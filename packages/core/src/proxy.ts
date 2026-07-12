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
      inspectFiles: (files) => call('mibs.inspectFiles', files),
      replacementGroup: (moduleName) => call('mibs.replacementGroup', moduleName),
      importTexts: (files) => call('mibs.importTexts', files),
      importUrl: (url) => call('mibs.importUrl', url),
      startImport: (request) => call('mibs.startImport', request),
      list: () => call('mibs.list'),
      module: (name) => call('mibs.module', name),
      moduleTree: (name, oid) => call('mibs.moduleTree', name, oid),
      unload: (name) => call('mibs.unload', name),
      tree: (oid) => call('mibs.tree', oid),
      node: (oidOrName, moduleName) => call('mibs.node', oidOrName, moduleName),
      search: (query, limit) => call('mibs.search', query, limit),
      moduleSearch: (moduleName, query, limit) =>
        call('mibs.moduleSearch', moduleName, query, limit),
      resolve: (oid) => call('mibs.resolve', oid),
    },
    ops: {
      get: (req) => call('ops.get', req),
      getNext: (req) => call('ops.getNext', req),
      set: (req) => call('ops.set', req),
      startWalk: (req) => call('ops.startWalk', req),
      cancel: (id) => call('ops.cancel', id),
    },
    traps: {
      startReceiver: (cfg) => call('traps.startReceiver', cfg),
      stopReceiver: () => call('traps.stopReceiver'),
      status: () => call('traps.status'),
      list: () => call('traps.list'),
      clear: () => call('traps.clear'),
      send: (req) => call('traps.send', req),
    },
    events: { subscribe: (channel, listener) => bus.subscribe(channel, listener) },
    agents: stub('plan 04'),
    resolver: {
      respondConsent: (handleId, response) =>
        call('resolver.respondConsent', handleId, response),
      cancel: (handleId) => call('resolver.cancel', handleId),
      status: (handleId) => call('resolver.status', handleId),
      settings: {
        get: () => call('resolver.settings.get'),
        update: (patch) => call('resolver.settings.update', patch),
      },
      sources: {
        list: () => call('resolver.sources.list'),
        create: (draft) => call('resolver.sources.create', draft),
        update: (sourceId, draft) => call('resolver.sources.update', sourceId, draft),
        remove: (sourceId) => call('resolver.sources.remove', sourceId),
        reorder: (sourceIds) => call('resolver.sources.reorder', sourceIds),
        test: (sourceId, module) => call('resolver.sources.test', sourceId, module),
        preview: (draft) => call('resolver.sources.preview', draft),
        exportCustom: () => call('resolver.sources.exportCustom'),
        importCustom: (serialized) => call('resolver.sources.importCustom', serialized),
      },
      cache: {
        stats: () => call('resolver.cache.stats'),
        clear: () => call('resolver.cache.clear'),
      },
      history: { list: (limit) => call('resolver.history.list', limit) },
      resolveModules: (modules) => call('resolver.resolveModules', modules),
      lookupOid: (request) => call('resolver.lookupOid', request),
    },
    tools: stub('plan 08'),
    logs: stub('plan 04'),
  };
}
