import type { LiveMibSettings } from '@mibbeacon/core/client';
import {
  acknowledgeRemoteEditError,
  beginRemoteEdit,
  canCancelRemoteEdit,
  createRemoteEditState,
  editRemoteDraft,
  getRemoteEditDisplayValue,
  markRemoteEditUncertain,
  queueRemoteEdit,
  reconcileRemoteEdit,
  rejectRemoteEdit,
  succeedRemoteEdit,
  type RemoteEditState,
} from './remote-edit-transaction';
import {
  DEFAULT_LIVE_MIB_SETTINGS,
  normalizeLiveMibSettings,
  resolveLiveMibSettings,
} from './live-mibs-model';

export const LIVE_MIB_GLOBAL_SCOPE = 'live-mibs:global' as const;
export type LiveMibAgentScopeKey = `live-mibs:agent:${string}`;
export type LiveMibSettingsScopeKey = typeof LIVE_MIB_GLOBAL_SCOPE | LiveMibAgentScopeKey;
export type LiveMibAgentOverrides = Partial<LiveMibSettings> | null;
type ScopeValue = LiveMibSettings | LiveMibAgentOverrides;
type ScopeValueFor<K extends LiveMibSettingsScopeKey> = K extends typeof LIVE_MIB_GLOBAL_SCOPE
  ? LiveMibSettings
  : LiveMibAgentOverrides;
export type LiveMibSettingsReadiness =
  { phase: 'unloaded' | 'loading' | 'ready' } | { phase: 'error'; error: string };

export const LIVE_MIB_NUMERIC_KEYS = [
  'refreshIntervalMs',
  'staleAfterMs',
  'writeDebounceMs',
  'documentAutoCollapseThreshold',
  'maximumUploadBytes',
] as const satisfies readonly (keyof LiveMibSettings)[];
export type LiveMibNumericKey = (typeof LIVE_MIB_NUMERIC_KEYS)[number];
export interface LiveMibNumericFormDraft {
  readonly values: Record<LiveMibNumericKey, string>;
  readonly touched: readonly LiveMibNumericKey[];
}

export function createLiveMibNumericFormDraft(settings: LiveMibSettings): LiveMibNumericFormDraft {
  return {
    values: Object.fromEntries(
      LIVE_MIB_NUMERIC_KEYS.map((key) => [key, String(settings[key])]),
    ) as Record<LiveMibNumericKey, string>,
    touched: [],
  };
}

export function editLiveMibNumericFormDraft(
  form: LiveMibNumericFormDraft,
  key: LiveMibNumericKey,
  value: string,
): LiveMibNumericFormDraft {
  return {
    values: { ...form.values, [key]: value },
    touched: form.touched.includes(key) ? form.touched : [...form.touched, key],
  };
}

export function validateLiveMibNumericFormDraft(
  form: LiveMibNumericFormDraft,
): { valid: true; patch: Partial<LiveMibSettings> } | { valid: false; reason: string } {
  const parsed: Partial<LiveMibSettings> = {};
  for (const key of LIVE_MIB_NUMERIC_KEYS) {
    const text = form.values[key];
    if (!/^-?\d+$/.test(text)) {
      return { valid: false, reason: `${numericFieldLabel(key)} must be a whole number.` };
    }
    const value = Number(text);
    if (!Number.isSafeInteger(value)) {
      return {
        valid: false,
        reason: `${numericFieldLabel(key)} is outside the safe number range.`,
      };
    }
    if (form.touched.includes(key)) (parsed as Record<string, number>)[key] = value;
  }
  const normalized = normalizeLiveMibSettings(parsed);
  return {
    valid: true,
    patch: Object.fromEntries(form.touched.map((key) => [key, normalized[key]])),
  };
}

function numericFieldLabel(key: LiveMibNumericKey): string {
  return {
    refreshIntervalMs: 'Refresh interval',
    staleAfterMs: 'Stale-after interval',
    writeDebounceMs: 'Change debounce',
    documentAutoCollapseThreshold: 'Auto-collapse threshold',
    maximumUploadBytes: 'Maximum staged upload bytes',
  }[key];
}

