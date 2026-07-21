import type { HostUpdateStatus } from './AppRoot';
import { isAmbiguousRemoteError } from './live-mib-settings-transaction';
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

export const AUTOMATIC_UPDATE_PREFERENCE_SCOPE = 'desktop-updates:automatic-checks' as const;

export interface UpdatePreferenceSnapshot {
  readonly automaticChecks: boolean;
  readonly status: HostUpdateStatus;
}

export interface UpdatePreferenceTransport {
  write(automaticChecks: boolean): Promise<UpdatePreferenceSnapshot | null>;
  read(): Promise<UpdatePreferenceSnapshot | null>;
}

export type UpdatePreferenceReadiness =
  { phase: 'unloaded' | 'loading' | 'ready' } | { phase: 'error'; error: string };

export function updatePreferenceStatusText(state: RemoteEditState<boolean>): string {
  switch (state.phase) {
    case 'confirmed':
      return 'Saved and confirmed.';
    case 'dirty':
      return 'Unsaved preference change.';
    case 'queued':
      return 'Preference save queued.';
    case 'updating':
      return 'Saving preference…';
    case 'success':
      return 'Preference saved successfully.';
    case 'error-reverted':
      return `Preference rejected; restored the last confirmed value. ${state.error}`;
    case 'uncertain':
      return `Preference outcome uncertain; check the remote value. ${state.error}`;
    case 'conflict':
      return `Remote preference differs from the submitted value. ${state.error}`;
  }
}

interface UpdateStatusRequestToken {
  readonly lifecycle: number;
  readonly eventRevision: number;
  readonly requestId: number;
}

/** Orders async updater responses behind the adapter's authoritative status event stream. */
export class UpdateStatusCoordinator {
  private active = true;
  private lifecycle = 0;
  private eventRevision = 0;
  private nextRequestId = 0;
  private appliedRequestId = 0;

  constructor(private readonly apply: (status: HostUpdateStatus) => void) {}

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycle += 1;
    this.eventRevision = 0;
    this.nextRequestId = 0;
    this.appliedRequestId = 0;
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
  }

  event(status: HostUpdateStatus): void {
    if (!this.active) return;
    this.eventRevision += 1;
    this.appliedRequestId = 0;
    this.apply(status);
  }

  async run<T>(
    request: () => Promise<T>,
    statusFrom: (result: T) => HostUpdateStatus | null | undefined,
  ): Promise<T> {
    const token: UpdateStatusRequestToken = {
      lifecycle: this.lifecycle,
      eventRevision: this.eventRevision,
      requestId: ++this.nextRequestId,
    };
    const result = await request();
    const status = statusFrom(result);
    if (status) this.response(token, status);
    return result;
  }

  private response(token: UpdateStatusRequestToken, status: HostUpdateStatus): void {
    if (
      !this.active ||
      token.lifecycle !== this.lifecycle ||
      token.eventRevision !== this.eventRevision ||
      token.requestId < this.appliedRequestId
    )
      return;
    this.appliedRequestId = token.requestId;
    this.apply(status);
  }
}

export class AutomaticUpdatePreferenceController {
  private state = createRemoteEditState(AUTOMATIC_UPDATE_PREFERENCE_SCOPE, false);
  private readinessState: UpdatePreferenceReadiness = { phase: 'unloaded' };
  private inFlightLoad?: Promise<UpdatePreferenceSnapshot | null>;
  private running?: Promise<void>;
  private transport?: UpdatePreferenceTransport;
  private lastAttempt?: boolean;
  private readonly listeners = new Set<() => void>();
  private sequence = 0;
  private lifecycle = 0;
  private runnerGeneration = 0;
  private active = true;

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

  readiness(): UpdatePreferenceReadiness {
    return this.readinessState;
  }

  get(): RemoteEditState<boolean> {
    return this.state;
  }

  display(): boolean {
    return getRemoteEditDisplayValue(this.state);
  }

  confirmed(): boolean {
    return this.state.confirmed;
  }

  edit(value: boolean): void {
    if (!this.active || this.readinessState.phase !== 'ready') return;
    this.set(editRemoteDraft(this.state, value));
  }

  canCancel(): boolean {
    return this.active && canCancelRemoteEdit(this.state);
  }

