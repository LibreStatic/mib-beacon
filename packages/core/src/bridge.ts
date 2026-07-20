/**
 * Host-side engine dispatch, shared by every out-of-process host (Electron main,
 * LAN server). Maps a method name + args onto the EngineAPI and serializes the
 * result (incl. MibBeaconError) so it can cross IPC or a WebSocket. Spike-scope method
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
  'packets.history': (e) => e.packets.history(),
  'packets.status': (e) => e.packets.status(),
  'packets.updateSettings': (e, patch) => e.packets.updateSettings(patch as never),
  'packets.retryPersistence': (e) => e.packets.retryPersistence(),
  'packets.clear': (e) => e.packets.clear(),
  'packets.export.create': (e) => e.packets.export.create(),
  'packets.export.readChunk': (e, id, offset, limit) =>
    e.packets.export.readChunk(id as string, offset as number, limit as number | undefined),
  'packets.export.dispose': (e, id) => e.packets.export.dispose(id as string),
  'logs.query': (e, filter) => e.logs.query(filter as never),
  'logs.setLevel': (e, level) => e.logs.setLevel(level as never),
  'logs.export': (e, path) => e.logs.export(path as string | undefined),
  'mibs.importTexts': (e, files) => e.mibs.importTexts(files as never),
  'mibs.inspectFiles': (e, files) => e.mibs.inspectFiles(files as never),
  'mibs.replacementGroup': (e, moduleName) => e.mibs.replacementGroup(moduleName as string),
  'mibs.importUrl': (e, url) => e.mibs.importUrl(url as string),
  'mibs.startImport': (e, request) => e.mibs.startImport(request as never),
  'mibs.list': (e) => e.mibs.list(),
  'mibs.module': (e, name) => e.mibs.module(name as string),
  'mibs.moduleTree': (e, name, oid) => e.mibs.moduleTree(name as string, oid as string | undefined),
  'mibs.unload': (e, name) => e.mibs.unload(name as string),
  'mibs.tree': (e, oid) => e.mibs.tree(oid as string | undefined),
  'mibs.node': (e, oidOrName, moduleName) =>
    e.mibs.node(oidOrName as string, moduleName as string | undefined),
  'mibs.search': (e, query, limit) => e.mibs.search(query as string, limit as number | undefined),
  'mibs.moduleSearch': (e, moduleName, query, limit) =>
    e.mibs.moduleSearch(moduleName as string, query as string, limit as number | undefined),
  'mibs.resolve': (e, oid) => e.mibs.resolve(oid as string),
  'mibs.translate': (e, oidOrName) => e.mibs.translate(oidOrName as string),
  'liveMibs.settings.get': (e) => e.liveMibs.settings.get(),
  'liveMibs.settings.update': (e, patch) => e.liveMibs.settings.update(patch as never),
  'liveMibs.agentOverrides.get': (e, agentId) =>
    e.liveMibs.agentOverrides.get(agentId as string),
  'liveMibs.agentOverrides.update': (e, agentId, patch) =>
    e.liveMibs.agentOverrides.update(agentId as string, patch as never),
  'liveMibs.agentOverrides.reset': (e, agentId) =>
    e.liveMibs.agentOverrides.reset(agentId as string),
  'liveMibs.scan.start': (e, request) => e.liveMibs.scan.start(request as never),
  'liveMibs.scan.status': (e, handleId) => e.liveMibs.scan.status(handleId as string),
  'liveMibs.scan.cancel': (e, handleId) => e.liveMibs.scan.cancel(handleId as string),
  'liveMibs.writeCell': (e, request) => e.liveMibs.writeCell(request as never),
  'liveMibs.uploads.create': (e, input) => e.liveMibs.uploads.create(input as never),
  'liveMibs.uploads.append': (e, id, offset, base64) =>
    e.liveMibs.uploads.append(id as string, offset as number, base64 as string),
  'liveMibs.uploads.complete': (e, id) => e.liveMibs.uploads.complete(id as string),
  'liveMibs.uploads.status': (e, id) => e.liveMibs.uploads.status(id as string),
  'liveMibs.uploads.dispose': (e, id) => e.liveMibs.uploads.dispose(id as string),
  'liveMibs.workflows.detect': (e, input) => e.liveMibs.workflows.detect(input as never),
  'liveMibs.workflows.start': (e, request) => e.liveMibs.workflows.start(request as never),
  'liveMibs.workflows.status': (e, handleId) =>
    e.liveMibs.workflows.status(handleId as string),
  'liveMibs.workflows.cancel': (e, handleId) =>
    e.liveMibs.workflows.cancel(handleId as string),
  'resolver.respondConsent': (e, handleId, response) =>
    e.resolver.respondConsent(handleId as string, response as never),
  'resolver.cancel': (e, handleId) => e.resolver.cancel(handleId as string),
  'resolver.status': (e, handleId) => e.resolver.status(handleId as string),
  'resolver.settings.get': (e) => e.resolver.settings.get(),
  'resolver.settings.update': (e, patch) => e.resolver.settings.update(patch as never),
  'resolver.sources.list': (e) => e.resolver.sources.list(),
  'resolver.sources.create': (e, draft) => e.resolver.sources.create(draft as never),
  'resolver.sources.update': (e, sourceId, draft) =>
    e.resolver.sources.update(sourceId as string, draft as never),
  'resolver.sources.remove': (e, sourceId) => e.resolver.sources.remove(sourceId as string),
  'resolver.sources.reorder': (e, sourceIds) => e.resolver.sources.reorder(sourceIds as string[]),
  'resolver.sources.test': (e, sourceId, module) =>
    e.resolver.sources.test(sourceId as string, module as string),
  'resolver.sources.preview': (e, draft) => e.resolver.sources.preview(draft as never),
  'resolver.sources.exportCustom': (e) => e.resolver.sources.exportCustom(),
  'resolver.sources.importCustom': (e, serialized) =>
    e.resolver.sources.importCustom(serialized as string),
  'resolver.cache.stats': (e) => e.resolver.cache.stats(),
  'resolver.cache.clear': (e) => e.resolver.cache.clear(),
  'resolver.history.list': (e, limit) => e.resolver.history.list(limit as number | undefined),
  'resolver.resolveModules': (e, modules, options) =>
    e.resolver.resolveModules(modules as string[], options as never),
  'resolver.loadCachedModules': (e, modules) => e.resolver.loadCachedModules(modules as string[]),
  'resolver.lookupOid': (e, request) => e.resolver.lookupOid(request as never),
  'resolver.browseVendorMibs': (e, request) => e.resolver.browseVendorMibs(request as never),
  'tools.polls.list': (e) => e.tools.polls.list(),
  'tools.polls.create': (e, draft) => e.tools.polls.create(draft as never),
  'tools.polls.update': (e, id, patch) => e.tools.polls.update(id as string, patch as never),
  'tools.polls.remove': (e, id) => e.tools.polls.remove(id as string),
  'tools.polls.samples': (e, id, limit) =>
    e.tools.polls.samples(id as string, limit as number | undefined),
  'tools.polls.sampleNow': (e, ids) => e.tools.polls.sampleNow(ids as string[] | undefined),
  'tools.polls.exportCsv': (e, id) => e.tools.polls.exportCsv(id as string),
  'tools.watches.list': (e) => e.tools.watches.list(),
  'tools.watches.save': (e, input) => e.tools.watches.save(input as never),
  'tools.watches.remove': (e, id) => e.tools.watches.remove(id as string),
  'tools.charts.list': (e) => e.tools.charts.list(),
  'tools.charts.save': (e, input) => e.tools.charts.save(input as never),
  'tools.charts.remove': (e, id) => e.tools.charts.remove(id as string),
  'tools.patterns.list': (e, input) => e.tools.patterns.list(input as never),
  'tools.patterns.events': (e, id) => e.tools.patterns.events(id as string),
  'tools.patterns.start': (e, input) => e.tools.patterns.start(input as never),
  'tools.patterns.annotate': (e, input) => e.tools.patterns.annotate(input as never),
  'tools.patterns.cancel': (e, id) => e.tools.patterns.cancel(id as string),
  'tools.patterns.remove': (e, id) => e.tools.patterns.remove(id as string),
  'tools.discovery.start': (e, input) => e.tools.discovery.start(input as never),
  'tools.discovery.cancel': (e, id) => e.tools.discovery.cancel(id as string),
  'tools.discovery.saveAgent': (e, input) => e.tools.discovery.saveAgent(input as never),
  'tools.compare.live': (e, input) => e.tools.compare.live(input as never),
  'tools.compare.start': (e, input) => e.tools.compare.start(input as never),
  'tools.compare.cancel': (e, id) => e.tools.compare.cancel(id as string),
  'tools.compare.text': (e, a, b) => e.tools.compare.text(a as string, b as string),
  'tools.compare.snapshots': (e, a, b) => e.tools.compare.snapshots(a as string, b as string),
  'tools.ports.inspect': (e, id) => e.tools.ports.inspect(id as string),
  'tools.ports.start': (e, id) => e.tools.ports.start(id as string),
  'tools.ports.cancel': (e, id) => e.tools.ports.cancel(id as string),
  'tools.ports.monitor': (e, id, index, highCapacity, intervalMs) =>
    e.tools.ports.monitor(
      id as string,
      index as string,
      highCapacity as boolean,
      intervalMs as number | undefined,
    ),
  'tools.reachability.start': (e, input) => e.tools.reachability.start(input as never),
  'tools.reachability.cancel': (e, id) => e.tools.reachability.cancel(id as string),
  'ops.get': (e, req) => e.ops.get(req as never),
  'ops.getNext': (e, req) => e.ops.getNext(req as never),
  'ops.getBulk': (e, req) => e.ops.getBulk(req as never),
  'ops.set': (e, req) => e.ops.set(req as never),
  'ops.start': (e, req) => e.ops.start(req as never),
  'ops.startWalk': (e, req) => e.ops.startWalk(req as never),
  'ops.cancel': (e, id) => e.ops.cancel(id as string),
  'ops.bookmarks.list': (e) => e.ops.bookmarks.list(),
  'ops.bookmarks.create': (e, input) => e.ops.bookmarks.create(input as never),
  'ops.bookmarks.delete': (e, id) => e.ops.bookmarks.delete(id as string),
  'ops.snapshots.list': (e) => e.ops.snapshots.list(),
  'ops.snapshots.create': (e, input) => e.ops.snapshots.create(input as never),
  'ops.snapshots.get': (e, id) => e.ops.snapshots.get(id as string),
  'ops.snapshots.delete': (e, id) => e.ops.snapshots.delete(id as string),
  'ops.createTableRow': (e, req) => e.ops.createTableRow(req as never),
  'ops.deleteTableRow': (e, req) => e.ops.deleteTableRow(req as never),
  'agents.list': (e) => e.agents.list(),
  'agents.get': (e, id) => e.agents.get(id as string),
  'agents.create': (e, draft) => e.agents.create(draft as never),
  'agents.update': (e, id, draft) => e.agents.update(id as string, draft as never),
  'agents.delete': (e, id) => e.agents.delete(id as string),
  'agents.markUsed': (e, id) => e.agents.markUsed(id as string),
  'agents.test': (e, id) => e.agents.test(id as string),
  'agents.groups.list': (e) => e.agents.groups.list(),
  'agents.groups.get': (e, id) => e.agents.groups.get(id as string),
  'agents.groups.create': (e, input) => e.agents.groups.create(input as never),
  'agents.groups.update': (e, id, input) => e.agents.groups.update(id as string, input as never),
  'agents.groups.delete': (e, id) => e.agents.groups.delete(id as string),
  'traps.startReceiver': (e, cfg) => e.traps.startReceiver(cfg as never),
  'traps.stopReceiver': (e) => e.traps.stopReceiver(),
  'traps.status': (e) => e.traps.status(),
  'traps.list': (e) => e.traps.list(),
  'traps.query': (e, query) => e.traps.query(query as never),
  'traps.markRead': (e, ids, read) =>
    e.traps.markRead(ids as string[], read as boolean | undefined),
  'traps.delete': (e, ids) => e.traps.delete(ids as string[]),
  'traps.unreadCount': (e) => e.traps.unreadCount(),
  'traps.clear': (e) => e.traps.clear(),
  'traps.v3Users.list': (e) => e.traps.v3Users.list(),
  'traps.v3Users.upsert': (e, draft) => e.traps.v3Users.upsert(draft as never),
  'traps.v3Users.remove': (e, name) => e.traps.v3Users.remove(name as string),
  'traps.savedFilters.list': (e) => e.traps.savedFilters.list(),
  'traps.savedFilters.save': (e, name, query) =>
    e.traps.savedFilters.save(name as string, query as never),
  'traps.savedFilters.remove': (e, id) => e.traps.savedFilters.remove(id as string),
  'traps.presets.list': (e) => e.traps.presets.list(),
  'traps.presets.save': (e, name, agentId, payload) =>
    e.traps.presets.save(name as string, agentId as string, payload as never),
  'traps.presets.remove': (e, id) => e.traps.presets.remove(id as string),
  'traps.rules.list': (e) => e.traps.rules.list(),
  'traps.rules.create': (e, draft) => e.traps.rules.create(draft as never),
  'traps.rules.update': (e, id, draft) => e.traps.rules.update(id as string, draft as never),
  'traps.rules.remove': (e, id) => e.traps.rules.remove(id as string),
  'traps.send': (e, req) => e.traps.send(req as never),
};

export const ENGINE_EVENT_CHANNELS: EngineEventChannel[] = [
  'ops',
  'traps',
  'resolver',
  'tools',
  'logs',
  'packets',
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
