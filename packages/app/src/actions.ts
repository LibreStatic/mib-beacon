import { inferWireType, normalizeNumericOid, validateVarbindInput } from '@mibbeacon/core/client';
import type {
  AgentCreateDraft,
  AgentProfile,
  AgentSpec,
  AgentTarget,
  AgentTestResult,
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
  VendorMibBrowseResult,
  ResolverOperationStatus,
  ResolverSettings,
  ResolverSourceDraft,
  ResolverSourcePreviewResult,
  SourceConfig,
  SnmpVarbindInput,
} from '@mibbeacon/core/client';
import { useAppStore, type AgentForm, type FileImportDraft, type QueryOperation } from './store';
import { replaceRouteForTab } from './routes';
import { engineStartArbitration } from './engine-start-arbitration';
import {
  ResolverSourceCollectionController,
  redactResolverSourceError,
  resolverSourceCollectionStatusText,
} from './resolver-source-collection';
import { agentPersistentCollectionsController } from './agent-persistent-collections';
import { ResolverCacheClearController } from './resolver-cache-transaction';

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

async function runOneShot(
  engine: EngineAPI,
  kind: 'get' | 'getNext' | 'getBulk',
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const startClaim = engineStartArbitration.begin(engine, 'query-operation');
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
    if (!engineStartArbitration.isCurrent(startClaim, owns)) return;
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
    await engineStartArbitration.accept(
      startClaim,
      handleId,
      owns,
      (id) => engine.ops.cancel(id),
      (id) => s.setRunning(id, t0),
    );
  } catch (e) {
    if (!engineStartArbitration.isCurrent(startClaim, owns)) return;
    s.setResults([]);
    s.setQueryError(describeError(e));
  }
}

export const runGet = (engine: EngineAPI, owns?: StoreWriteOwnership) =>
  runOneShot(engine, 'get', owns);
export const runGetNext = (engine: EngineAPI, owns?: StoreWriteOwnership) =>
  runOneShot(engine, 'getNext', owns);
export const runGetBulk = (engine: EngineAPI, owns?: StoreWriteOwnership) =>
  runOneShot(engine, 'getBulk', owns);

export async function runSet(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const startClaim = engineStartArbitration.begin(engine, 'query-operation');
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
    if (!engineStartArbitration.isCurrent(startClaim, owns)) return;
    s.clearAgentOperationStatuses();
    s.clearOperationPduLog();
    s.setResults([]);
    const { handleId } = await engine.ops.start({ ...target, kind: 'set', varbinds });
    const accepted = await engineStartArbitration.accept(
      startClaim,
      handleId,
      owns,
      (id) => engine.ops.cancel(id),
      (id) => s.setRunning(id, t0),
    );
    if (!accepted) return;
    s.setSetReview(false);
    s.clearSetStaging();
    s.pushToast({
      tone: 'success',
      message: `Set request sent (${varbinds.length} varbind${varbinds.length === 1 ? '' : 's'})`,
    });
  } catch (e) {
    if (!engineStartArbitration.isCurrent(startClaim, owns)) return;
    const error = describeError(e);
    s.setResults([]);
    s.setQueryError(error);
    s.pushToast({ tone: 'error', message: error });
  }
}

export async function prepareSetReview(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const startClaim = engineStartArbitration.begin(engine, 'query-operation');
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
    const previousValues = await engine.ops.get({
      ...target,
      oids: await Promise.all(varbinds.map(({ oid }) => numericOid(engine, oid))),
    });
    if (!engineStartArbitration.isCurrent(startClaim, owns)) return;
    state.setSetPreviousValues(previousValues);
  } catch {
    if (!engineStartArbitration.isCurrent(startClaim, owns)) return;
    state.setSetPreviousValues([]);
  }
  if (!engineStartArbitration.isCurrent(startClaim, owns)) return;
  state.setSetReview(true);
}

export async function runWalk(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const startClaim = engineStartArbitration.begin(engine, 'query-operation');
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
    if (!engineStartArbitration.isCurrent(startClaim, owns)) return;
    const { handleId } = groupId
      ? await engine.ops.start({ ...target, kind: 'walk', baseOid })
      : await engine.ops.startWalk({ ...agentTarget, baseOid });
    await engineStartArbitration.accept(
      startClaim,
      handleId,
      owns,
      (id) => engine.ops.cancel(id),
      (id) => s.setRunning(id, Date.now()),
    );
  } catch (e) {
    if (!engineStartArbitration.isCurrent(startClaim, owns)) return;
    s.setQueryError(describeError(e));
  }
}

export async function stopWalk(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  engineStartArbitration.begin(engine, 'query-operation');
  const { running, setRunning } = useAppStore.getState();
  if (running) {
    await engine.ops.cancel(running);
    if (!owns() || useAppStore.getState().running !== running) return;
    setRunning(null);
  }
}

export async function openTableView(
  engine: EngineAPI,
  node: MibNodeDetail,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  let entry: MibNodeDetail | null = node;
  if (node.kind === 'table') {
    const child = (await engine.mibs.tree(node.oid)).find((item) => item.kind === 'entry');
    entry = child ? await engine.mibs.node(child.oid, child.module) : null;
  } else if (node.kind === 'column') {
    entry = await engine.mibs.node(node.oid.split('.').slice(0, -1).join('.'), node.module);
  }
  if (!owns()) return;
  if (!entry || entry.kind !== 'entry') throw new Error(`${node.name} is not a table or entry`);
  openLiveMibScope(entry.oid);
}

export async function runTableView(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const startClaim = engineStartArbitration.begin(engine, 'query-operation');
  const state = useAppStore.getState();
  const view = state.tableView;
  if (!view) return;
  const groupId = state.queryGroupMode ? state.selectedAgentGroupId : null;
  const target = buildOperationTarget(state.agent, state.selectedAgentId, groupId);
  state.setQueryError(null);
  state.setResults([]);
  state.clearOperationPduLog();
  state.clearAgentOperationStatuses();
  try {
    const { handleId } = await engine.ops.start({
      ...target,
      kind: 'table-fetch',
      baseOid: view.entryOid,
      columnOids: view.selectedColumnOids,
    });
    await engineStartArbitration.accept(
      startClaim,
      handleId,
      owns,
      (id) => engine.ops.cancel(id),
      (id) => state.setRunning(id, Date.now()),
    );
  } catch (error) {
    if (engineStartArbitration.isCurrent(startClaim, owns))
      state.setQueryError(describeError(error));
  }
}

