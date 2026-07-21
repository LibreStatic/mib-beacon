import type { EngineAPI, ResolverSourceDraft, SourceConfig } from '@mibbeacon/core/client';
import { isAmbiguousRemoteError } from './live-mib-settings-transaction';
import { structuralRemoteEditEquality } from './remote-edit-transaction';

export type ResolverSourceCollectionPhase =
  'confirmed' | 'queued' | 'updating' | 'success' | 'error-reverted' | 'uncertain' | 'conflict';

export type ResolverSourceCollectionReadiness =
  { phase: 'unloaded' | 'loading' | 'ready' } | { phase: 'error'; error: string };

export interface ResolverSourceCollectionSnapshot {
  readonly readiness: ResolverSourceCollectionReadiness;
  readonly phase: ResolverSourceCollectionPhase;
  readonly confirmed: SourceConfig[];
  readonly queued: number;
  readonly active?: string;
  readonly failedCommand?: string;
  readonly error?: string;
  readonly remote?: SourceConfig[];
}

type AuthorityOrigin = 'load' | 'refresh' | 'event' | 'mutation' | 'import' | 'reconcile';
type CollectionCommand = {
  label: string;
  run(): Promise<SourceConfig[] | void>;
  project(before: SourceConfig[], result?: SourceConfig[]): SourceConfig[];
  redactions: string[];
  reconcileOnFailure: boolean;
  owns(): boolean;
  resolve(): void;
  reject(cause: unknown): void;
};

/**
 * Per-engine serialization and authority boundary for the resolver source collection.
 * It deliberately stores only source configs returned by the engine. Secret-bearing
 * drafts remain inside a queued command until its one API call finishes and are then
 * released; they are never copied into observable state or error text.
 */
export class ResolverSourceCollectionController {
  private state: ResolverSourceCollectionSnapshot = {
    readiness: { phase: 'unloaded' },
    phase: 'confirmed',
    confirmed: [],
    queued: 0,
  };
  private readonly queue: CollectionCommand[] = [];
  private readonly listeners = new Set<() => void>();
  private loadPromise?: Promise<SourceConfig[]>;
  private draining?: Promise<void>;
  private lifecycle = 0;
  private active = true;
  private authoritySequence = 0;
  private committedAuthority = 0;
  private pendingAuthority?: { sources: SourceConfig[]; token: number; origin: AuthorityOrigin };

