import { inferWireType } from '@omc/core/client';
import type {
  AgentSpec,
  EngineAPI,
  EngineEvent,
  ImportResult,
  MibNodeDetail,
  MibTextFile,
  NotificationSendRequest,
  OidLookupResult,
  ResolverOperationStatus,
  ResolverSettings,
  ResolverSourceDraft,
  ResolverSourcePreviewResult,
  SourceConfig,
} from '@omc/core/client';
import { useAppStore, type AgentForm } from './store';

let notificationSeq = 0;

/** Translate the string-based agent form into a typed AgentSpec. */
export function buildAgentSpec(form: AgentForm, defaultPort = 161): AgentSpec {
  const spec: AgentSpec = {
    host: form.host.trim(),
    port: Number(form.port) || defaultPort,
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

export async function runSet(engine: EngineAPI): Promise<void> {
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
    const vbs = await engine.ops.set({ agent, varbinds: [s.setDraft] });
    s.setResults(vbs);
    s.setStats({ count: vbs.length, batches: 1, ms: Date.now() - t0 });
    s.setSetReview(false);
  } catch (e) {
    s.setResults([]);
    s.setQueryError(describeError(e));
  }
}

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
  if (!/^\d+(?:\.\d+)+$/.test(oid.trim())) {
    s.setOidName(null);
    return;
  }
  try {
    const r = await engine.mibs.resolve(oid.trim());
    // Only apply if the field hasn't changed underneath us.
    if (useAppStore.getState().oid === oid) {
      s.setOidName(r?.name ?? null);
      if (r && useAppStore.getState().queryOperation === 'set') {
        const node = await engine.mibs.node(r.definitionOid, s.moduleFocus?.module.name);
        if (useAppStore.getState().oid === oid && node) {
          s.updateSetDraft({ type: inferWireType(node.syntax) });
        }
      }
    }
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

export async function sendNotification(engine: EngineAPI): Promise<void> {
  const s = useAppStore.getState();
  const form = s.notification;
  const target = buildAgentSpec(form.target, 162);
  if (!target.host) {
    s.setSendError('Enter a destination host first.');
    return;
  }
  const request: NotificationSendRequest = {
    target,
    kind: form.kind,
    trapOid: form.trapOid,
    varbinds: form.varbinds,
    ...(form.upTime.trim() ? { upTime: Number(form.upTime) } : {}),
    ...(form.agentAddress.trim() ? { agentAddress: form.agentAddress.trim() } : {}),
  };
  s.setSendBusy(true);
  s.setSendError(null);
  const id = `sent-${Date.now()}-${notificationSeq++}`;
  try {
    const result = await engine.traps.send(request);
    s.addSendHistory({ id, request, result });
  } catch (e) {
    const error = describeError(e);
    s.setSendError(error);
    s.addSendHistory({ id, request, error });
  } finally {
    s.setSendBusy(false);
  }
}

export async function repeatNotification(
  engine: EngineAPI,
  request: NotificationSendRequest,
): Promise<void> {
  const s = useAppStore.getState();
  s.setSendBusy(true);
  s.setSendError(null);
  const id = `sent-${Date.now()}-${notificationSeq++}`;
  try {
    const result = await engine.traps.send(request);
    s.addSendHistory({ id, request, result });
  } catch (e) {
    const error = describeError(e);
    s.setSendError(error);
    s.addSendHistory({ id, request, error });
  } finally {
    s.setSendBusy(false);
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
  const priorHandle = useAppStore.getState().importHandle;
  const priorStatusHandle = useAppStore.getState().importStatus?.handleId;
  try {
    const { handleId } = await engine.mibs.startImport({
      files: [{ name: name || 'pasted.mib', content }],
    });
    useAppStore.getState().beginImport(handleId);
    await syncImportOrCancel(engine, handleId, name || 'pasted.mib');
  } catch (e) {
    await handleStartImportFailure(engine, priorHandle, priorStatusHandle, name || 'pasted.mib', e);
  }
}

/** Start a reviewed file batch. Returns true only after the engine accepted ownership. */
export async function importReviewedFiles(
  engine: EngineAPI,
  files: MibTextFile[],
  replaceModules: string[],
  batchLabel: string,
): Promise<string | null> {
  const priorHandle = useAppStore.getState().importHandle;
  const priorStatusHandle = useAppStore.getState().importStatus?.handleId;
  try {
    const { handleId } = await engine.mibs.startImport({ files, replaceModules, batchLabel });
    const state = useAppStore.getState();
    if (state.importHandle !== handleId && state.importStatus?.handleId !== handleId) {
      state.beginImport(handleId);
    }
    // Ownership transfers as soon as the handle is accepted. Resolver status,
    // consent, progress, cancellation and terminal events remain in the existing UI.
    void syncImportOrCancel(engine, handleId, batchLabel);
    return handleId;
  } catch (e) {
    await handleStartImportFailure(engine, priorHandle, priorStatusHandle, batchLabel, e);
    return null;
  }
}

export async function importUrl(engine: EngineAPI, url: string): Promise<void> {
  const priorHandle = useAppStore.getState().importHandle;
  const priorStatusHandle = useAppStore.getState().importStatus?.handleId;
  try {
    const { handleId } = await engine.mibs.startImport({ url: url.trim() });
    useAppStore.getState().beginImport(handleId);
    await syncImportOrCancel(engine, handleId, url);
  } catch (e) {
    await handleStartImportFailure(engine, priorHandle, priorStatusHandle, url, e);
  }
}

export async function cancelImport(engine: EngineAPI): Promise<void> {
  const handleId = useAppStore.getState().importHandle;
  if (handleId) await engine.resolver.cancel(handleId);
}

// --------------------------------------------------------------------------
// Resolver
// --------------------------------------------------------------------------

const TERMINAL_STATES = new Set(['done', 'partial', 'error', 'cancelled', 'expired']);

export async function refreshResolverState(engine: EngineAPI): Promise<void> {
  const s = useAppStore.getState();
  const [settings, sources, cache, history] = await Promise.all([
    engine.resolver.settings.get(),
    engine.resolver.sources.list(),
    engine.resolver.cache.stats(),
    engine.resolver.history.list(30),
  ]);
  s.setResolverSettings(settings);
  s.setResolverSources(sources);
  s.setResolverCache(cache);
  s.setResolverHistory(history);
}

async function syncResolverOperation(engine: EngineAPI, handleId: string): Promise<void> {
  const status = await engine.resolver.status(handleId);
  if (!status) throw new Error(`Resolver operation status is unavailable: ${handleId}`);
  const s = useAppStore.getState();
  if (status.state === 'awaiting-consent') {
    s.enqueueConsent({
      handleId,
      missingModules: status.missingModules,
      sourceHosts: status.sourceHosts,
      expiresAt: status.expiresAt,
    });
  }
  if (TERMINAL_STATES.has(status.state)) {
    await handleResolverEvent(engine, {
      channel: 'resolver',
      handleId,
      kind: status.state === 'expired' ? 'error' : status.state,
      payload: { status, result: status.result },
    });
  } else if (handleId === s.importHandle) {
    s.setImportStatus(status);
  }
}

async function syncImportOrCancel(
  engine: EngineAPI,
  handleId: string,
  requestName: string,
): Promise<void> {
  try {
    await syncResolverOperation(engine, handleId);
  } catch (error) {
    try {
      await engine.resolver.cancel(handleId);
    } catch {
      // The status transport failed too; local ownership still must be released.
    }
    const s = useAppStore.getState();
    if (s.importHandle !== handleId) return;
    const message = `Import started but its resolver status could not be synchronized: ${describeError(error)}`;
    const now = Date.now();
    s.finishImport(
      {
        handleId,
        state: 'error',
        startedAt: s.importStatus?.startedAt ?? now,
        updatedAt: now,
        missingModules: [],
        sourceHosts: [],
        loadedModules: s.importStatus?.loadedModules ?? [],
        failures: [{ message }],
      },
      { loaded: [], errors: [{ name: requestName, message }] },
    );
    s.settleFileImportDraft(handleId, 'error');
  }
}

async function handleStartImportFailure(
  engine: EngineAPI,
  priorHandle: string | null,
  priorStatusHandle: string | undefined,
  requestName: string,
  error: unknown,
): Promise<void> {
  const state = useAppStore.getState();
  const claimedHandle = state.importHandle;
  const message = describeError(error);

  // A synchronous `started` event can claim the operation even if the start RPC
  // response is lost. Release UI ownership before cancellation so the renderer
  // can never appear idle while retaining a hidden live handle.
  if (claimedHandle && claimedHandle !== priorHandle) {
    const now = Date.now();
    state.finishImport(
      {
        handleId: claimedHandle,
        state: 'error',
        startedAt: state.importStatus?.startedAt ?? now,
        updatedAt: now,
        missingModules: [],
        sourceHosts: [],
        loadedModules: state.importStatus?.loadedModules ?? [],
        failures: [{ message }],
      },
      { loaded: [], errors: [{ name: requestName, message }] },
    );
    state.dismissConsent(claimedHandle);
    try {
      await engine.resolver.cancel(claimedHandle);
    } catch {
      // Ownership is already released; surface the original start failure.
    }
    return;
  }

  // A terminal event may have completed the claimed operation before the lost
  // RPC response rejected. Do not overwrite that authoritative result.
  if (
    !claimedHandle &&
    state.importStatus &&
    state.importStatus.handleId !== priorStatusHandle &&
    TERMINAL_STATES.has(state.importStatus.state)
  ) return;

  // Do not disturb an operation that already existed before this start attempt.
  if (claimedHandle === priorHandle && priorHandle) return;
  state.setImportBusy(false);
  state.setLastImport({ loaded: [], errors: [{ name: requestName, message }] });
}

/** Route one resolver event to its owning operation. Events for stale handles are ignored. */
export async function handleResolverEvent(engine: EngineAPI, event: EngineEvent): Promise<void> {
  const s = useAppStore.getState();
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  // In-process engines can emit `started` just before startImport's Promise resolves.
  if (event.kind === 'started' && event.handleId) {
    const request = payload.request as Record<string, unknown> | undefined;
    if (request && ('files' in request || 'url' in request)) s.beginImport(event.handleId);
  }

  const sourceId = Object.entries(s.sourceTestHandles).find(([, id]) => id === event.handleId)?.[0];
  const isSourcePreview = Boolean(event.handleId && event.handleId === s.sourcePreviewHandle);
  const lookupOid = Object.entries(s.lookupHandles).find(([, id]) => id === event.handleId)?.[0];
  const isImport = Boolean(event.handleId && event.handleId === useAppStore.getState().importHandle);

  if (event.kind === 'consent-required' && event.handleId) {
    const active = isImport || Boolean(sourceId) || isSourcePreview || Boolean(lookupOid);
    if (active) {
      s.enqueueConsent({
        handleId: event.handleId,
        missingModules: stringArray(payload.missingModules),
        sourceHosts: stringArray(payload.sourceHosts),
        expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : undefined,
      });
      if (isImport) {
        s.setImportStatus(
          operationStatusForEvent(
            useAppStore.getState().importStatus,
            event.handleId,
            'awaiting-consent',
            stringArray(payload.missingModules),
            stringArray(payload.sourceHosts),
          ),
        );
      }
    }
  }

  if (isImport) {
    if (event.kind === 'local-result') s.setLastImport(payload as unknown as ImportResult);
    if (event.kind === 'source-progress') {
      s.setImportStatus(
        operationStatusForEvent(
          useAppStore.getState().importStatus,
          event.handleId!,
          'resolving',
        ),
      );
      const progress = payload as Record<string, unknown>;
      if (progress.type === 'progress') {
        s.setImportCounts(Number(progress.completed) || 0, Number(progress.total) || 0);
      } else {
        s.addImportProgress({
          id: `${Date.now()}-${s.importProgress.length}`,
          kind: String(progress.type ?? 'progress'),
          module: stringValue(progress.module),
          sourceId: stringValue(progress.sourceId),
          location: stringValue(progress.location),
          message: stringValue(progress.message ?? progress.reason),
          at: Date.now(),
        });
      }
    }
  }

  if (!TERMINAL_STATES.has(event.kind)) return;
  if (event.handleId) s.dismissConsent(event.handleId);
  const status = extractTerminalStatus(payload, event.handleId, event.kind);

  if (isImport) {
    const finalResult = extractImportResult(payload) ?? useAppStore.getState().lastImport;
    s.finishImport(status, finalResult);
    s.settleFileImportDraft(status.handleId, status.state);
    await Promise.all([refreshModules(engine), refreshResolverState(engine)]);
    const fresh = useAppStore.getState();
    fresh.clearChildrenCache();
    await loadChildren(engine, '');
    return;
  }

  if (sourceId) {
    const result = (payload.result ?? payload) as Record<string, unknown>;
    s.finishSourceTest(sourceId, {
      state: status.state,
      ok: result.ok === true,
      message: stringValue(result.message) ?? status.failures[0]?.message,
      location: stringValue(result.location),
    });
    await refreshResolverState(engine);
    return;
  }

  if (isSourcePreview) {
    const result = payload.result as ResolverSourcePreviewResult | undefined;
    s.finishSourcePreview({
      state: status.state,
      result: result?.kind === 'source-preview' ? result : undefined,
      error: status.failures[0]?.message,
    });
    await refreshResolverState(engine);
    return;
  }

  if (lookupOid) {
    const result = payload.result as OidLookupResult | undefined;
    s.finishOidLookup(lookupOid, {
      state: status.state,
      result,
      error: status.failures[0]?.message,
    });
    await refreshResolverState(engine);
  }
}

export async function respondResolverConsent(
  engine: EngineAPI,
  allow: boolean,
  askAgain: boolean,
): Promise<void> {
  const prompt = useAppStore.getState().consent;
  if (!prompt) return;
  try {
    await engine.resolver.respondConsent(prompt.handleId, { allow, askAgain });
    useAppStore.getState().dismissConsent(prompt.handleId);
    if (!allow) await engine.resolver.cancel(prompt.handleId);
  } catch (e) {
    const state = useAppStore.getState();
    state.setResolverError(describeError(e));
    try {
      const status = await engine.resolver.status(prompt.handleId);
      if (status?.state === 'awaiting-consent') state.enqueueConsent(prompt);
      else state.dismissConsent(prompt.handleId);
    } catch {
      // If status is also unreachable, preserve/re-enqueue the disclosure rather
      // than silently advancing to a later queued prompt.
      state.enqueueConsent(prompt);
    }
  }
}

export async function updateResolverSettings(
  engine: EngineAPI,
  patch: Partial<ResolverSettings>,
): Promise<void> {
  try {
    useAppStore.getState().setResolverSettings(await engine.resolver.settings.update(patch));
  } catch (e) {
    useAppStore.getState().setResolverError(describeError(e));
  }
}

export async function saveResolverSource(
  engine: EngineAPI,
  draft: ResolverSourceDraft,
  existingId?: string,
): Promise<void> {
  const s = useAppStore.getState();
  s.setResolverError(null);
  try {
    if (existingId) await engine.resolver.sources.update(existingId, draft);
    else await engine.resolver.sources.create(draft);
    await refreshResolverState(engine);
  } catch (e) {
    s.setResolverError(describeError(e));
    throw e;
  }
}

export async function removeResolverSource(engine: EngineAPI, sourceId: string): Promise<void> {
  try {
    await engine.resolver.sources.remove(sourceId);
    await refreshResolverState(engine);
  } catch (e) {
    useAppStore.getState().setResolverError(describeError(e));
    throw e;
  }
}

export async function toggleResolverSource(engine: EngineAPI, source: SourceConfig): Promise<void> {
  await saveResolverSource(engine, { config: { ...source, enabled: !source.enabled } }, source.id);
}

export async function moveResolverSource(
  engine: EngineAPI,
  sourceId: string,
  direction: -1 | 1,
): Promise<void> {
  const sources = useAppStore.getState().resolverSources;
  const fixed = sources.filter((source) => source.kind === 'cache');
  const movable = sources.filter((source) => source.kind !== 'cache');
  const index = movable.findIndex((source) => source.id === sourceId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= movable.length) return;
  const ids = movable.map((source) => source.id);
  [ids[index], ids[target]] = [ids[target]!, ids[index]!];
  useAppStore
    .getState()
    .setResolverSources(await engine.resolver.sources.reorder([...fixed.map((source) => source.id), ...ids]));
}

export async function testResolverSource(
  engine: EngineAPI,
  sourceId: string,
  module: string,
): Promise<void> {
  try {
    const { handleId } = await engine.resolver.sources.test(sourceId, module.trim());
    useAppStore.getState().setSourceTestHandle(sourceId, handleId);
    await syncResolverOperation(engine, handleId);
  } catch (e) {
    useAppStore.getState().finishSourceTest(sourceId, {
      state: 'error',
      message: describeError(e),
    });
  }
}

export async function previewResolverSource(
  engine: EngineAPI,
  draft: ResolverSourceDraft,
): Promise<void> {
  const s = useAppStore.getState();
  try {
    const { handleId } = await engine.resolver.sources.preview(draft);
    s.beginSourcePreview(handleId);
    await syncResolverOperation(engine, handleId);
  } catch (e) {
    s.finishSourcePreview({ state: 'error', error: describeError(e) });
  }
}

export async function clearResolverCache(engine: EngineAPI): Promise<void> {
  await engine.resolver.cache.clear();
  await refreshResolverState(engine);
}

export async function lookupUnknownOid(engine: EngineAPI, oid: string): Promise<void> {
  const normalized = oid.trim().replace(/^\./, '');
  if (!/^\d+(?:\.\d+)+$/.test(normalized)) return;
  const current = useAppStore.getState().lookupHandles[normalized];
  if (current) return;
  try {
    const { handleId } = await engine.resolver.lookupOid({ oid: normalized, network: true });
    useAppStore.getState().beginOidLookup(normalized, handleId);
    await syncResolverOperation(engine, handleId);
  } catch (e) {
    useAppStore.getState().finishOidLookup(normalized, {
      state: 'error',
      error: describeError(e),
    });
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function extractTerminalStatus(
  payload: Record<string, unknown>,
  handleId: string | undefined,
  eventKind: string,
): ResolverOperationStatus {
  const given = payload.status as ResolverOperationStatus | undefined;
  if (given) return given;
  const now = Date.now();
  return {
    handleId: handleId ?? '',
    state: eventKind as ResolverOperationStatus['state'],
    startedAt: now,
    updatedAt: now,
    missingModules: [],
    sourceHosts: [],
    loadedModules: [],
    failures: [],
    result: payload.result as ResolverOperationStatus['result'],
  };
}

function operationStatusForEvent(
  current: ResolverOperationStatus | null,
  handleId: string,
  state: ResolverOperationStatus['state'],
  missingModules = current?.missingModules ?? [],
  sourceHosts = current?.sourceHosts ?? [],
): ResolverOperationStatus {
  const now = Date.now();
  return {
    handleId,
    state,
    startedAt: current?.startedAt ?? now,
    updatedAt: now,
    missingModules,
    sourceHosts,
    loadedModules: current?.loadedModules ?? [],
    failures: current?.failures ?? [],
    expiresAt: current?.expiresAt,
    result: current?.result,
  };
}

function extractImportResult(payload: Record<string, unknown>): ImportResult | null {
  const result = payload.result as Record<string, unknown> | undefined;
  if (!result) return null;
  if (Array.isArray(result.loaded) && Array.isArray(result.errors)) return result as unknown as ImportResult;
  const retry = result.retry as ImportResult | undefined;
  if (retry) return retry;
  return null;
}

export async function unloadModule(engine: EngineAPI, name: string): Promise<void> {
  await engine.mibs.unload(name);
  await refreshModules(engine);
  const s = useAppStore.getState();
  if (s.moduleFocus?.module.name === name) s.setModuleFocus(null);
  s.clearChildrenCache();
  await loadChildren(engine, '');
}

// --------------------------------------------------------------------------
// Browse
// --------------------------------------------------------------------------

/** Fetch (and cache) the children of an OID; '' loads the tree roots. */
export async function loadChildren(engine: EngineAPI, oid: string): Promise<void> {
  const s = useAppStore.getState();
  if (s.childrenCache[oid]) return;
  const children = s.moduleFocus
    ? await engine.mibs.moduleTree(s.moduleFocus.module.name, oid || undefined)
    : await engine.mibs.tree(oid || undefined);
  s.setChildren(oid, children);
}

export async function focusModule(engine: EngineAPI, moduleName: string): Promise<void> {
  const s = useAppStore.getState();
  const focus = await engine.mibs.module(moduleName);
  if (!focus) return;
  s.setModuleFocus(focus);
  s.setSelected(null);
  s.setSearch('');
  s.setHits([]);
  s.clearChildrenCache();
  s.setTab('browse');
  await loadChildren(engine, '');
}

export async function clearModuleFocus(engine: EngineAPI): Promise<void> {
  const s = useAppStore.getState();
  s.setModuleFocus(null);
  s.setSelected(null);
  s.clearChildrenCache();
  await loadChildren(engine, '');
}

export async function selectNode(engine: EngineAPI, oidOrName: string): Promise<void> {
  const s = useAppStore.getState();
  const detail = await engine.mibs.node(oidOrName, s.moduleFocus?.module.name);
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
  const hits = s.moduleFocus
    ? await engine.mibs.moduleSearch(s.moduleFocus.module.name, query, 40)
    : await engine.mibs.search(query, 40);
  if (useAppStore.getState().search === query) s.setHits(hits);
}

/** Send the browse selection into the Query tab and run it. */
export function walkFromNode(engine: EngineAPI, oid: string): void {
  const s = useAppStore.getState();
  s.setOid(oid);
  s.setOidName(null);
  s.setTab('query');
  void runWalk(engine);
}

export function getFromNode(engine: EngineAPI, detail: MibNodeDetail): void {
  const s = useAppStore.getState();
  const oid = detail.kind === 'scalar' ? `${detail.oid}.0` : detail.oid;
  s.setOid(oid);
  s.setOidName(detail.name);
  s.setTab('query');
  void runGet(engine);
}

export function setFromNode(detail: MibNodeDetail): void {
  const s = useAppStore.getState();
  const oid = detail.kind === 'scalar' ? `${detail.oid}.0` : `${detail.oid}.`;
  s.setOid(oid);
  s.setOidName(detail.name);
  s.updateSetDraft({ oid, type: inferWireType(detail.syntax), value: '' });
  s.setQueryOperation('set');
  s.setTab('query');
}

export async function trapFromNode(engine: EngineAPI, detail: MibNodeDetail): Promise<void> {
  const varbinds = [];
  for (const objectName of detail.objects ?? []) {
    const node = await engine.mibs.node(objectName);
    if (!node) continue;
    varbinds.push({
      oid: node.kind === 'scalar' ? `${node.oid}.0` : `${node.oid}.`,
      type: inferWireType(node.syntax),
      value: '',
    });
  }
  const s = useAppStore.getState();
  s.updateNotification({ trapOid: detail.oid, varbinds });
  s.setTrapMode('send');
  s.setTab('traps');
}
