import netSnmpPkg from 'net-snmp/package.json';
import type { Transport, StorageAdapter } from '@omc/transport';
import { MibStore } from '@omc/smi';
import { EventBus } from './events';
import { OmcError } from './errors';
import { SnmpSession } from './snmp/session';
import { TrapReceiver, type TrapRecord } from './snmp/receiver';
import { runMigrations } from './db/migrate';
import type { DecodedVarbind } from './snmp/types';
import type { EngineAPI, EngineInfo, StubDomain } from './api/engine-api';
import { ResolverService } from './resolver-service';
import { validateMibFileBatch } from './mib-file-limits';
import { AsyncMutationQueue } from './async-mutex';

export interface EngineOptions {
  /** SQLite file path; defaults to <dataDir>/omc.db. Pass ':memory:' for tests. */
  dbPath?: string;
  resolver?: {
    now?: () => number;
    consentTtlMs?: number;
  };
}

const ENGINE_VERSION = '0.0.0';
const TRAP_RING_CAP = 5000;
const MIB_URL_MAX_BYTES = 5 * 1024 * 1024;

function stub(plannedIn: string): StubDomain {
  return { plannedIn };
}

function netSnmpVersion(): string {
  return (netSnmpPkg as { version?: string }).version ?? 'unknown';
}

