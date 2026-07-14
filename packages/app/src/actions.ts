import { inferWireType, validateVarbindInput } from '@mibbeacon/core/client';
import type {
  AgentSpec,
  AgentTarget,
  OperationTarget,
  EngineAPI,
  EngineEvent,
  ImportResult,
  MibNodeDetail,
  MibTextFile,
  NotificationSendRequest,
  NotificationAgentSendRequest,
  TrapQuery,
  OidLookupResult,
  ResolverOperationStatus,
  ResolverSettings,
  ResolverSourceDraft,
  ResolverSourcePreviewResult,
  SourceConfig,
  SnmpVarbindInput,
} from '@mibbeacon/core/client';
import { useAppStore, type AgentForm, type QueryOperation } from './store';

let notificationSeq = 0;

/** Translate the string-based agent form into a typed AgentSpec. */
export function buildAgentSpec(form: AgentForm, defaultPort = 161): AgentSpec {
  const spec: AgentSpec = {
    host: form.host.trim(),
    port: Number(form.port) || defaultPort,
    transport: form.transport,
    version: form.version,
    timeoutMs: Number(form.timeoutMs) || 5_000,
    retries: Math.max(0, Number(form.retries) || 0),
  };
  if (form.version === 'v3') {
    spec.v3 = {
      user: form.v3.user,
      level: form.v3.level,
      authProtocol: form.v3.level !== 'noAuthNoPriv' ? form.v3.authProtocol : undefined,
      authKey: form.v3.level !== 'noAuthNoPriv' ? form.v3.authKey : undefined,
      privProtocol: form.v3.level === 'authPriv' ? form.v3.privProtocol : undefined,
      privKey: form.v3.level === 'authPriv' ? form.v3.privKey : undefined,
      context: form.v3.context || undefined,
    };
  } else {
    spec.community = form.community;
  }
  return spec;
}

/** Keep saved credentials inside the engine by targeting an opaque profile id. */
export function buildAgentTarget(form: AgentForm, selectedAgentId: string | null): AgentTarget {
  return selectedAgentId ? { agentId: selectedAgentId } : { agent: buildAgentSpec(form) };
}

export function buildOperationTarget(
  form: AgentForm,
  selectedAgentId: string | null,
  selectedGroupId: string | null,
): OperationTarget {
  return selectedGroupId ? { groupId: selectedGroupId } : buildAgentTarget(form, selectedAgentId);
}

function describeError(e: unknown): string {
  const err = e as {
    message?: string;
    hint?: string;
    details?: { errorIndex?: number; oid?: string };
  };
  const row = err.details?.errorIndex
    ? ` — staged row ${err.details.errorIndex}${err.details.oid ? ` (${err.details.oid})` : ''}`
    : '';
  return `${err.message ?? String(e)}${row}${err.hint ? ' — ' + err.hint : ''}`;
}

export function queryResultTitle(
  state: Pick<
    ReturnType<typeof useAppStore.getState>,
    'selectedAgentId' | 'agentProfiles' | 'agent' | 'oid'
  >,
  operation: string,
): string {
  const agentName = state.selectedAgentId
    ? (state.agentProfiles.find((profile) => profile.id === state.selectedAgentId)?.name ?? 'Agent')
    : state.agent.host.trim() || 'Ad hoc';
  return `${agentName} · ${operation} · ${state.oid}`;
}

export async function numericOid(engine: EngineAPI, value: string): Promise<string> {
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)+$/.test(trimmed)) return trimmed;
  const translated = await engine.mibs.translate(trimmed);
  if (!translated) throw new Error(`OID or symbol "${trimmed}" could not be resolved`);
  return translated.oid;
}

async function numericSetVarbinds(
  engine: EngineAPI,
  inputs: readonly SnmpVarbindInput[],
): Promise<SnmpVarbindInput[]> {
  return Promise.all(
    inputs.map(async (input) => ({
      ...input,
      oid: await numericOid(engine, input.oid),
      ...(input.type === 'ObjectIdentifier'
        ? { value: await numericOid(engine, input.value) }
        : {}),
    })),
  );
}

// --------------------------------------------------------------------------
// Query
// --------------------------------------------------------------------------

