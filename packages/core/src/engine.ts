import { createRequire } from 'node:module';
import type { Transport, StorageAdapter } from '@omc/transport';
import { EventBus } from './events.js';
import { OmcError } from './errors.js';
import { SnmpSession } from './snmp/session.js';
import { TrapReceiver, type TrapRecord } from './snmp/receiver.js';
import { runMigrations } from './db/migrate.js';
import type { EngineAPI, EngineInfo, StubDomain } from './api/engine-api.js';

const require = createRequire(import.meta.url);

export interface EngineOptions {
  /** SQLite file path; defaults to <dataDir>/omc.db. Pass ':memory:' for tests. */
  dbPath?: string;
}

const ENGINE_VERSION = '0.0.0';
const TRAP_RING_CAP = 5000;

function stub(plannedIn: string): StubDomain {
  return { plannedIn };
}

function netSnmpVersion(): string {
  try {
    return (require('net-snmp/package.json') as { version: string }).version;
  } catch {
    return 'unknown';
  }
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
    // The spike screen must still work if the DB can't open; log and continue.
    bus.emit({ channel: 'logs', kind: 'error', payload: `DB init failed: ${String(e)}` });
  }

  // --- trap receiver state (in-memory ring for the spike) ---
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

    ops: {
      async get(req) {
        const session = new SnmpSession(req.agent);
        try {
          return await session.get(req.oids);
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
            (batch) => bus.emit({ channel: 'ops', handleId, kind: 'batch', payload: batch }),
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

    mibs: stub('plan 03'),
    agents: stub('plan 04'),
    resolver: stub('plan 06'),
    tools: stub('plan 08'),
    logs: stub('plan 04'),
  };
}
