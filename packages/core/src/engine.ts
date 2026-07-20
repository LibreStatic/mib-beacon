import netSnmpPkg from 'net-snmp/package.json';
import type { Transport, StorageAdapter } from '@mibbeacon/transport';
import { MibStore } from '@mibbeacon/smi';
import { EventBus } from './events';
import { MibBeaconError } from './errors';
import { SnmpSession } from './snmp/session';
import { TrapReceiver, type TrapRecord } from './snmp/receiver';
import { runMigrations } from './db/migrate';
import type { AgentSpec, DecodedVarbind, SnmpVarbindInput } from './snmp/types';
import type { EngineAPI, EngineInfo, OperationStartRequest } from './api/engine-api';
import { ResolverService } from './resolver-service';
import { validateMibFileBatch } from './mib-file-limits';
import { AsyncMutationQueue } from './async-mutex';
import { persistMibCatalog } from './db/mib-catalog-store';
import { AgentStore } from './db/agent-store';
import { SerializedSessionPool } from './ops/session-pool';
import { formatVarbindWithMib } from './snmp/varbind-format';
import { QueryArtifactStore } from './db/query-artifact-store';
import { createRowWithFallback } from './ops/row-status';
import { TrapStore } from './db/trap-store';
import { evaluateTrapRules } from './traps/rules';
import { ToolService } from './tools/service';
import { ENGINE_VERSION } from './generated/version';
import { LogService } from './logs';
import { PacketTraceService, type PacketTraceEvent } from './packet-trace';
import { LiveMibService } from './live-mibs/service';

export interface EngineOptions {
  /** SQLite file path; defaults to <dataDir>/mibbeacon.db. Pass ':memory:' for tests. */
  dbPath?: string;
  resolver?: {
    now?: () => number;
    consentTtlMs?: number;
    /** Defaults to the oid-base operator-friendly minimum of one second. */
    oidBaseIntervalMs?: number;
  };
  tools?: { now?: () => number };
  /** Deterministic test seam; production uses SnmpSession.get. */
  agentTester?: (agent: AgentSpec, oids: string[]) => Promise<DecodedVarbind[]>;
  /** Deterministic test seam; production uses SnmpSession.set. */
  agentSetter?: (
    agent: AgentSpec,
    varbinds: SnmpVarbindInput[],
  ) => Promise<DecodedVarbind[]>;
}

const MIB_URL_MAX_BYTES = 5 * 1024 * 1024;

function netSnmpVersion(): string {
  return (netSnmpPkg as { version?: string }).version ?? 'unknown';
}