export function createEngine(transport: Transport, opts: EngineOptions = {}): EngineAPI {
  const bus = new EventBus();
  const dbPath = opts.dbPath ?? transport.files.join(transport.files.dataDir(), 'omc.db');
  let db: StorageAdapter | null = null;
  try {
    // Hosts pass an existing data dir (Electron userData / Expo documentDirectory);
    // tests use ':memory:'. No dir creation needed here.
    db = transport.storage.open(dbPath);
    runMigrations(db);
  } catch (e) {
    // The UI must still work if the DB can't open; log and continue.
    bus.emit({ channel: 'logs', kind: 'error', payload: `DB init failed: ${String(e)}` });
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
      bus.emit({ channel: 'logs', kind: 'error', payload: `MIB reload failed: ${String(e)}` });
    }
  }

  function persistCatalog(): void {
    if (!db) return;
    db.transaction(() => {
      db!.run('DELETE FROM mib_modules');
      for (const document of mibStore.userSourceDocuments()) {
        db!.run(
          'INSERT INTO mib_modules (name, content, loaded_at) VALUES (?, ?, ?)',
          [document.name, document.content, Date.now()],
        );
      }
    });
  }

  /** Decorate decoded varbinds with MIB-resolved display names. */
  function named(varbinds: DecodedVarbind[]): DecodedVarbind[] {
    for (const vb of varbinds) {
      const r = mibStore.index.resolve(vb.oid);
      if (r) vb.name = r.name;
    }
    return varbinds;
  }

  // --- trap receiver state (in-memory ring; SQLite store lands in plan 05) ---
  let receiver: TrapReceiver | null = null;
  let receiverPort: number | undefined;
  const traps: TrapRecord[] = [];

  // --- active walk sessions, keyed by handleId, for cancellation ---
  const walks = new Map<string, SnmpSession>();
  let walkSeq = 0;

  const ciphers = {
    des: transport.crypto.hasCipher('des-cbc'),
    aes128: transport.crypto.hasCipher('aes-128-cfb'),
    aes256: transport.crypto.hasCipher('aes-256-cfb'),
  };

  if (!db) throw new OmcError('INTERNAL', 'Resolver requires an available storage adapter');
  const resolverService = new ResolverService(
    transport,
    db,
    mibStore,
    bus,
    mibMutations,
    opts.resolver,
  );

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

    mibs: {
      async inspectFiles(files) {
        validateMibFileBatch(files);
        return mibStore.inspectFiles(files);
      },

      async replacementGroup(moduleName) {
        return mibStore.replacementGroup(moduleName);
      },

      async importTexts(files) {
        const result = await mibMutations.run(() => {
          const result = mibStore.importTexts(files);
          if (result.loaded.length > 0) persistCatalog();
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
          throw new OmcError('SOURCE_UNREACHABLE', `fetch failed with HTTP ${res.status}`);
        }
        // Guard against HTML soft-200s before feeding the parser (plan 06 rule).
        const head = res.text.slice(0, 2048);
        if (/<html|<!doctype/i.test(head) || !/DEFINITIONS\s*::=\s*BEGIN/.test(res.text)) {
          throw new OmcError('CONTENT_VALIDATION_FAILED', 'response is not a MIB module', {
            hint: 'The URL returned something that does not look like SMI text (no DEFINITIONS ::= BEGIN).',
          });
        }
        const name = url.split('/').pop() || 'downloaded-mib';
        const result = await mibMutations.run(() => {
          const result = mibStore.importTexts([{ name, content: res.text }]);
          if (result.loaded.length > 0) persistCatalog();
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
        await mibMutations.run(() => {
          mibStore.unload(moduleName);
          persistCatalog();
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
    },

    ops: {
      async get(req) {
        const session = new SnmpSession(req.agent);
        try {
          return named(await session.get(req.oids));
        } finally {
          session.close();
        }
      },

      async getNext(req) {
        const session = new SnmpSession(req.agent);
        try {
          return named(await session.getNext(req.oids));
        } finally {
          session.close();
        }
      },

      async set(req) {
        const session = new SnmpSession(req.agent);
        try {
          return named(await session.set(req.varbinds));
        } finally {
          session.close();
        }
      },

      async startWalk(req) {
        const handleId = `walk-${Date.now()}-${walkSeq++}`;
        const session = new SnmpSession(req.agent);
        walks.set(handleId, session);
        // Run detached; results stream over the bus.
        session
          .walk(
            req.baseOid,
            (batch) => bus.emit({ channel: 'ops', handleId, kind: 'batch', payload: named(batch) }),
            { maxRepetitions: req.maxRepetitions },
          )
          .then((count) => bus.emit({ channel: 'ops', handleId, kind: 'done', payload: { count } }))
          .catch((err) =>
            bus.emit({
              channel: 'ops',
              handleId,
              kind: 'error',
              payload: err instanceof OmcError ? err.toJSON() : { message: String(err) },
            }),
          )
          .finally(() => {
            walks.get(handleId)?.close();
            walks.delete(handleId);
          });
        return { handleId };
      },

      async cancel(handleId) {
        const session = walks.get(handleId);
        if (session) {
          session.close();
          walks.delete(handleId);
          bus.emit({ channel: 'ops', handleId, kind: 'error', payload: { code: 'CANCELLED' } });
        }
      },
    },

    traps: {
      async startReceiver(cfg) {
        if (receiver) await receiver.stop();
        receiver = new TrapReceiver(
          (rec) => {
            named(rec.varbinds);
            if (rec.trapOid) rec.trapName = mibStore.index.resolve(rec.trapOid)?.name;
            traps.unshift(rec);
            if (traps.length > TRAP_RING_CAP) traps.length = TRAP_RING_CAP;
            bus.emit({ channel: 'traps', kind: 'trap', payload: rec });
          },
          (err) => bus.emit({ channel: 'traps', kind: 'error', payload: String(err) }),
        );
        const { port } = receiver.start(cfg);
        receiverPort = port;
        const status = { running: true, port, count: traps.length };
        bus.emit({ channel: 'traps', kind: 'status', payload: status });
        return status;
      },

      async stopReceiver() {
        if (receiver) {
          await receiver.stop();
          receiver = null;
          receiverPort = undefined;
        }
        bus.emit({
          channel: 'traps',
          kind: 'status',
          payload: { running: false, count: traps.length },
        });
      },

      async status() {
        return { running: receiver !== null, port: receiverPort, count: traps.length };
      },

      async list() {
        return traps.slice();
      },

      async clear() {
        traps.length = 0;
        bus.emit({ channel: 'traps', kind: 'cleared', payload: { count: 0 } });
      },

      async send(req) {
        const session = new SnmpSession(req.target);
        try {
          const { target: _target, ...payload } = req;
          return await session.sendNotification(payload);
        } finally {
          session.close();
        }
      },
    },

    events: {
      subscribe: (channel, listener) => bus.subscribe(channel, listener),
    },

    agents: stub('plan 04'),
    resolver: resolverService.api,
    tools: stub('plan 08'),
    logs: stub('plan 04'),
  };
}
