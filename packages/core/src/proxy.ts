/**
 * Renderer-safe EngineAPI proxy. Any host that runs the engine out-of-process
 * (Electron main over IPC, a LAN server over WebSocket) exposes it to the UI via
 * a tiny transport adapter; this builds the typed EngineAPI on top. No net-snmp,
 * no node builtins — safe for the browser bundle.
 */
import { EventBus, type EngineEvent } from './events';
import { OmcError, type OmcErrorCode } from './errors';
import type { EngineAPI } from './api/engine-api';

/** Serialized result of an engine method call crossing a process/network boundary. */
export interface BridgeResult {
  ok: boolean;
  value?: unknown;
  error?: { code: string; message: string; hint?: string };
}

/** The per-host transport: how to invoke a method and receive engine events. */
export interface ProxyAdapter {
  invoke(method: string, ...args: unknown[]): Promise<BridgeResult>;
  subscribe(listener: (event: EngineEvent) => void): () => void;
}

const stub = (plannedIn: string) => ({ plannedIn });

export function createEngineProxy(adapter: ProxyAdapter): EngineAPI {
  const bus = new EventBus();
  adapter.subscribe((event) => {
    if (event?.channel) bus.emit(event);
  });

  async function call<T>(method: string, ...args: unknown[]): Promise<T> {
    const res = await adapter.invoke(method, ...args);
    if (!res.ok) {
      throw new OmcError(
        (res.error?.code as OmcErrorCode) ?? 'INTERNAL',
        res.error?.message ?? 'engine call failed',
        { hint: res.error?.hint },
      );
    }
    return res.value as T;
  }

  return {
    system: { info: () => call('system.info') },
    mibs: {
      importTexts: (files) => call('mibs.importTexts', files),
      importUrl: (url) => call('mibs.importUrl', url),
      list: () => call('mibs.list'),
      unload: (name) => call('mibs.unload', name),
      tree: (oid) => call('mibs.tree', oid),
      node: (oidOrName) => call('mibs.node', oidOrName),
      search: (query, limit) => call('mibs.search', query, limit),
      resolve: (oid) => call('mibs.resolve', oid),
    },
    ops: {
      get: (req) => call('ops.get', req),
      getNext: (req) => call('ops.getNext', req),
      startWalk: (req) => call('ops.startWalk', req),
      cancel: (id) => call('ops.cancel', id),
    },
    traps: {
      startReceiver: (cfg) => call('traps.startReceiver', cfg),
      stopReceiver: () => call('traps.stopReceiver'),
      status: () => call('traps.status'),
      list: () => call('traps.list'),
      clear: () => call('traps.clear'),
    },
    events: { subscribe: (channel, listener) => bus.subscribe(channel, listener) },
    agents: stub('plan 04'),
    resolver: stub('plan 06'),
    tools: stub('plan 08'),
    logs: stub('plan 04'),
  };
}
