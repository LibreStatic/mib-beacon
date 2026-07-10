import type { AgentSpec, EngineAPI, MibNodeDetail } from '@omc/core/client';
import { useAppStore, type AgentForm } from './store';

/** Translate the string-based agent form into a typed AgentSpec. */
export function buildAgentSpec(form: AgentForm): AgentSpec {
  const spec: AgentSpec = {
    host: form.host.trim(),
    port: Number(form.port) || 161,
    version: form.version,
  };
  if (form.version === 'v3') {
    spec.v3 = {
      user: form.v3.user,
      level: form.v3.level,
      authProtocol: form.v3.level !== 'noAuthNoPriv' ? form.v3.authProtocol : undefined,
      authKey: form.v3.level !== 'noAuthNoPriv' ? form.v3.authKey : undefined,
      privProtocol: form.v3.level === 'authPriv' ? form.v3.privProtocol : undefined,
      privKey: form.v3.level === 'authPriv' ? form.v3.privKey : undefined,
    };
  } else {
    spec.community = form.community;
  }
  return spec;
}

function describeError(e: unknown): string {
  const err = e as { message?: string; hint?: string };
  return `${err.message ?? String(e)}${err.hint ? ' — ' + err.hint : ''}`;
}

// --------------------------------------------------------------------------
// Query
// --------------------------------------------------------------------------

async function runOneShot(engine: EngineAPI, kind: 'get' | 'getNext'): Promise<void> {
  const s = useAppStore.getState();
  const agent = buildAgentSpec(s.agent);
  if (!agent.host) {
    s.setQueryError('Enter an agent host first.');
    return;
  }
  s.setQueryError(null);
  s.setStats({ count: 0, batches: 0, ms: 0 });
  const t0 = Date.now();
  try {
    const fn = kind === 'get' ? engine.ops.get : engine.ops.getNext;
    const vbs = await fn({ agent, oids: [s.oid] });
    s.setResults(vbs);
    s.setStats({ count: vbs.length, batches: 1, ms: Date.now() - t0 });
  } catch (e) {
    s.setResults([]);
    s.setQueryError(describeError(e));
  }
}

export const runGet = (engine: EngineAPI) => runOneShot(engine, 'get');
export const runGetNext = (engine: EngineAPI) => runOneShot(engine, 'getNext');

export async function runWalk(engine: EngineAPI): Promise<void> {
  const s = useAppStore.getState();
  const agent = buildAgentSpec(s.agent);
  if (!agent.host) {
    s.setQueryError('Enter an agent host first.');
    return;
  }
  s.setQueryError(null);
  s.setResults([]);
  s.setStats({ count: 0, batches: 0, ms: 0 });
  try {
    const { handleId } = await engine.ops.startWalk({ agent, baseOid: s.oid });
    s.setRunning(handleId, Date.now());
  } catch (e) {
    s.setQueryError(describeError(e));
  }
}

export async function stopWalk(engine: EngineAPI): Promise<void> {
  const { running, setRunning } = useAppStore.getState();
  if (running) {
    await engine.ops.cancel(running);
    setRunning(null);
  }
}

/** Live OID → name hint for the query field. */
export async function resolveOidHint(engine: EngineAPI, oid: string): Promise<void> {
  const s = useAppStore.getState();
  if (!/^[0-9.]+$/.test(oid.trim())) {
    s.setOidName(null);
    return;
  }
  try {
    const r = await engine.mibs.resolve(oid.trim());
    // Only apply if the field hasn't changed underneath us.
    if (useAppStore.getState().oid === oid) s.setOidName(r?.name ?? null);
  } catch {
    s.setOidName(null);
  }
}

// --------------------------------------------------------------------------
// Traps
// --------------------------------------------------------------------------

export async function toggleReceiver(engine: EngineAPI, port: string): Promise<void> {
  const s = useAppStore.getState();
  if (s.receiver.running) {
    await engine.traps.stopReceiver();
    s.setReceiver({ running: false });
  } else {
    try {
      const status = await engine.traps.startReceiver({
        port: Number(port) || 1162,
        disableAuthorization: true,
        communities: ['public'],
      });
      s.setReceiver({ running: status.running, port: status.port });
    } catch (e) {
      s.setReceiver({ running: false });
      throw e;
    }
  }
}

// --------------------------------------------------------------------------
// MIBs
// --------------------------------------------------------------------------

export async function refreshModules(engine: EngineAPI): Promise<void> {
  const s = useAppStore.getState();
  s.setModules(await engine.mibs.list());
}

export async function importPastedText(
  engine: EngineAPI,
  name: string,
  content: string,
): Promise<void> {
  const s = useAppStore.getState();
  s.setImportBusy(true);
  try {
    const result = await engine.mibs.importTexts([{ name: name || 'pasted.mib', content }]);
    s.setLastImport(result);
    await refreshModules(engine);
    s.clearChildrenCache();
  } finally {
    s.setImportBusy(false);
  }
}

export async function importUrl(engine: EngineAPI, url: string): Promise<void> {
  const s = useAppStore.getState();
  s.setImportBusy(true);
  try {
    const result = await engine.mibs.importUrl(url.trim());
    s.setLastImport(result);
    await refreshModules(engine);
    s.clearChildrenCache();
  } catch (e) {
    s.setLastImport({ loaded: [], errors: [{ name: url, message: describeError(e) }] });
  } finally {
    s.setImportBusy(false);
  }
}

export async function unloadModule(engine: EngineAPI, name: string): Promise<void> {
  await engine.mibs.unload(name);
  await refreshModules(engine);
  useAppStore.getState().clearChildrenCache();
}

// --------------------------------------------------------------------------
// Browse
// --------------------------------------------------------------------------

/** Fetch (and cache) the children of an OID; '' loads the tree roots. */
export async function loadChildren(engine: EngineAPI, oid: string): Promise<void> {
  const s = useAppStore.getState();
  if (s.childrenCache[oid]) return;
  const children = await engine.mibs.tree(oid || undefined);
  s.setChildren(oid, children);
}

export async function selectNode(engine: EngineAPI, oidOrName: string): Promise<void> {
  const s = useAppStore.getState();
  const detail = await engine.mibs.node(oidOrName);
  s.setSelected(detail);
}

/** Expand every ancestor prefix of an OID (used when jumping from search). */
export async function revealOid(engine: EngineAPI, oid: string): Promise<void> {
  const s = useAppStore.getState();
  const arcs = oid.split('.');
  let prefix = '';
  for (let i = 0; i < arcs.length - 1; i++) {
    prefix = i === 0 ? arcs[0]! : `${prefix}.${arcs[i]}`;
    s.setExpanded(prefix, true);
    await loadChildren(engine, prefix);
  }
}

export async function runSearch(engine: EngineAPI, query: string): Promise<void> {
  const s = useAppStore.getState();
  if (!query.trim()) {
    s.setHits([]);
    return;
  }
  const hits = await engine.mibs.search(query, 40);
  if (useAppStore.getState().search === query) s.setHits(hits);
}

/** Send the browse selection into the Query tab and run it. */
export function walkFromNode(engine: EngineAPI, oid: string): void {
  const s = useAppStore.getState();
  s.setOid(oid);
  s.setTab('query');
  void runWalk(engine);
}

export function getFromNode(engine: EngineAPI, detail: MibNodeDetail): void {
  const s = useAppStore.getState();
  const oid = detail.kind === 'scalar' ? `${detail.oid}.0` : detail.oid;
  s.setOid(oid);
  s.setTab('query');
  void runGet(engine);
}