const agentProfileRefreshGenerations = new WeakMap<EngineAPI, number>();
const agentGroupRefreshGenerations = new WeakMap<EngineAPI, number>();
export type StoreWriteOwnership = () => boolean;
const alwaysOwnsStoreWrite: StoreWriteOwnership = () => true;

export async function openQuerySnapshot(
  engine: EngineAPI,
  snapshotId: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const loaded = await engine.ops.snapshots.get(snapshotId);
  if (!owns() || !loaded) return;
  const state = useAppStore.getState();
  state.setResults(loaded.results);
  state.setStats({ count: loaded.results.length, batches: 1, ms: 0 });
  state.saveQueryResultTab(`${loaded.agentName} · snapshot · ${loaded.baseOid}`);
}

export async function refreshAgentProfiles(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const generation = (agentProfileRefreshGenerations.get(engine) ?? 0) + 1;
  agentProfileRefreshGenerations.set(engine, generation);
  const controller = agentPersistentCollectionsController(engine, owns);
  await controller.refresh(
    'refresh',
    () => owns() && agentProfileRefreshGenerations.get(engine) === generation,
  );
}

export async function refreshAgentGroups(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const generation = (agentGroupRefreshGenerations.get(engine) ?? 0) + 1;
  agentGroupRefreshGenerations.set(engine, generation);
  const controller = agentPersistentCollectionsController(engine, owns);
  await controller.refresh(
    'refresh',
    () => owns() && agentGroupRefreshGenerations.get(engine) === generation,
  );
}

export interface AgentProfileSaveOutcome {
  profile: AgentProfile;
  refreshError: unknown | null;
}

