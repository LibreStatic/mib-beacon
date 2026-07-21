import type { PacketTraceServiceStatus } from '@mibbeacon/core/client';
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

export const PACKET_RETENTION_SCOPE = 'packets:retention-mib' as const;
export type PacketRetentionReadiness =
  { phase: 'unloaded' | 'loading' | 'ready' } | { phase: 'error'; error: string };
export type PacketRetentionValidation =
  { valid: true; value: number } | { valid: false; reason: string };
export type PacketStatusOperationState =
  { phase: 'idle' | 'updating' | 'success' } | { phase: 'error' | 'uncertain'; error: string };

export interface PacketRetentionTransport {
  write(retentionMiB: number): Promise<PacketTraceServiceStatus>;
  read(): Promise<PacketTraceServiceStatus>;
}

interface StatusRequestToken {
  readonly lifecycle: number;
  readonly authorityRevision: number;
  readonly requestId: number;
}

export function validatePacketRetention(text: string): PacketRetentionValidation {
  if (!/^\d+$/.test(text)) {
    return { valid: false, reason: 'Enter a whole number from 0 through 256 MiB.' };
  }
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= 0 && value <= 256
    ? { valid: true, value }
    : { valid: false, reason: 'Enter a whole number from 0 through 256 MiB.' };
}

export function packetRetentionStatusText(state: RemoteEditState<string>): string {
  switch (state.phase) {
    case 'confirmed':
      return 'Saved and confirmed.';
    case 'dirty':
      return 'Unsaved retention change.';
    case 'queued':
      return 'Retention save queued.';
    case 'updating':
      return 'Saving retention…';
    case 'success':
      return 'Retention saved successfully.';
    case 'error-reverted':
      return `Retention rejected; restored the last confirmed value. ${state.error}`;
    case 'uncertain':
      return `Retention outcome uncertain; check the engine status. ${state.error}`;
    case 'conflict':
      return `Engine retention differs from the submitted value. ${state.error}`;
  }
}

export class PacketRetentionController {
  private state = createRemoteEditState(PACKET_RETENTION_SCOPE, '32');
  private readinessState: PacketRetentionReadiness = { phase: 'unloaded' };
  private inFlightLoad?: Promise<PacketTraceServiceStatus>;
  private running?: Promise<void>;
  private transport?: PacketRetentionTransport;
  private lastAttempt?: string;
  private latestStatus?: PacketTraceServiceStatus;
  private readonly listeners = new Set<() => void>();
  private sequence = 0;
  private lifecycle = 0;
  private runnerGeneration = 0;
  private authorityRevision = 0;
  private nextStatusRequestId = 0;
  private appliedStatusRequestId = 0;
  private statusOperationState: PacketStatusOperationState = { phase: 'idle' };
  private statusOperationGeneration = 0;
  private inFlightStatusOperation?: Promise<PacketTraceServiceStatus | undefined>;
  private active = true;