export interface LiveMibSettingsTransport<T extends ScopeValue> {
  write(value: T): Promise<T>;
  read(): Promise<T>;
}

export function liveMibAgentScopeKey(agentId: string): LiveMibAgentScopeKey {
  return `live-mibs:agent:${agentId}`;
}

export function isLiveMibAgentScope(scopeKey: LiveMibSettingsScopeKey): boolean {
  return scopeKey !== LIVE_MIB_GLOBAL_SCOPE;
}

/** Normalize numeric bounds without filling inherited agent fields with global defaults. */
export function normalizeLiveMibScopeDraft<K extends LiveMibSettingsScopeKey>(
  scopeKey: K,
  draft: ScopeValueFor<K>,
): ScopeValueFor<K> {
  if (scopeKey === LIVE_MIB_GLOBAL_SCOPE) return normalizeLiveMibSettings(draft as LiveMibSettings);
  if (draft === null) return null as ScopeValueFor<K>;
  const partial = draft as Partial<LiveMibSettings>;
  const normalized = normalizeLiveMibSettings(partial);
  return Object.fromEntries(
    Object.keys(partial).map((key) => [key, normalized[key as keyof LiveMibSettings]]),
  ) as ScopeValueFor<K>;
}

export function liveMibSettingsStatusText<T>(state: RemoteEditState<T>): string {
  switch (state.phase) {
    case 'confirmed':
      return 'Saved and confirmed.';
    case 'dirty':
      return 'Unsaved changes.';
    case 'queued':
      return 'Save queued.';
    case 'updating':
      return 'Saving…';
    case 'success':
      return 'Saved successfully.';
    case 'error-reverted':
      return `Save rejected; restored the last confirmed values. ${state.error}`;
    case 'uncertain':
      return `Save outcome uncertain; checking the remote settings. ${state.error}`;
    case 'conflict':
      return `Remote settings differ from the submitted values. ${state.error}`;
  }
}

export function resolveLiveMibSettingsForScope(
  globalState: RemoteEditState<LiveMibSettings>,
  agentState?: RemoteEditState<LiveMibAgentOverrides>,
): LiveMibSettings {
  if (!agentState) return getRemoteEditDisplayValue(globalState);
  return resolveLiveMibSettings(globalState.confirmed, getRemoteEditDisplayValue(agentState));
}

export function resolveConfirmedLiveMibSettingsForScope(
  globalState: RemoteEditState<LiveMibSettings>,
  agentState?: RemoteEditState<LiveMibAgentOverrides>,
): LiveMibSettings {
  return agentState
    ? resolveLiveMibSettings(globalState.confirmed, agentState.confirmed)
    : globalState.confirmed;
}

export class LiveMibSettingsController {
  private readonly states = new Map<LiveMibSettingsScopeKey, RemoteEditState<ScopeValue>>();
  private readonly loadTokens = new Map<LiveMibSettingsScopeKey, number>();
  private readonly inFlightLoads = new Map<LiveMibSettingsScopeKey, Promise<ScopeValue>>();
  private readonly reconcileTokens = new Map<LiveMibSettingsScopeKey, number>();
  private readonly readinessStates = new Map<LiveMibSettingsScopeKey, LiveMibSettingsReadiness>();
  private readonly running = new Map<LiveMibSettingsScopeKey, Promise<void>>();
  private readonly transports = new Map<
    LiveMibSettingsScopeKey,
    LiveMibSettingsTransport<ScopeValue>
  >();
  private readonly lastAttempts = new Map<LiveMibSettingsScopeKey, ScopeValue>();
  private readonly listeners = new Set<() => void>();
  private sequence = 0;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  seed(scopeKey: typeof LIVE_MIB_GLOBAL_SCOPE, value: LiveMibSettings): void;
  seed(scopeKey: LiveMibAgentScopeKey, value: LiveMibAgentOverrides): void;
  seed(scopeKey: LiveMibSettingsScopeKey, value: ScopeValue): void {
    this.states.set(scopeKey, createRemoteEditState<ScopeValue>(scopeKey, value));
    this.readinessStates.set(scopeKey, { phase: 'ready' });
    this.emit();
  }

