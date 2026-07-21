import type {
  EngineAPI,
  OperationBookmark,
  OperationBookmarkInput,
  WalkSnapshotInput,
  WalkSnapshotSummary,
} from '@mibbeacon/core/client';
import { isAmbiguousRemoteError } from './live-mib-settings-transaction';

export type QueryArtifactPhase =
  'confirmed' | 'queued' | 'updating' | 'success' | 'error-reverted' | 'uncertain' | 'conflict';

export interface QueryArtifacts {
  bookmarks: OperationBookmark[];
  snapshots: WalkSnapshotSummary[];
}

export interface QueryArtifactCollectionsSnapshot extends QueryArtifacts {
  readiness: { phase: 'unloaded' | 'loading' | 'ready' } | { phase: 'error'; error: string };
  phase: QueryArtifactPhase;
  queued: number;
  active?: string;
  failedCommand?: string;
  error?: string;
}

type Command = {
  label: string;
  owns: () => boolean;
  run: () => Promise<unknown>;
  project: (before: QueryArtifacts, result?: unknown) => QueryArtifacts;
  matches: (remote: QueryArtifacts, before: QueryArtifacts, result?: unknown) => boolean;
  resolve: () => void;
  reject: (cause: unknown) => void;
};

const empty = (): QueryArtifacts => ({ bookmarks: [], snapshots: [] });
const copy = (value: QueryArtifacts): QueryArtifacts => ({
  bookmarks: [...value.bookmarks],
  snapshots: [...value.snapshots],
});
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function queryArtifactStatusText(snapshot: QueryArtifactCollectionsSnapshot): string {
  if (snapshot.readiness.phase === 'loading') return 'Loading confirmed saved work…';
  if (snapshot.readiness.phase === 'error') return snapshot.readiness.error;
  if (snapshot.phase === 'queued') return `${snapshot.queued} saved-work change(s) queued`;
  if (snapshot.phase === 'updating')
    return `Updating ${snapshot.active ?? 'saved work'}… · ${snapshot.queued} queued`;
  if (snapshot.phase === 'success') return 'Saved work confirmed by the engine';
  if (snapshot.phase === 'error-reverted')
    return `Change rejected; last-confirmed saved work restored${snapshot.error ? ` · ${snapshot.error}` : ''}`;
  if (snapshot.phase === 'uncertain')
    return `Saved-work outcome uncertain; reconcile with the engine${snapshot.error ? ` · ${snapshot.error}` : ''}`;
  if (snapshot.phase === 'conflict')
    return `Saved-work conflict requires review${snapshot.error ? ` · ${snapshot.error}` : ''}`;
  return 'Saved work confirmed';
}

/** Retained, per-engine serialization and authority boundary for Query artifacts. */
export class QueryArtifactCollectionsController {
  private state: QueryArtifactCollectionsSnapshot = {
    ...empty(),
    readiness: { phase: 'unloaded' },
    phase: 'confirmed',
    queued: 0,
  };
  private readonly listeners = new Set<() => void>();
  private readonly queue: Command[] = [];
  private activeCommand?: Command;
  private failed?: {
    command: Omit<Command, 'resolve' | 'reject'>;
    before: QueryArtifacts;
    result?: unknown;
  };
  private loadPromise?: Promise<QueryArtifacts>;
  private draining?: Promise<void>;
  private active = true;
  private lifecycle = 0;
  private authoritySequence = 0;
  private latestReadStarted = 0;
  private committedAuthority = 0;
  private readonly inflightIntents = new Map<string, Promise<void>>();
  private readonly snapshotResultIds = new WeakMap<object, number>();
  private nextSnapshotResultId = 1;

  constructor(private readonly engine: EngineAPI) {}