/** Keep an acknowledged profile mutation authoritative even if list reconciliation fails. */
export async function saveAgentProfile(
  engine: EngineAPI,
  editingId: string | null,
  draft: AgentCreateDraft,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<AgentProfileSaveOutcome> {
  if (!owns()) throw new Error('Agent command lost engine ownership');
  const controller = agentPersistentCollectionsController(engine, owns);
  const profile = editingId
    ? await controller.updateProfile(editingId, draft, owns)
    : await controller.createProfile(draft, owns);
  if (!owns()) return { profile, refreshError: null };
  try {
    await refreshAgentProfiles(engine, owns);
    return { profile, refreshError: null };
  } catch (refreshError) {
    return { profile, refreshError };
  }
}

export interface AgentProfileTestOutcome {
  result: AgentTestResult;
  refreshError: unknown | null;
}

/** Preserve a successful connectivity result even if metadata reconciliation fails. */
export async function testAgentProfile(
  engine: EngineAPI,
  id: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<AgentProfileTestOutcome> {
  if (!owns()) throw new Error('Agent test lost engine ownership');
  const result = await engine.agents.test(id);
  if (!owns()) throw new Error('Agent test lost engine ownership');
  try {
    await refreshAgentProfiles(engine, owns);
    return { result, refreshError: null };
  } catch (refreshError) {
    return { result, refreshError };
  }
}

export interface AgentProfileDeleteOutcome {
  refreshErrors: unknown[];
}

/** Keep an acknowledged deletion authoritative while both dependent lists reconcile. */
export async function deleteAgentProfile(
  engine: EngineAPI,
  id: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<AgentProfileDeleteOutcome> {
  if (!owns()) return { refreshErrors: [] };
  await agentPersistentCollectionsController(engine, owns).deleteProfile(id, owns);
  if (!owns()) return { refreshErrors: [] };
  const refreshes = await Promise.allSettled([
    refreshAgentProfiles(engine, owns),
    refreshAgentGroups(engine, owns),
  ]);
  return {
    refreshErrors: refreshes.flatMap((refresh) =>
      refresh.status === 'rejected' ? [refresh.reason] : [],
    ),
  };
}

/** Live OID → name hint for the query field. */
export async function resolveOidHint(
  engine: EngineAPI,
  oid: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const s = useAppStore.getState();
  const normalized = normalizeNumericOid(oid);
  if (!normalized) {
    s.setOidName(null);
    return;
  }
  try {
    const r = await engine.mibs.resolve(normalized);
    if (!owns()) return;
    // Only apply if the field hasn't changed underneath us.
    if (useAppStore.getState().oid === oid) {
      s.setOidName(r?.name ?? null);
      if (r && useAppStore.getState().queryOperation === 'set') {
        const node = await engine.mibs.node(r.definitionOid, s.moduleFocus?.module.name);
        if (owns() && useAppStore.getState().oid === oid && node) {
          s.updateSetDraft({ type: inferWireType(node.syntax) });
        }
      }
    }
  } catch {
    if (!owns()) return;
    s.setOidName(null);
  }
}

// --------------------------------------------------------------------------
// Traps
// --------------------------------------------------------------------------

const receiverTransitions = new WeakMap<EngineAPI, Promise<void>>();
const receiverTransitionGeneration = new WeakMap<EngineAPI, number>();
const trapRecordRefreshGeneration = new WeakMap<EngineAPI, number>();
interface TrapRecordMutationQueue {
  tail: Promise<void>;
  exact: Map<string, { resource: string; promise: Promise<void> }>;
}
const trapRecordMutations = new WeakMap<EngineAPI, TrapRecordMutationQueue>();

export function invalidateTrapRecordAuthority(engine: EngineAPI): number {
  const generation = (trapRecordRefreshGeneration.get(engine) ?? 0) + 1;
  trapRecordRefreshGeneration.set(engine, generation);
  return generation;
}

export function performTrapRecordMutation(
  engine: EngineAPI,
  resource: string,
  intent: string,
  remote: () => Promise<unknown>,
  apply: () => void,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return Promise.resolve();
  let queue = trapRecordMutations.get(engine);
  if (!queue) {
    queue = { tail: Promise.resolve(), exact: new Map() };
    trapRecordMutations.set(engine, queue);
  }
  const existing = queue.exact.get(intent);
  if (existing) return existing.promise;
  invalidateTrapRecordAuthority(engine);
  const mutation = queue.tail
    .catch(() => undefined)
    .then(async () => {
      if (!owns()) throw new Error('Trap record mutation lost engine ownership');
      await remote();
      if (!owns()) throw new Error('Trap record mutation lost engine ownership');
      invalidateTrapRecordAuthority(engine);
      apply();
    })
    .finally(() => {
      if (queue?.exact.get(intent)?.promise === mutation) queue.exact.delete(intent);
    });
  queue.exact.set(intent, { resource, promise: mutation });
  queue.tail = mutation;
  return mutation;
}

export async function refreshTrapReceiverStatus(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const generation = (receiverTransitionGeneration.get(engine) ?? 0) + 1;
  receiverTransitionGeneration.set(engine, generation);
  const status = await engine.traps.status();
  if (!owns() || receiverTransitionGeneration.get(engine) !== generation) return;
  useAppStore.getState().setReceiver({
    running: status.running,
    ...(status.port ? { port: status.port } : {}),
    count: status.count,
    drops: status.drops,
    ...(status.transports ? { transports: status.transports } : {}),
  });
}

export async function toggleReceiver(
  engine: EngineAPI,
  port: string,
  options: {
    disableAuthorization?: boolean;
    communities?: string[];
    transport?: 'udp4' | 'udp6' | 'dual';
  } = {},
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const pending = receiverTransitions.get(engine);
  if (pending) return pending;
  const generation = (receiverTransitionGeneration.get(engine) ?? 0) + 1;
  receiverTransitionGeneration.set(engine, generation);
  const accepts = () => owns() && receiverTransitionGeneration.get(engine) === generation;
  const transition = (async () => {
    const s = useAppStore.getState();
    if (s.receiver.running) {
      await engine.traps.stopReceiver();
      if (!accepts()) return;
      s.setReceiver({ running: false });
    } else {
      try {
        const status = await engine.traps.startReceiver({
          ...(port.trim() ? { port: Number(port) } : {}),
          disableAuthorization: options.disableAuthorization ?? true,
          communities: options.communities ?? ['public'],
          transport: options.transport ?? 'dual',
        });
        if (!accepts()) return;
        s.setReceiver({
          running: status.running,
          port: status.port,
          count: status.count,
          drops: status.drops,
          transports: status.transports,
        });
      } catch (e) {
        if (!accepts()) return;
        s.setReceiver({ running: false });
        throw e;
      }
    }
  })().finally(() => {
    if (receiverTransitions.get(engine) === transition) receiverTransitions.delete(engine);
  });
  receiverTransitions.set(engine, transition);
  return transition;
}

export async function refreshTrapRecords(
  engine: EngineAPI,
  query: TrapQuery = {},
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const generation = invalidateTrapRecordAuthority(engine);
  const records = await engine.traps.query({ ...query, limit: 10_000 });
  if (owns() && trapRecordRefreshGeneration.get(engine) === generation)
    useAppStore.getState().setTrapRecords(records);
}

export async function markTrapRead(
  engine: EngineAPI,
  id: string,
  read = true,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  return performTrapRecordMutation(
    engine,
    id,
    `mark:${id}:${read}`,
    () => engine.traps.markRead([id], read),
    () => useAppStore.getState().markTrapRead(id, read),
    owns,
  );
}

export async function deleteTrap(
  engine: EngineAPI,
  id: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  return performTrapRecordMutation(
    engine,
    id,
    `delete:${id}`,
    () => engine.traps.delete([id]),
    () => useAppStore.getState().removeTrap(id),
    owns,
  );
}

export async function sendNotification(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const s = useAppStore.getState();
  if (s.sendBusy) return;
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
    if (!owns()) return;
    s.addSendHistory({ id, request, result });
    s.pushToast({ tone: 'success', message: `${form.kind === 'inform' ? 'Inform' : 'Trap'} sent` });
  } catch (e) {
    if (!owns()) return;
    const error = describeError(e);
    s.setSendError(error);
    s.addSendHistory({ id, request, error });
    s.pushToast({ tone: 'error', message: error });
  } finally {
    if (owns()) s.setSendBusy(false);
  }
}

export async function repeatNotification(
  engine: EngineAPI,
  request: NotificationSendRequest | NotificationAgentSendRequest,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const s = useAppStore.getState();
  if (s.sendBusy) return;
  s.setSendBusy(true);
  s.setSendError(null);
  const id = `sent-${Date.now()}-${notificationSeq++}`;
  try {
    const result = await engine.traps.send(request);
    if (!owns()) return;
    s.addSendHistory({ id, request, result });
  } catch (e) {
    if (!owns()) return;
    const error = describeError(e);
    s.setSendError(error);
    s.addSendHistory({ id, request, error });
  } finally {
    if (owns()) s.setSendBusy(false);
  }
}

// --------------------------------------------------------------------------
// MIBs
// --------------------------------------------------------------------------

export async function refreshModules(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  const modules = await engine.mibs.list();
  if (!owns()) return;
  useAppStore.getState().setModules(modules);
}

function waitForImporterDismissal(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

let fileImportReviewDismissal: Promise<void> | null = null;

export function dismissFileImportReviewForOperation(
  handleId: string,
  waitForDismissal: () => Promise<void> = waitForImporterDismissal,
): void {
  const state = useAppStore.getState();
  if (!state.fileImportDraft?.visible) {
    state.acceptFileImportDraft(handleId);
    return;
  }
  state.acceptFileImportDraft(handleId);
  const dismissal = waitForDismissal().finally(() => {
    if (fileImportReviewDismissal === dismissal) fileImportReviewDismissal = null;
  });
  fileImportReviewDismissal = dismissal;
}

async function waitForFileImportReviewDismissal(): Promise<void> {
  await fileImportReviewDismissal;
}

async function dismissBrowserImporterBeforeStart(
  waitForDismissal: () => Promise<void> = waitForImporterDismissal,
): Promise<void> {
  const state = useAppStore.getState();
  const importerWasOpen = state.browserImportOpen;
  state.setBrowserImportOpen(false);
  if (importerWasOpen) await waitForDismissal();
}

export async function presentFileImportReview(
  draft: FileImportDraft,
  waitForDismissal: () => Promise<void> = waitForImporterDismissal,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  await dismissBrowserImporterBeforeStart(waitForDismissal);
  if (owns()) useAppStore.getState().setFileImportDraft(draft);
}

export async function importPastedText(
  engine: EngineAPI,
  name: string,
  content: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const startClaim = engineStartArbitration.begin(engine, 'mib-import');
  const priorHandle = useAppStore.getState().importHandle;
  const priorStatusHandle = useAppStore.getState().importStatus?.handleId;
  try {
    await dismissBrowserImporterBeforeStart();
    if (!engineStartArbitration.isCurrent(startClaim, owns)) return;
    const { handleId } = await engine.mibs.startImport({
      files: [{ name: name || 'pasted.mib', content }],
    });
    const accepted = await engineStartArbitration.accept(
      startClaim,
      handleId,
      owns,
      (id) => engine.resolver.cancel(id),
      (id) => useAppStore.getState().beginImport(id),
    );
    if (!accepted) return;
    await syncImportOrCancel(engine, handleId, name || 'pasted.mib', owns);
  } catch (e) {
    if (engineStartArbitration.isCurrent(startClaim, owns))
      await handleStartImportFailure(
        engine,
        priorHandle,
        priorStatusHandle,
        name || 'pasted.mib',
        e,
        owns,
      );
  }
}

/** Start a reviewed file batch. Returns true only after the engine accepted ownership. */
export async function importReviewedFiles(
  engine: EngineAPI,
  files: MibTextFile[],
  replaceModules: string[],
  batchLabel: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<string | null> {
  if (!owns()) return null;
  const startClaim = engineStartArbitration.begin(engine, 'mib-import');
  const priorHandle = useAppStore.getState().importHandle;
  const priorStatusHandle = useAppStore.getState().importStatus?.handleId;
  try {
    const { handleId } = await engine.mibs.startImport({ files, replaceModules, batchLabel });
    const state = useAppStore.getState();
    const accepted = await engineStartArbitration.accept(
      startClaim,
      handleId,
      owns,
      (id) => engine.resolver.cancel(id),
      (id) => {
        if (state.importHandle !== id && state.importStatus?.handleId !== id) state.beginImport(id);
      },
    );
    if (!accepted) return null;
    // Ownership transfers as soon as the handle is accepted. Resolver status,
    // consent, progress, cancellation and terminal events remain in the existing UI.
    void syncImportOrCancel(engine, handleId, batchLabel, owns);
    return handleId;
  } catch (e) {
    if (engineStartArbitration.isCurrent(startClaim, owns))
      await handleStartImportFailure(engine, priorHandle, priorStatusHandle, batchLabel, e, owns);
    return null;
  }
}

export async function importUrl(
  engine: EngineAPI,
  url: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const startClaim = engineStartArbitration.begin(engine, 'mib-import');
  const priorHandle = useAppStore.getState().importHandle;
  const priorStatusHandle = useAppStore.getState().importStatus?.handleId;
  try {
    await dismissBrowserImporterBeforeStart();
    if (!engineStartArbitration.isCurrent(startClaim, owns)) return;
    const { handleId } = await engine.mibs.startImport({ url: url.trim() });
    const accepted = await engineStartArbitration.accept(
      startClaim,
      handleId,
      owns,
      (id) => engine.resolver.cancel(id),
      (id) => useAppStore.getState().beginImport(id),
    );
    if (!accepted) return;
    await syncImportOrCancel(engine, handleId, url, owns);
  } catch (e) {
    if (engineStartArbitration.isCurrent(startClaim, owns))
      await handleStartImportFailure(engine, priorHandle, priorStatusHandle, url, e, owns);
  }
}

export async function cancelImport(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  engineStartArbitration.begin(engine, 'mib-import');
  const handleId = useAppStore.getState().importHandle;
  if (handleId && owns()) await engine.resolver.cancel(handleId);
}

// --------------------------------------------------------------------------
// Resolver
// --------------------------------------------------------------------------

const TERMINAL_STATES = new Set(['done', 'partial', 'error', 'cancelled', 'expired']);

type ResolverRefreshSnapshot = readonly [
  Awaited<ReturnType<EngineAPI['resolver']['settings']['get']>>,
  Awaited<ReturnType<EngineAPI['resolver']['sources']['list']>>,
  Awaited<ReturnType<EngineAPI['resolver']['cache']['stats']>>,
  Awaited<ReturnType<EngineAPI['resolver']['history']['list']>>,
];
interface ResolverRefreshEntry {
  generation: number;
  sourceAuthorityToken: number;
  cacheAuthorityToken: number;
  promise: Promise<ResolverRefreshSnapshot>;
}
const resolverRefreshes = new WeakMap<EngineAPI, ResolverRefreshEntry>();
const resolverRefreshGenerations = new WeakMap<EngineAPI, number>();
interface ResolverSourceControllerEntry {
  controller: ResolverSourceCollectionController;
  owns: StoreWriteOwnership;
}
const resolverSourceControllers = new WeakMap<EngineAPI, ResolverSourceControllerEntry>();
interface ResolverCacheControllerEntry {
  controller: ResolverCacheClearController;
  owns: StoreWriteOwnership;
}
const resolverCacheControllers = new WeakMap<EngineAPI, ResolverCacheControllerEntry>();
const vendorBrowseStartsByEngine = new WeakMap<EngineAPI, Set<string>>();
const lookupCandidateStarts = new WeakSet<EngineAPI>();

export function resolverSourceController(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
  load = true,
): ResolverSourceCollectionController {
  let entry = resolverSourceControllers.get(engine);
  if (!entry) {
    entry = {
      owns,
      controller: undefined as unknown as ResolverSourceCollectionController,
    };
    entry.controller = new ResolverSourceCollectionController(engine, (sources) => {
      if (entry?.owns()) useAppStore.getState().setResolverSources(sources);
    });
    resolverSourceControllers.set(engine, entry);
  }
  entry.owns = owns;
  if (owns()) entry.controller.activate();
  if (owns() && load && entry.controller.snapshot().readiness.phase === 'unloaded')
    void entry.controller.load().catch(() => undefined);
  return entry.controller;
}

export function disposeResolverSourceController(engine: EngineAPI): void {
  const entry = resolverSourceControllers.get(engine);
  entry?.controller.dispose();
}

export function resolverCacheClearController(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): ResolverCacheClearController {
  let entry = resolverCacheControllers.get(engine);
  if (!entry) {
    entry = {
      owns,
      controller: new ResolverCacheClearController(engine.resolver.cache, (stats) => {
        if (entry?.owns()) useAppStore.getState().setResolverCache(stats);
      }),
    };
    resolverCacheControllers.set(engine, entry);
  }
  entry.owns = owns;
  if (owns()) entry.controller.activate();
  return entry.controller;
}

export function disposeResolverCacheClearController(engine: EngineAPI): void {
  resolverCacheControllers.get(engine)?.controller.dispose();
}

export function refreshResolverState(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
  force = false,
): Promise<void> {
  let entry = resolverRefreshes.get(engine);
  if (!entry || force) {
    const generation = (resolverRefreshGenerations.get(engine) ?? 0) + 1;
    resolverRefreshGenerations.set(engine, generation);
    const sourceAuthorityToken = resolverSourceController(engine, owns, false).beginAuthorityRead();
    const cacheAuthorityToken = resolverCacheClearController(engine, owns).beginAuthorityRead();
    const promise = Promise.all([
      engine.resolver.settings.get(),
      engine.resolver.sources.list(),
      engine.resolver.cache.stats(),
      engine.resolver.history.list(30),
    ]).finally(() => {
      if (resolverRefreshes.get(engine) === createdEntry) resolverRefreshes.delete(engine);
    });
    const createdEntry: ResolverRefreshEntry = {
      generation,
      sourceAuthorityToken,
      cacheAuthorityToken,
      promise,
    };
    entry = createdEntry;
    resolverRefreshes.set(engine, entry);
  }
  const { generation, sourceAuthorityToken, cacheAuthorityToken, promise } = entry;
  return promise.then(([settings, sources, cache, history]) => {
    if (resolverRefreshGenerations.get(engine) !== generation || !owns()) return;
    const s = useAppStore.getState();
    if (!owns()) return;
    s.setResolverSettings(settings);
    if (!owns()) return;
    resolverSourceController(engine, owns, false).applyAuthority(
      sources,
      'refresh',
      sourceAuthorityToken,
    );
    if (!owns()) return;
    resolverCacheClearController(engine, owns).applyAuthority(cache, cacheAuthorityToken);
    if (!owns()) return;
    s.setResolverHistory(history);
  });
}

async function syncResolverOperation(
  engine: EngineAPI,
  handleId: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  const status = await engine.resolver.status(handleId);
  if (!owns()) return;
  if (!status) throw new Error(`Resolver operation status is unavailable: ${handleId}`);
  const s = useAppStore.getState();
  if (status.state === 'awaiting-consent') {
    s.setBrowserImportOpen(false);
    dismissFileImportReviewForOperation(handleId);
    await waitForFileImportReviewDismissal();
    if (!owns()) return;
    if (useAppStore.getState().importHandle !== handleId) return;
    s.enqueueConsent({
      handleId,
      missingModules: status.missingModules,
      sourceHosts: status.sourceHosts,
      expiresAt: status.expiresAt,
    });
  }
  if (TERMINAL_STATES.has(status.state)) {
    await handleResolverEvent(
      engine,
      {
        channel: 'resolver',
        handleId,
        kind: status.state === 'expired' ? 'error' : status.state,
        payload: { status, result: status.result },
      },
      owns,
    );
  } else if (handleId === s.importHandle) {
    s.setImportStatus(status);
  }
}

async function syncImportOrCancel(
  engine: EngineAPI,
  handleId: string,
  requestName: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  try {
    await syncResolverOperation(engine, handleId, owns);
  } catch (error) {
    try {
      await engine.resolver.cancel(handleId);
    } catch {
      // The status transport failed too; local ownership still must be released.
    }
    if (!owns()) return;
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
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
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
    await waitForFileImportReviewDismissal();
    if (!owns()) return;
    state.settleFileImportDraft(claimedHandle, 'error');
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
  state.updateFileImportDraft({
    reopenMessage: `Import could not start — ${message}. Review your original selection and try again.`,
  });
}

/** Route one resolver event to its owning operation. Events for stale handles are ignored. */
export async function handleResolverEvent(
  engine: EngineAPI,
  event: EngineEvent,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
  deferPostTerminalRefresh = false,
): Promise<void> {
  if (!owns()) return;
  const s = useAppStore.getState();
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  // In-process engines can emit `started` just before startImport's Promise resolves.
  if (event.kind === 'started' && event.handleId) {
    const request = payload.request as Record<string, unknown> | undefined;
    if (request && ('files' in request || 'url' in request)) {
      if (s.importHandle && s.importHandle !== event.handleId) return;
      s.beginImport(event.handleId);
      if ('files' in request) dismissFileImportReviewForOperation(event.handleId);
    }
  }

  const sourceId = Object.entries(s.sourceTestHandles).find(([, id]) => id === event.handleId)?.[0];
  const isSourcePreview = Boolean(event.handleId && event.handleId === s.sourcePreviewHandle);
  const lookupOid = Object.entries(s.lookupHandles).find(([, id]) => id === event.handleId)?.[0];
  const vendorBrowseOid = Object.entries(s.vendorMibBrowseHandles).find(
    ([, id]) => id === event.handleId,
  )?.[0];
  const isImport = Boolean(
    event.handleId && event.handleId === useAppStore.getState().importHandle,
  );

  if (event.kind === 'consent-required' && event.handleId) {
    const active =
      isImport ||
      Boolean(sourceId) ||
      isSourcePreview ||
      Boolean(lookupOid) ||
      Boolean(vendorBrowseOid);
    if (active) {
      if (isImport) {
        s.setBrowserImportOpen(false);
        await waitForFileImportReviewDismissal();
        if (!owns()) return;
        if (useAppStore.getState().importHandle !== event.handleId) return;
      }
      const current = useAppStore.getState();
      current.enqueueConsent({
        handleId: event.handleId,
        missingModules: stringArray(payload.missingModules),
        sourceHosts: stringArray(payload.sourceHosts),
        expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : undefined,
      });
      if (isImport) {
        current.setImportStatus(
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
    if (status.state !== 'done') await waitForFileImportReviewDismissal();
    if (!owns()) return;
    s.settleFileImportDraft(status.handleId, status.state);
    if (deferPostTerminalRefresh) return;
    await Promise.all([refreshModules(engine, owns), refreshResolverState(engine, owns)]);
    if (!owns()) return;
    await refreshLoadedOidLookups(engine, owns);
    if (!owns()) return;
    const fresh = useAppStore.getState();
    fresh.clearChildrenCache();
    await loadChildren(engine, '', owns);
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
    if (!deferPostTerminalRefresh) await refreshResolverState(engine, owns);
    return;
  }

  if (isSourcePreview) {
    const result = payload.result as ResolverSourcePreviewResult | undefined;
    s.finishSourcePreview({
      state: status.state,
      result: result?.kind === 'source-preview' ? result : undefined,
      error: status.failures[0]?.message,
    });
    if (!deferPostTerminalRefresh) await refreshResolverState(engine, owns);
    return;
  }

  if (lookupOid) {
    const result = payload.result as OidLookupResult | undefined;
    s.finishOidLookup(lookupOid, {
      state: status.state,
      result,
      error: status.failures[0]?.message,
    });
    if (!deferPostTerminalRefresh) await refreshResolverState(engine, owns);
  }

  if (vendorBrowseOid) {
    const result = payload.result as VendorMibBrowseResult | undefined;
    s.finishVendorMibBrowse(vendorBrowseOid, {
      state: status.state,
      result,
      error: status.failures[0]?.message,
    });
    if (!deferPostTerminalRefresh) await refreshResolverState(engine, owns);
  }
}

export async function refreshLoadedOidLookups(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  const snapshot = useAppStore.getState();
  const unresolved = Object.entries(snapshot.oidLookups).filter(
    ([oid, lookup]) => lookup.result && !lookup.result.loaded && !snapshot.lookupHandles[oid],
  );
  await Promise.all(
    unresolved.map(async ([oid]) => {
      const loaded = await engine.mibs.resolve(oid);
      if (!loaded || !owns()) return;
      const current = useAppStore.getState().oidLookups[oid];
      if (!current?.result || current.result.loaded) return;
      if (!owns()) return;
      useAppStore.getState().finishOidLookup(oid, {
        ...current,
        state: 'done',
        result: { ...current.result, loaded, cached: null },
      });
    }),
  );
}

export async function respondResolverConsent(
  engine: EngineAPI,
  allow: boolean,
  askAgain: boolean,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const prompt = useAppStore.getState().consent;
  if (!prompt) return;
  try {
    await engine.resolver.respondConsent(prompt.handleId, { allow, askAgain });
    if (!owns()) return;
    useAppStore.getState().dismissConsent(prompt.handleId);
    if (!allow) await engine.resolver.cancel(prompt.handleId);
  } catch (e) {
    if (!owns()) return;
    const state = useAppStore.getState();
    state.setResolverError(describeError(e));
    try {
      const status = await engine.resolver.status(prompt.handleId);
      if (!owns()) return;
      if (status?.state === 'awaiting-consent') state.enqueueConsent(prompt);
      else state.dismissConsent(prompt.handleId);
    } catch {
      if (!owns()) return;
      // If status is also unreachable, preserve/re-enqueue the disclosure rather
      // than silently advancing to a later queued prompt.
      state.enqueueConsent(prompt);
    }
  }
}

export async function updateResolverSettings(
  engine: EngineAPI,
  patch: Partial<ResolverSettings>,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  useAppStore.getState().setResolverError(null);
  try {
    const settings = await engine.resolver.settings.update(patch);
    if (owns()) useAppStore.getState().setResolverSettings(settings);
  } catch (e) {
    if (owns()) useAppStore.getState().setResolverError(describeError(e));
  }
}

export async function saveResolverSource(
  engine: EngineAPI,
  draft: ResolverSourceDraft,
  existingId?: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
  retry = false,
): Promise<void> {
  if (!owns()) return;
  const s = useAppStore.getState();
  s.setResolverError(null);
  try {
    const controller = resolverSourceController(engine, owns);
    if (existingId) await controller.update(existingId, draft, retry, owns);
    else await controller.create(draft, retry, owns);
    assertResolverSourceMutationSettled(controller);
    if (owns())
      s.pushToast({ tone: 'success', message: existingId ? 'Source updated' : 'Source added' });
  } catch (e) {
    if (owns()) s.setResolverError(describeError(e));
    throw e;
  }
}

export async function removeResolverSource(
  engine: EngineAPI,
  sourceId: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
  retry = false,
): Promise<void> {
  if (!owns()) return;
  try {
    const controller = resolverSourceController(engine, owns);
    await controller.remove(sourceId, retry, owns);
    assertResolverSourceMutationSettled(controller);
  } catch (e) {
    if (owns()) useAppStore.getState().setResolverError(describeError(e));
    throw e;
  }
}

function assertResolverSourceMutationSettled(controller: ResolverSourceCollectionController): void {
  const state = controller.snapshot();
  if (state.phase === 'uncertain' || state.phase === 'conflict')
    throw new Error(resolverSourceCollectionStatusText(state));
}

export async function toggleResolverSource(
  engine: EngineAPI,
  source: SourceConfig,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  await resolverSourceController(engine, owns).toggle(source.id, owns);
}

export async function moveResolverSource(
  engine: EngineAPI,
  sourceId: string,
  direction: -1 | 1,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  await resolverSourceController(engine, owns).move(sourceId, direction, owns);
}

export async function dragResolverSource(
  engine: EngineAPI,
  sourceId: string,
  targetIndex: number,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  await resolverSourceController(engine, owns).drag(sourceId, targetIndex, owns);
}

export async function testResolverSource(
  engine: EngineAPI,
  sourceId: string,
  module: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const startClaim = engineStartArbitration.begin(engine, `resolver-source-test:${sourceId}`);
  const priorHandle = useAppStore.getState().sourceTestHandles[sourceId];
  try {
    if (priorHandle) {
      await engine.resolver.cancel(priorHandle).catch(() => undefined);
      if (!engineStartArbitration.isCurrent(startClaim, owns)) return;
      if (useAppStore.getState().sourceTestHandles[sourceId] === priorHandle)
        useAppStore.getState().finishSourceTest(sourceId, {
          state: 'cancelled',
          message: 'Superseded by a newer source test.',
        });
    }
    const { handleId } = await engine.resolver.sources.test(sourceId, module.trim());
    const accepted = await engineStartArbitration.accept(
      startClaim,
      handleId,
      owns,
      (id) => engine.resolver.cancel(id),
      (id) => useAppStore.getState().setSourceTestHandle(sourceId, id),
    );
    if (!accepted) return;
    await syncResolverOperation(engine, handleId, owns);
  } catch (e) {
    if (engineStartArbitration.isCurrent(startClaim, owns))
      useAppStore.getState().finishSourceTest(sourceId, {
        state: 'error',
        message: describeError(e),
      });
  }
}

export async function previewResolverSource(
  engine: EngineAPI,
  draft: ResolverSourceDraft,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const startClaim = engineStartArbitration.begin(engine, 'resolver-source-preview');
  const s = useAppStore.getState();
  const priorHandle = s.sourcePreviewHandle;
  try {
    if (priorHandle) {
      await engine.resolver.cancel(priorHandle).catch(() => undefined);
      if (!engineStartArbitration.isCurrent(startClaim, owns)) return;
      if (useAppStore.getState().sourcePreviewHandle === priorHandle)
        useAppStore.getState().clearSourcePreview();
    }
    const { handleId } = await engine.resolver.sources.preview(draft);
    const accepted = await engineStartArbitration.accept(
      startClaim,
      handleId,
      owns,
      (id) => engine.resolver.cancel(id),
      (id) => s.beginSourcePreview(id),
    );
    if (!accepted) return;
    await syncResolverOperation(engine, handleId, owns);
  } catch (e) {
    if (engineStartArbitration.isCurrent(startClaim, owns))
      s.finishSourcePreview({ state: 'error', error: redactResolverSourceError(e, draft) });
  }
}

export async function cancelResolverSourcePreview(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  engineStartArbitration.begin(engine, 'resolver-source-preview');
  const state = useAppStore.getState();
  const handleId = state.sourcePreviewHandle;
  state.clearSourcePreview();
  if (handleId) await engine.resolver.cancel(handleId).catch(() => undefined);
}

export async function clearResolverCache(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  const controller = resolverCacheClearController(engine, owns);
  await controller.clear(owns);
  if (owns()) useAppStore.getState().setResolverCache(controller.snapshot().confirmed ?? null);
}

export async function lookupUnknownOid(
  engine: EngineAPI,
  oid: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const normalized = normalizeNumericOid(oid);
  if (!normalized) return;
  const current = useAppStore.getState().lookupHandles[normalized];
  if (current) return;
  try {
    const { handleId } = await engine.resolver.lookupOid({ oid: normalized, network: true });
    if (!owns()) return;
    useAppStore.getState().beginOidLookup(normalized, handleId);
    await syncResolverOperation(engine, handleId, owns);
  } catch (e) {
    if (owns())
      useAppStore.getState().finishOidLookup(normalized, {
        state: 'error',
        error: describeError(e),
      });
  }
}

export async function browseVendorMibs(
  engine: EngineAPI,
  oid: string,
  vendor: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const normalized = normalizeNumericOid(oid);
  if (!normalized) return;
  const state = useAppStore.getState();
  let pendingStarts = vendorBrowseStartsByEngine.get(engine);
  if (!pendingStarts) {
    pendingStarts = new Set<string>();
    vendorBrowseStartsByEngine.set(engine, pendingStarts);
  }
  if (state.vendorMibBrowseHandles[normalized] || pendingStarts.has(normalized)) return;
  pendingStarts.add(normalized);
  try {
    const settings = await engine.resolver.settings.get();
    if (!owns()) return;
    const { handleId } = await engine.resolver.browseVendorMibs({
      oid: normalized,
      vendor,
      network: settings.enabled,
    });
    if (!owns()) return;
    useAppStore.getState().beginVendorMibBrowse(normalized, handleId);
    await syncResolverOperation(engine, handleId, owns);
  } catch (error) {
    if (owns())
      useAppStore.getState().finishVendorMibBrowse(normalized, {
        state: 'error',
        error: describeError(error),
      });
  } finally {
    pendingStarts.delete(normalized);
  }
}

/** Resolve a lookup candidate through the configured chain, or strictly from local cache. */
export async function loadLookupCandidate(
  engine: EngineAPI,
  module: string,
  cachedOnly = false,
  preferredSourceId?: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const state = useAppStore.getState();
  if (state.importHandle || lookupCandidateStarts.has(engine)) return;
  lookupCandidateStarts.add(engine);
  try {
    const { handleId } = cachedOnly
      ? await engine.resolver.loadCachedModules([module])
      : await engine.resolver.resolveModules([module], { preferredSourceId });
    if (!owns()) return;
    state.beginImport(handleId);
    await syncResolverOperation(engine, handleId, owns);
  } catch (error) {
    if (owns()) state.setResolverError(describeError(error));
  } finally {
    lookupCandidateStarts.delete(engine);
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

export async function unloadModule(
  engine: EngineAPI,
  name: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  await engine.mibs.unload(name);
  await refreshModules(engine, owns);
  if (!owns()) return;
  const s = useAppStore.getState();
  if (s.moduleFocus?.module.name === name) {
    s.setModuleFocus(null);
    s.setSelected(null);
  }
  s.clearChildrenCache();
  await loadChildren(engine, '', owns);
}

// --------------------------------------------------------------------------
// Browse
// --------------------------------------------------------------------------

/** Fetch (and cache) the children of an OID; '' loads the tree roots. */
export async function loadChildren(
  engine: EngineAPI,
  oid: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  const s = useAppStore.getState();
  if (s.childrenCache[oid]) return;
  const children = s.moduleFocus
    ? await engine.mibs.moduleTree(s.moduleFocus.module.name, oid || undefined)
    : await engine.mibs.tree(oid || undefined);
  if (!owns()) return;
  useAppStore.getState().setChildren(oid, children);
}

export async function selectModuleInPlace(
  engine: EngineAPI,
  moduleName: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  const s = useAppStore.getState();
  const focus = await engine.mibs.module(moduleName);
  if (!focus || !owns()) return;
  s.setModuleFocus(focus);
  s.setSelected(null);
  s.setSearch('');
  s.setHits([]);
  s.clearChildrenCache();
  await loadChildren(engine, '', owns);
}

export async function focusModule(
  engine: EngineAPI,
  moduleName: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  await selectModuleInPlace(engine, moduleName, owns);
  if (owns()) useAppStore.getState().setTab('browse');
}

export async function clearModuleFocus(
  engine: EngineAPI,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const s = useAppStore.getState();
  s.setModuleFocus(null);
  s.setSelected(null);
  s.clearChildrenCache();
  await loadChildren(engine, '', owns);
}

export async function selectNode(
  engine: EngineAPI,
  oidOrName: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<MibNodeDetail | null> {
  const s = useAppStore.getState();
  const detail = await engine.mibs.node(oidOrName, s.moduleFocus?.module.name);
  if (!owns()) return null;
  useAppStore.getState().setSelected(detail);
  return detail;
}

/** Expand every ancestor prefix of an OID (used when jumping from search). */
export function getOidAncestorPrefixes(oid: string): string[] {
  const arcs = oid.split('.').filter(Boolean);
  return arcs.slice(0, -1).map((_arc, index) => arcs.slice(0, index + 1).join('.'));
}

export async function revealOid(
  engine: EngineAPI,
  oid: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const s = useAppStore.getState();
  const prefixes = getOidAncestorPrefixes(oid);
  for (const prefix of prefixes) {
    s.setExpanded(prefix, true);
  }
  await Promise.all(prefixes.map((prefix) => loadChildren(engine, prefix, owns)));
}

export async function runSearch(
  engine: EngineAPI,
  query: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
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
    const normalizedQuery = normalizeNumericOid(query) ?? query;
    const hits = s.moduleFocus
      ? await engine.mibs.moduleSearch(s.moduleFocus.module.name, normalizedQuery, 40)
      : await engine.mibs.search(normalizedQuery, 40);
    const current = useAppStore.getState();
    if (owns() && current.search === query) {
      current.setHits(hits);
      current.setSearchPhase('idle');
    }
  } catch (error) {
    const current = useAppStore.getState();
    if (owns() && current.search === query) {
      current.setSearchPhase('error');
      current.setSearchError(describeError(error));
    }
  }
}

export async function openSearchHit(
  engine: EngineAPI,
  oid: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const initial = useAppStore.getState();
  const activeQuery = initial.search;
  initial.setSearchPhase('opening');
  initial.setSearchError(null);
  try {
    const detail = await selectNode(engine, oid, owns);
    if (!owns()) return;
    if (!detail) throw new Error(`MIB object is no longer available: ${oid}`);
    await revealOid(engine, oid, owns);
    const current = useAppStore.getState();
    if (owns() && current.search === activeQuery) {
      current.setSearch('');
      current.setHits([]);
      current.setSearchPhase('idle');
    }
  } catch (error) {
    const current = useAppStore.getState();
    if (owns() && current.search === activeQuery) {
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
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<MibNodeDetail> {
  if (!owns()) return undefined as never;
  const detail = await engine.mibs.node(oid);
  if (!owns()) return detail as MibNodeDetail;
  if (!detail) throw new MibObjectNotFoundError(oid);

  const prefixes = getOidAncestorPrefixes(detail.oid);
  const [root, ...branches] = await Promise.all([
    engine.mibs.tree(undefined),
    ...prefixes.map((prefix) => engine.mibs.tree(prefix)),
  ]);
  if (!owns()) return detail;

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

/** Open a tree object in the dedicated live, editable data workspace. */
export function openLiveMibScope(oid: string): void {
  const state = useAppStore.getState();
  state.setLiveMibScopeOid(oid);
  state.setTab('liveMibs');
  replaceRouteForTab('liveMibs');
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
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
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
  if (operation === 'get') await runGet(engine, owns);
  else if (operation === 'getNext') await runGetNext(engine, owns);
  else await runWalk(engine, owns);
}

/** Send the browse selection into the Query tab and run it. */
export function walkFromNode(
  engine: EngineAPI,
  oid: string,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): void {
  if (!owns()) return;
  const s = useAppStore.getState();
  s.setOid(oid);
  s.setOidName(null);
  s.setTab('query');
  void runWalk(engine, owns);
}

export function getFromNode(
  engine: EngineAPI,
  detail: MibNodeDetail,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): void {
  if (!owns()) return;
  const s = useAppStore.getState();
  const oid = detail.kind === 'scalar' ? `${detail.oid}.0` : detail.oid;
  s.setOid(oid);
  s.setOidName(detail.name);
  s.setTab('query');
  void runGet(engine, owns);
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

export async function trapFromNode(
  engine: EngineAPI,
  detail: MibNodeDetail,
  owns: StoreWriteOwnership = alwaysOwnsStoreWrite,
): Promise<void> {
  if (!owns()) return;
  const varbinds = [];
  for (const objectName of detail.objects ?? []) {
    const node = await engine.mibs.node(objectName);
    if (!owns()) return;
    if (!node) continue;
    varbinds.push({
      oid: node.kind === 'scalar' ? `${node.oid}.0` : `${node.oid}.`,
      type: inferWireType(node.syntax),
      value: '',
    });
  }
  if (!owns()) return;
  const s = useAppStore.getState();
  s.updateNotification({ trapOid: detail.oid, varbinds });
  s.setTrapMode('send');
  s.setTrapComposerOpen(true);
  s.setTab('traps');
}
