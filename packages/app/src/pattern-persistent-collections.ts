import type {
  EngineAPI,
  PatternTraceEvent,
  PatternTraceSession,
  PatternTraceStartResult,
} from '@mibbeacon/core/client';
import { isAmbiguousRemoteError } from './live-mib-settings-transaction';

export type PatternCollectionPhase =
  'confirmed' | 'queued' | 'updating' | 'success' | 'error-reverted' | 'uncertain' | 'conflict';

export interface PatternPersistentCollectionsSnapshot {
  sessions: PatternTraceSession[];
  events: Record<string, PatternTraceEvent[]>;
  readiness: { phase: 'unloaded' | 'loading' | 'ready' } | { phase: 'error'; error: string };
  phase: PatternCollectionPhase;
  queued: number;
  active?: string;
  error?: string;
}

type Authority = Pick<PatternPersistentCollectionsSnapshot, 'sessions' | 'events'>;
type Command<T> = {
  lifecycle: number;
  key: string;
  label: string;
  owns: () => boolean;
  run: () => Promise<T>;
  matches: (authority: Authority, result?: T) => T | undefined;
  voidResult: boolean;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
};

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};

/** Retained per-engine authority and FIFO transaction boundary for pattern trace persistence. */
export class PatternPersistentCollectionsController {
  private state: PatternPersistentCollectionsSnapshot = {
    sessions: [],
    events: {},
    readiness: { phase: 'unloaded' },
    phase: 'confirmed',
    queued: 0,
  };
  private readonly listeners = new Set<() => void>();
  private readonly queue: Command<unknown>[] = [];
  private readonly admitted = new Map<string, Promise<unknown>>();
  private loadPromise?: Promise<Authority>;
  private draining?: Promise<void>;
  private activeCommand?: Command<unknown>;
  private failed?: { command: Command<unknown>; result?: unknown };
  private active = true;
  private lifecycle = 0;
  private readSequence = 0;
  private committedRead = 0;
  private latestAuthorityRead = 0;

