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
  'resolver.resolveModules': (e, modules) => e.resolver.resolveModules(modules as string[]),
  'resolver.lookupOid': (e, request) => e.resolver.lookupOid(request as never),
  'ops.get': (e, req) => e.ops.get(req as never),
  'ops.getNext': (e, req) => e.ops.getNext(req as never),
  'ops.set': (e, req) => e.ops.set(req as never),
  'ops.startWalk': (e, req) => e.ops.startWalk(req as never),
  'ops.cancel': (e, id) => e.ops.cancel(id as string),
  'traps.startReceiver': (e, cfg) => e.traps.startReceiver(cfg as never),
  'traps.stopReceiver': (e) => e.traps.stopReceiver(),
  'traps.status': (e) => e.traps.status(),
  'traps.list': (e) => e.traps.list(),
  'traps.clear': (e) => e.traps.clear(),
  'traps.send': (e, req) => e.traps.send(req as never),
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