async function runOneShot(engine: EngineAPI, kind: 'get' | 'getNext' | 'getBulk'): Promise<void> {
  const s = useAppStore.getState();
  const groupId = s.queryGroupMode ? s.selectedAgentGroupId : null;
  const agentTarget = buildAgentTarget(s.agent, s.selectedAgentId);
  const target = groupId ? ({ groupId } as const) : agentTarget;
  if (!groupId && !s.selectedAgentId && !s.agent.host.trim()) {
    s.setQueryError('Enter an agent host first.');
    return;
  }
  s.setQueryError(null);
  s.setStats({ count: 0, batches: 0, ms: 0 });
  const t0 = Date.now();
  try {
    const oid = await numericOid(engine, s.oid);
    s.clearAgentOperationStatuses();
    s.clearOperationPduLog();
    s.setResults([]);
    const request =
      kind === 'getBulk'
        ? {
            ...target,
            kind,
            oids: [oid],
            nonRepeaters: Number(s.agent.getBulkNonRepeaters) || 0,
            maxRepetitions: Number(s.agent.getBulkMaxRepetitions) || 20,
          }
        : { ...target, kind, oids: [oid] };
    const { handleId } = await engine.ops.start(request);
    s.setRunning(handleId, t0);
  } catch (e) {
    s.setResults([]);
    s.setQueryError(describeError(e));
  }
}

export const runGet = (engine: EngineAPI) => runOneShot(engine, 'get');
export const runGetNext = (engine: EngineAPI) => runOneShot(engine, 'getNext');
export const runGetBulk = (engine: EngineAPI) => runOneShot(engine, 'getBulk');

export async function runSet(engine: EngineAPI): Promise<void> {
  const s = useAppStore.getState();
  const groupId = s.queryGroupMode ? s.selectedAgentGroupId : null;
  const agentTarget = buildAgentTarget(s.agent, s.selectedAgentId);
  const target = groupId ? ({ groupId } as const) : agentTarget;
  if (!groupId && !s.selectedAgentId && !s.agent.host.trim()) {
    s.setQueryError('Enter an agent host first.');
    return;
  }
  s.setQueryError(null);
  s.setStats({ count: 0, batches: 0, ms: 0 });
  const t0 = Date.now();
  try {
    const varbinds = await numericSetVarbinds(
      engine,
      s.setStaging.length > 0 ? s.setStaging : [s.setDraft],
    );
    s.clearAgentOperationStatuses();
    s.clearOperationPduLog();
    s.setResults([]);
    const { handleId } = await engine.ops.start({ ...target, kind: 'set', varbinds });
    s.setRunning(handleId, t0);
    s.setSetReview(false);
    s.clearSetStaging();
  } catch (e) {
    s.setResults([]);
    s.setQueryError(describeError(e));
  }
}

export async function prepareSetReview(engine: EngineAPI): Promise<void> {
  const state = useAppStore.getState();
  const varbinds = state.setStaging.length > 0 ? state.setStaging : [state.setDraft];
  const validationError = varbinds.map(validateVarbindInput).find(Boolean);
  if (validationError) {
    state.setQueryError(validationError);
    return;
  }
  state.setQueryError(null);
  if (state.queryGroupMode && state.selectedAgentGroupId) {
    state.setSetPreviousValues([]);
    state.setSetReview(true);
    return;
  }
  try {
    const target = buildAgentTarget(state.agent, state.selectedAgentId);
    state.setSetPreviousValues(
      await engine.ops.get({
        ...target,
        oids: await Promise.all(varbinds.map(({ oid }) => numericOid(engine, oid))),
      }),
    );
  } catch {
    state.setSetPreviousValues([]);
  }
  state.setSetReview(true);
}

