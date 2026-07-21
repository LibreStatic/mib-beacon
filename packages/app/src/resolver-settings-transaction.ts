import type { ResolverSettings } from '@mibbeacon/core/client';
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
import { isAmbiguousRemoteError } from './live-mib-settings-transaction';

export const RESOLVER_SETTINGS_SCOPE = 'resolver:settings' as const;
export type ResolverSettingsReadiness =
  { phase: 'unloaded' | 'loading' | 'ready' } | { phase: 'error'; error: string };

export interface ResolverSettingsTransport {
  write(value: ResolverSettings): Promise<ResolverSettings>;
  read(): Promise<ResolverSettings>;
}

const EMPTY_RESOLVER_SETTINGS: ResolverSettings = {
  enabled: false,
  autoResolveImports: false,
  externalConsentRemembered: false,
};

export function resolverSettingsStatusText(state: RemoteEditState<ResolverSettings>): string {
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
      return `Save outcome uncertain; check the remote settings. ${state.error}`;
    case 'conflict':
      return `Remote settings differ from the submitted values. ${state.error}`;
  }
}

export class ResolverSettingsController {
  private state = createRemoteEditState(RESOLVER_SETTINGS_SCOPE, EMPTY_RESOLVER_SETTINGS);
  private readinessState: ResolverSettingsReadiness = { phase: 'unloaded' };
  private inFlightLoad?: Promise<ResolverSettings>;
  private running?: Promise<void>;
  private transport?: ResolverSettingsTransport;
  private lastAttempt?: ResolverSettings;
  private readonly listeners = new Set<() => void>();
  private sequence = 0;
  private lifecycle = 0;
  private runnerGeneration = 0;
  private active = true;