  constructor(
    private readonly engine: EngineAPI,
    private readonly sink?: (sources: SourceConfig[]) => void,
  ) {}

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycle += 1;
    this.authoritySequence = 0;
    this.committedAuthority = 0;
    this.pendingAuthority = undefined;
    this.loadPromise = undefined;
    this.draining = undefined;
    this.state = {
      readiness: { phase: 'unloaded' },
      phase: 'confirmed',
      confirmed: [],
      queued: 0,
    };
  }

  snapshot(): ResolverSourceCollectionSnapshot {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  statusFor(sourceId: string): 'queued' | 'updating' | undefined {
    if (this.state.phase === 'updating' && this.state.active?.endsWith(`:${sourceId}`))
      return 'updating';
    return this.queue.some(
      (command, index) =>
        (this.state.phase !== 'updating' || index > 0) && command.label.endsWith(`:${sourceId}`),
    )
      ? 'queued'
      : undefined;
  }

  beginAuthorityRead(): number {
    return ++this.authoritySequence;
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
    this.listeners.clear();
    this.pendingAuthority = undefined;
    const error = new Error('Resolver source controller was disposed');
    this.queue.splice(0).forEach((command) => command.reject(error));
  }

  load(): Promise<SourceConfig[]> {
    if (!this.active) return Promise.resolve(this.state.confirmed);
    if (this.state.readiness.phase === 'ready') return Promise.resolve(this.state.confirmed);
    if (this.loadPromise) return this.loadPromise;
    const lifecycle = this.lifecycle;
    const authorityToken = this.beginAuthorityRead();
    this.set({ ...this.state, readiness: { phase: 'loading' } });
    const loading = this.engine.resolver.sources
      .list()
      .then((sources) => {
        if (!this.owns(lifecycle)) return normalizeSources(sources);
        const confirmed = this.commitAuthority(sources, authorityToken);
        if (!confirmed) return this.state.confirmed;
        this.set({
          ...this.state,
          readiness: { phase: 'ready' },
          phase: this.queue.length ? 'queued' : 'confirmed',
          queued: this.queue.length,
          confirmed,
        });
        void this.ensureDrain();
        return confirmed;
      })
      .catch((cause) => {
        if (this.owns(lifecycle)) {
          this.set({
            ...this.state,
            readiness: { phase: 'error', error: safeError(cause) },
          });
        }
        throw cause;
      })
      .finally(() => {
        if (this.owns(lifecycle) && this.loadPromise === loading) this.loadPromise = undefined;
      });
    this.loadPromise = loading;
    return loading;
  }

  /** The only public sink for lists obtained by refreshes or resolver events. */
  applyAuthority(sources: SourceConfig[], _origin: AuthorityOrigin, authorityToken?: number): void {
    if (!this.active) return;
    const token = authorityToken ?? ++this.authoritySequence;
    if (token < this.committedAuthority) return;
    if (this.draining || this.state.phase === 'updating') {
      // Keep only the newest authority while the serialized mutation owns the
      // visible state. It will be compared with the post-write raw list.
      if (!this.pendingAuthority || token > this.pendingAuthority.token)
        this.pendingAuthority = { sources: normalizeSources(sources), token, origin: _origin };
      return;
    }
    const confirmed = this.commitAuthority(sources, token);
    if (!confirmed) return;
    this.set({
      ...this.state,
      readiness: { phase: 'ready' },
      phase: 'confirmed',
      confirmed,
      queued: this.queue.length,
      error: undefined,
      remote: undefined,
      failedCommand: undefined,
    });
    if (this.queue.length) void this.ensureDrain();
  }

  create(
    draft: ResolverSourceDraft,
    prepend = false,
    owns: () => boolean = () => true,
  ): Promise<void> {
    return this.enqueue(
      'create',
      () => this.engine.resolver.sources.create(draft).then((created) => [created]),
      (before, result) => normalizeSources([...before, ...(result ?? [draft.config])]),
      draftRedactions(draft),
      prepend,
      false,
      owns,
    );
  }

  update(
    sourceId: string,
    draft: ResolverSourceDraft,
    prepend = false,
    owns: () => boolean = () => true,
  ): Promise<void> {
    return this.enqueue(
      `update:${sourceId}`,
      () => this.engine.resolver.sources.update(sourceId, draft).then((updated) => [updated]),
      (before, result) => {
        const updated = result?.[0] ?? draft.config;
        return normalizeSources(
          before.map((source) => (source.id === sourceId ? updated : source)),
        );
      },
      draftRedactions(draft),
      prepend,
      false,
      owns,
    );
  }

  remove(sourceId: string, prepend = false, owns: () => boolean = () => true): Promise<void> {
    return this.enqueue(
      `remove:${sourceId}`,
      () => this.engine.resolver.sources.remove(sourceId),
      (before) => normalizeSources(before.filter((source) => source.id !== sourceId)),
      [],
      prepend,
      false,
      owns,
    );
  }

  toggle(sourceId: string, owns: () => boolean = () => true): Promise<void> {
    return this.enqueue(
      `toggle:${sourceId}`,
      async () => {
        const current = this.state.confirmed.find((source) => source.id === sourceId);
        if (!current || current.kind === 'cache') return;
        const updated = await this.engine.resolver.sources.update(sourceId, {
          config: { ...current, enabled: !current.enabled },
        });
        return [updated];
      },
      (before, result) => {
        const current = before.find((source) => source.id === sourceId);
        if (!current) return before;
        const updated = result?.[0] ?? { ...current, enabled: !current.enabled };
        return normalizeSources(
          before.map((source) => (source.id === sourceId ? updated : source)),
        );
      },
      [],
      false,
      false,
      owns,
    );
  }

  reorder(sourceIds: string[], owns: () => boolean = () => true): Promise<void> {
    return this.enqueue(
      'reorder',
      () => this.engine.resolver.sources.reorder(normalizeOrder(this.state.confirmed, sourceIds)),
      (before, result) => result ?? reorderCollection(before, sourceIds),
      [],
      false,
      false,
      owns,
    );
  }

  move(sourceId: string, direction: -1 | 1, owns: () => boolean = () => true): Promise<void> {
    return this.enqueue(
      `move:${sourceId}`,
      async () => {
        const ids = moveIds(this.state.confirmed, sourceId, direction);
        if (!ids) return this.state.confirmed;
        return this.engine.resolver.sources.reorder(ids);
      },
      (before, result) => {
        const ids = moveIds(before, sourceId, direction);
        return result ?? (ids ? reorderCollection(before, ids) : before);
      },
      [],
      false,
      false,
      owns,
    );
  }

  drag(sourceId: string, targetIndex: number, owns: () => boolean = () => true): Promise<void> {
    return this.enqueue(
      `drag:${sourceId}`,
      async () => {
        const ids = dragIds(this.state.confirmed, sourceId, targetIndex);
        if (!ids) return this.state.confirmed;
        return this.engine.resolver.sources.reorder(ids);
      },
      (before, result) => {
        const ids = dragIds(before, sourceId, targetIndex);
        return result ?? (ids ? reorderCollection(before, ids) : before);
      },
      [],
      false,
      false,
      owns,
    );
  }

  importCustom(serialized: string, owns: () => boolean = () => true): Promise<void> {
    const imported = parseImportedSources(serialized);
    return this.enqueue(
      'import',
      () => this.engine.resolver.sources.importCustom(serialized),
      (before, result) =>
        result
          ? normalizeSources(result)
          : normalizeSources([
              ...before.filter((source) => !imported.some((item) => item.id === source.id)),
              ...imported,
            ]),
      extractSerializedSecrets(serialized),
      false,
      true,
      owns,
    );
  }

  acknowledge(): void {
    if (!this.active || !['error-reverted', 'conflict'].includes(this.state.phase)) return;
    this.set({
      ...this.state,
      phase: this.queue.length ? 'queued' : 'confirmed',
      queued: this.queue.length,
      error: undefined,
      remote: undefined,
      failedCommand: undefined,
    });
    void this.ensureDrain();
  }

  /** Clear a rejection without draining so a caller can prepend its rebuilt retry. */
  prepareRetry(): void {
    if (!this.active || this.state.phase !== 'error-reverted') return;
    this.set({
      ...this.state,
      phase: 'confirmed',
      error: undefined,
      remote: undefined,
      failedCommand: undefined,
    });
  }

  async reconcile(): Promise<void> {
    if (!this.active) return;
    const lifecycle = this.lifecycle;
    const authorityToken = this.beginAuthorityRead();
    try {
      const remote = await this.engine.resolver.sources.list();
      if (!this.owns(lifecycle)) return;
      this.applyAuthority(remote, 'reconcile', authorityToken);
      await this.ensureDrain();
    } catch (cause) {
      if (this.owns(lifecycle))
        this.set({ ...this.state, phase: 'uncertain', error: safeError(cause) });
    }
  }

  private enqueue(
    label: string,
    run: () => Promise<SourceConfig[] | void>,
    project: CollectionCommand['project'],
    redactions: string[] = [],
    prepend = false,
    reconcileOnFailure = false,
    owns: () => boolean = () => true,
  ): Promise<void> {
    if (!this.active) return Promise.reject(new Error('Resolver source controller is disposed'));
    const promise = new Promise<void>((resolve, reject) => {
      const command = {
        label,
        run,
        project,
        redactions,
        reconcileOnFailure,
        owns,
        resolve,
        reject,
      };
      if (prepend) this.queue.unshift(command);
      else this.queue.push(command);
    });
    this.set({
      ...this.state,
      phase: this.state.phase === 'updating' ? 'updating' : 'queued',
      queued: Math.max(0, this.queue.length - (this.state.phase === 'updating' ? 1 : 0)),
    });
    if (this.state.readiness.phase === 'ready') void this.ensureDrain();
    return promise;
  }

  private ensureDrain(): Promise<void> {
    if (!this.active || this.state.readiness.phase !== 'ready') return Promise.resolve();
    if (this.draining) return this.draining;
    if (['error-reverted', 'uncertain', 'conflict'].includes(this.state.phase))
      return Promise.resolve();
    const lifecycle = this.lifecycle;
    const draining = this.drain(lifecycle).finally(() => {
      if (this.owns(lifecycle) && this.draining === draining) {
        this.draining = undefined;
        this.flushPendingAuthority();
        if (
          this.queue.length &&
          !['error-reverted', 'uncertain', 'conflict'].includes(this.state.phase)
        )
          void this.ensureDrain();
      }
    });
    this.draining = draining;
    return draining;
  }

  private async drain(lifecycle: number): Promise<void> {
    while (this.owns(lifecycle) && this.queue.length) {
      const command = this.queue[0]!;
      if (!command.owns()) {
        this.queue.shift();
        command.reject(new Error('Resolver source command ownership is stale'));
        this.set({
          ...this.state,
          phase: this.queue.length ? 'queued' : 'confirmed',
          queued: this.queue.length,
          active: undefined,
        });
        continue;
      }
      const before = this.state.confirmed;
      // Starting a mutation invalidates any list read that began against the
      // prior collection, even if that stale read settles after this write.
      this.committedAuthority = ++this.authoritySequence;
      this.set({
        ...this.state,
        phase: 'updating',
        active: command.label,
        queued: Math.max(0, this.queue.length - 1),
        error: undefined,
        remote: undefined,
      });
      let writeSucceeded = false;
      try {
        const result = await command.run();
        writeSucceeded = true;
        if (!this.owns(lifecycle)) return;
        if (!command.owns()) {
          this.queue.shift();
          command.reject(new Error('Resolver source command ownership became stale'));
          this.set({
            ...this.state,
            phase: this.queue.length ? 'queued' : 'confirmed',
            queued: this.queue.length,
            active: undefined,
          });
          continue;
        }
        // Mutation return values are useful for projection, but the raw list is
        // the sole final authority (and captures partial import outcomes).
        command.project(before, result || undefined);
        const authorityToken = this.beginAuthorityRead();
        const remote = normalizeSources(await this.engine.resolver.sources.list());
        if (!this.owns(lifecycle)) return;
        this.queue.shift();
        command.resolve();
        const confirmed = this.commitNewestAuthority(remote, authorityToken);
        if (!confirmed) return;
        this.set({
          ...this.state,
          phase: this.queue.length ? 'queued' : 'success',
          confirmed,
          queued: this.queue.length,
          active: undefined,
          // The raw list can legitimately add runtime stats or incorporate a
          // concurrent actor, so it wins without manufacturing a conflict.
          error: undefined,
        });
      } catch (cause) {
        if (!this.owns(lifecycle)) return;
        const error = redactError(safeError(cause), command.redactions);
        if (writeSucceeded) {
          this.queue.shift();
          command.resolve();
          this.set({
            ...this.state,
            phase: 'uncertain',
            confirmed: before,
            queued: this.queue.length,
            active: undefined,
            failedCommand: command.label,
            error,
          });
          return;
        }
        if (!isAmbiguousRemoteError(cause)) {
          if (command.reconcileOnFailure) {
            try {
              const authorityToken = this.beginAuthorityRead();
              const remote = normalizeSources(await this.engine.resolver.sources.list());
              if (!this.owns(lifecycle)) return;
              const confirmed = this.commitNewestAuthority(remote, authorityToken);
              if (!confirmed) return;
              this.queue.shift();
              command.reject(new Error(error));
              const partial = !structuralRemoteEditEquality(before, confirmed);
              this.set({
                ...this.state,
                phase: partial ? 'conflict' : 'error-reverted',
                confirmed,
                queued: this.queue.length,
                active: undefined,
                failedCommand: command.label,
                error,
                remote: partial ? confirmed : undefined,
              });
              return;
            } catch {
              this.queue.shift();
              command.reject(new Error(error));
              this.set({
                ...this.state,
                phase: 'uncertain',
                confirmed: before,
                queued: this.queue.length,
                active: undefined,
                failedCommand: command.label,
                error,
              });
              return;
            }
          }
          this.queue.shift();
          command.reject(new Error(error));
          this.set({
            ...this.state,
            phase: 'error-reverted',
            confirmed: before,
            queued: this.queue.length,
            active: undefined,
            failedCommand: command.label,
            error,
          });
          return;
        }
        this.set({ ...this.state, phase: 'uncertain', active: command.label, error });
        try {
          const authorityToken = this.beginAuthorityRead();
          const remote = normalizeSources(await this.engine.resolver.sources.list());
          if (!this.owns(lifecycle)) return;
          const expected = normalizeSources(command.project(before));
          this.queue.shift();
          command.resolve();
          const confirmed = this.commitNewestAuthority(remote, authorityToken);
          if (!confirmed) return;
          const matches = structuralRemoteEditEquality(expected, confirmed);
          this.set({
            ...this.state,
            phase: matches ? (this.queue.length ? 'queued' : 'success') : 'conflict',
            confirmed,
            queued: this.queue.length,
            active: undefined,
            error: matches ? undefined : error,
            remote: matches ? undefined : confirmed,
          });
          if (!matches) return;
        } catch {
          // The remote outcome remains unknown, but callers must not hang. Drop
          // the submitted (possibly secret-bearing) command and require an
          // explicit authoritative reconcile before any queued work resumes.
          this.queue.shift();
          command.resolve();
          this.set({
            ...this.state,
            phase: 'uncertain',
            queued: this.queue.length,
            active: undefined,
            error,
          });
          return;
        }
      }
    }
  }

  private commitAuthority(sources: SourceConfig[], token: number): SourceConfig[] | undefined {
    if (token < this.committedAuthority) return undefined;
    this.committedAuthority = token;
    const confirmed = normalizeSources(sources);
    if (this.active) this.sink?.(confirmed);
    return confirmed;
  }

  private commitNewestAuthority(
    sources: SourceConfig[],
    token: number,
  ): SourceConfig[] | undefined {
    const pending = this.pendingAuthority;
    this.pendingAuthority = undefined;
    if (pending && pending.token > token)
      return this.commitAuthority(pending.sources, pending.token);
    return this.commitAuthority(sources, token);
  }

  private flushPendingAuthority(): void {
    const pending = this.pendingAuthority;
    if (!pending) return;
    this.pendingAuthority = undefined;
    const confirmed = this.commitAuthority(pending.sources, pending.token);
    if (!confirmed) return;
    const failure = ['error-reverted', 'uncertain', 'conflict'].includes(this.state.phase);
    this.set({
      ...this.state,
      phase: failure ? this.state.phase : this.queue.length ? 'queued' : 'confirmed',
      confirmed,
      queued: this.queue.length,
      ...(failure ? {} : { error: undefined, remote: undefined }),
    });
  }

  private owns(lifecycle: number): boolean {
    return this.active && lifecycle === this.lifecycle;
  }

  private set(state: ResolverSourceCollectionSnapshot): void {
    if (!this.active) return;
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}

export function resolverSourceCollectionStatusText(
  state: ResolverSourceCollectionSnapshot,
): string {
  if (state.readiness.phase === 'loading') return 'Loading authoritative resolver sources…';
  if (state.readiness.phase === 'error') return `Source load failed. ${state.readiness.error}`;
  switch (state.phase) {
    case 'confirmed':
      return 'Sources confirmed.';
    case 'queued':
      return `${state.queued} source change${state.queued === 1 ? '' : 's'} queued.`;
    case 'updating':
      return `Updating sources${state.queued ? ` · ${state.queued} queued` : ''}…`;
    case 'success':
      return 'Source changes saved and confirmed.';
    case 'error-reverted':
      return `Source change rejected; restored confirmed sources. ${state.error ?? ''}`;
    case 'uncertain':
      return `Source change outcome uncertain; reconcile with the engine. ${state.error ?? ''}`;
    case 'conflict':
      return `Remote sources differ from the requested change. ${state.error ?? ''}`;
  }
}

export type ResolverSourceEditorRecovery =
  'retry-local' | 'acknowledge-queued' | 'reconcile' | null;

export function resolverSourceEditorRecovery(
  state: ResolverSourceCollectionSnapshot,
  localCommand: string | null,
  hasLocalError: boolean,
  saving: boolean,
): ResolverSourceEditorRecovery {
  if (state.phase === 'uncertain' || state.phase === 'conflict') return 'reconcile';
  if (state.phase !== 'error-reverted') return null;
  if (!saving && hasLocalError && localCommand && state.failedCommand === localCommand)
    return 'retry-local';
  return 'acknowledge-queued';
}

export function normalizeSources(sources: readonly SourceConfig[]): SourceConfig[] {
  const seen = new Set<string>();
  const unique = sources.filter((source) => !seen.has(source.id) && Boolean(seen.add(source.id)));
  const fixed = unique.filter((source) => source.kind === 'cache');
  const movable = unique.filter((source) => source.kind !== 'cache');
  return [...fixed, ...movable].map((source, priority) => ({ ...source, priority }));
}

function normalizeOrder(sources: SourceConfig[], requested: string[]): string[] {
  const existing = new Set(sources.map((source) => source.id));
  const fixed = sources.filter((source) => source.kind === 'cache').map((source) => source.id);
  const movable = requested.filter((id) => existing.has(id) && !fixed.includes(id));
  for (const source of sources)
    if (source.kind !== 'cache' && !movable.includes(source.id)) movable.push(source.id);
  return [...fixed, ...movable];
}

function reorderCollection(sources: SourceConfig[], requested: string[]): SourceConfig[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return normalizeSources(
    normalizeOrder(sources, requested)
      .map((id) => byId.get(id)!)
      .filter(Boolean),
  );
}

function moveIds(
  sources: SourceConfig[],
  sourceId: string,
  direction: -1 | 1,
): string[] | undefined {
  const movable = sources.filter((source) => source.kind !== 'cache').map((source) => source.id);
  const from = movable.indexOf(sourceId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= movable.length) return undefined;
  [movable[from], movable[to]] = [movable[to]!, movable[from]!];
  return normalizeOrder(sources, movable);
}

function dragIds(
  sources: SourceConfig[],
  sourceId: string,
  targetIndex: number,
): string[] | undefined {
  const movable = sources.filter((source) => source.kind !== 'cache').map((source) => source.id);
  const from = movable.indexOf(sourceId);
  const to = Math.max(0, Math.min(movable.length - 1, Math.trunc(targetIndex)));
  if (from < 0 || from === to) return undefined;
  const [moved] = movable.splice(from, 1);
  movable.splice(to, 0, moved!);
  return normalizeOrder(sources, movable);
}

function draftRedactions(draft: ResolverSourceDraft): string[] {
  return [
    draft.secrets?.password,
    draft.secrets?.token,
    ...Object.values(draft.secrets?.headers ?? {}),
  ].filter((value): value is string => Boolean(value));
}

function extractSerializedSecrets(serialized: string): string[] {
  try {
    const value = JSON.parse(serialized) as unknown;
    const found: string[] = [];
    const visit = (candidate: unknown, key = '', insideSecretContainer = false) => {
      const secretContext =
        insideSecretContainer || /password|token|secret|authorization|headers/i.test(key);
      if (typeof candidate === 'string' && secretContext) found.push(candidate);
      else if (candidate && typeof candidate === 'object')
        Object.entries(candidate).forEach(([childKey, child]) =>
          visit(child, childKey, secretContext),
        );
    };
    visit(value);
    return found;
  } catch {
    // If an invalid payload is echoed by the engine, redact it wholesale.
    // Parsing failed, so no narrower structural guarantee is trustworthy.
    const found: string[] = serialized ? [serialized] : [];
    const pattern =
      /["']?(?:password|token|secret|authorization)["']?\s*[:=]\s*["']([^"'\s,}\]]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(serialized))) if (match[1]) found.push(match[1]);
    // Invalid JSON cannot be traversed reliably. Conservatively redact every
    // quoted value so nested header/container secrets cannot leak via errors.
    const quotedValue = /:\s*"((?:\\.|[^"\\])*)"/g;
    while ((match = quotedValue.exec(serialized))) if (match[1]) found.push(match[1]);
    const singleQuotedValue = /:\s*'((?:\\.|[^'\\])*)'/g;
    while ((match = singleQuotedValue.exec(serialized))) if (match[1]) found.push(match[1]);
    return found;
  }
}

function parseImportedSources(serialized: string): SourceConfig[] {
  try {
    const parsed = JSON.parse(serialized) as { sources?: unknown };
    if (!Array.isArray(parsed.sources)) return [];
    // The engine remains responsible for full validation. This local parse is
    // used only to compare an ambiguous outcome and is never sent to the UI.
    return parsed.sources.filter(
      (candidate): candidate is SourceConfig =>
        Boolean(candidate) &&
        typeof candidate === 'object' &&
        typeof (candidate as { id?: unknown }).id === 'string' &&
        typeof (candidate as { kind?: unknown }).kind === 'string',
    );
  } catch {
    return [];
  }
}

function redactError(error: string, secrets: string[]): string {
  let safe = error;
  for (const secret of secrets) if (secret) safe = safe.split(secret).join('[REDACTED]');
  return safe.replace(/(password|token|authorization|secret)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
}

function safeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function redactResolverSourceError(cause: unknown, draft?: ResolverSourceDraft): string {
  return redactError(safeError(cause), draft ? draftRedactions(draft) : []);
}