  readiness(scopeKey: LiveMibSettingsScopeKey): LiveMibSettingsReadiness {
    return this.readinessStates.get(scopeKey) ?? { phase: 'unloaded' };
  }

  get<K extends LiveMibSettingsScopeKey>(scopeKey: K): RemoteEditState<ScopeValueFor<K>> {
    return this.getState(scopeKey) as unknown as RemoteEditState<ScopeValueFor<K>>;
  }

  private getState(scopeKey: LiveMibSettingsScopeKey): RemoteEditState<ScopeValue> {
    let state = this.states.get(scopeKey);
    if (!state) {
      state = createRemoteEditState<ScopeValue>(
        scopeKey,
        scopeKey === LIVE_MIB_GLOBAL_SCOPE ? DEFAULT_LIVE_MIB_SETTINGS : null,
      );
      this.states.set(scopeKey, state);
    }
    return state;
  }

  display<K extends LiveMibSettingsScopeKey>(scopeKey: K): ScopeValueFor<K> {
    return getRemoteEditDisplayValue(this.getState(scopeKey)) as ScopeValueFor<K>;
  }

  edit<K extends LiveMibSettingsScopeKey>(scopeKey: K, value: ScopeValueFor<K>): void {
    if (this.readiness(scopeKey).phase !== 'ready') return;
    this.set(scopeKey, editRemoteDraft(this.getState(scopeKey), value as ScopeValue));
  }

  touch(scopeKey: LiveMibSettingsScopeKey): void {
    if (this.readiness(scopeKey).phase !== 'ready') return;
    const current = this.getState(scopeKey);
    this.set(scopeKey, editRemoteDraft(current, current.draft));
  }

  canCancel(scopeKey: LiveMibSettingsScopeKey): boolean {
    return canCancelRemoteEdit(this.getState(scopeKey));
  }

  cancel(scopeKey: LiveMibSettingsScopeKey): void {
    const current = this.getState(scopeKey);
    if (!canCancelRemoteEdit(current)) return;
    this.set(scopeKey, createRemoteEditState(scopeKey, current.confirmed, current.equals));
  }

  acknowledge(scopeKey: LiveMibSettingsScopeKey): void {
    this.set(scopeKey, acknowledgeRemoteEditError(this.getState(scopeKey)));
  }

  async load<K extends LiveMibSettingsScopeKey>(
    scopeKey: K,
    read: () => Promise<ScopeValueFor<K>>,
  ): Promise<ScopeValueFor<K>> {
    const readiness = this.readiness(scopeKey);
    if (readiness.phase === 'ready') return this.getState(scopeKey).confirmed as ScopeValueFor<K>;
    const existingLoad = this.inFlightLoads.get(scopeKey);
    if (readiness.phase === 'loading' && existingLoad)
      return existingLoad as Promise<ScopeValueFor<K>>;
    const token = ++this.sequence;
    this.loadTokens.set(scopeKey, token);
    const loading = Promise.resolve().then(async () => {
      try {
        const value = await read();
        if (this.loadTokens.get(scopeKey) === token) {
          this.states.set(scopeKey, createRemoteEditState<ScopeValue>(scopeKey, value));
          this.readinessStates.set(scopeKey, { phase: 'ready' });
          this.emit();
        }
        return value;
      } catch (cause) {
        if (this.loadTokens.get(scopeKey) === token) {
          this.readinessStates.set(scopeKey, {
            phase: 'error',
            error: cause instanceof Error ? cause.message : String(cause),
          });
          this.emit();
        }
        throw cause;
      } finally {
        if (this.loadTokens.get(scopeKey) === token) this.inFlightLoads.delete(scopeKey);
      }
    });
    this.inFlightLoads.set(scopeKey, loading);
    this.readinessStates.set(scopeKey, { phase: 'loading' });
    this.emit();
    return loading;
  }

