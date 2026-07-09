/**
 * Host-side engine dispatch, shared by every out-of-process host (Electron main,
 * LAN server). Maps a method name + args onto the EngineAPI and serializes the
 * result (incl. OmcError) so it can cross IPC or a WebSocket. Spike-scope method
 * list; grows alongside the EngineAPI in later plans.
 *
 * Type-only imports keep this free of the engine implementation / net-snmp.
 */
import type { EngineAPI } from './api/engine-api';
import type { EngineEventChannel } from './events';
import type { BridgeResult } from './proxy';

type Handler = (engine: EngineAPI, ...args: unknown[]) => unknown;

export const ENGINE_METHODS: Record<string, Handler> = {
  'system.info': (e) => e.system.info(),
  'ops.get': (e, req) => e.ops.get(req as never),
  'ops.startWalk': (e, req) => e.ops.startWalk(req as never),
  'ops.cancel': (e, id) => e.ops.cancel(id as string),
  'traps.startReceiver': (e, cfg) => e.traps.startReceiver(cfg as never),
  'traps.stopReceiver': (e) => e.traps.stopReceiver(),
  'traps.status': (e) => e.traps.status(),
  'traps.list': (e) => e.traps.list(),
  'traps.clear': (e) => e.traps.clear(),
};

export const ENGINE_EVENT_CHANNELS: EngineEventChannel[] = [
  'ops',
  'traps',
  'resolver',
  'tools',
  'logs',
];

export async function dispatchEngineCall(
  engine: EngineAPI,
  method: string,
  args: unknown[],
): Promise<BridgeResult> {
  const fn = ENGINE_METHODS[method];
  if (!fn) return { ok: false, error: { code: 'INTERNAL', message: `unknown method: ${method}` } };
  try {
    return { ok: true, value: await fn(engine, ...args) };
  } catch (err) {
    const e = err as { code?: string; message?: string; hint?: string };
    return {
      ok: false,
      error: { code: e.code ?? 'INTERNAL', message: e.message ?? String(err), hint: e.hint },
    };
  }
}
