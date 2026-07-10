import netSnmpPkg from 'net-snmp/package.json';
import type { Transport, StorageAdapter } from '@omc/transport';
import { MibStore } from '@omc/smi';
import type { ImportResult } from '@omc/smi';
import { EventBus } from './events';
import { OmcError } from './errors';
import { SnmpSession } from './snmp/session';
import { TrapReceiver, type TrapRecord } from './snmp/receiver';
import { runMigrations } from './db/migrate';
import type { DecodedVarbind } from './snmp/types';
import type { EngineAPI, EngineInfo, StubDomain } from './api/engine-api';

export interface EngineOptions {
  /** SQLite file path; defaults to <dataDir>/omc.db. Pass ':memory:' for tests. */
  dbPath?: string;
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
  }

  // --- MIB store: base modules + persisted user modules ---
  const mibStore = new MibStore();
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

  function persistLoadedModules(result: ImportResult): void {
    if (!db) return;
    for (const moduleName of result.loaded) {
      const content = mibStore.getSource(moduleName);
      if (content === undefined) continue;
      db.run(
        `INSERT INTO mib_modules (name, content, loaded_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET content = excluded.content, loaded_at = excluded.loaded_at`,
        [moduleName, content, Date.now()],
      );
    }
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
      async importTexts(files) {
        const result = mibStore.importTexts(files);
        persistLoadedModules(result);
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
        const result = mibStore.importTexts([{ name, content: res.text }]);
        persistLoadedModules(result);
        return result;
      },

      async list() {
        return mibStore.listModules();
      },

      async unload(moduleName) {
        mibStore.unload(moduleName);
        db?.run('DELETE FROM mib_modules WHERE name = ?', [moduleName]);
      },

      async tree(oid) {
        return mibStore.index.children(oid);
      },

      async node(oidOrName) {
        return mibStore.index.node(oidOrName);
      },

      async search(query, limit) {
        return mibStore.index.search(query, limit);
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
        return { running: true, port, count: traps.length };
      },

      async stopReceiver() {
        if (receiver) {
          await receiver.stop();
          receiver = null;
          receiverPort = undefined;
        }
      },

      async status() {
        return { running: receiver !== null, port: receiverPort, count: traps.length };
      },

      async list() {
        return traps.slice();
      },

      async clear() {
        traps.length = 0;
      },
    },

    events: {
      subscribe: (channel, listener) => bus.subscribe(channel, listener),
    },

    agents: stub('plan 04'),
    resolver: stub('plan 06'),
    tools: stub('plan 08'),
    logs: stub('plan 04'),
  };
}