  constructor(
    private readonly engine: EngineAPI,
    private readonly requestId: () => string = () =>
      `pattern-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  ) {}

  snapshot(): PatternPersistentCollectionsSnapshot {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycle += 1;
    this.loadPromise = undefined;
    this.draining = undefined;
    this.activeCommand = undefined;
    this.failed = undefined;
    this.state = {
      sessions: [],
      events: {},
      readiness: { phase: 'unloaded' },
      phase: 'confirmed',
      queued: 0,
    };
  }

  load(): Promise<Authority> {
    if (!this.active) return Promise.reject(new Error('Pattern controller was disposed'));
    if (this.state.readiness.phase === 'ready') return Promise.resolve(this.authority());
    if (this.loadPromise) return this.loadPromise;
    const lifecycle = this.lifecycle;
    const token = ++this.readSequence;
    this.latestAuthorityRead = token;
    this.set({ ...this.state, readiness: { phase: 'loading' } });
    const promise = this.readAuthority()
      .then((authority) => {
        if (
          this.owns(lifecycle) &&
          token === this.latestAuthorityRead &&
          token >= this.committedRead
        ) {
          this.commit(authority, token);
          this.set({ ...this.state, readiness: { phase: 'ready' } });
          void this.ensureDrain();
        }
        return authority;
      })
      .catch((cause) => {
        if (
          this.owns(lifecycle) &&
          token === this.latestAuthorityRead &&
          token >= this.committedRead
        )
          this.set({ ...this.state, readiness: { phase: 'error', error: errorMessage(cause) } });
        throw cause;
      })
      .finally(() => {
        if (this.loadPromise === promise) this.loadPromise = undefined;
      });
    this.loadPromise = promise;
    return promise;
  }

  async refresh(accepts: () => boolean = () => true): Promise<void> {
    if (!this.active) return;
    const lifecycle = this.lifecycle;
    const token = ++this.readSequence;
    this.latestAuthorityRead = token;
    const authority = await this.readAuthority();
    if (
      !this.owns(lifecycle) ||
      !accepts() ||
      token !== this.latestAuthorityRead ||
      token < this.committedRead
    )
      return;
    if (this.draining) return;
    this.commit(authority, token);
    this.set({ ...this.state, readiness: { phase: 'ready' } });
    void this.ensureDrain();
  }

  start(
    input: Omit<Parameters<EngineAPI['tools']['patterns']['start']>[0], 'requestId'>,
    owns: () => boolean = () => true,
  ): Promise<PatternTraceStartResult> {
    const key = `start:${canonical(input)}`;
    return this.enqueue(
      key,
      'pattern:start',
      owns,
      (requestId) => this.engine.tools.patterns.start({ ...input, requestId }),
      (authority, requestId, result) => {
        const session = authority.sessions.find((item) => item.requestId === requestId);
        if (session?.status !== 'running' || !session.operationHandleId) return undefined;
        return result ?? { handleId: session.operationHandleId, sessionId: session.id };
      },
    );
  }

  annotate(
    input: Omit<Parameters<EngineAPI['tools']['patterns']['annotate']>[0], 'requestId'>,
    owns: () => boolean = () => true,
  ): Promise<PatternTraceSession> {
    return this.enqueue(
      `annotate:${canonical(input)}`,
      'pattern:annotate',
      owns,
      (requestId) => this.engine.tools.patterns.annotate({ ...input, requestId }),
      (authority, requestId) => authority.sessions.find((item) => item.requestId === requestId),
    );
  }

  cancel(handleId: string, owns: () => boolean = () => true): Promise<void> {
    return this.enqueue(
      `cancel:${handleId}`,
      'pattern:cancel',
      owns,
      async () => this.engine.tools.patterns.cancel(handleId),
      (authority) => {
        const target = authority.sessions.find((item) => item.operationHandleId === handleId);
        return (!target || target.status !== 'running') as never;
      },
      true,
    );
  }

  remove(sessionId: string, owns: () => boolean = () => true): Promise<void> {
    return this.enqueue(
      `remove:${sessionId}`,
      'pattern:remove',
      owns,
      async () => this.engine.tools.patterns.remove(sessionId),
      (authority) => !authority.sessions.some((item) => item.id === sessionId) as never,
      true,
    );
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
    const cause = new Error('Pattern controller was disposed');
    this.activeCommand?.reject(cause);
    this.queue.splice(0).forEach((command) => command.reject(cause));
    this.activeCommand = undefined;
    this.loadPromise = undefined;
    this.draining = undefined;
    this.failed = undefined;
    this.admitted.clear();
    this.listeners.clear();
  }

  acknowledge(): void {
    if (!['error-reverted', 'conflict'].includes(this.state.phase)) return;
    this.failed = undefined;
    this.set({ ...this.state, phase: 'confirmed', error: undefined, active: undefined });
    void this.ensureDrain();
  }

  async reconcile(): Promise<void> {
    if (!this.active) return;
    const lifecycle = this.lifecycle;
    const token = ++this.readSequence;
    try {
      const authority = await this.readAuthority();
      if (!this.owns(lifecycle) || token < this.committedRead) return;
      const failed = this.failed;
      if (failed) {
        const confirmation = this.confirm(failed.command, authority, failed.result);
        if (!confirmation.ok) {
          const conflict = new Error(
            `Authoritative pattern state does not confirm ${failed.command.label}`,
          );
          this.commit(authority, token);
          this.set({ ...this.state, phase: 'conflict', error: conflict.message });
          throw conflict;
        }
      }
      this.commit(authority, token);
      this.failed = undefined;
      this.set({
        ...this.state,
        readiness: { phase: 'ready' },
        phase: 'success',
        error: undefined,
      });
      void this.ensureDrain();
    } catch (cause) {
      if (this.owns(lifecycle) && this.state.phase !== 'conflict')
        this.set({ ...this.state, phase: 'uncertain', error: errorMessage(cause) });
      throw cause;
    }
  }

  private enqueue<T>(
    key: string,
    label: string,
    owns: () => boolean,
    run: (requestId: string) => Promise<T>,
    match: (authority: Authority, requestId: string, result?: T) => T | undefined,
    voidResult = false,
  ): Promise<T> {
    if (!this.active) return Promise.reject(new Error('Pattern controller was disposed'));
    if (['error-reverted', 'uncertain', 'conflict'].includes(this.state.phase))
      return Promise.reject(
        new Error('Recover pattern persistence before submitting another change'),
      );
    const admitted = this.admitted.get(key);
    if (admitted) return admitted as Promise<T>;
    const requestId = this.requestId();
    const promise = new Promise<T>((resolve, reject) => {
      const command: Command<T> = {
        lifecycle: this.lifecycle,
        key,
        label,
        owns,
        run: () => run(requestId),
        matches: (authority, result) => {
          const matched = match(authority, requestId, result);
          return voidResult && matched === undefined ? (undefined as T) : matched;
        },
        voidResult,
        resolve,
        reject,
      };
      this.queue.push(command as Command<unknown>);
    }).finally(() => {
      if (this.admitted.get(key) === promise) this.admitted.delete(key);
    });
    this.admitted.set(key, promise);
    this.set({
      ...this.state,
      phase: this.state.phase === 'updating' ? 'updating' : 'queued',
      queued: this.queue.length,
    });
    void this.load().catch(() => undefined);
    if (this.state.readiness.phase === 'ready') void this.ensureDrain();
    return promise;
  }

  private ensureDrain(): Promise<void> {
    if (!this.active || this.draining || this.state.readiness.phase !== 'ready')
      return this.draining ?? Promise.resolve();
    const lifecycle = this.lifecycle;
    const draining = this.drain(lifecycle).finally(() => {
      if (this.draining === draining) {
        this.draining = undefined;
        if (this.owns(lifecycle) && this.queue.length) void this.ensureDrain();
      }
    });
    this.draining = draining;
    return draining;
  }

  private async drain(lifecycle: number): Promise<void> {
    while (this.owns(lifecycle) && this.queue.length) {
      const command = this.queue.shift()!;
      this.activeCommand = command;
      if (!command.owns()) {
        command.reject(new Error('Pattern command lost engine ownership'));
        this.finishCommand(command);
        this.discardQueued(
          new Error('Queued pattern changes were discarded after ownership loss'),
          lifecycle,
        );
        break;
      }
      this.committedRead = Math.max(this.committedRead, ++this.readSequence);
      this.set({
        ...this.state,
        phase: 'updating',
        active: command.label,
        queued: this.queue.length,
        error: undefined,
      });
      let result: unknown;
      try {
        result = await command.run();
      } catch (cause) {
        if (!this.owns(lifecycle)) {
          command.reject(new Error('Pattern controller was disposed or lost ownership'));
          this.finishCommand(command);
          break;
        }
        if (!command.owns()) {
          command.reject(new Error('Pattern controller was disposed or lost ownership'));
          this.finishCommand(command);
          this.discardQueued(
            new Error('Queued pattern changes were discarded after ownership loss'),
            lifecycle,
          );
          break;
        }
        if (!isAmbiguousRemoteError(cause)) {
          this.recordFailure(command, result, lifecycle);
          this.discardQueued(
            new Error('Queued pattern changes were discarded; recover pattern persistence'),
            lifecycle,
          );
          this.set({
            ...this.state,
            phase: 'error-reverted',
            active: undefined,
            queued: 0,
            error: errorMessage(cause),
          });
          command.reject(cause);
          this.finishCommand(command);
          break;
        }
        this.set({ ...this.state, phase: 'uncertain', error: errorMessage(cause) });
      }
      if (!this.owns(lifecycle)) {
        command.reject(new Error('Pattern controller was disposed or lost ownership'));
        this.finishCommand(command);
        break;
      }
      if (!command.owns()) {
        command.reject(new Error('Pattern controller was disposed or lost ownership'));
        this.finishCommand(command);
        this.discardQueued(
          new Error('Queued pattern changes were discarded after ownership loss'),
          lifecycle,
        );
        break;
      }
      try {
        this.recordFailure(command, result, lifecycle);
        const token = ++this.readSequence;
        const authority = await this.readAuthority();
        if (!this.owns(lifecycle)) {
          command.reject(new Error('Pattern controller was disposed or lost ownership'));
          this.finishCommand(command);
          break;
        }
        if (!command.owns()) {
          command.reject(new Error('Pattern controller was disposed or lost ownership'));
          this.finishCommand(command);
          this.discardQueued(
            new Error('Queued pattern changes were discarded after ownership loss'),
            lifecycle,
          );
          break;
        }
        this.commit(authority, token);
        const confirmation = this.confirm(command, authority, result);
        if (!confirmation.ok) {
          const conflict = new Error(
            `Authoritative pattern state does not confirm ${command.label}`,
          );
          this.set({
            ...this.state,
            phase: 'conflict',
            active: undefined,
            queued: 0,
            error: conflict.message,
          });
          this.discardQueued(
            new Error('Queued pattern changes were discarded; recover pattern persistence'),
            lifecycle,
          );
          command.reject(conflict);
          this.finishCommand(command);
          break;
        }
        result = confirmation.value;
        this.clearFailure(command, lifecycle);
        this.set({
          ...this.state,
          readiness: { phase: 'ready' },
          phase: 'success',
          active: undefined,
          error: undefined,
        });
        command.resolve(result);
      } catch (cause) {
        if (!this.owns(lifecycle)) {
          command.reject(new Error('Pattern controller was disposed or lost ownership'));
          this.finishCommand(command);
          break;
        }
        if (!command.owns()) {
          command.reject(new Error('Pattern controller was disposed or lost ownership'));
          this.finishCommand(command);
          this.discardQueued(
            new Error('Queued pattern changes were discarded after ownership loss'),
            lifecycle,
          );
          break;
        }
        this.recordFailure(command, result, lifecycle);
        this.discardQueued(
          new Error('Queued pattern changes were discarded; reconcile pattern persistence'),
          lifecycle,
        );
        if (this.state.phase !== 'conflict')
          this.set({
            ...this.state,
            phase: 'uncertain',
            active: undefined,
            queued: 0,
            error: errorMessage(cause),
          });
        command.reject(cause);
      }
      this.finishCommand(command);
      if (['error-reverted', 'uncertain', 'conflict'].includes(this.state.phase)) break;
    }
    if (this.owns(lifecycle)) this.set({ ...this.state, queued: 0, active: undefined });
  }

  private confirm(
    command: Command<unknown>,
    authority: Authority,
    result?: unknown,
  ): { ok: true; value: unknown } | { ok: false } {
    const matched = command.matches(authority, result);
    if (command.voidResult)
      return matched === true ? { ok: true, value: undefined } : { ok: false };
    return matched === undefined ? { ok: false } : { ok: true, value: matched };
  }

  private discardQueued(cause: Error, lifecycle: number): void {
    const retained = this.queue.filter((command) => command.lifecycle !== lifecycle);
    this.queue
      .filter((command) => command.lifecycle === lifecycle)
      .forEach((command) => command.reject(cause));
    this.queue.splice(0, this.queue.length, ...retained);
  }

  private recordFailure(command: Command<unknown>, result: unknown, lifecycle: number): void {
    if (this.owns(lifecycle) && this.activeCommand === command) this.failed = { command, result };
  }

  private clearFailure(command: Command<unknown>, lifecycle: number): void {
    if (this.owns(lifecycle) && this.activeCommand === command && this.failed?.command === command)
      this.failed = undefined;
  }

  private finishCommand(command: Command<unknown>): void {
    if (this.activeCommand === command) this.activeCommand = undefined;
  }

  private async readAuthority(): Promise<Authority> {
    const sessions = await this.engine.tools.patterns.list();
    const pairs = await Promise.all(
      sessions.map(
        async (session) =>
          [session.id, await this.engine.tools.patterns.events(session.id)] as const,
      ),
    );
    return { sessions, events: Object.fromEntries(pairs) };
  }

  private authority(): Authority {
    return { sessions: this.state.sessions, events: this.state.events };
  }

  private commit(authority: Authority, token: number): void {
    if (token < this.committedRead) return;
    this.committedRead = token;
    this.set({ ...this.state, sessions: [...authority.sessions], events: { ...authority.events } });
  }

  private owns(lifecycle: number): boolean {
    return this.active && this.lifecycle === lifecycle;
  }

  private set(next: PatternPersistentCollectionsSnapshot): void {
    if (!this.active) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}

interface Entry {
  controller: PatternPersistentCollectionsController;
  owns: () => boolean;
}
const controllers = new WeakMap<EngineAPI, Entry>();

export function patternPersistentCollectionsController(
  engine: EngineAPI,
  owns: () => boolean = () => true,
): PatternPersistentCollectionsController {
  let entry = controllers.get(engine);
  if (!entry) {
    entry = { owns, controller: new PatternPersistentCollectionsController(engine) };
    controllers.set(engine, entry);
  }
  entry.owns = owns;
  if (owns()) entry.controller.activate();
  return entry.controller;
}

export function disposePatternPersistentCollectionsController(engine: EngineAPI): void {
  controllers.get(engine)?.controller.dispose();
}
