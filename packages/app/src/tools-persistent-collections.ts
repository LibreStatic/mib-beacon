import type {
  EngineAPI,
  PollChart,
  PollSeries,
  PollSeriesDraft,
  PollWatch,
} from '@mibbeacon/core/client';
import { isAmbiguousRemoteError } from './live-mib-settings-transaction';

export type ToolsCollectionPhase =
  'confirmed' | 'queued' | 'updating' | 'success' | 'error-reverted' | 'uncertain' | 'conflict';

export interface ToolsCollections {
  polls: PollSeries[];
  watches: PollWatch[];
  charts: PollChart[];
}

export interface ToolsPersistentCollectionsSnapshot extends ToolsCollections {
  readiness: { phase: 'unloaded' | 'loading' | 'ready' } | { phase: 'error'; error: string };
  phase: ToolsCollectionPhase;
  queued: number;
  active?: string;
  failedCommand?: string;
  error?: string;
  remote?: ToolsCollections;
}

export function toolsCollectionStatusText(snapshot: ToolsPersistentCollectionsSnapshot): string {
  if (snapshot.readiness.phase === 'loading')
    return 'Loading confirmed polls, watches, and charts…';
  if (snapshot.readiness.phase === 'error') return snapshot.readiness.error;
  if (snapshot.phase === 'queued') return `${snapshot.queued} saved change(s) queued`;
  if (snapshot.phase === 'updating')
    return `Updating ${snapshot.active ?? 'saved tools'}… · ${snapshot.queued} queued`;
  if (snapshot.phase === 'success') return 'Saved and confirmed by the engine';
  return snapshot.error ?? snapshot.phase;
}

type Origin = 'load' | 'refresh' | 'event' | 'mutation' | 'reconcile';
type Command = {
  label: string;
  owns: () => boolean;
  run: () => Promise<unknown>;
  project: (before: ToolsCollections, result?: unknown) => ToolsCollections;
  matches: (remote: ToolsCollections, before: ToolsCollections, result?: unknown) => boolean;
  resolve: () => void;
  reject: (cause: unknown) => void;
};

const empty = (): ToolsCollections => ({ polls: [], watches: [], charts: [] });
const copy = (value: ToolsCollections): ToolsCollections => ({
  polls: [...value.polls],
  watches: [...value.watches],
  charts: [...value.charts],
});
const equal = (left: ToolsCollections, right: ToolsCollections) =>
  JSON.stringify(left) === JSON.stringify(right);
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** One serialization and authority boundary for persistent polling, watch, and chart lists. */
export class ToolsPersistentCollectionsController {
  private state: ToolsPersistentCollectionsSnapshot = {
    ...empty(),
    readiness: { phase: 'unloaded' },
    phase: 'confirmed',
    queued: 0,
  };
  private readonly queue: Command[] = [];
  private readonly listeners = new Set<() => void>();
  private loadPromise?: Promise<ToolsCollections>;
  private draining?: Promise<void>;
  private failed?: { command: Omit<Command, 'resolve' | 'reject'>; before: ToolsCollections };
  private lifecycle = 0;
  private active = true;
  private authoritySequence = 0;
  private committedAuthority = 0;
  private pendingAuthority?: { value: ToolsCollections; token: number; origin: Origin };
  private activeCommand?: Command;

