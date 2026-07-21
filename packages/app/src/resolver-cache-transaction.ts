import type { ResolverCacheStats } from '@mibbeacon/core/client';
import { isAmbiguousRemoteError } from './live-mib-settings-transaction';

export type ResolverCacheClearPhase =
  'confirmed' | 'queued' | 'updating' | 'success' | 'error-reverted' | 'uncertain' | 'conflict';

export interface ResolverCacheClearSnapshot {
  readonly readiness: 'unloaded' | 'loading' | 'ready' | 'error';
  readonly phase: ResolverCacheClearPhase;
  readonly confirmed?: ResolverCacheStats;
  readonly error?: string;
}

export interface ResolverCacheClearTransport {
  clear(): Promise<void>;
  stats(): Promise<ResolverCacheStats>;
}

interface PendingClear {
  readonly lifecycle: number;
  readonly owns: () => boolean;
  readonly promise: Promise<void>;
  resolve(): void;
  reject(cause: unknown): void;
}

const emptyStats = (value: ResolverCacheStats) => value.entries === 0 && value.bytes === 0;
const sameStats = (left: ResolverCacheStats, right: ResolverCacheStats) =>
  left.entries === right.entries && left.bytes === right.bytes;
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Retained per-engine authority for destructive resolver-cache clears. */
export class ResolverCacheClearController {
  private state: ResolverCacheClearSnapshot = { readiness: 'unloaded', phase: 'confirmed' };
  private readonly listeners = new Set<() => void>();
  private pending?: PendingClear;
  private lifecycle = 0;
  private readSequence = 0;
  private active = true;