  constructor(private readonly onConfirmed?: (settings: ResolverSettings) => void) {}

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycle += 1;
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
    this.runnerGeneration += 1;
    this.readinessState = { phase: 'unloaded' };
    this.inFlightLoad = undefined;
    this.running = undefined;
    this.transport = undefined;
    this.listeners.clear();
  }

  subscribe(listener: () => void): () => void {
    if (!this.active) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  readiness(): ResolverSettingsReadiness {
    return this.readinessState;
  }

  get(): RemoteEditState<ResolverSettings> {
    return this.state;
  }

  display(): ResolverSettings {
    return getRemoteEditDisplayValue(this.state);
  }

  edit(patch: Partial<ResolverSettings>): void {
    if (!this.active || this.readinessState.phase !== 'ready') return;
    this.set(editRemoteDraft(this.state, { ...this.state.draft, ...patch }));
  }

  canCancel(): boolean {
    return this.active && canCancelRemoteEdit(this.state);
  }

  cancel(): void {
    if (!this.canCancel()) return;
    this.set(createRemoteEditState(RESOLVER_SETTINGS_SCOPE, this.state.confirmed));
  }

  acknowledge(): void {
    if (!this.active) return;
    this.set(acknowledgeRemoteEditError(this.state));
  }

  async acknowledgeAndResume(): Promise<void> {
    if (!this.active) return;
    this.acknowledge();
    await this.ensureDrain();
  }

  load(read: () => Promise<ResolverSettings>): Promise<ResolverSettings> {
    if (!this.active) return Promise.resolve(this.state.confirmed);
    if (this.readinessState.phase === 'ready') return Promise.resolve(this.state.confirmed);
    if (this.readinessState.phase === 'loading' && this.inFlightLoad) return this.inFlightLoad;
    const token = ++this.sequence;
    const lifecycle = this.lifecycle;
    const loading = Promise.resolve()
      .then(read)
      .then((settings) => {
        if (this.active && lifecycle === this.lifecycle && token === this.sequence) {
          this.state = createRemoteEditState(RESOLVER_SETTINGS_SCOPE, settings);
          this.readinessState = { phase: 'ready' };
          this.onConfirmed?.(settings);
          this.emit();
        }
        return settings;
      })
      .catch((cause) => {
        if (this.active && lifecycle === this.lifecycle && token === this.sequence) {
          this.readinessState = {
            phase: 'error',
            error: cause instanceof Error ? cause.message : String(cause),
          };
          this.emit();
        }
        throw cause;
      })
      .finally(() => {
        if (this.active && lifecycle === this.lifecycle && token === this.sequence)
          this.inFlightLoad = undefined;
      });
    this.inFlightLoad = loading;
    this.readinessState = { phase: 'loading' };
    this.emit();
    return loading;
  }

  save(transport: ResolverSettingsTransport): Promise<void> {
    if (!this.active || this.readinessState.phase !== 'ready') return Promise.resolve();
    if (this.state.phase === 'dirty') {
      this.lastAttempt = this.state.draft;
      this.set(queueRemoteEdit(this.state, ++this.sequence));
    }
    this.transport = transport;
    return this.ensureDrain();
  }

  retry(transport: ResolverSettingsTransport): Promise<void> {
    if (!this.active) return Promise.resolve();
    const attempted = this.lastAttempt;
    this.acknowledge();
    if (attempted && ['confirmed', 'success'].includes(this.state.phase)) {
      this.edit(attempted);
    }
    return this.save(transport);
  }

  async reconcile(read: () => Promise<ResolverSettings>): Promise<void> {
    await this.reconcileWithOwner(read);
  }

  private async reconcileWithOwner(
    read: () => Promise<ResolverSettings>,
    ownerGeneration?: number,
  ): Promise<void> {
    if (!this.active) return;
    const current = this.state;
    if (current.phase !== 'uncertain') return;
    const token = ++this.sequence;
    const lifecycle = this.lifecycle;
    try {
      const remote = await read();
      const fresh = this.state;
      if (
        !this.active ||
        lifecycle !== this.lifecycle ||
        (ownerGeneration !== undefined && ownerGeneration !== this.runnerGeneration) ||
        token !== this.sequence ||
        fresh.phase !== 'uncertain' ||
        fresh.activeRequest.requestId !== current.activeRequest.requestId
      )
        return;
      this.set(
        reconcileRemoteEdit(
          fresh,
          RESOLVER_SETTINGS_SCOPE,
          current.activeRequest.requestId,
          remote,
        ),
      );
      this.onConfirmed?.(remote);
      if (ownerGeneration === undefined && this.running) {
        this.runnerGeneration += 1;
        this.running = undefined;
      }
      if (this.state.phase === 'queued') {
        if (ownerGeneration === undefined) await this.ensureDrain();
      }
    } catch {
      // Keep the state uncertain until an authoritative read succeeds.
    }
  }

  private ensureDrain(): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.running) return this.running.then(() => this.ensureDrain());
    if (this.state.phase !== 'queued') return Promise.resolve();
    const generation = ++this.runnerGeneration;
    const running = Promise.resolve()
      .then(() => this.drain(generation))
      .finally(() => {
        if (this.runnerGeneration === generation && this.running === running)
          this.running = undefined;
      });
    this.running = running;
    return running;
  }

  private async drain(generation: number): Promise<void> {
    while (
      this.active &&
      generation === this.runnerGeneration &&
      this.state.phase === 'queued' &&
      !this.state.activeRequest
    ) {
      const requestId = this.state.queuedRequest.requestId;
      this.set(beginRemoteEdit(this.state, RESOLVER_SETTINGS_SCOPE, requestId));
      const updating = this.get();
      if (updating.phase !== 'updating' || !this.transport) return;
      const lifecycle = this.lifecycle;
      try {
        const confirmed = await this.transport.write(updating.activeRequest.submitted);
        if (!this.active || lifecycle !== this.lifecycle || generation !== this.runnerGeneration)
          return;
        this.set(succeedRemoteEdit(this.state, RESOLVER_SETTINGS_SCOPE, requestId, confirmed));
        this.onConfirmed?.(confirmed);
      } catch (cause) {
        if (!this.active || lifecycle !== this.lifecycle || generation !== this.runnerGeneration)
          return;
        const error = cause instanceof Error ? cause.message : String(cause);
        if (isAmbiguousRemoteError(cause)) {
          this.set(markRemoteEditUncertain(this.state, RESOLVER_SETTINGS_SCOPE, requestId, error));
          await this.reconcileWithOwner(this.transport.read, generation);
        } else {
          this.set(rejectRemoteEdit(this.state, RESOLVER_SETTINGS_SCOPE, requestId, error));
        }
      }
    }
  }

  private set(state: RemoteEditState<ResolverSettings>): void {
    if (!this.active) return;
    this.state = state;
    this.emit();
  }

  private emit(): void {
    if (!this.active) return;
    this.listeners.forEach((listener) => listener());
  }
}