  constructor(private readonly onAcceptedStatus?: (status: PacketTraceServiceStatus) => void) {}

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
    this.inFlightStatusOperation = undefined;
    this.statusOperationGeneration += 1;
    this.transport = undefined;
    this.listeners.clear();
  }

  subscribe(listener: () => void): () => void {
    if (!this.active) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  readiness(): PacketRetentionReadiness {
    return this.readinessState;
  }

  get(): RemoteEditState<string> {
    return this.state;
  }

  status(): PacketTraceServiceStatus | undefined {
    return this.latestStatus;
  }

  statusOperation(): PacketStatusOperationState {
    return this.statusOperationState;
  }

  displayText(): string {
    return getRemoteEditDisplayValue(this.state);
  }

  confirmedText(): string {
    return this.state.confirmed;
  }

  validation(): PacketRetentionValidation {
    return validatePacketRetention(this.state.draft);
  }

  observe(status: PacketTraceServiceStatus): void {
    if (!this.active || status === this.latestStatus) return;
    this.authorityRevision += 1;
    this.appliedStatusRequestId = 0;
    this.latestStatus = status;
    const confirmed = String(status.retentionMiB);
    if (this.readinessState.phase !== 'ready') {
      this.sequence += 1;
      this.state = createRemoteEditState(PACKET_RETENTION_SCOPE, confirmed);
      this.readinessState = { phase: 'ready' };
    } else if (!this.state.activeRequest && !this.state.queuedRequest) {
      if (this.state.phase === 'dirty') {
        this.state = editRemoteDraft(
          createRemoteEditState(PACKET_RETENTION_SCOPE, confirmed),
          this.state.draft,
        );
      } else if (this.state.phase === 'confirmed' || this.state.phase === 'success') {
        this.state = createRemoteEditState(PACKET_RETENTION_SCOPE, confirmed);
      }
    }
    this.onAcceptedStatus?.(status);
    this.emit();
  }

  edit(text: string): void {
    if (!this.active || this.readinessState.phase !== 'ready') return;
    this.set(editRemoteDraft(this.state, text));
  }

  canCancel(): boolean {
    return this.active && canCancelRemoteEdit(this.state);
  }

  cancel(): void {
    if (!this.canCancel()) return;
    this.set(createRemoteEditState(PACKET_RETENTION_SCOPE, this.state.confirmed));
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

  load(read: () => Promise<PacketTraceServiceStatus>): Promise<PacketTraceServiceStatus> {
    if (!this.active) return Promise.resolve(this.latestStatus ?? emptyStatus());
    if (this.readinessState.phase === 'ready')
      return Promise.resolve(this.latestStatus ?? emptyStatus(Number(this.state.confirmed)));
    if (this.readinessState.phase === 'loading' && this.inFlightLoad) return this.inFlightLoad;
    const token = ++this.sequence;
    const lifecycle = this.lifecycle;
    const loading = Promise.resolve()
      .then(read)
      .then((status) => {
        if (this.active && lifecycle === this.lifecycle && token === this.sequence) {
          this.latestStatus = status;
          this.state = createRemoteEditState(PACKET_RETENTION_SCOPE, String(status.retentionMiB));
          this.readinessState = { phase: 'ready' };
          this.onAcceptedStatus?.(status);
          this.emit();
        }
        return status;
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

  save(transport: PacketRetentionTransport): Promise<void> {
    if (!this.active || this.readinessState.phase !== 'ready') return Promise.resolve();
    if (this.state.phase === 'dirty') {
      if (!this.validation().valid) return Promise.resolve();
      this.lastAttempt = this.state.draft;
      this.set(queueRemoteEdit(this.state, ++this.sequence));
    }
    this.transport = transport;
    return this.ensureDrain();
  }

  retry(transport: PacketRetentionTransport): Promise<void> {
    if (!this.active) return Promise.resolve();
    const attempted = this.lastAttempt;
    this.acknowledge();
    if (attempted !== undefined && ['confirmed', 'success'].includes(this.state.phase)) {
      this.edit(attempted);
    }
    return this.save(transport);
  }

  async reconcile(read: () => Promise<PacketTraceServiceStatus>): Promise<void> {
    await this.reconcileWithOwner(read);
  }

  runStatusOperation(
    operation: () => Promise<PacketTraceServiceStatus>,
    read?: () => Promise<PacketTraceServiceStatus>,
  ): Promise<PacketTraceServiceStatus | undefined> {
    if (!this.active) return Promise.resolve(this.latestStatus);
    if (this.inFlightStatusOperation) return this.inFlightStatusOperation;
    const running = this.performStatusOperation(operation, read).finally(() => {
      if (this.inFlightStatusOperation === running) this.inFlightStatusOperation = undefined;
    });
    this.inFlightStatusOperation = running;
    return running;
  }

  private async performStatusOperation(
    operation: () => Promise<PacketTraceServiceStatus>,
    read?: () => Promise<PacketTraceServiceStatus>,
  ): Promise<PacketTraceServiceStatus | undefined> {
    const generation = ++this.statusOperationGeneration;
    const lifecycle = this.lifecycle;
    this.statusOperationState = { phase: 'updating' };
    this.emit();
    const token = this.captureStatusRequest();
    try {
      const status = await operation();
      const accepted = this.acceptStatusResponse(token, status);
      if (
        this.active &&
        lifecycle === this.lifecycle &&
        generation === this.statusOperationGeneration
      ) {
        this.statusOperationState = this.statusOperationOutcome(
          accepted ? status : this.latestStatus,
        );
        this.emit();
      }
      return status;
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      if (
        !this.active ||
        lifecycle !== this.lifecycle ||
        generation !== this.statusOperationGeneration
      )
        return this.latestStatus;
      if (!isAmbiguousRemoteError(cause) || !read) {
        this.statusOperationState = { phase: 'error', error };
        this.emit();
        return this.latestStatus;
      }
      this.statusOperationState = { phase: 'uncertain', error };
      this.emit();
      const readToken = this.captureStatusRequest();
      try {
        const status = await read();
        if (
          this.active &&
          lifecycle === this.lifecycle &&
          generation === this.statusOperationGeneration
        ) {
          const accepted = this.acceptStatusResponse(readToken, status);
          this.statusOperationState = this.statusOperationOutcome(
            accepted ? status : this.latestStatus,
          );
          this.emit();
        }
        return status;
      } catch {
        return this.latestStatus;
      }
    }
  }

  private async reconcileWithOwner(
    read: () => Promise<PacketTraceServiceStatus>,
    ownerGeneration?: number,
  ): Promise<void> {
    if (!this.active) return;
    const current = this.state;
    if (current.phase !== 'uncertain') return;
    const token = ++this.sequence;
    const lifecycle = this.lifecycle;
    const statusToken = this.captureStatusRequest();
    try {
      const response = await read();
      const accepted = this.acceptStatusResponse(statusToken, response);
      const authoritative = accepted ? response : this.latestStatus;
      const fresh = this.state;
      if (
        !this.active ||
        lifecycle !== this.lifecycle ||
        (ownerGeneration !== undefined && ownerGeneration !== this.runnerGeneration) ||
        token !== this.sequence ||
        fresh.phase !== 'uncertain' ||
        fresh.activeRequest.requestId !== current.activeRequest.requestId ||
        !authoritative
      )
        return;
      this.set(
        reconcileRemoteEdit(
          fresh,
          PACKET_RETENTION_SCOPE,
          current.activeRequest.requestId,
          String(authoritative.retentionMiB),
        ),
      );
      if (ownerGeneration === undefined && this.running) {
        this.runnerGeneration += 1;
        this.running = undefined;
      }
      if (this.state.phase === 'queued' && ownerGeneration === undefined) await this.ensureDrain();
    } catch {
      // Keep uncertainty visible until a later authoritative status succeeds.
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
      this.set(beginRemoteEdit(this.state, PACKET_RETENTION_SCOPE, requestId));
      const updating = this.get();
      if (updating.phase !== 'updating' || !this.transport) return;
      const validation = validatePacketRetention(updating.activeRequest.submitted);
      if (!validation.valid) return;
      const lifecycle = this.lifecycle;
      const statusToken = this.captureStatusRequest();
      try {
        const response = await this.transport.write(validation.value);
        if (!this.active || lifecycle !== this.lifecycle || generation !== this.runnerGeneration)
          return;
        const accepted = this.acceptStatusResponse(statusToken, response);
        if (!accepted) this.publishCausalWriteStatus(response);
        this.completeWrite(requestId, response);
      } catch (cause) {
        if (!this.active || lifecycle !== this.lifecycle || generation !== this.runnerGeneration)
          return;
        const error = cause instanceof Error ? cause.message : String(cause);
        if (isAmbiguousRemoteError(cause)) {
          this.set(markRemoteEditUncertain(this.state, PACKET_RETENTION_SCOPE, requestId, error));
          await this.reconcileWithOwner(this.transport.read, generation);
        } else {
          this.set(rejectRemoteEdit(this.state, PACKET_RETENTION_SCOPE, requestId, error));
        }
      }
    }
  }

  private captureStatusRequest(): StatusRequestToken {
    return {
      lifecycle: this.lifecycle,
      authorityRevision: this.authorityRevision,
      requestId: ++this.nextStatusRequestId,
    };
  }

  private completeWrite(requestId: number, status: PacketTraceServiceStatus): void {
    const current = this.state;
    const remote = String(status.retentionMiB);
    if (
      current.activeRequest?.requestId === requestId &&
      !current.queuedRequest &&
      current.draft === current.activeRequest.submitted &&
      remote !== current.activeRequest.submitted
    ) {
      const uncertain = markRemoteEditUncertain(
        current,
        PACKET_RETENTION_SCOPE,
        requestId,
        'The engine returned a different retention value.',
      );
      this.set(reconcileRemoteEdit(uncertain, PACKET_RETENTION_SCOPE, requestId, remote));
      return;
    }
    this.set(succeedRemoteEdit(current, PACKET_RETENTION_SCOPE, requestId, remote));
  }

  private acceptStatusResponse(
    token: StatusRequestToken,
    status: PacketTraceServiceStatus,
  ): boolean {
    if (
      !this.active ||
      token.lifecycle !== this.lifecycle ||
      token.authorityRevision !== this.authorityRevision ||
      token.requestId < this.appliedStatusRequestId
    )
      return false;
    this.appliedStatusRequestId = token.requestId;
    this.latestStatus = status;
    this.onAcceptedStatus?.(status);
    return true;
  }

  private statusOperationOutcome(
    status: PacketTraceServiceStatus | undefined,
  ): PacketStatusOperationState {
    return status?.persistence === 'degraded'
      ? {
          phase: 'error',
          error: status.warning ?? 'Packet persistence remains degraded.',
        }
      : { phase: 'success' };
  }

  private publishCausalWriteStatus(response: PacketTraceServiceStatus): void {
    if (!this.active) return;
    const causal = { ...response };
    if (causal.retentionMiB === 0) {
      causal.persistence = 'disabled';
      causal.persistedBytes = 0;
      delete causal.warning;
    }
    const newer = this.latestStatus;
    if (!newer) {
      this.latestStatus = causal;
      this.onAcceptedStatus?.(causal);
      return;
    }
    const retentionMiB = causal.retentionMiB;
    const sameRetention = newer.retentionMiB === retentionMiB;
    const persistence = retentionMiB === 0 ? 'disabled' : newer.persistence;
    const merged: PacketTraceServiceStatus = {
      ...causal,
      retentionMiB,
      ...(sameRetention
        ? {
            persistence,
            persistedBytes: newer.persistedBytes,
          }
        : {}),
    };
    if (retentionMiB === 0) {
      merged.persistence = 'disabled';
      merged.persistedBytes = 0;
      delete merged.warning;
    } else if (sameRetention) {
      if (newer.warning) merged.warning = newer.warning;
      else delete merged.warning;
    }
    this.latestStatus = merged;
    this.onAcceptedStatus?.(merged);
  }

  private set(state: RemoteEditState<string>): void {
    if (!this.active) return;
    this.state = state;
    this.emit();
  }

  private emit(): void {
    if (!this.active) return;
    this.listeners.forEach((listener) => listener());
  }
}

function emptyStatus(retentionMiB = 32): PacketTraceServiceStatus {
  return {
    retentionMiB,
    persistence: retentionMiB === 0 ? 'disabled' : 'active',
    persistedBytes: 0,
  };
}