  snapshot(): QueryArtifactCollectionsSnapshot {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  activate(owns: () => boolean = () => true): void {
    if (!owns()) return;
    if (this.active) return;
    this.active = true;
    this.lifecycle += 1;
    this.loadPromise = undefined;
    this.draining = undefined;
    this.failed = undefined;
    this.authoritySequence = 0;
    this.latestReadStarted = 0;
    this.committedAuthority = 0;
    this.state = { ...empty(), readiness: { phase: 'unloaded' }, phase: 'confirmed', queued: 0 };
  }

  load(): Promise<QueryArtifacts> {
    if (!this.active) return Promise.resolve(this.collections());
    if (this.state.readiness.phase === 'ready') return Promise.resolve(this.collections());
    if (this.loadPromise) return this.loadPromise;
    const lifecycle = this.lifecycle;
    const token = this.beginRead();
    this.set({ ...this.state, readiness: { phase: 'loading' } });
    const loading = this.readAuthority()
      .then((remote) => {
        if (this.owns(lifecycle) && token === this.latestReadStarted) {
          this.commit(remote, token);
          this.set({ ...this.state, readiness: { phase: 'ready' } });
          void this.ensureDrain();
        }
        return remote;
      })
      .catch((cause) => {
        if (this.owns(lifecycle) && token === this.latestReadStarted)
          this.set({ ...this.state, readiness: { phase: 'error', error: message(cause) } });
        throw cause;
      })
      .finally(() => {
        if (this.owns(lifecycle) && this.loadPromise === loading) this.loadPromise = undefined;
      });
    this.loadPromise = loading;
    return loading;
  }

  async refresh(accepts: () => boolean = () => true): Promise<QueryArtifacts> {
    if (!this.active) return this.collections();
    const lifecycle = this.lifecycle;
    const token = this.beginRead();
    const remote = await this.readAuthority();
    if (
      this.owns(lifecycle) &&
      accepts() &&
      token === this.latestReadStarted &&
      token >= this.committedAuthority
    ) {
      this.commit(remote, token);
      const blocked = ['error-reverted', 'uncertain', 'conflict'].includes(this.state.phase);
      this.set({
        ...this.state,
        readiness: { phase: 'ready' },
        phase: blocked || this.draining ? this.state.phase : 'confirmed',
      });
      void this.ensureDrain();
    }
    return this.collections();
  }

  createBookmark(input: OperationBookmarkInput, owns: () => boolean = () => true): Promise<void> {
    const semantic = normalizeBookmarkInput(input);
    return this.coalesceIntent(`bookmark:create:${stableSerialize(semantic)}`, () =>
      this.enqueue(
        'bookmark:create',
        owns,
        () => this.engine.ops.bookmarks.create(input),
        (before, result) => ({
          ...before,
          bookmarks: result ? [result as OperationBookmark, ...before.bookmarks] : before.bookmarks,
        }),
        (remote, before, result) =>
          result
            ? remote.bookmarks.some((item) => item.id === (result as OperationBookmark).id)
            : multiplicity(remote.bookmarks, semantic, normalizeBookmark) >
              multiplicity(before.bookmarks, semantic, normalizeBookmark),
      ),
    );
  }

  deleteBookmark(id: string, owns: () => boolean = () => true): Promise<void> {
    return this.coalesceIntent(`bookmark:delete:${id}`, () =>
      this.enqueue(
        `bookmark:delete:${id}`,
        owns,
        () => this.engine.ops.bookmarks.delete(id),
        (before) => ({ ...before, bookmarks: before.bookmarks.filter((item) => item.id !== id) }),
        (remote) => !remote.bookmarks.some((item) => item.id === id),
      ),
    );
  }

  createSnapshot(input: WalkSnapshotInput, owns: () => boolean = () => true): Promise<void> {
    const semantic = normalizeSnapshotInput(input);
    const resultsId = this.snapshotResultsIdentity(input.results);
    return this.coalesceIntent(
      `snapshot:create:${stableSerialize(semantic)}:results:${resultsId}`,
      () =>
        this.enqueue(
          'snapshot:create',
          owns,
          () => this.engine.ops.snapshots.create(input),
          (before, result) => ({
            ...before,
            snapshots: result
              ? [result as WalkSnapshotSummary, ...before.snapshots]
              : before.snapshots,
          }),
          (remote, before, result) =>
            result
              ? remote.snapshots.some((item) => item.id === (result as WalkSnapshotSummary).id)
              : multiplicity(remote.snapshots, semantic, normalizeSnapshot) >
                multiplicity(before.snapshots, semantic, normalizeSnapshot),
        ),
    );
  }

  deleteSnapshot(id: string, owns: () => boolean = () => true): Promise<void> {
    return this.coalesceIntent(`snapshot:delete:${id}`, () =>
      this.enqueue(
        `snapshot:delete:${id}`,
        owns,
        () => this.engine.ops.snapshots.delete(id),
        (before) => ({ ...before, snapshots: before.snapshots.filter((item) => item.id !== id) }),
        (remote) => !remote.snapshots.some((item) => item.id === id),
      ),
    );
  }

  retryFailed(): Promise<void> {
    if (!this.failed || this.state.phase !== 'error-reverted') return Promise.resolve();
    const command = this.failed.command;
    this.failed = undefined;
    this.set({ ...this.state, phase: 'confirmed', error: undefined, failedCommand: undefined });
    return this.enqueue(command.label, command.owns, command.run, command.project, command.matches);
  }

  acknowledge(): void {
    if (!['error-reverted', 'conflict'].includes(this.state.phase)) return;
    this.failed = undefined;
    this.set({
      ...this.state,
      phase: this.queue.length ? 'queued' : 'confirmed',
      error: undefined,
      failedCommand: undefined,
    });
    void this.ensureDrain();
  }

  async reconcile(): Promise<void> {
    if (!this.active) return;
    const lifecycle = this.lifecycle;
    const token = this.beginRead();
    try {
      const remote = await this.readAuthority();
      if (!this.owns(lifecycle) || token !== this.latestReadStarted) return;
      const failed = this.failed;
      this.commit(remote, token);
      if (failed && !failed.command.matches(remote, failed.before, failed.result)) {
        this.enterBlocked({
          ...this.state,
          phase: 'conflict',
          error: `Remote saved work does not contain ${failed.command.label}`,
          failedCommand: failed.command.label,
        });
        return;
      }
      this.failed = undefined;
      this.set({
        ...this.state,
        readiness: { phase: 'ready' },
        phase: 'success',
        error: undefined,
        failedCommand: undefined,
      });
      void this.ensureDrain();
    } catch (cause) {
      if (this.owns(lifecycle) && token === this.latestReadStarted)
        this.enterBlocked({ ...this.state, phase: 'uncertain', error: message(cause) });
      throw cause;
    }
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
    this.listeners.clear();
    const cause = new Error('Query artifact controller was disposed');
    this.activeCommand?.reject(cause);
    this.activeCommand = undefined;
    this.queue.splice(0).forEach((command) => command.reject(cause));
    this.inflightIntents.clear();
  }

  private coalesceIntent(key: string, create: () => Promise<void>): Promise<void> {
    const existing = this.inflightIntents.get(key);
    if (existing) return existing;
    const promise = create();
    this.inflightIntents.set(key, promise);
    void promise.then(
      () => {
        if (this.inflightIntents.get(key) === promise) this.inflightIntents.delete(key);
      },
      () => {
        if (this.inflightIntents.get(key) === promise) this.inflightIntents.delete(key);
      },
    );
    return promise;
  }

  private snapshotResultsIdentity(results: object): number {
    const existing = this.snapshotResultIds.get(results);
    if (existing !== undefined) return existing;
    const id = this.nextSnapshotResultId++;
    this.snapshotResultIds.set(results, id);
    return id;
  }

  private enterBlocked(next: QueryArtifactCollectionsSnapshot): void {
    const cause = new Error(
      `Queued saved-work changes rejected because ${next.phase} blocked writes`,
    );
    this.queue.splice(0).forEach((command) => command.reject(cause));
    this.set({ ...next, queued: 0 });
  }

  private enqueue(
    label: string,
    owns: () => boolean,
    run: () => Promise<unknown>,
    project: Command['project'],
    matches: Command['matches'],
  ): Promise<void> {
    if (!this.active || !owns()) return Promise.reject(new Error('Query artifact ownership lost'));
    if (['error-reverted', 'uncertain', 'conflict'].includes(this.state.phase))
      return Promise.reject(new Error('Reconcile saved work before making another change'));
    return new Promise<void>((resolve, reject) => {
      const command = { label, owns, run, project, matches, resolve, reject };
      this.queue.push(command);
      this.set({
        ...this.state,
        phase: this.draining ? this.state.phase : 'queued',
        queued: this.queue.length,
      });
      void this.load().then(
        () => this.ensureDrain(),
        (cause) => {
          const index = this.queue.indexOf(command);
          if (index >= 0) this.queue.splice(index, 1);
          this.set({ ...this.state, phase: 'confirmed', queued: this.queue.length });
          reject(cause);
        },
      );
    });
  }

  private ensureDrain(): Promise<void> {
    if (this.draining) return this.draining;
    if (this.state.readiness.phase !== 'ready') return Promise.resolve();
    const lifecycle = this.lifecycle;
    const draining = this.drain(lifecycle).finally(() => {
      if (this.owns(lifecycle) && this.draining === draining) this.draining = undefined;
    });
    this.draining = draining;
    return draining;
  }

  private async drain(lifecycle: number): Promise<void> {
    while (this.owns(lifecycle) && this.queue.length) {
      const command = this.queue.shift()!;
      if (!command.owns()) {
        command.reject(new Error('Query artifact command lost engine ownership'));
        this.set({
          ...this.state,
          phase:
            this.queue.length > 0
              ? 'queued'
              : this.state.phase === 'queued'
                ? 'confirmed'
                : this.state.phase,
          active: undefined,
          queued: this.queue.length,
        });
        continue;
      }
      const before = this.collections();
      this.activeCommand = command;
      this.set({
        ...this.state,
        phase: 'updating',
        active: command.label,
        queued: this.queue.length,
      });
      let result: unknown;
      try {
        result = await command.run();
      } catch (cause) {
        if (!this.owns(lifecycle) || !command.owns()) {
          command.reject(new Error('Query artifact command lost engine ownership'));
          this.clearActive(command);
          if (this.owns(lifecycle))
            this.set({
              ...this.state,
              ...before,
              phase: this.queue.length ? 'queued' : 'confirmed',
              active: undefined,
              queued: this.queue.length,
            });
          continue;
        }
        const ambiguous = isAmbiguousRemoteError(cause);
        if (ambiguous) {
          let exposedCause = cause;
          this.failed = { command, before };
          try {
            const token = this.beginRead();
            const remote = await this.readAuthority();
            if (!this.owns(lifecycle) || !command.owns()) {
              command.reject(new Error('Query artifact command lost engine ownership'));
              this.clearActive(command);
              if (this.owns(lifecycle))
                this.set({
                  ...this.state,
                  ...before,
                  phase: this.queue.length ? 'queued' : 'confirmed',
                  active: undefined,
                  queued: this.queue.length,
                });
              continue;
            }
            if (token !== this.latestReadStarted)
              throw new Error('Stale ambiguous authority confirmation ignored');
            this.commit(remote, token);
            if (command.matches(remote, before)) {
              this.failed = undefined;
              this.set({ ...this.state, phase: 'success', active: undefined, error: undefined });
              command.resolve();
              this.clearActive(command);
              continue;
            }
            const rollbackUnknown = /rollback outcome unknown/i.test(message(cause));
            this.enterBlocked({
              ...this.state,
              phase: rollbackUnknown ? 'uncertain' : 'error-reverted',
              active: undefined,
              failedCommand: command.label,
              error: message(cause),
            });
            command.reject(cause);
            this.clearActive(command);
            return;
          } catch (readCause) {
            exposedCause = readCause;
          }
          const stale = /stale ambiguous authority confirmation/i.test(message(exposedCause));
          this.enterBlocked({
            ...this.state,
            ...(stale ? {} : before),
            phase: 'uncertain',
            active: undefined,
            failedCommand: command.label,
            error: message(exposedCause),
          });
          command.reject(exposedCause);
          this.clearActive(command);
          return;
        }
        this.failed = { command, before };
        this.enterBlocked({
          ...this.state,
          ...before,
          phase: 'error-reverted',
          active: undefined,
          failedCommand: command.label,
          error: message(cause),
        });
        command.reject(cause);
        this.clearActive(command);
        return;
      }
      if (!this.owns(lifecycle) || !command.owns()) {
        command.reject(new Error('Query artifact command lost engine ownership'));
        this.clearActive(command);
        if (this.owns(lifecycle))
          this.set({
            ...this.state,
            ...before,
            phase: this.queue.length ? 'queued' : 'confirmed',
            active: undefined,
            queued: this.queue.length,
          });
        continue;
      }
      try {
        const token = this.beginRead();
        const remote = await this.readAuthority();
        if (!this.owns(lifecycle) || !command.owns()) throw new Error('ownership lost');
        if (token !== this.latestReadStarted)
          throw new Error('Stale normal authority confirmation ignored');
        this.commit(remote, token);
        if (!command.matches(remote, before, result)) {
          const mismatch = new Error('Engine confirmation mismatch');
          this.failed = { command, before, result };
          this.enterBlocked({
            ...this.state,
            phase: 'conflict',
            active: undefined,
            failedCommand: command.label,
            error: mismatch.message,
          });
          command.reject(mismatch);
          this.clearActive(command);
          return;
        }
        this.failed = undefined;
        this.set({ ...this.state, phase: 'success', active: undefined, error: undefined });
        command.resolve();
      } catch (cause) {
        if (!this.owns(lifecycle) || !command.owns()) {
          command.reject(new Error('Query artifact command lost engine ownership'));
          this.clearActive(command);
          if (this.owns(lifecycle))
            this.set({
              ...this.state,
              ...before,
              phase: this.queue.length ? 'queued' : 'confirmed',
              active: undefined,
              queued: this.queue.length,
            });
          continue;
        }
        this.failed = { command, before, result };
        const stale = /stale normal authority confirmation/i.test(message(cause));
        this.enterBlocked({
          ...this.state,
          ...(stale ? {} : command.project(before, result)),
          phase: 'uncertain',
          active: undefined,
          failedCommand: command.label,
          error: message(cause),
        });
        command.reject(cause);
        this.clearActive(command);
        return;
      }
      this.clearActive(command);
    }
    if (this.owns(lifecycle) && !this.queue.length && this.state.phase === 'queued')
      this.set({ ...this.state, phase: 'confirmed', queued: 0 });
  }

  private beginRead(): number {
    const token = ++this.authoritySequence;
    this.latestReadStarted = token;
    return token;
  }

  private clearActive(command: Command): void {
    if (this.activeCommand === command) this.activeCommand = undefined;
  }

  private async readAuthority(): Promise<QueryArtifacts> {
    const [bookmarks, snapshots] = await Promise.all([
      this.engine.ops.bookmarks.list(),
      this.engine.ops.snapshots.list(),
    ]);
    return { bookmarks, snapshots };
  }

  private collections(): QueryArtifacts {
    return copy(this.state);
  }

  private commit(value: QueryArtifacts, token: number): void {
    if (token < this.committedAuthority || token < this.latestReadStarted) return;
    this.committedAuthority = token;
    this.set({ ...this.state, ...copy(value), readiness: { phase: 'ready' } });
  }

  private owns(lifecycle: number): boolean {
    return this.active && lifecycle === this.lifecycle;
  }

  private set(value: QueryArtifactCollectionsSnapshot): void {
    this.state = value;
    this.listeners.forEach((listener) => listener());
  }
}

const normalizeBookmarkInput = (input: OperationBookmarkInput) => ({
  name: input.name.trim(),
  agentId: input.agentId,
  oid: input.oid.trim(),
  operation: input.operation,
});
const normalizeBookmark = (item: OperationBookmark) => normalizeBookmarkInput(item);
const normalizeSnapshotInput = (input: WalkSnapshotInput) => ({
  name: input.name.trim(),
  agentName: input.agentName.trim() || 'Unknown agent',
  baseOid: input.baseOid.trim(),
  resultCount: input.results.length,
});
const normalizeSnapshot = (item: WalkSnapshotSummary) => ({
  name: item.name,
  agentName: item.agentName,
  baseOid: item.baseOid,
  resultCount: item.resultCount,
});
function multiplicity<T, S>(items: T[], semantic: S, normalize: (item: T) => S): number {
  const expected = JSON.stringify(semantic);
  return items.filter((item) => JSON.stringify(normalize(item)) === expected).length;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  return value;
}

interface RegistryEntry {
  controller: QueryArtifactCollectionsController;
  owns: () => boolean;
}
const registry = new WeakMap<EngineAPI, RegistryEntry>();
export function queryArtifactCollectionsController(
  engine: EngineAPI,
  owns: () => boolean = () => true,
): QueryArtifactCollectionsController {
  let entry = registry.get(engine);
  if (!entry) {
    entry = { controller: new QueryArtifactCollectionsController(engine), owns };
    registry.set(engine, entry);
  }
  entry.owns = owns;
  if (owns()) entry.controller.activate();
  return entry.controller;
}
export function disposeQueryArtifactCollectionsController(engine: EngineAPI): void {
  registry.get(engine)?.controller.dispose();
}