  cancel(): void {
    if (!this.canCancel()) return;
    this.set(createRemoteEditState(AUTOMATIC_UPDATE_PREFERENCE_SCOPE, this.state.confirmed));
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

  load(
    read: () => Promise<UpdatePreferenceSnapshot | null>,
  ): Promise<UpdatePreferenceSnapshot | null> {
    if (!this.active) return Promise.resolve(null);
    if (this.readinessState.phase === 'ready') return Promise.resolve(null);
    if (this.readinessState.phase === 'loading' && this.inFlightLoad) return this.inFlightLoad;
    const token = ++this.sequence;
    const lifecycle = this.lifecycle;
    const loading = Promise.resolve()
      .then(read)
      .then((snapshot) => {
        if (!this.active || lifecycle !== this.lifecycle || token !== this.sequence)
          return snapshot;
        if (!snapshot) {
          this.readinessState = {
            phase: 'error',
            error: 'The desktop host did not return an authoritative update preference.',
          };
          this.emit();
          return snapshot;
        }
        this.state = createRemoteEditState(
          AUTOMATIC_UPDATE_PREFERENCE_SCOPE,
          snapshot.automaticChecks,
        );
        this.readinessState = { phase: 'ready' };
        this.emit();
        return snapshot;
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

  save(transport: UpdatePreferenceTransport): Promise<void> {
    if (!this.active || this.readinessState.phase !== 'ready') return Promise.resolve();
    if (this.state.phase === 'dirty') {
      this.lastAttempt = this.state.draft;
      this.set(queueRemoteEdit(this.state, ++this.sequence));
    }
    this.transport = transport;
    return this.ensureDrain();
  }

  retry(transport: UpdatePreferenceTransport): Promise<void> {
    if (!this.active) return Promise.resolve();
    const attempted = this.lastAttempt;
    this.acknowledge();
    if (attempted !== undefined && ['confirmed', 'success'].includes(this.state.phase)) {
      this.edit(attempted);
    }
    return this.save(transport);
  }

  async reconcile(read: () => Promise<UpdatePreferenceSnapshot | null>): Promise<void> {
    await this.reconcileWithOwner(read);
  }

  private async reconcileWithOwner(
    read: () => Promise<UpdatePreferenceSnapshot | null>,
    ownerGeneration?: number,
  ): Promise<void> {
    if (!this.active) return;
    const current = this.state;
    if (current.phase !== 'uncertain') return;
    const token = ++this.sequence;
    const lifecycle = this.lifecycle;
    try {
      const snapshot = await read();
      const fresh = this.state;
      if (
        !snapshot ||
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
          AUTOMATIC_UPDATE_PREFERENCE_SCOPE,
          current.activeRequest.requestId,
          snapshot.automaticChecks,
        ),
      );
      if (ownerGeneration === undefined && this.running) {
        this.runnerGeneration += 1;
        this.running = undefined;
      }
      if (this.state.phase === 'queued' && ownerGeneration === undefined) await this.ensureDrain();
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
      this.set(beginRemoteEdit(this.state, AUTOMATIC_UPDATE_PREFERENCE_SCOPE, requestId));
      const updating = this.get();
      if (updating.phase !== 'updating' || !this.transport) return;
      const lifecycle = this.lifecycle;
      try {
        const snapshot = await this.transport.write(updating.activeRequest.submitted);
        if (!this.active || lifecycle !== this.lifecycle || generation !== this.runnerGeneration)
          return;
        if (!snapshot) {
          this.set(
            rejectRemoteEdit(
              this.state,
              AUTOMATIC_UPDATE_PREFERENCE_SCOPE,
              requestId,
              'The desktop host rejected the preference update.',
            ),
          );
          continue;
        }
        this.set(
          succeedRemoteEdit(
            this.state,
            AUTOMATIC_UPDATE_PREFERENCE_SCOPE,
            requestId,
            snapshot.automaticChecks,
          ),
        );
      } catch (cause) {
        if (!this.active || lifecycle !== this.lifecycle || generation !== this.runnerGeneration)
          return;
        const error = cause instanceof Error ? cause.message : String(cause);
        if (isAmbiguousRemoteError(cause)) {
          this.set(
            markRemoteEditUncertain(
              this.state,
              AUTOMATIC_UPDATE_PREFERENCE_SCOPE,
              requestId,
              error,
            ),
          );
          await this.reconcileWithOwner(this.transport.read, generation);
        } else {
          this.set(
            rejectRemoteEdit(this.state, AUTOMATIC_UPDATE_PREFERENCE_SCOPE, requestId, error),
          );
        }
      }
    }
  }

  private set(state: RemoteEditState<boolean>): void {
    if (!this.active) return;
    this.state = state;
    this.emit();
  }

  private emit(): void {
    if (!this.active) return;
    this.listeners.forEach((listener) => listener());
  }
}