export function createEngine(transport: Transport, opts: EngineOptions = {}): EngineAPI {
  const bus = new EventBus();
  const packetTrace = new PacketTraceService(transport.files, (kind, payload) =>
    bus.emit({ channel: 'packets', kind, payload }),
    opts.dbPath !== ':memory:',
  );
  const packetTraceReady = packetTrace.initialize();
  const tracePacket = (event: PacketTraceEvent) => packetTrace.record(event);
  const logService = new LogService(bus, Date.now, 1_000, transport.files);
  const dbPath = opts.dbPath ?? transport.files.join(transport.files.dataDir(), 'mibbeacon.db');
  let db: StorageAdapter | null = null;
  try {
    // Hosts pass an existing data dir (Electron userData / Expo documentDirectory);
    // tests use ':memory:'. No dir creation needed here.
    db = transport.storage.open(dbPath);
    runMigrations(db);
  } catch (e) {
    // The UI must still work if the DB can't open; log and continue.
    logService.write('error', `DB init failed: ${String(e)}`);
    try {
      db = transport.storage.open(':memory:');
      runMigrations(db);
    } catch {
      /* transport storage is unavailable; handled below */
    }
  }

  // --- MIB store: base modules + persisted user modules ---
  const mibStore = new MibStore();
  const mibMutations = new AsyncMutationQueue();
  if (db) {
    try {
      const rows = db.all<{ name: string; content: string }>(
        'SELECT name, content FROM mib_modules ORDER BY loaded_at',
      );
      if (rows.length > 0) {
        mibStore.importTexts(rows.map((r) => ({ name: r.name, content: r.content })));
      }
    } catch (e) {
      logService.write('error', `MIB reload failed: ${String(e)}`);
    }
  }

  async function persistCatalog(): Promise<void> {
    if (!db) return;
    await persistMibCatalog(db, transport.files, mibStore);
  }

  /** Decorate decoded varbinds with MIB-resolved display names. */
  function named(varbinds: DecodedVarbind[]): DecodedVarbind[] {
    for (const vb of varbinds) {
      const r = mibStore.index.resolve(vb.oid);
      if (r) {
        vb.name = r.name;
        Object.assign(vb, formatVarbindWithMib(vb, mibStore.index.node(r.definitionOid)));
      }
    }
    return varbinds;
  }

  // --- trap receiver state; records and configuration live in SQLite. ---
  let receiver: TrapReceiver | null = null;
  let receiverPort: number | undefined;
  let receiverTransports: ('udp4' | 'udp6')[] = [];
  let receiverDrops = 0;
  let receiverRingCap = 50_000;

  // --- active walk sessions, keyed by handleId, for cancellation ---
  const activeOperations = new Map<string, Map<string, SnmpSession>>();
  const operationKeys = new Map<string, Set<string>>();
  const cancelledOperations = new Set<string>();
  const sessions = new SerializedSessionPool<SnmpSession>();
  let walkSeq = 0;

  const ciphers = {
    des: transport.crypto.hasCipher('des-cbc'),
    aes128: transport.crypto.hasCipher('aes-128-cfb'),
    aes256: transport.crypto.hasCipher('aes-256-cfb'),
  };

  if (!db) throw new MibBeaconError('INTERNAL', 'Resolver requires an available storage adapter');
  const resolverService = new ResolverService(
    transport,
    db,
    mibStore,
    bus,
    mibMutations,
    opts.resolver,
  );
  const agentStore = new AgentStore(db, transport);
  const queryArtifacts = new QueryArtifactStore(db, transport);
  const trapStore = new TrapStore(db, transport);
  const toolService = new ToolService(
    transport,
    db,
    bus,
    agentStore,
    mibStore,
    queryArtifacts,
    opts.agentTester,
    opts.tools?.now,
    tracePacket,
  );
  const liveMibService = new LiveMibService(db, transport.files, transport.udp, mibStore, bus, {
    resolveAgent: async (target) => (await operationAgent(target)).agent,
    get: async (agent, oids) => {
      if (opts.agentTester) return opts.agentTester(agent, oids);
      const session = new SnmpSession(agent, tracePacket);
      try {
        return await session.get(oids);
      } finally {
        session.close();
      }
    },
    walk: async (agent, oid, onBatch, signal) => {
      const session = new SnmpSession(agent, tracePacket);
      const close = () => session.close();
      signal.addEventListener('abort', close, { once: true });
      try {
        if (!signal.aborted) await session.walk(oid, onBatch);
      } finally {
        signal.removeEventListener('abort', close);
        session.close();
      }
    },
    set: async (agent, varbinds) => {
      if (opts.agentSetter) return opts.agentSetter(agent, varbinds);
      const session = new SnmpSession(agent, tracePacket);
      try {
        return await session.set(varbinds);
      } finally {
        session.close();
      }
    },
    decorate: named,
  });

  function decorateAndStoreTrap(record: TrapRecord): TrapRecord {
    named(record.varbinds);
    if (record.trapOid) {
      const definition = mibStore.index.node(record.trapOid);
      if (definition) {
        record.trapName = definition.name;
        record.trapDescription = definition.description;
        const expected = (definition.objects ?? []).map((objectName) => {
          const node = mibStore.index.node(objectName);
          return node ? `${node.name}|${node.oid}` : objectName;
        });
        const expectedOids = expected.map((item) => item.split('|').at(-1)!);
        const payload = record.varbinds.filter(
          ({ oid }) => oid !== '1.3.6.1.2.1.1.3.0' && oid !== '1.3.6.1.6.3.1.1.4.1.0',
        );
        record.expectedObjects = expected;
        record.missingObjects = expected.filter(
          (item, index) =>
            !payload.some(
              ({ oid }) => oid === expectedOids[index] || oid.startsWith(`${expectedOids[index]}.`),
            ),
        );
        record.extraObjects = payload
          .filter(
            ({ oid }) =>
              !expectedOids.some(
                (expectedOid) => oid === expectedOid || oid.startsWith(`${expectedOid}.`),
              ),
          )
          .map(({ name, oid }) => name ?? oid);
      }
    }
    const evaluation = evaluateTrapRules(trapStore.listRules(), record);
    record.matchedRuleIds = evaluation.matchedRuleIds;
    if (evaluation.actions.severity) record.severity = evaluation.actions.severity;
    if (evaluation.actions.color) record.color = evaluation.actions.color;
    trapStore.insert(record, receiverRingCap);
    if (evaluation.notifyRules.length > 0) {
      bus.emit({
        channel: 'traps',
        kind: 'rule-notification',
        payload: {
          record,
          rules: evaluation.notifyRules.map(({ id, name }) => ({ id, name })),
        },
      });
    }
    return record;
  }

  async function operationAgent(target: {
    agent?: AgentSpec;
    agentId?: string;
  }): Promise<{ agent: AgentSpec; sessionKey: string }> {
    if (target.agentId) {
      const agent = await agentStore.resolve(target.agentId);
      await agentStore.api.markUsed(target.agentId);
      return { agent, sessionKey: `saved:${target.agentId}` };
    }
    if (target.agent) {
      return { agent: target.agent, sessionKey: `adhoc:${JSON.stringify(target.agent)}` };
    }
    throw new MibBeaconError('REQ_FAILED', 'An ad-hoc agent or saved agent id is required');
  }

  async function withSession<R>(
    target: { agent?: AgentSpec; agentId?: string },
    task: (session: SnmpSession, agent: AgentSpec) => Promise<R>,
  ): Promise<R> {
    const { agent, sessionKey } = await operationAgent(target);
    return sessions.run(
      sessionKey,
      () => new SnmpSession(agent, tracePacket),
      (session) => task(session, agent),
    );
  }

  async function startOperation(req: OperationStartRequest) {
    const handleId = `op-${Date.now()}-${walkSeq++}`;
    const startedAt = Date.now();
    let count = 0;
    let pduCount = 0;
    const keys = new Set<string>();
    operationKeys.set(handleId, keys);
    const emitBatch = (
      batch: DecodedVarbind[],
      identity?: { agentId: string; agentName: string },
    ) => {
      if (batch.length === 0 || cancelledOperations.has(handleId)) return;
      pduCount += 1;
      count += batch.length;
      const decorated = named(batch).map((varbind) =>
        identity ? { ...varbind, ...identity } : varbind,
      );
      for (let offset = 0; offset < decorated.length; offset += 50) {
        bus.emit({
          channel: 'ops',
          handleId,
          kind: 'batch',
          payload: decorated.slice(offset, offset + 50),
        });
      }
    };

    const execute = async (
      target: { agent?: AgentSpec; agentId?: string },
      identity?: { agentId: string; agentName: string },
    ): Promise<number> => {
      const { agent, sessionKey } = await operationAgent(target);
      keys.add(sessionKey);
      let agentCount = 0;
      const agentBatch = (batch: DecodedVarbind[]) => {
        agentCount += batch.length;
        bus.emit({
          channel: 'ops',
          handleId,
          kind: 'pdu',
          payload: {
            direction: 'response',
            operation: req.kind,
            ...(identity ?? {}),
            varbinds: batch,
          },
        });
        emitBatch(batch, identity);
      };
      await sessions.run(
        sessionKey,
        () => new SnmpSession(agent, tracePacket),
        async (session) => {
          let active = activeOperations.get(handleId);
          if (!active) {
            active = new Map();
            activeOperations.set(handleId, active);
          }
          active.set(sessionKey, session);
          if (cancelledOperations.has(handleId)) return;
          bus.emit({
            channel: 'ops',
            handleId,
            kind: 'pdu',
            payload: {
              direction: 'request',
              operation: req.kind,
              ...(identity ?? {}),
              security: {
                version: agent.version,
                ...(agent.v3
                  ? {
                      user: agent.v3.user,
                      level: agent.v3.level,
                      authProtocol: agent.v3.authProtocol,
                      privProtocol: agent.v3.privProtocol,
                      context: agent.v3.context,
                    }
                  : {}),
              },
              ...('oids' in req ? { oids: req.oids } : {}),
              ...('baseOid' in req ? { baseOid: req.baseOid } : {}),
              ...('varbinds' in req
                ? {
                    varbinds: req.varbinds.map(({ oid, type, value, encoding }) => ({
                      oid,
                      type,
                      value,
                      encoding,
                    })),
                  }
                : {}),
            },
          });
          if (req.kind === 'get') {
            agentBatch(
              opts.agentTester
                ? await opts.agentTester(agent, req.oids)
                : await session.get(req.oids),
            );
          } else if (req.kind === 'getNext') {
            agentBatch(await session.getNext(req.oids));
          } else if (req.kind === 'getBulk') {
            agentBatch(await session.getBulk(req.oids, req.nonRepeaters, req.maxRepetitions));
          } else if (req.kind === 'set') {
            agentBatch(await session.set(req.varbinds));
          } else if (
            req.kind === 'walk' ||
            req.kind === 'subtree-fetch' ||
            req.kind === 'table-fetch'
          ) {
            const bases =
              req.kind === 'table-fetch' && req.columnOids?.length ? req.columnOids : [req.baseOid];
            for (const baseOid of bases) {
              await session.walk(baseOid, agentBatch, {
                maxRepetitions: req.maxRepetitions,
                maxVarbinds: req.maxVarbinds,
              });
            }
          }
          active.delete(sessionKey);
        },
      );
      return agentCount;
    };

    const runSingle = async () => {
      await execute(req);
      return { succeeded: 1, failed: 0 };
    };

    const runGroup = async (groupId: string, concurrency?: number) => {
      const group = await agentStore.api.groups.get(groupId);
      if (!group) throw new MibBeaconError('REQ_FAILED', `Agent group ${groupId} does not exist`);
      const targets = await Promise.all(
        group.agentIds.map(async (agentId) => {
          const profile = await agentStore.api.get(agentId);
          if (!profile) throw new MibBeaconError('REQ_FAILED', `Agent ${agentId} does not exist`);
          return { agentId, agentName: profile.name };
        }),
      );
      let next = 0;
      let succeeded = 0;
      let failed = 0;
      const worker = async () => {
        while (next < targets.length && !cancelledOperations.has(handleId)) {
          const target = targets[next++]!;
          bus.emit({
            channel: 'ops',
            handleId,
            kind: 'agent-status',
            payload: { ...target, state: 'running' },
          });
          try {
            const agentCount = await execute(
              { agentId: target.agentId },
              { agentId: target.agentId, agentName: target.agentName },
            );
            succeeded += 1;
            bus.emit({
              channel: 'ops',
              handleId,
              kind: 'agent-status',
              payload: { ...target, state: 'done', count: agentCount },
            });
          } catch (error) {
            failed += 1;
            const detail =
              error instanceof MibBeaconError ? error.toJSON() : { message: String(error) };
            bus.emit({
              channel: 'ops',
              handleId,
              kind: 'agent-status',
              payload: { ...target, state: 'error', error: detail },
            });
          }
        }
      };
      const width = Math.max(1, Math.min(20, concurrency ?? 5, targets.length || 1));
      await Promise.all(Array.from({ length: width }, worker));
      return { succeeded, failed };
    };

    const run = async () => {
      if (cancelledOperations.has(handleId)) return;
      const aggregate =
        'groupId' in req ? await runGroup(req.groupId, req.concurrency) : await runSingle();
      return aggregate;
    };

    void run()
      .then((aggregate) => {
        if (cancelledOperations.has(handleId)) return;
        bus.emit({
          channel: 'ops',
          handleId,
          kind: 'done',
          payload: { count, pduCount, durationMs: Date.now() - startedAt, ...aggregate },
        });
      })
      .catch((err) => {
        if (cancelledOperations.has(handleId)) return;
        bus.emit({
          channel: 'ops',
          handleId,
          kind: 'error',
          payload: err instanceof MibBeaconError ? err.toJSON() : { message: String(err) },
        });
      })
      .finally(() => {
        activeOperations.delete(handleId);
        operationKeys.delete(handleId);
        cancelledOperations.delete(handleId);
      });
    return { handleId };
  }

  return {
    system: {
      async info(): Promise<EngineInfo> {
        return {
          platform: transport.platform,
          engineVersion: ENGINE_VERSION,
          netSnmpVersion: netSnmpVersion(),
          ciphers,
        };
      },
    },

    packets: {
      async history() {
        await packetTraceReady;
        return packetTrace.history();
      },
      async status() {
        await packetTraceReady;
        return packetTrace.status();
      },
      async updateSettings(patch) {
        await packetTraceReady;
        return packetTrace.updateSettings(patch);
      },
      async retryPersistence() {
        await packetTraceReady;
        return packetTrace.retryPersistence();
      },
      async clear() {
        await packetTraceReady;
        return packetTrace.clear();
      },
      export: {
        async create() {
          await packetTraceReady;
          await packetTrace.flush();
          return packetTrace.createExport();
        },
        async readChunk(id, offset, limit) {
          return packetTrace.readExportChunk(id, offset, limit);
        },
        async dispose(id) {
          packetTrace.disposeExport(id);
        },
      },
    },

    mibs: {
      async inspectFiles(files) {
        validateMibFileBatch(files);
        return mibStore.inspectFiles(files);
      },

      async replacementGroup(moduleName) {
        return mibStore.replacementGroup(moduleName);
      },

      async importTexts(files) {
        const result = await mibMutations.run(async () => {
          const result = mibStore.importTexts(files);
          if (result.loaded.length > 0) await persistCatalog();
          return result;
        });
        if (result.loaded.length > 0)
          bus.emit({
            channel: 'tools',
            kind: 'catalog-changed',
            payload: { action: 'import', modules: result.loaded },
          });
        return result;
      },

      async importUrl(url) {
        const res = await transport.http.fetch({ url, maxBytes: MIB_URL_MAX_BYTES });
        if (!res.ok) {
          throw new MibBeaconError('SOURCE_UNREACHABLE', `fetch failed with HTTP ${res.status}`);
        }
        // Guard against HTML soft-200s before feeding the parser (plan 06 rule).
        const head = res.text.slice(0, 2048);
        if (/<html|<!doctype/i.test(head) || !/DEFINITIONS\s*::=\s*BEGIN/.test(res.text)) {
          throw new MibBeaconError('CONTENT_VALIDATION_FAILED', 'response is not a MIB module', {
            hint: 'The URL returned something that does not look like SMI text (no DEFINITIONS ::= BEGIN).',
          });
        }
        const name = url.split('/').pop() || 'downloaded-mib';
        const result = await mibMutations.run(async () => {
          const result = mibStore.importTexts([{ name, content: res.text }]);
          if (result.loaded.length > 0) await persistCatalog();
          return result;
        });
        if (result.loaded.length > 0)
          bus.emit({
            channel: 'tools',
            kind: 'catalog-changed',
            payload: { action: 'import', modules: result.loaded },
          });
        return result;
      },

      async startImport(request) {
        if ('files' in request && request.files) validateMibFileBatch(request.files);
        return resolverService.startImport(request);
      },

      async list() {
        return mibStore.listModules();
      },

      async module(moduleName) {
        return mibStore.module(moduleName);
      },

      async moduleTree(moduleName, oid) {
        return mibStore.moduleChildren(moduleName, oid);
      },

      async unload(moduleName) {
        await mibMutations.run(async () => {
          mibStore.unload(moduleName);
          await persistCatalog();
        });
        bus.emit({
          channel: 'tools',
          kind: 'catalog-changed',
          payload: { action: 'unload', moduleName },
        });
      },

      async tree(oid) {
        return mibStore.index.children(oid);
      },

      async node(oidOrName, moduleName) {
        return mibStore.index.node(oidOrName, moduleName);
      },

      async search(query, limit) {
        return mibStore.index.search(query, limit);
      },

      async moduleSearch(moduleName, query, limit) {
        return mibStore.index.searchModule(moduleName, query, limit);
      },

      async resolve(oid) {
        return mibStore.index.resolve(oid);
      },

      async translate(oidOrName) {
        return mibStore.index.translate(oidOrName);
      },
    },

    liveMibs: liveMibService.api,

    ops: {
      async get(req) {
        if (opts.agentTester) {
          const { agent } = await operationAgent(req);
          return named(await opts.agentTester(agent, req.oids));
        }
        return withSession(req, async (session) => named(await session.get(req.oids)));
      },

      async getNext(req) {
        return withSession(req, async (session) => named(await session.getNext(req.oids)));
      },

      async getBulk(req) {
        return withSession(req, async (session) =>
          named(await session.getBulk(req.oids, req.nonRepeaters, req.maxRepetitions)),
        );
      },

      async set(req) {
        return withSession(req, async (session) => named(await session.set(req.varbinds)));
      },

      async start(req) {
        return startOperation(req);
      },

      async startWalk(req) {
        return startOperation({ ...req, kind: 'walk' });
      },

      async cancel(handleId) {
        const active = activeOperations.get(handleId);
        const sessionKeys = operationKeys.get(handleId);
        if (sessionKeys) {
          cancelledOperations.add(handleId);
          if (active) {
            for (const session of active.values()) session.close();
            activeOperations.delete(handleId);
          }
          for (const sessionKey of sessionKeys) sessions.invalidate(sessionKey);
          bus.emit({ channel: 'ops', handleId, kind: 'error', payload: { code: 'CANCELLED' } });
        }
      },
      bookmarks: {
        list: async () => queryArtifacts.listBookmarks(),
        create: async (input) => queryArtifacts.createBookmark(input),
        delete: async (id) => queryArtifacts.deleteBookmark(id),
      },
      snapshots: {
        list: async () => queryArtifacts.listSnapshots(),
        create: async (input) => queryArtifacts.createSnapshot(input),
        get: async (id) => queryArtifacts.getSnapshot(id),
        delete: async (id) => queryArtifacts.deleteSnapshot(id),
      },
      async createTableRow(req) {
        return withSession(req, async (session) => {
          const result = await createRowWithFallback(
            (varbinds) => session.set(varbinds),
            req.rowStatusOid,
            req.requiredColumns,
          );
          return { ...result, varbinds: named(result.varbinds) };
        });
      },
      async deleteTableRow(req) {
        return withSession(req, async (session) =>
          named(await session.set([{ oid: req.rowStatusOid, type: 'Integer', value: '6' }])),
        );
      },
    },

    traps: {
      async startReceiver(cfg) {
        if (receiver) await receiver.stop();
        const storedUsers = await trapStore.resolveV3Users();
        receiverRingCap = Math.max(100, Math.min(500_000, Math.trunc(cfg.ringCap ?? 50_000)));
        const nextReceiver = new TrapReceiver(
          (rec) => {
            const stored = decorateAndStoreTrap(rec);
            bus.emit({ channel: 'traps', kind: 'trap', payload: stored });
          },
          (err) => bus.emit({ channel: 'traps', kind: 'error', payload: String(err) }),
          tracePacket,
        );
        const requestedPort = cfg.port ?? (transport.platform === 'node' ? 162 : 1162);
        try {
          let bound: { port: number; transports: ('udp4' | 'udp6')[] };
          try {
            bound = await nextReceiver.start({
              ...cfg,
              port: requestedPort,
              v3Users: [...storedUsers, ...(cfg.v3Users ?? [])],
            });
          } catch (error) {
            if (
              cfg.port === undefined &&
              transport.platform === 'node' &&
              error instanceof MibBeaconError &&
              error.code === 'PORT_BIND_DENIED'
            ) {
              bound = await nextReceiver.start({
                ...cfg,
                port: 1162,
                v3Users: [...storedUsers, ...(cfg.v3Users ?? [])],
              });
            } else {
              throw error;
            }
          }
          receiver = nextReceiver;
          receiverPort = bound.port;
          receiverTransports = bound.transports;
          receiverDrops = nextReceiver.dropCount;
          const status = {
            running: true,
            port: bound.port,
            count: trapStore.count(),
            drops: receiverDrops,
            transports: receiverTransports,
          };
          bus.emit({ channel: 'traps', kind: 'status', payload: status });
          return status;
        } catch (error) {
          await nextReceiver.stop();
          receiver = null;
          receiverPort = undefined;
          receiverTransports = [];
          throw error;
        }
      },

      async stopReceiver() {
        if (receiver) {
          receiverDrops = receiver.dropCount;
          await receiver.stop();
          receiver = null;
          receiverPort = undefined;
          receiverTransports = [];
        }
        bus.emit({
          channel: 'traps',
          kind: 'status',
          payload: { running: false, count: trapStore.count(), drops: receiverDrops },
        });
      },

      async status() {
        if (receiver) receiverDrops = receiver.dropCount;
        return {
          running: receiver !== null,
          port: receiverPort,
          count: trapStore.count(),
          drops: receiverDrops,
          ...(receiverTransports.length ? { transports: receiverTransports } : {}),
        };
      },

      async list() {
        return trapStore.list();
      },

      async query(query) {
        return trapStore.query(query);
      },

      async markRead(ids, read = true) {
        trapStore.markRead(ids, read);
      },

      async delete(ids) {
        trapStore.delete(ids);
        bus.emit({ channel: 'traps', kind: 'removed', payload: { ids } });
      },

      async unreadCount() {
        return trapStore.unreadCount();
      },

      async clear() {
        trapStore.clear();
        bus.emit({ channel: 'traps', kind: 'cleared', payload: { count: 0 } });
      },

      v3Users: {
        list: async () => trapStore.listV3Users(),
        upsert: async (draft) => trapStore.upsertV3User(draft),
        remove: async (name) => trapStore.removeV3User(name),
      },

      savedFilters: {
        list: async () => trapStore.listFilters(),
        save: async (name, query) => trapStore.saveFilter(name, query),
        remove: async (id) => trapStore.removeFilter(id),
      },

      presets: {
        list: async () => trapStore.listPresets(),
        save: async (name, agentId, payload) => trapStore.savePreset(name, agentId, payload),
        remove: async (id) => trapStore.removePreset(id),
      },

      rules: {
        list: async () => trapStore.listRules(),
        create: async (draft) => trapStore.createRule(draft),
        update: async (id, draft) => trapStore.updateRule(id, draft),
        remove: async (id) => trapStore.removeRule(id),
      },

      async send(req) {
        const target = 'agentId' in req ? await agentStore.resolve(req.agentId) : req.target;
        if ('agentId' in req) await agentStore.api.markUsed(req.agentId);
        const session = new SnmpSession(target, tracePacket);
        try {
          const payload =
            'agentId' in req
              ? (({ agentId: _agentId, ...value }) => value)(req)
              : (({ target: _target, ...value }) => value)(req);
          return await session.sendNotification(payload);
        } finally {
          session.close();
        }
      },
    },

    events: {
      subscribe: (channel, listener) => bus.subscribe(channel, listener),
    },

    agents: {
      ...agentStore.api,
      async update(id, draft) {
        const profile = await agentStore.api.update(id, draft);
        sessions.invalidate(`saved:${id}`);
        return profile;
      },
      async delete(id) {
        await agentStore.api.delete(id);
        sessions.invalidate(`saved:${id}`);
      },
      async test(id) {
        const agent = await agentStore.resolve(id);
        const oids = ['1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.3.0', '1.3.6.1.2.1.1.2.0'];
        const started = Date.now();
        let varbinds: DecodedVarbind[];
        if (opts.agentTester) varbinds = await opts.agentTester(agent, oids);
        else {
          const session = new SnmpSession(agent, tracePacket);
          try {
            varbinds = await session.get(oids);
          } finally {
            session.close();
          }
        }
        await agentStore.api.markUsed(id);
        return { latencyMs: Math.max(0, Date.now() - started), varbinds: named(varbinds) };
      },
    },
    resolver: resolverService.api,
    tools: toolService.api,
    logs: logService.api,
  };
}