  save<K extends LiveMibSettingsScopeKey>(
    scopeKey: K,
    transport: LiveMibSettingsTransport<ScopeValueFor<K>>,
  ): Promise<void> {
    if (this.readiness(scopeKey).phase !== 'ready') return Promise.resolve();
    const current = this.getState(scopeKey);
    if (current.phase === 'dirty') {
      const normalized = normalizeLiveMibScopeDraft(scopeKey, current.draft as ScopeValueFor<K>);
      const normalizedState = editRemoteDraft(current, normalized);
      this.lastAttempts.set(scopeKey, normalized);
      this.set(scopeKey, queueRemoteEdit(normalizedState, ++this.sequence));
    }
    this.transports.set(scopeKey, {
      write: (value) => transport.write(value as ScopeValueFor<K>),
      read: transport.read,
    });
    return this.ensureDrain(scopeKey);
  }

  private ensureDrain(scopeKey: LiveMibSettingsScopeKey): Promise<void> {
    const existing = this.running.get(scopeKey);
    if (existing) return existing.then(() => this.ensureDrain(scopeKey));
    if (this.getState(scopeKey).phase !== 'queued') return Promise.resolve();
    const running = this.drain(scopeKey).finally(() => this.running.delete(scopeKey));
    this.running.set(scopeKey, running);
    return running;
  }

  retry<K extends LiveMibSettingsScopeKey>(
    scopeKey: K,
    transport: LiveMibSettingsTransport<ScopeValueFor<K>>,
  ): Promise<void> {
    const attempted = this.lastAttempts.get(scopeKey);
    this.acknowledge(scopeKey);
    if (['confirmed', 'success'].includes(this.getState(scopeKey).phase) && attempted !== undefined)
      this.edit(scopeKey, attempted as ScopeValueFor<typeof scopeKey>);
    return this.save(scopeKey, transport);
  }

  async reconcile<K extends LiveMibSettingsScopeKey>(
    scopeKey: K,
    read: () => Promise<ScopeValueFor<K>>,
  ) {
    const current = this.getState(scopeKey);
    if (current.phase !== 'uncertain') return;
    const reconcileToken = ++this.sequence;
    this.reconcileTokens.set(scopeKey, reconcileToken);
    try {
      const remote = await read();
      const fresh = this.getState(scopeKey);
      if (
        this.reconcileTokens.get(scopeKey) !== reconcileToken ||
        fresh.phase !== 'uncertain' ||
        fresh.activeRequest.requestId !== current.activeRequest.requestId
      )
        return;
      this.set(
        scopeKey,
        reconcileRemoteEdit(fresh, scopeKey, current.activeRequest.requestId, remote),
      );
    } catch {
      // Remaining uncertain is deliberate: no authoritative value was obtained.
    }
  }

  private async drain(scopeKey: LiveMibSettingsScopeKey): Promise<void> {
    while (true) {
      const queued = this.getState(scopeKey);
      if (queued.activeRequest || queued.phase !== 'queued') return;
      const requestId = queued.queuedRequest.requestId;
      this.set(scopeKey, beginRemoteEdit(queued, scopeKey, requestId));
      const updating = this.getState(scopeKey);
      if (updating.phase !== 'updating') return;
      const transport = this.transports.get(scopeKey);
      if (!transport) return;
      try {
        const confirmed = await transport.write(updating.activeRequest.submitted);
        this.set(
          scopeKey,
          succeedRemoteEdit(this.getState(scopeKey), scopeKey, requestId, confirmed),
        );
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        if (isAmbiguousRemoteError(cause)) {
          this.set(
            scopeKey,
            markRemoteEditUncertain(this.getState(scopeKey), scopeKey, requestId, error),
          );
          await this.reconcile(scopeKey, transport.read);
        } else {
          this.set(scopeKey, rejectRemoteEdit(this.getState(scopeKey), scopeKey, requestId, error));
        }
      }
    }
  }

  private set(scopeKey: LiveMibSettingsScopeKey, state: RemoteEditState<ScopeValue>): void {
    this.states.set(scopeKey, state);
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export function isAmbiguousRemoteError(cause: unknown): boolean {
  const text = cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause);
  return /timeout|timed out|disconnect|network|transport|connection|outcome unknown|ambiguous/i.test(
    text,
  );
}