  constructor(
    private readonly engine: EngineAPI,
    private readonly sink?: (collections: ToolsCollections) => void,
  ) {}

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycle += 1;
    this.loadPromise = undefined;
    this.draining = undefined;
    this.failed = undefined;
    this.pendingAuthority = undefined;
    this.authoritySequence = 0;
    this.committedAuthority = 0;
    this.state = {
      ...empty(),
      readiness: { phase: 'unloaded' },
      phase: 'confirmed',
      queued: 0,
    };
  }

  snapshot(): ToolsPersistentCollectionsSnapshot {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  statusFor(label: string): 'queued' | 'updating' | undefined {
    if (this.state.phase === 'updating' && this.state.active === label) return 'updating';
    return this.queue.some((command) => command.label === label) ? 'queued' : undefined;
  }

  beginAuthorityRead(): number {
    return ++this.authoritySequence;
  }

  load(): Promise<ToolsCollections> {
    if (!this.active) return Promise.resolve(this.collections());
    if (this.state.readiness.phase === 'ready') return Promise.resolve(this.collections());
    if (this.loadPromise) return this.loadPromise;
    const lifecycle = this.lifecycle;
    const token = this.beginAuthorityRead();
    this.set({ ...this.state, readiness: { phase: 'loading' } });
    const loading = this.readAuthority()
      .then((value) => {
        if (!this.owns(lifecycle)) return value;
        this.commit(value, token);
        this.set({ ...this.state, readiness: { phase: 'ready' } });
        void this.ensureDrain();
        return value;
      })
      .catch((cause) => {
        if (this.owns(lifecycle))
          this.set({ ...this.state, readiness: { phase: 'error', error: message(cause) } });
        throw cause;
      })
      .finally(() => {
        if (this.owns(lifecycle) && this.loadPromise === loading) this.loadPromise = undefined;
      });
    this.loadPromise = loading;
    return loading;
  }

  async refresh(
    origin: Extract<Origin, 'refresh' | 'event'> = 'refresh',
    accepts: () => boolean = () => true,
  ): Promise<ToolsCollections> {
    if (!this.active) return this.collections();
    const lifecycle = this.lifecycle;
    const token = this.beginAuthorityRead();
    const initial = this.state.readiness.phase !== 'ready';
    if (initial) this.set({ ...this.state, readiness: { phase: 'loading' } });
    try {
      const value = await this.readAuthority();
      if (this.owns(lifecycle) && accepts()) this.applyAuthority(value, origin, token);
      return this.collections();
    } catch (cause) {
      if (initial && this.owns(lifecycle) && accepts())
        this.set({ ...this.state, readiness: { phase: 'error', error: message(cause) } });
      throw cause;
    }
  }

  applyAuthority(value: ToolsCollections, origin: Origin, token = ++this.authoritySequence): void {
    if (!this.active || token < this.committedAuthority) return;
    if (this.draining || this.state.phase === 'updating') {
      if (!this.pendingAuthority || token > this.pendingAuthority.token)
        this.pendingAuthority = { value: copy(value), token, origin };
      return;
    }
    this.commit(value, token);
    if (['error-reverted', 'uncertain', 'conflict'].includes(this.state.phase)) {
      this.set({ ...this.state, readiness: { phase: 'ready' } });
      return;
    }
    this.set({
      ...this.state,
      readiness: { phase: 'ready' },
      phase: this.queue.length ? 'queued' : 'confirmed',
      queued: this.queue.length,
      error: undefined,
      remote: undefined,
      failedCommand: undefined,
    });
    if (this.queue.length) void this.ensureDrain();
  }

  createPoll(draft: PollSeriesDraft, owns: () => boolean = () => true): Promise<void> {
    return this.enqueue(
      'poll:create',
      owns,
      () => this.engine.tools.polls.create(draft),
      (before, result) => ({
        ...before,
        polls: result ? [...before.polls, result as PollSeries] : before.polls,
      }),
      false,
      (remote, before) =>
        semanticMultiplicity(remote.polls, normalizePollCreate(draft), normalizePollSeries) >
        semanticMultiplicity(before.polls, normalizePollCreate(draft), normalizePollSeries),
    );
  }

  updatePoll(
    id: string,
    patch: Partial<PollSeriesDraft>,
    owns: () => boolean = () => true,
  ): Promise<void> {
    return this.enqueue(
      `poll:update:${id}`,
      owns,
      () => this.engine.tools.polls.update(id, patch),
      (before, result) => ({
        ...before,
        polls: before.polls.map((item) =>
          item.id === id ? ((result as PollSeries | undefined) ?? { ...item, ...patch }) : item,
        ),
      }),
      false,
      (remote) => {
        const item = remote.polls.find((candidate) => candidate.id === id);
        return Boolean(item && pollPatchMatches(item, patch));
      },
    );
  }

  removePoll(id: string, owns: () => boolean = () => true): Promise<void> {
    return this.enqueue(
      `poll:remove:${id}`,
      owns,
      () => this.engine.tools.polls.remove(id),
      (before) => ({
        ...before,
        polls: before.polls.filter((item) => item.id !== id),
      }),
      false,
      (remote) => !remote.polls.some((item) => item.id === id),
    );
  }

  saveWatch(
    input: Parameters<EngineAPI['tools']['watches']['save']>[0],
    owns: () => boolean = () => true,
  ): Promise<void> {
    return this.enqueue(
      `watch:save:${input.id ?? input.name}`,
      owns,
      () => this.engine.tools.watches.save(input),
      (before, result) => ({
        ...before,
        watches: result
          ? [
              ...before.watches.filter((item) => item.id !== (result as PollWatch).id),
              result as PollWatch,
            ]
          : before.watches,
      }),
      false,
      (remote, before) =>
        input.id
          ? remote.watches.some(
              (item) =>
                item.id === input.id &&
                semanticEqual(normalizeWatch(item), normalizeWatchInput(input)),
            )
          : semanticMultiplicity(remote.watches, normalizeWatchInput(input), normalizeWatch) >
            semanticMultiplicity(before.watches, normalizeWatchInput(input), normalizeWatch),
    );
  }

  removeWatch(id: string, owns: () => boolean = () => true): Promise<void> {
    return this.enqueue(
      `watch:remove:${id}`,
      owns,
      () => this.engine.tools.watches.remove(id),
      (before) => ({
        ...before,
        watches: before.watches.filter((item) => item.id !== id),
      }),
      false,
      (remote) => !remote.watches.some((item) => item.id === id),
    );
  }

  saveChart(
    input: Parameters<EngineAPI['tools']['charts']['save']>[0],
    owns: () => boolean = () => true,
  ): Promise<void> {
    return this.enqueue(
      `chart:save:${input.id ?? input.name}`,
      owns,
      () => this.engine.tools.charts.save(input),
      (before, result) => ({
        ...before,
        charts: result
          ? [
              ...before.charts.filter((item) => item.id !== (result as PollChart).id),
              result as PollChart,
            ]
          : before.charts,
      }),
      false,
      (remote, before) =>
        input.id
          ? remote.charts.some(
              (item) =>
                item.id === input.id &&
                semanticEqual(normalizeChart(item), normalizeChartInput(input)),
            )
          : semanticMultiplicity(remote.charts, normalizeChartInput(input), normalizeChart) >
            semanticMultiplicity(before.charts, normalizeChartInput(input), normalizeChart),
    );
  }

  removeChart(id: string, owns: () => boolean = () => true): Promise<void> {
    return this.enqueue(
      `chart:remove:${id}`,
      owns,
      () => this.engine.tools.charts.remove(id),
      (before) => ({
        ...before,
        charts: before.charts.filter((item) => item.id !== id),
      }),
      false,
      (remote) => !remote.charts.some((item) => item.id === id),
    );
  }

  acknowledge(): void {
    if (!['error-reverted', 'conflict'].includes(this.state.phase)) return;
    this.failed = undefined;
    this.set({
      ...this.state,
      phase: this.queue.length ? 'queued' : 'confirmed',
      error: undefined,
      remote: undefined,
      failedCommand: undefined,
    });
    void this.ensureDrain();
  }

  retryFailed(): Promise<void> {
    if (!this.failed || this.state.phase !== 'error-reverted') return Promise.resolve();
    const failed = this.failed.command;
    this.failed = undefined;
    this.set({ ...this.state, phase: 'confirmed', error: undefined, failedCommand: undefined });
    return this.enqueue(
      failed.label,
      failed.owns,
      failed.run,
      failed.project,
      true,
      failed.matches,
    );
  }

  async reconcile(): Promise<void> {
    if (!this.active) return;
    const lifecycle = this.lifecycle;
    const token = this.beginAuthorityRead();
    try {
      const remote = await this.readAuthority();
      if (!this.owns(lifecycle)) return;
      if (token < this.committedAuthority) return;
      const failed = this.failed;
      if (failed && !failed.command.matches(remote, failed.before)) {
        this.commit(remote, token);
        const conflict = new Error(
          `Remote authority does not contain the expected result of ${failed.command.label}`,
        );
        this.set({
          ...this.state,
          phase: 'conflict',
          failedCommand: failed.command.label,
          error: message(conflict),
          remote,
        });
        throw conflict;
      }
      this.pendingAuthority = undefined;
      this.commit(remote, token);
      this.failed = undefined;
      this.set({
        ...this.state,
        readiness: { phase: 'ready' },
        phase: 'success',
        error: undefined,
        remote: undefined,
        failedCommand: undefined,
      });
      void this.ensureDrain();
    } catch (cause) {
      if (this.owns(lifecycle) && this.state.phase !== 'conflict')
        this.set({ ...this.state, phase: 'uncertain', error: message(cause) });
      throw cause;
    }
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
    this.listeners.clear();
    this.pendingAuthority = undefined;
    const error = new Error('Tools collections controller was disposed');
    this.activeCommand?.reject(error);
    this.activeCommand = undefined;
    this.queue.splice(0).forEach((command) => command.reject(error));
  }

  private enqueue(
    label: string,
    owns: () => boolean,
    run: () => Promise<unknown>,
    project: (before: ToolsCollections, result?: unknown) => ToolsCollections,
    prepend = false,
    matches: (remote: ToolsCollections, before: ToolsCollections, result?: unknown) => boolean = (
      remote,
      before,
      result,
    ) => equal(project(before, result), remote),
  ): Promise<void> {
    if (!this.active) return Promise.reject(new Error('Tools collections controller was disposed'));
    const promise = new Promise<void>((resolve, reject) => {
      const command = { label, owns, run, project, matches, resolve, reject };
      if (prepend) this.queue.unshift(command);
      else this.queue.push(command);
    });
    const blocked = ['error-reverted', 'uncertain', 'conflict'].includes(this.state.phase);
    this.set({
      ...this.state,
      phase: blocked ? this.state.phase : this.state.phase === 'updating' ? 'updating' : 'queued',
      queued: this.queue.length,
    });
    void this.load().catch(() => undefined);
    if (this.state.readiness.phase === 'ready') void this.ensureDrain();
    return promise;
  }

  private ensureDrain(): Promise<void> {
    if (!this.active || this.draining || this.state.readiness.phase !== 'ready')
      return this.draining ?? Promise.resolve();
    if (['error-reverted', 'uncertain', 'conflict'].includes(this.state.phase))
      return Promise.resolve();
    const lifecycle = this.lifecycle;
    const draining = this.drain(lifecycle).finally(() => {
      if (this.owns(lifecycle) && this.draining === draining) {
        this.draining = undefined;
        this.consumePendingAuthority();
        if (this.queue.length) void this.ensureDrain();
      }
    });
    this.draining = draining;
    return draining;
  }

  private async drain(lifecycle: number): Promise<void> {
    while (this.owns(lifecycle) && this.queue.length) {
      const command = this.queue.shift()!;
      this.activeCommand = command;
      const stablePhase = this.state.phase === 'success' ? 'success' : 'confirmed';
      if (!command.owns()) {
        this.activeCommand = undefined;
        this.set({
          ...this.state,
          phase: this.queue.length ? 'queued' : stablePhase,
          active: undefined,
          queued: this.queue.length,
        });
        command.reject(new Error('Tools collection command lost engine ownership'));
        continue;
      }
      // A mutation starts a new causal epoch. Reads that began before this
      // barrier cannot become authority if they complete during or after it.
      this.committedAuthority = Math.max(this.committedAuthority, this.beginAuthorityRead());
      const before = this.collections();
      this.set({
        ...this.state,
        phase: 'updating',
        active: command.label,
        queued: this.queue.length,
        error: undefined,
        remote: undefined,
      });
      try {
        await command.run();
      } catch (cause) {
        if (!this.owns(lifecycle) || !command.owns()) {
          this.activeCommand = undefined;
          if (this.owns(lifecycle))
            this.set({
              ...this.state,
              ...before,
              phase: this.queue.length ? 'queued' : stablePhase,
              active: undefined,
              queued: this.queue.length,
            });
          command.reject(new Error('Tools collections controller was disposed or lost ownership'));
          continue;
        }
        if (isAmbiguousRemoteError(cause)) {
          try {
            const token = this.beginAuthorityRead();
            const remote = await this.readAuthority();
            if (!this.owns(lifecycle) || !command.owns()) {
              this.activeCommand = undefined;
              if (this.owns(lifecycle))
                this.set({
                  ...this.state,
                  ...before,
                  phase: this.queue.length ? 'queued' : stablePhase,
                  active: undefined,
                  queued: this.queue.length,
                });
              command.reject(
                new Error('Tools collections controller was disposed or lost ownership'),
              );
              continue;
            }
            this.commit(remote, token);
            if (command.matches(remote, before)) {
              this.consumePendingAuthority();
              this.set({
                ...this.state,
                phase: 'success',
                active: undefined,
                failedCommand: undefined,
              });
              this.activeCommand = undefined;
              command.resolve();
              continue;
            }
            this.failed = { command, before };
            this.activeCommand = undefined;
            this.set({
              ...this.state,
              phase: 'conflict',
              active: undefined,
              failedCommand: command.label,
              error: message(cause),
              remote,
            });
            command.reject(cause);
            return;
          } catch (readCause) {
            this.failed = { command, before };
            this.activeCommand = undefined;
            this.set({
              ...this.state,
              phase: 'uncertain',
              active: undefined,
              failedCommand: command.label,
              error: message(readCause),
            });
            command.reject(readCause);
            return;
          }
        }
        this.failed = { command, before };
        this.activeCommand = undefined;
        this.set({
          ...this.state,
          ...before,
          phase: 'error-reverted',
          active: undefined,
          failedCommand: command.label,
          error: message(cause),
        });
        this.consumePendingAuthority();
        command.reject(cause);
        return;
      }
      if (!this.owns(lifecycle) || !command.owns()) {
        this.activeCommand = undefined;
        if (this.owns(lifecycle))
          this.set({
            ...this.state,
            ...before,
            phase: this.queue.length ? 'queued' : stablePhase,
            active: undefined,
            queued: this.queue.length,
          });
        command.reject(new Error('Tools collections controller was disposed or lost ownership'));
        continue;
      }
      try {
        const token = this.beginAuthorityRead();
        const remote = await this.readAuthority();
        if (!this.owns(lifecycle) || !command.owns()) {
          this.activeCommand = undefined;
          if (this.owns(lifecycle))
            this.set({
              ...this.state,
              ...before,
              phase: this.queue.length ? 'queued' : stablePhase,
              active: undefined,
              queued: this.queue.length,
            });
          command.reject(new Error('Tools collections controller was disposed or lost ownership'));
          continue;
        }
        this.commit(remote, token);
        this.consumePendingAuthority();
        this.set({
          ...this.state,
          phase: 'success',
          active: undefined,
          failedCommand: undefined,
          remote: undefined,
          error: undefined,
        });
        this.activeCommand = undefined;
        command.resolve();
      } catch (cause) {
        this.failed = { command, before };
        this.activeCommand = undefined;
        this.set({
          ...this.state,
          ...before,
          phase: 'uncertain',
          active: undefined,
          failedCommand: command.label,
          error: message(cause),
        });
        command.reject(cause);
        return;
      }
    }
    if (
      this.owns(lifecycle) &&
      !this.queue.length &&
      !['uncertain', 'conflict', 'error-reverted'].includes(this.state.phase)
    )
      this.set({ ...this.state, active: undefined, queued: 0 });
  }

  private async readAuthority(): Promise<ToolsCollections> {
    const [polls, watches, charts] = await Promise.all([
      this.engine.tools.polls.list(),
      this.engine.tools.watches.list(),
      this.engine.tools.charts.list(),
    ]);
    return { polls, watches, charts };
  }

  private collections(): ToolsCollections {
    return { polls: this.state.polls, watches: this.state.watches, charts: this.state.charts };
  }

  private commit(value: ToolsCollections, token: number): void {
    if (token < this.committedAuthority) return;
    this.committedAuthority = token;
    const next = copy(value);
    this.set({ ...this.state, ...next });
    this.sink?.(next);
  }

  private consumePendingAuthority(): void {
    const pending = this.pendingAuthority;
    this.pendingAuthority = undefined;
    if (pending && pending.token > this.committedAuthority)
      this.commit(pending.value, pending.token);
  }

  private owns(lifecycle: number): boolean {
    return this.active && this.lifecycle === lifecycle;
  }

  private set(next: ToolsPersistentCollectionsSnapshot): void {
    if (!this.active) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}

type PollSemantic = Pick<
  PollSeries,
  'name' | 'agentId' | 'oid' | 'intervalMs' | 'mode' | 'counterBits' | 'retention' | 'paused'
>;

function normalizePollSeries(item: PollSeries): PollSemantic {
  return {
    name: item.name.trim(),
    agentId: item.agentId,
    oid: normalizePollOid(item.oid),
    intervalMs: Math.trunc(item.intervalMs),
    mode: item.mode,
    counterBits: item.counterBits,
    retention: boundedPollRetention(item.retention),
    paused: Boolean(item.paused),
  };
}

function normalizePollCreate(draft: PollSeriesDraft): PollSemantic {
  return {
    name: draft.name.trim(),
    agentId: draft.agentId,
    oid: normalizePollOid(draft.oid),
    intervalMs: Math.trunc(draft.intervalMs),
    mode: draft.mode,
    counterBits: draft.counterBits ?? 64,
    retention: boundedPollRetention(draft.retention),
    paused: Boolean(draft.paused),
  };
}

function pollPatchMatches(item: PollSeries, patch: Partial<PollSeriesDraft>): boolean {
  const normalized = normalizePollSeries(item);
  const intended: Partial<PollSemantic> = {};
  if (patch.name !== undefined) intended.name = patch.name.trim();
  if (patch.agentId !== undefined) intended.agentId = patch.agentId;
  if (patch.oid !== undefined) intended.oid = normalizePollOid(patch.oid);
  if (patch.intervalMs !== undefined) intended.intervalMs = Math.trunc(patch.intervalMs);
  if (patch.mode !== undefined) intended.mode = patch.mode;
  if (patch.counterBits !== undefined) intended.counterBits = patch.counterBits;
  if (patch.retention !== undefined) intended.retention = boundedPollRetention(patch.retention);
  if (patch.paused !== undefined) intended.paused = Boolean(patch.paused);
  return Object.entries(intended).every(
    ([key, value]) => normalized[key as keyof PollSemantic] === value,
  );
}

function normalizePollOid(oid: string): string {
  return oid.trim().replace(/^\./, '');
}

function boundedPollRetention(value?: number): number {
  return Math.max(10, Math.min(100_000, Math.trunc(value ?? 10_000)));
}

type WatchSemantic = Pick<
  PollWatch,
  'seriesId' | 'name' | 'operator' | 'threshold' | 'thresholdMode'
>;

function normalizeWatch(item: PollWatch): WatchSemantic {
  return {
    seriesId: item.seriesId,
    name: item.name.trim(),
    operator: item.operator,
    threshold: item.threshold,
    thresholdMode: item.thresholdMode,
  };
}

function normalizeWatchInput(
  input: Parameters<EngineAPI['tools']['watches']['save']>[0],
): WatchSemantic {
  return {
    seriesId: input.seriesId,
    name: input.name.trim(),
    operator: input.operator,
    threshold: input.threshold,
    thresholdMode: input.thresholdMode,
  };
}

type ChartSemantic = Pick<
  PollChart,
  'name' | 'seriesIds' | 'hiddenSeriesIds' | 'hiddenPatternSessionIds'
>;

function normalizeChart(item: PollChart): ChartSemantic {
  return {
    name: item.name.trim(),
    seriesIds: [...new Set(item.seriesIds)],
    hiddenSeriesIds: item.hiddenSeriesIds ?? [],
    hiddenPatternSessionIds: [...new Set(item.hiddenPatternSessionIds ?? [])],
  };
}

function normalizeChartInput(
  input: Parameters<EngineAPI['tools']['charts']['save']>[0],
): ChartSemantic {
  return {
    name: input.name.trim(),
    seriesIds: [...new Set(input.seriesIds)],
    hiddenSeriesIds: input.hiddenSeriesIds ?? [],
    hiddenPatternSessionIds: [...new Set(input.hiddenPatternSessionIds ?? [])],
  };
}

function semanticMultiplicity<T, S>(items: T[], expected: S, normalize: (item: T) => S): number {
  return items.filter((item) => semanticEqual(normalize(item), expected)).length;
}

function semanticEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface ControllerEntry {
  controller: ToolsPersistentCollectionsController;
  owns: () => boolean;
}
const controllers = new WeakMap<EngineAPI, ControllerEntry>();

export function toolsPersistentCollectionsController(
  engine: EngineAPI,
  owns: () => boolean = () => true,
): ToolsPersistentCollectionsController {
  let entry = controllers.get(engine);
  if (!entry) {
    entry = { owns, controller: new ToolsPersistentCollectionsController(engine) };
    controllers.set(engine, entry);
  }
  entry.owns = owns;
  if (owns()) entry.controller.activate();
  return entry.controller;
}

export function disposeToolsPersistentCollectionsController(engine: EngineAPI): void {
  controllers.get(engine)?.controller.dispose();
}