  constructor(
    private readonly transport: ResolverCacheClearTransport,
    private readonly onAccepted?: (stats: ResolverCacheStats) => void,
  ) {}

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycle += 1;
    this.state = { readiness: 'unloaded', phase: 'confirmed' };
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
    const pending = this.pending;
    this.pending = undefined;
    pending?.reject(new Error('Resolver cache clear controller was disposed'));
    this.listeners.clear();
  }

  snapshot(): ResolverCacheClearSnapshot {
    return this.state;
  }

  /** Capture authority before an external cache-stats read starts. */
  beginAuthorityRead(): number {
    return ++this.readSequence;
  }

  /** Apply an external cache-stats read only while it remains the newest authority. */
  applyAuthority(confirmed: ResolverCacheStats, token: number): boolean {
    if (!this.active || token !== this.readSequence || this.pending) return false;
    this.onAccepted?.(confirmed);
    this.set({ readiness: 'ready', phase: 'confirmed', confirmed });
    return true;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(
    read: () => Promise<ResolverCacheStats> = () => this.transport.stats(),
  ): Promise<void> {
    if (!this.active || this.pending) return;
    const lifecycle = this.lifecycle;
    const token = this.beginAuthorityRead();
    this.set({ ...this.state, readiness: 'loading' });
    try {
      const confirmed = await read();
      if (!this.owns(lifecycle) || token !== this.readSequence || this.pending) return;
      this.applyAuthority(confirmed, token);
    } catch (cause) {
      if (this.owns(lifecycle) && token === this.readSequence && !this.pending) {
        this.set({ ...this.state, readiness: 'error', error: message(cause) });
      }
      throw cause;
    }
  }

  clear(owns: () => boolean): Promise<void> {
    if (!this.active || !owns()) return Promise.reject(new Error('Resolver cache ownership lost'));
    if (this.pending) return this.pending.promise;
    let resolve!: () => void;
    let reject!: (cause: unknown) => void;
    const promise = new Promise<void>((accept, decline) => {
      resolve = accept;
      reject = decline;
    });
    const command: PendingClear = { lifecycle: this.lifecycle, owns, promise, resolve, reject };
    this.pending = command;
    // A mutation start supersedes every authority read that started before it.
    this.readSequence += 1;
    this.set({ ...this.state, phase: 'queued', error: undefined });
    void Promise.resolve().then(() => this.run(command));
    return promise;
  }

  retry(owns: () => boolean): Promise<void> {
    if (!['error-reverted', 'conflict'].includes(this.state.phase)) {
      return Promise.reject(new Error('Resolver cache clear is not retryable'));
    }
    return this.clear(owns);
  }

  acknowledge(): void {
    if (!['error-reverted', 'conflict'].includes(this.state.phase)) return;
    this.set({ ...this.state, phase: 'confirmed', error: undefined });
  }

  async reconcile(owns: () => boolean): Promise<void> {
    if (!this.active || !owns()) throw new Error('Resolver cache ownership lost');
    if (this.pending) throw new Error('Resolver cache clear is already in progress');
    const lifecycle = this.lifecycle;
    const before = this.state.confirmed;
    const token = this.beginAuthorityRead();
    const remote = await this.transport.stats();
    if (!this.owns(lifecycle) || !owns()) throw new Error('Resolver cache ownership lost');
    if (token !== this.readSequence || this.pending) return;
    this.onAccepted?.(remote);
    if (emptyStats(remote)) {
      this.set({ readiness: 'ready', phase: 'success', confirmed: remote });
    } else if (before && sameStats(remote, before)) {
      this.set({
        readiness: 'ready',
        phase: 'error-reverted',
        confirmed: remote,
        error: this.state.error,
      });
    } else {
      this.set({
        readiness: 'ready',
        phase: 'conflict',
        confirmed: remote,
        error:
          'The engine cache differs from both the submitted clear and the last confirmed state.',
      });
    }
  }

  private async run(command: PendingClear): Promise<void> {
    if (!this.current(command)) return;
    this.set({ ...this.state, phase: 'updating' });
    let clearAccepted = false;
    try {
      await this.transport.clear();
      clearAccepted = true;
      if (!this.current(command)) return this.rejectStale(command);
      const confirmed = await this.transport.stats();
      if (!this.current(command)) return this.rejectStale(command);
      this.readSequence += 1;
      this.pending = undefined;
      this.onAccepted?.(confirmed);
      if (emptyStats(confirmed)) {
        this.set({ readiness: 'ready', phase: 'success', confirmed });
        command.resolve();
      } else {
        this.set({
          readiness: 'ready',
          phase: 'conflict',
          confirmed,
          error: 'The engine accepted the clear but still reports cached entries.',
        });
        command.reject(new Error('Resolver cache clear did not produce an empty cache'));
      }
    } catch (cause) {
      if (!this.current(command)) return this.rejectStale(command);
      this.pending = undefined;
      if (clearAccepted || isAmbiguousRemoteError(cause)) {
        this.set({ ...this.state, phase: 'uncertain', error: message(cause) });
      } else {
        this.set({ ...this.state, phase: 'error-reverted', error: message(cause) });
      }
      command.reject(cause);
    }
  }

  private rejectStale(command: PendingClear): void {
    if (this.pending === command) this.pending = undefined;
    command.reject(new Error('Resolver cache ownership lost'));
  }

  private current(command: PendingClear): boolean {
    return this.pending === command && this.owns(command.lifecycle) && command.owns();
  }

  private owns(lifecycle: number): boolean {
    return this.active && this.lifecycle === lifecycle;
  }

  private set(state: ResolverCacheClearSnapshot): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}

export function resolverCacheClearStatusText(state: ResolverCacheClearSnapshot): string {
  switch (state.phase) {
    case 'confirmed':
      return 'Cache state confirmed.';
    case 'queued':
      return 'Cache clear queued.';
    case 'updating':
      return 'Clearing dependency cache…';
    case 'success':
      return 'Dependency cache cleared successfully.';
    case 'error-reverted':
      return `Clear rejected; restored the last confirmed cache. ${state.error ?? ''}`.trim();
    case 'uncertain':
      return `Clear outcome uncertain; check the engine cache. ${state.error ?? ''}`.trim();
    case 'conflict':
      return `Engine cache conflicts with the clear request. ${state.error ?? ''}`.trim();
  }
}
