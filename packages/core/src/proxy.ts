/**
 * Renderer-safe EngineAPI proxy. Any host that runs the engine out-of-process
 * (Electron main over IPC, a LAN server over WebSocket) exposes it to the UI via
 * a tiny transport adapter; this builds the typed EngineAPI on top. No net-snmp,
 * no node builtins — safe for the browser bundle.
 */
import { EventBus, type EngineEvent } from './events';
import { MibBeaconError, type MibBeaconErrorCode } from './errors';
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

export function createEngineProxy(adapter: ProxyAdapter): EngineAPI {
  const bus = new EventBus();
  adapter.subscribe((event) => {
    if (event?.channel) bus.emit(event);
  });

  async function call<T>(method: string, ...args: unknown[]): Promise<T> {
    const res = await adapter.invoke(method, ...args);
    if (!res.ok) {
      throw new MibBeaconError(
        (res.error?.code as MibBeaconErrorCode) ?? 'INTERNAL',
        res.error?.message ?? 'engine call failed',
        { hint: res.error?.hint },
      );
    }
    return res.value as T;
  }

  return {
    system: { info: () => call('system.info') },
    packets: {
      history: () => call('packets.history'),
      status: () => call('packets.status'),
      updateSettings: (patch) => call('packets.updateSettings', patch),
      retryPersistence: () => call('packets.retryPersistence'),
      clear: () => call('packets.clear'),
      export: {
        create: () => call('packets.export.create'),
        readChunk: (id, offset, limit) => call('packets.export.readChunk', id, offset, limit),
        dispose: (id) => call('packets.export.dispose', id),
      },
    },
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
      translate: (oidOrName) => call('mibs.translate', oidOrName),
    },
    ops: {
      get: (req) => call('ops.get', req),
      getNext: (req) => call('ops.getNext', req),
      getBulk: (req) => call('ops.getBulk', req),
      set: (req) => call('ops.set', req),
      start: (req) => call('ops.start', req),
      startWalk: (req) => call('ops.startWalk', req),
      cancel: (id) => call('ops.cancel', id),
      bookmarks: {
        list: () => call('ops.bookmarks.list'),
        create: (input) => call('ops.bookmarks.create', input),
        delete: (id) => call('ops.bookmarks.delete', id),
      },
      snapshots: {
        list: () => call('ops.snapshots.list'),
        create: (input) => call('ops.snapshots.create', input),
        get: (id) => call('ops.snapshots.get', id),
        delete: (id) => call('ops.snapshots.delete', id),
      },
      createTableRow: (req) => call('ops.createTableRow', req),
      deleteTableRow: (req) => call('ops.deleteTableRow', req),
    },
    traps: {
      startReceiver: (cfg) => call('traps.startReceiver', cfg),
      stopReceiver: () => call('traps.stopReceiver'),
      status: () => call('traps.status'),
      list: () => call('traps.list'),
      query: (query) => call('traps.query', query),
      markRead: (ids, read) => call('traps.markRead', ids, read),
      delete: (ids) => call('traps.delete', ids),
      unreadCount: () => call('traps.unreadCount'),
      clear: () => call('traps.clear'),
      v3Users: {
        list: () => call('traps.v3Users.list'),
        upsert: (draft) => call('traps.v3Users.upsert', draft),
        remove: (name) => call('traps.v3Users.remove', name),
      },
      savedFilters: {
        list: () => call('traps.savedFilters.list'),
        save: (name, query) => call('traps.savedFilters.save', name, query),
        remove: (id) => call('traps.savedFilters.remove', id),
      },
      presets: {
        list: () => call('traps.presets.list'),
        save: (name, agentId, payload) => call('traps.presets.save', name, agentId, payload),
        remove: (id) => call('traps.presets.remove', id),
      },
      rules: {
        list: () => call('traps.rules.list'),
        create: (draft) => call('traps.rules.create', draft),
        update: (id, draft) => call('traps.rules.update', id, draft),
        remove: (id) => call('traps.rules.remove', id),
      },
      send: (req) => call('traps.send', req),
    },
    events: { subscribe: (channel, listener) => bus.subscribe(channel, listener) },
    agents: {
      list: () => call('agents.list'),
      get: (id) => call('agents.get', id),
      create: (draft) => call('agents.create', draft),
      update: (id, draft) => call('agents.update', id, draft),
      delete: (id) => call('agents.delete', id),
      markUsed: (id) => call('agents.markUsed', id),
      test: (id) => call('agents.test', id),
      groups: {
        list: () => call('agents.groups.list'),
        get: (id) => call('agents.groups.get', id),
        create: (input) => call('agents.groups.create', input),
        update: (id, input) => call('agents.groups.update', id, input),
        delete: (id) => call('agents.groups.delete', id),
      },
    },
    resolver: {
      respondConsent: (handleId, response) => call('resolver.respondConsent', handleId, response),
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
      loadCachedModules: (modules) => call('resolver.loadCachedModules', modules),
      lookupOid: (request) => call('resolver.lookupOid', request),
    },
    tools: {
      polls: {
        list: () => call('tools.polls.list'),
        create: (draft) => call('tools.polls.create', draft),
        update: (id, patch) => call('tools.polls.update', id, patch),
        remove: (id) => call('tools.polls.remove', id),
        samples: (id, limit) => call('tools.polls.samples', id, limit),
        sampleNow: (ids) => call('tools.polls.sampleNow', ids),
        exportCsv: (id) => call('tools.polls.exportCsv', id),
      },
      watches: {
        list: () => call('tools.watches.list'),
        save: (input) => call('tools.watches.save', input),
        remove: (id) => call('tools.watches.remove', id),
      },
      charts: {
        list: () => call('tools.charts.list'),
        save: (input) => call('tools.charts.save', input),
        remove: (id) => call('tools.charts.remove', id),
      },
      discovery: {
        start: (input) => call('tools.discovery.start', input),
        cancel: (handleId) => call('tools.discovery.cancel', handleId),
        saveAgent: (input) => call('tools.discovery.saveAgent', input),
      },
      compare: {
        live: (input) => call('tools.compare.live', input),
        start: (input) => call('tools.compare.start', input),
        cancel: (handleId) => call('tools.compare.cancel', handleId),
        text: (a, b) => call('tools.compare.text', a, b),
        snapshots: (aId, bId) => call('tools.compare.snapshots', aId, bId),
      },
      ports: {
        inspect: (agentId) => call('tools.ports.inspect', agentId),
        start: (agentId) => call('tools.ports.start', agentId),
        cancel: (handleId) => call('tools.ports.cancel', handleId),
        monitor: (agentId, index, highCapacity, intervalMs) =>
          call('tools.ports.monitor', agentId, index, highCapacity, intervalMs),
      },
      reachability: {
        start: (input) => call('tools.reachability.start', input),
        cancel: (handleId) => call('tools.reachability.cancel', handleId),
      },
    },
    logs: {
      query: (filter) => call('logs.query', filter),
      setLevel: (level) => call('logs.setLevel', level),
      export: (path) => call('logs.export', path),
    },
  };
}