export async function runWalk(engine: EngineAPI): Promise<void> {
  const s = useAppStore.getState();
  const groupId = s.queryGroupMode ? s.selectedAgentGroupId : null;
  const agentTarget = buildAgentTarget(s.agent, s.selectedAgentId);
  const target = groupId ? ({ groupId } as const) : agentTarget;
  if (!groupId && !s.selectedAgentId && !s.agent.host.trim()) {
    s.setQueryError('Enter an agent host first.');
    return;
  }
  s.setQueryError(null);
  s.clearAgentOperationStatuses();
  s.clearOperationPduLog();
  s.setResults([]);
  s.setStats({ count: 0, batches: 0, ms: 0 });
  try {
    const baseOid = await numericOid(engine, s.oid);
    const { handleId } = groupId
      ? await engine.ops.start({ ...target, kind: 'walk', baseOid })
      : await engine.ops.startWalk({ ...agentTarget, baseOid });
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

export async function openTableView(engine: EngineAPI, node: MibNodeDetail): Promise<void> {
  let entry: MibNodeDetail | null = node;
  if (node.kind === 'table') {
    const child = (await engine.mibs.tree(node.oid)).find((item) => item.kind === 'entry');
    entry = child ? await engine.mibs.node(child.oid, child.module) : null;
  } else if (node.kind === 'column') {
    entry = await engine.mibs.node(node.oid.split('.').slice(0, -1).join('.'), node.module);
  }
  if (!entry || entry.kind !== 'entry') throw new Error(`${node.name} is not a table or entry`);
  const columnSummaries = (await engine.mibs.tree(entry.oid)).filter(
    (item) => item.kind === 'column',
  );
  const columnDetails = await Promise.all(
    columnSummaries.map((column) => engine.mibs.node(column.oid, column.module)),
  );
  const indexDetails = await Promise.all(
    (entry.indexes ?? []).map((name) => engine.mibs.node(name, entry!.module)),
  );
  const columns = columnSummaries.map((column, index) => ({
    oid: column.oid,
    name: column.name,
    ...(columnDetails[index]?.access ? { access: columnDetails[index]!.access } : {}),
    ...(columnDetails[index]?.syntax ? { syntax: columnDetails[index]!.syntax } : {}),
  }));
  useAppStore.getState().setTableView({
    entryOid: entry.oid,
    name: entry.name,
    columns,
    indexes: (entry.indexes ?? []).map((name, index) => ({
      name,
      syntax: indexDetails[index]?.syntax ?? 'INTEGER',
      implied: entry!.impliedIndexes?.includes(name),
      displayHint: indexDetails[index]?.displayHint,
    })),
    selectedColumnOids: columns.map(({ oid }) => oid),
    rotate: false,
    pollMs: 0,
  });
  await runTableView(engine);
}

export async function runTableView(engine: EngineAPI): Promise<void> {
  const state = useAppStore.getState();
  const view = state.tableView;
  if (!view) return;
  const groupId = state.queryGroupMode ? state.selectedAgentGroupId : null;
  const target = buildOperationTarget(state.agent, state.selectedAgentId, groupId);
  state.setQueryError(null);
  state.setResults([]);
  state.clearOperationPduLog();
  state.clearAgentOperationStatuses();
  const { handleId } = await engine.ops.start({
    ...target,
    kind: 'table-fetch',
    baseOid: view.entryOid,
    columnOids: view.selectedColumnOids,
  });
  state.setRunning(handleId, Date.now());
}

export async function refreshAgentProfiles(engine: EngineAPI): Promise<void> {
  useAppStore.getState().setAgentProfiles(await engine.agents.list());
}

export async function refreshAgentGroups(engine: EngineAPI): Promise<void> {
  useAppStore.getState().setAgentGroups(await engine.agents.groups.list());
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

export async function toggleReceiver(
  engine: EngineAPI,
  port: string,
  options: {
    disableAuthorization?: boolean;
    communities?: string[];
    transport?: 'udp4' | 'udp6' | 'dual';
  } = {},
): Promise<void> {
  const s = useAppStore.getState();
  if (s.receiver.running) {
    await engine.traps.stopReceiver();
    s.setReceiver({ running: false });
  } else {
    try {
      const status = await engine.traps.startReceiver({
        ...(port.trim() ? { port: Number(port) } : {}),
        disableAuthorization: options.disableAuthorization ?? true,
        communities: options.communities ?? ['public'],
        transport: options.transport ?? 'dual',
      });
      s.setReceiver({
        running: status.running,
        port: status.port,
        count: status.count,
        drops: status.drops,
        transports: status.transports,
      });
    } catch (e) {
      s.setReceiver({ running: false });
      throw e;
    }
  }
}

export async function refreshTrapRecords(engine: EngineAPI, query: TrapQuery = {}): Promise<void> {
  useAppStore.getState().setTrapRecords(await engine.traps.query({ ...query, limit: 10_000 }));
}

export async function markTrapRead(engine: EngineAPI, id: string, read = true): Promise<void> {
  await engine.traps.markRead([id], read);
  useAppStore.getState().markTrapRead(id, read);
}

export async function deleteTrap(engine: EngineAPI, id: string): Promise<void> {
  await engine.traps.delete([id]);
  useAppStore.getState().removeTrap(id);
}

export async function sendNotification(engine: EngineAPI): Promise<void> {
  const s = useAppStore.getState();
  const form = s.notification;
  const target = buildAgentSpec(form.target, 162);
  const selectedProfile = s.agentProfiles.find((profile) => profile.id === s.notificationAgentId);
  const sendsV1 = selectedProfile ? selectedProfile.version === 'v1' : form.target.version === 'v1';
  if (!s.notificationAgentId && !target.host) {
    s.setSendError('Enter a destination host first.');
    return;
  }
  const payload = {
    kind: form.kind,
    trapOid: form.trapOid,
    varbinds: form.varbinds,
    ...(form.upTime.trim() ? { upTime: Number(form.upTime) } : {}),
    ...(form.agentAddress.trim() ? { agentAddress: form.agentAddress.trim() } : {}),
    ...(sendsV1
      ? {
          v1Enterprise: form.v1Enterprise.trim(),
          v1Generic: Number(form.v1Generic),
          v1Specific: Number(form.v1Specific),
        }
      : {}),
  };
  const request: NotificationSendRequest | NotificationAgentSendRequest = s.notificationAgentId
    ? { agentId: s.notificationAgentId, ...payload }
    : { target, ...payload };
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
  request: NotificationSendRequest | NotificationAgentSendRequest,
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

const resolverRefreshes = new WeakMap<EngineAPI, Promise<void>>();

export function refreshResolverState(engine: EngineAPI): Promise<void> {
  const current = resolverRefreshes.get(engine);
  if (current) return current;
  const refresh = (async () => {
    const [settings, sources, cache, history] = await Promise.all([
      engine.resolver.settings.get(),
      engine.resolver.sources.list(),
      engine.resolver.cache.stats(),
      engine.resolver.history.list(30),
    ]);
    const s = useAppStore.getState();
    s.setResolverSettings(settings);
    s.setResolverSources(sources);
    s.setResolverCache(cache);
    s.setResolverHistory(history);
  })().finally(() => resolverRefreshes.delete(engine));
  resolverRefreshes.set(engine, refresh);
  return refresh;
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
  )
    return;

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
  const isImport = Boolean(
    event.handleId && event.handleId === useAppStore.getState().importHandle,
  );

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
        operationStatusForEvent(useAppStore.getState().importStatus, event.handleId!, 'resolving'),
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
      stage: stringValue(result.stage),
      responseExcerpt: stringValue(result.responseExcerpt),
      httpStatus: typeof result.httpStatus === 'number' ? result.httpStatus : undefined,
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
    .setResolverSources(
      await engine.resolver.sources.reorder([...fixed.map((source) => source.id), ...ids]),
    );
}

export async function dragResolverSource(
  engine: EngineAPI,
  sourceId: string,
  targetIndex: number,
): Promise<void> {
  const sources = useAppStore.getState().resolverSources;
  const fixed = sources.filter((source) => source.kind === 'cache');
  const movable = sources.filter((source) => source.kind !== 'cache');
  const from = movable.findIndex((source) => source.id === sourceId);
  const to = Math.max(0, Math.min(movable.length - 1, Math.trunc(targetIndex)));
  if (from < 0 || from === to) return;
  const [moved] = movable.splice(from, 1);
  if (!moved) return;
  movable.splice(to, 0, moved);
  useAppStore
    .getState()
    .setResolverSources(
      await engine.resolver.sources.reorder([
        ...fixed.map((source) => source.id),
        ...movable.map((source) => source.id),
      ]),
    );
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

/** Resolve a lookup candidate through the configured chain, or strictly from local cache. */
export async function loadLookupCandidate(
  engine: EngineAPI,
  module: string,
  cachedOnly = false,
): Promise<void> {
  const state = useAppStore.getState();
  if (state.importHandle) return;
  try {
    const { handleId } = cachedOnly
      ? await engine.resolver.loadCachedModules([module])
      : await engine.resolver.resolveModules([module]);
    state.beginImport(handleId);
    await syncResolverOperation(engine, handleId);
  } catch (error) {
    state.setResolverError(describeError(error));
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
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
  if (Array.isArray(result.loaded) && Array.isArray(result.errors))
    return result as unknown as ImportResult;
  const retry = result.retry as ImportResult | undefined;
  if (retry) return retry;
  return null;
}

export async function unloadModule(engine: EngineAPI, name: string): Promise<void> {
  await engine.mibs.unload(name);
  await refreshModules(engine);
  const s = useAppStore.getState();
  if (s.moduleFocus?.module.name === name) {
    s.setModuleFocus(null);
    s.setSelected(null);
  }
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

export async function selectModuleInPlace(engine: EngineAPI, moduleName: string): Promise<void> {
  const s = useAppStore.getState();
  const focus = await engine.mibs.module(moduleName);
  if (!focus) return;
  s.setModuleFocus(focus);
  s.setSelected(null);
  s.setSearch('');
  s.setHits([]);
  s.clearChildrenCache();
  await loadChildren(engine, '');
}

export async function focusModule(engine: EngineAPI, moduleName: string): Promise<void> {
  await selectModuleInPlace(engine, moduleName);
  useAppStore.getState().setTab('browse');
}

export async function clearModuleFocus(engine: EngineAPI): Promise<void> {
  const s = useAppStore.getState();
  s.setModuleFocus(null);
  s.setSelected(null);
  s.clearChildrenCache();
  await loadChildren(engine, '');
}

export async function selectNode(
  engine: EngineAPI,
  oidOrName: string,
): Promise<MibNodeDetail | null> {
  const s = useAppStore.getState();
  const detail = await engine.mibs.node(oidOrName, s.moduleFocus?.module.name);
  s.setSelected(detail);
  return detail;
}

/** Expand every ancestor prefix of an OID (used when jumping from search). */
export function getOidAncestorPrefixes(oid: string): string[] {
  const arcs = oid.split('.').filter(Boolean);
  return arcs.slice(0, -1).map((_arc, index) => arcs.slice(0, index + 1).join('.'));
}

export async function revealOid(engine: EngineAPI, oid: string): Promise<void> {
  const s = useAppStore.getState();
  const prefixes = getOidAncestorPrefixes(oid);
  for (const prefix of prefixes) {
    s.setExpanded(prefix, true);
  }
  await Promise.all(prefixes.map((prefix) => loadChildren(engine, prefix)));
}

export async function runSearch(engine: EngineAPI, query: string): Promise<void> {
  const s = useAppStore.getState();
  if (!query.trim()) {
    s.setHits([]);
    s.setSearchPhase('idle');
    s.setSearchError(null);
    return;
  }
  s.setSearchPhase('searching');
  s.setSearchError(null);
  try {
    const hits = s.moduleFocus
      ? await engine.mibs.moduleSearch(s.moduleFocus.module.name, query, 40)
      : await engine.mibs.search(query, 40);
    const current = useAppStore.getState();
    if (current.search === query) {
      current.setHits(hits);
      current.setSearchPhase('idle');
    }
  } catch (error) {
    const current = useAppStore.getState();
    if (current.search === query) {
      current.setSearchPhase('error');
      current.setSearchError(describeError(error));
    }
  }
}

export async function openSearchHit(engine: EngineAPI, oid: string): Promise<void> {
  const initial = useAppStore.getState();
  const activeQuery = initial.search;
  initial.setSearchPhase('opening');
  initial.setSearchError(null);
  try {
    const detail = await selectNode(engine, oid);
    if (!detail) throw new Error(`MIB object is no longer available: ${oid}`);
    await revealOid(engine, oid);
    const current = useAppStore.getState();
    if (current.search === activeQuery) {
      current.setSearch('');
      current.setHits([]);
      current.setSearchPhase('idle');
    }
  } catch (error) {
    const current = useAppStore.getState();
    if (current.search === activeQuery) {
      current.setSearchPhase('error');
      current.setSearchError(describeError(error));
    }
  }
}

export class MibObjectNotFoundError extends Error {
  readonly code = 'MIB_OBJECT_NOT_FOUND';

  constructor(readonly oid: string) {
    super(`MIB object is no longer available: ${oid}`);
    this.name = 'MibObjectNotFoundError';
  }
}

/** Resolve an object globally, then leave module focus and reveal it in the full catalog tree. */
export async function openGlobalCatalogObject(
  engine: EngineAPI,
  oid: string,
): Promise<MibNodeDetail> {
  const detail = await engine.mibs.node(oid);
  if (!detail) throw new MibObjectNotFoundError(oid);

  const prefixes = getOidAncestorPrefixes(detail.oid);
  const [root, ...branches] = await Promise.all([
    engine.mibs.tree(undefined),
    ...prefixes.map((prefix) => engine.mibs.tree(prefix)),
  ]);

  const state = useAppStore.getState();
  state.setModuleFocus(null);
  state.clearChildrenCache();
  state.setChildren('', root);
  prefixes.forEach((prefix, index) => {
    state.setChildren(prefix, branches[index] ?? []);
    state.setExpanded(prefix, true);
  });
  state.setSearch('');
  state.setHits([]);
  state.setSearchPhase('idle');
  state.setSearchError(null);
  state.setSelected(detail);
  return detail;
}

export interface NodeOperationPlan {
  allowed: boolean;
  oid: string;
  requiresInstance: boolean;
  reason?: string;
}

function isWritable(detail: MibNodeDetail): boolean {
  return (
    detail.access === 'read-write' ||
    detail.access === 'read-create' ||
    detail.access === 'write-only'
  );
}

export function getNodeOperationPlan(
  detail: MibNodeDetail,
  operation: QueryOperation,
  instanceSuffix = '',
): NodeOperationPlan {
  const objectOperation = operation === 'get' || operation === 'set';
  if (objectOperation && detail.kind !== 'scalar' && detail.kind !== 'column') {
    return {
      allowed: false,
      oid: detail.oid,
      requiresInstance: false,
      reason: 'Get and Set require a scalar or column object.',
    };
  }
  if (operation === 'get' && detail.access === 'not-accessible') {
    return {
      allowed: false,
      oid: detail.oid,
      requiresInstance: false,
      reason: 'This object is not directly readable.',
    };
  }
  if (operation === 'set' && !isWritable(detail)) {
    return {
      allowed: false,
      oid: detail.oid,
      requiresInstance: false,
      reason: 'This object is not writable.',
    };
  }
  if ((operation === 'get' || operation === 'set') && detail.kind === 'column') {
    const suffix = instanceSuffix.trim().replace(/^\.+/, '');
    return suffix
      ? { allowed: true, oid: `${detail.oid}.${suffix}`, requiresInstance: false }
      : {
          allowed: false,
          oid: `${detail.oid}.`,
          requiresInstance: true,
          reason: 'Enter the row instance suffix before running this operation.',
        };
  }
  const oid =
    (operation === 'get' || operation === 'set') && detail.kind === 'scalar'
      ? `${detail.oid}.0`
      : detail.oid;
  return { allowed: true, oid, requiresInstance: false };
}

export async function prepareNodeOperation(
  engine: EngineAPI,
  detail: MibNodeDetail,
  operation: QueryOperation,
  options: { instanceSuffix?: string; execute?: boolean } = {},
): Promise<void> {
  const s = useAppStore.getState();
  const plan = getNodeOperationPlan(detail, operation, options.instanceSuffix);
  s.setBrowserConsoleOpen(true);
  if (s.running) {
    s.setQueryError('Stop the running walk before starting another operation.');
    return;
  }
  s.setQueryOperation(operation);
  s.setOid(plan.oid);
  s.setOidName(detail.name);
  s.setQueryError(plan.allowed ? null : (plan.reason ?? 'This operation is unavailable.'));
  if (operation === 'set') {
    s.updateSetDraft({ oid: plan.oid, type: inferWireType(detail.syntax), value: '' });
  }
  if (!plan.allowed || options.execute === false || operation === 'set') return;
  if (operation === 'get') await runGet(engine);
  else if (operation === 'getNext') await runGetNext(engine);
  else await runWalk(engine);
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
