import type {
  EngineAPI,
  NotificationPayload,
  TrapRule,
  TrapRuleDraft,
  TrapSavedFilter,
  TrapSendPreset,
  TrapV3UserDraft,
  TrapV3UserProfile,
} from '@mibbeacon/core/client';
import { isAmbiguousRemoteError } from './live-mib-settings-transaction';

export type TrapCollectionPhase =
  'confirmed' | 'queued' | 'updating' | 'success' | 'error-reverted' | 'uncertain' | 'conflict';

export interface TrapPersistentCollections {
  savedFilters: TrapSavedFilter[];
  v3Users: TrapV3UserProfile[];
  rules: TrapRule[];
  presets: TrapSendPreset[];
}

export interface TrapPersistentCollectionsSnapshot extends TrapPersistentCollections {
  readiness: { phase: 'unloaded' | 'loading' | 'ready' } | { phase: 'error'; error: string };
  phase: TrapCollectionPhase;
  queued: number;
  active?: string;
  failedCommand?: string;
  retryable?: boolean;
  canAcknowledgeUncertainty?: boolean;
  error?: string;
  remote?: TrapPersistentCollections;
}

type AuthorityOrigin = 'load' | 'refresh' | 'event' | 'mutation' | 'reconcile';
type Command = {
  label: string;
  owns: () => boolean;
  run: () => Promise<unknown>;
  project: (before: TrapPersistentCollections, result?: unknown) => TrapPersistentCollections;
  matches: (
    remote: TrapPersistentCollections,
    before: TrapPersistentCollections,
    result?: unknown,
  ) => boolean | 'unknown';
  sensitive: boolean;
  resolve: () => void;
  reject: (cause: unknown) => void;
};

const empty = (): TrapPersistentCollections => ({
  savedFilters: [],
  v3Users: [],
  rules: [],
  presets: [],
});
const copy = (value: TrapPersistentCollections): TrapPersistentCollections => ({
  savedFilters: [...value.savedFilters],
  v3Users: [...value.v3Users],
  rules: [...value.rules],
  presets: [...value.presets],
});
const equal = (left: unknown, right: unknown) =>
  JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function trapCollectionStatusText(snapshot: TrapPersistentCollectionsSnapshot): string {
  if (snapshot.readiness.phase === 'loading')
    return `Loading confirmed trap configuration…${snapshot.queued ? ` · ${snapshot.queued} queued` : ''}`;
  if (snapshot.readiness.phase === 'error')
    return `${snapshot.readiness.error}${snapshot.queued ? ` · ${snapshot.queued} queued` : ''}`;
  if (snapshot.phase === 'queued') return `${snapshot.queued} trap change(s) queued`;
  if (snapshot.phase === 'updating')
    return `Updating ${snapshot.active ?? 'trap configuration'}… · ${snapshot.queued} queued`;
  if (snapshot.phase === 'success') return 'Trap configuration saved and confirmed';
  if (snapshot.phase === 'error-reverted')
    return `Change rejected; last-confirmed trap configuration restored (reverted)${snapshot.error ? ` · ${snapshot.error}` : ''}`;
  if (snapshot.phase === 'uncertain')
    return `Trap change outcome uncertain; reconcile with the engine${snapshot.error ? ` · ${snapshot.error}` : ''}`;
  if (snapshot.phase === 'conflict')
    return `Remote trap configuration conflict; reconcile or acknowledge${snapshot.error ? ` · ${snapshot.error}` : ''}`;
  return snapshot.error ?? snapshot.phase;
}

/** Single per-engine serialization and authority boundary for persistent trap configuration. */
export class TrapPersistentCollectionsController {
  private state: TrapPersistentCollectionsSnapshot = {
    ...empty(),
    readiness: { phase: 'unloaded' },
    phase: 'confirmed',
    queued: 0,
  };
  private readonly listeners = new Set<() => void>();
  private readonly queue: Command[] = [];
  private loadPromise?: Promise<TrapPersistentCollections>;
  private draining?: Promise<void>;
  private activeCommand?: Command;
  private failed?: {
    command: Omit<Command, 'resolve' | 'reject'>;
    before: TrapPersistentCollections;
    result?: unknown;
    hasResult: boolean;
    canAcknowledgeUncertainty?: boolean;
  };
  private active = true;
  private lifecycle = 0;
  private authoritySequence = 0;
  private committedAuthority = 0;
  private pendingAuthority?: { value: TrapPersistentCollections; token: number };

  constructor(private readonly engine: EngineAPI) {}

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycle += 1;
    this.queue.splice(0);
    this.loadPromise = undefined;
    this.draining = undefined;
    this.activeCommand = undefined;
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

  snapshot(): TrapPersistentCollectionsSnapshot {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  statusFor(label: string): 'queued' | 'updating' | undefined {
    if (this.state.active === label && this.state.phase === 'updating') return 'updating';
    return this.queue.some((command) => command.label === label) ? 'queued' : undefined;
  }

  beginAuthorityRead(): number {
    return ++this.authoritySequence;
  }

  load(): Promise<TrapPersistentCollections> {
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
        if (this.owns(lifecycle) && token >= this.committedAuthority)
          this.set({ ...this.state, readiness: { phase: 'error', error: safeMessage(cause) } });
        throw cause;
      })
      .finally(() => {
        if (this.owns(lifecycle) && this.loadPromise === loading) this.loadPromise = undefined;
      });
    this.loadPromise = loading;
    return loading;
  }

  async refresh(
    origin: Extract<AuthorityOrigin, 'refresh' | 'event'> = 'refresh',
    accepts: () => boolean = () => true,
  ): Promise<TrapPersistentCollections> {
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
      if (initial && this.owns(lifecycle) && accepts() && token >= this.committedAuthority)
        this.set({ ...this.state, readiness: { phase: 'error', error: safeMessage(cause) } });
      throw cause;
    }
  }

  applyAuthority(
    value: TrapPersistentCollections,
    _origin: AuthorityOrigin,
    token = ++this.authoritySequence,
  ): void {
    if (!this.active || token < this.committedAuthority) return;
    if (this.draining || this.state.phase === 'updating') {
      if (!this.pendingAuthority || token > this.pendingAuthority.token)
        this.pendingAuthority = { value: copy(value), token };
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
      retryable: undefined,
      canAcknowledgeUncertainty: undefined,
    });
    if (this.queue.length) void this.ensureDrain();
  }

  saveFilter(
    name: string,
    query: Parameters<EngineAPI['traps']['savedFilters']['save']>[1],
    owns: () => boolean = () => true,
  ): Promise<void> {
    const semantic = normalizeFilterInput(name, query);
    return this.enqueue(
      `filter:save:${name.trim()}`,
      owns,
      () => this.engine.traps.savedFilters.save(name, query),
      (before, result) => ({
        ...before,
        savedFilters: result
          ? [
              ...before.savedFilters.filter(
                (item) => item.name !== (result as TrapSavedFilter).name,
              ),
              result as TrapSavedFilter,
            ]
          : before.savedFilters,
      }),
      false,
      (remote, _before, result) =>
        remote.savedFilters.some(
          (item) =>
            (!result || item.id === (result as TrapSavedFilter).id) &&
            equal(normalizeFilter(item), semantic),
        ),
    );
  }

  removeFilter(id: string, owns: () => boolean = () => true): Promise<void> {
    return this.enqueue(
      `filter:remove:${id}`,
      owns,
      () => this.engine.traps.savedFilters.remove(id),
      (before) => ({
        ...before,
        savedFilters: before.savedFilters.filter((item) => item.id !== id),
      }),
      false,
      (remote) => !remote.savedFilters.some((item) => item.id === id),
    );
  }

  upsertV3User(draft: TrapV3UserDraft, owns: () => boolean = () => true): Promise<void> {
    const intended = normalizeV3Draft(draft);
    return this.enqueue(
      `v3:upsert:${draft.name.trim()}`,
      owns,
      () => this.engine.traps.v3Users.upsert(draft),
      (before, result) => ({
        ...before,
        v3Users: result
          ? [
              ...before.v3Users.filter((item) => item.name !== (result as TrapV3UserProfile).name),
              result as TrapV3UserProfile,
            ]
          : before.v3Users,
      }),
      false,
      (remote, before, result) => {
        if (result)
          return remote.v3Users.some((item) =>
            equal(normalizeV3Profile(item), normalizeV3Profile(result as TrapV3UserProfile)),
          );
        const prior = before.v3Users.find((item) => item.name === intended.name);
        const outcomes = remote.v3Users.map((item) => v3DraftMatches(item, intended, prior));
        return outcomes.includes(true) ? true : outcomes.includes('unknown') ? 'unknown' : false;
      },
      true,
    );
  }

  removeV3User(name: string, owns: () => boolean = () => true): Promise<void> {
    return this.enqueue(
      `v3:remove:${name}`,
      owns,
      () => this.engine.traps.v3Users.remove(name),
      (before) => ({ ...before, v3Users: before.v3Users.filter((item) => item.name !== name) }),
      false,
      (remote) => !remote.v3Users.some((item) => item.name === name),
      true,
    );
  }

  savePreset(
    name: string,
    agentId: string,
    payload: NotificationPayload,
    owns: () => boolean = () => true,
  ): Promise<void> {
    const semantic = normalizePresetInput(name, agentId, payload);
    return this.enqueue(
      `preset:save:${name.trim()}`,
      owns,
      () => this.engine.traps.presets.save(name, agentId, payload),
      (before, result) => ({
        ...before,
        presets: result
          ? [
              ...before.presets.filter((item) => item.name !== (result as TrapSendPreset).name),
              result as TrapSendPreset,
            ]
          : before.presets,
      }),
      false,
      (remote, _before, result) =>
        remote.presets.some(
          (item) =>
            (!result || item.id === (result as TrapSendPreset).id) &&
            equal(normalizePreset(item), semantic),
        ),
    );
  }

  removePreset(id: string, owns: () => boolean = () => true): Promise<void> {
    return this.enqueue(
      `preset:remove:${id}`,
      owns,
      () => this.engine.traps.presets.remove(id),
      (before) => ({ ...before, presets: before.presets.filter((item) => item.id !== id) }),
      false,
      (remote) => !remote.presets.some((item) => item.id === id),
    );
  }

  createRule(draft: TrapRuleDraft, owns: () => boolean = () => true): Promise<void> {
    const semantic = normalizeRuleDraft(draft);
    return this.enqueue(
      `rule:create:${draft.name.trim()}`,
      owns,
      () => this.engine.traps.rules.create(draft),
      (before, result) => ({
        ...before,
        rules: result ? [...before.rules, result as TrapRule] : before.rules,
      }),
      false,
      (remote, before) =>
        multiplicity(remote.rules, semantic, normalizeRule) >
        multiplicity(before.rules, semantic, normalizeRule),
    );
  }

  updateRule(
    id: string,
    patch: Partial<TrapRuleDraft>,
    owns: () => boolean = () => true,
  ): Promise<void> {
    return this.enqueue(
      `rule:update:${id}`,
      owns,
      () => this.engine.traps.rules.update(id, patch),
      (before, result) => ({
        ...before,
        rules: before.rules.map((item) =>
          item.id === id ? ((result as TrapRule | undefined) ?? { ...item, ...patch }) : item,
        ),
      }),
      false,
      (remote) => {
        const item = remote.rules.find((candidate) => candidate.id === id);
        return Boolean(item && rulePatchMatches(item, patch));
      },
    );
  }

  removeRule(id: string, owns: () => boolean = () => true): Promise<void> {
    return this.enqueue(
      `rule:remove:${id}`,
      owns,
      () => this.engine.traps.rules.remove(id),
      (before) => ({ ...before, rules: before.rules.filter((item) => item.id !== id) }),
      false,
      (remote) => !remote.rules.some((item) => item.id === id),
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
      retryable: undefined,
      canAcknowledgeUncertainty: undefined,
    });
    void this.ensureDrain();
  }

  retryFailed(): Promise<void> {
    if (!this.failed || this.state.phase !== 'error-reverted') return Promise.resolve();
    const failed = this.failed.command;
    if (failed.sensitive)
      return Promise.reject(new Error('Re-enter the SNMPv3 keys before retrying.'));
    this.failed = undefined;
    this.set({
      ...this.state,
      phase: 'confirmed',
      error: undefined,
      failedCommand: undefined,
      retryable: undefined,
      canAcknowledgeUncertainty: undefined,
    });
    return this.enqueue(
      failed.label,
      failed.owns,
      failed.run,
      failed.project,
      true,
      failed.matches,
      failed.sensitive,
    );
  }

  async reconcile(): Promise<void> {
    if (!this.active) return;
    const lifecycle = this.lifecycle;
    const token = this.beginAuthorityRead();
    try {
      const remote = await this.readAuthority();
      if (!this.owns(lifecycle) || token < this.committedAuthority) return;
      const failed = this.failed;
      const reconciliation = failed?.command.matches(
        remote,
        failed.before,
        failed.hasResult ? failed.result : undefined,
      );
      if (failed && reconciliation !== true) {
        if (reconciliation === 'unknown') {
          this.commit(remote, token);
          failed.canAcknowledgeUncertainty = true;
          this.set({
            ...this.state,
            phase: 'uncertain',
            failedCommand: failed.command.label,
            error: 'The write-only key outcome cannot be proven from remote metadata.',
            retryable: false,
            canAcknowledgeUncertainty: true,
          });
          throw new Error('The write-only key outcome cannot be proven from remote metadata.');
        }
        this.commit(remote, token);
        const conflict = new Error(`Remote authority does not contain ${failed.command.label}`);
        this.set({
          ...this.state,
          phase: 'conflict',
          failedCommand: failed.command.label,
          error: message(conflict),
          remote,
          retryable: !failed.command.sensitive,
          canAcknowledgeUncertainty: undefined,
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
        retryable: undefined,
        canAcknowledgeUncertainty: undefined,
      });
      void this.ensureDrain();
    } catch (cause) {
      if (this.owns(lifecycle) && this.state.phase !== 'conflict')
        this.set({ ...this.state, phase: 'uncertain', error: safeMessage(cause) });
      throw cause;
    }
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
    this.listeners.clear();
    this.pendingAuthority = undefined;
    const error = new Error('Trap collections controller was disposed');
    if (this.activeCommand) discardSensitive(this.activeCommand);
    this.activeCommand?.reject(error);
    this.activeCommand = undefined;
    this.queue.splice(0).forEach((command) => {
      discardSensitive(command);
      command.reject(error);
    });
  }

  acknowledgeUncertainty(): void {
    if (
      this.state.phase !== 'uncertain' ||
      !this.failed?.command.sensitive ||
      !this.failed.canAcknowledgeUncertainty
    )
      return;
    this.failed = undefined;
    this.set({
      ...this.state,
      phase: this.queue.length ? 'queued' : 'confirmed',
      failedCommand: undefined,
      error: undefined,
      retryable: undefined,
      canAcknowledgeUncertainty: undefined,
    });
    void this.ensureDrain();
  }

  private enqueue(
    label: string,
    owns: () => boolean,
    run: () => Promise<unknown>,
    project: (before: TrapPersistentCollections, result?: unknown) => TrapPersistentCollections,
    prepend = false,
    matches: Command['matches'] = (remote, before, result) =>
      equal(project(before, result), remote),
    sensitive = false,
  ): Promise<void> {
    if (!this.active) return Promise.reject(new Error('Trap collections controller was disposed'));
    const promise = new Promise<void>((resolve, reject) => {
      const command = { label, owns, run, project, matches, sensitive, resolve, reject };
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
      const before = this.collections();
      const stablePhase = this.state.phase === 'success' ? 'success' : 'confirmed';
      if (!command.owns()) {
        this.activeCommand = undefined;
        command.reject(new Error('Trap command lost engine ownership'));
        this.set({
          ...this.state,
          phase: this.queue.length ? 'queued' : stablePhase,
          queued: this.queue.length,
        });
        continue;
      }
      this.committedAuthority = Math.max(this.committedAuthority, this.beginAuthorityRead());
      this.set({
        ...this.state,
        phase: 'updating',
        active: command.label,
        queued: this.queue.length,
        error: undefined,
        remote: undefined,
      });
      let result: unknown;
      try {
        const running = command.run();
        discardSensitive(command);
        result = await running;
      } catch (cause) {
        const exposedCause = command.sensitive ? sensitiveCommandError() : cause;
        const forceSecretUncertain =
          command.sensitive && /rollback outcome unknown/i.test(message(cause));
        if (!this.owns(lifecycle) || !command.owns()) {
          this.activeCommand = undefined;
          command.reject(new Error('Trap command lost engine ownership'));
          continue;
        }
        if (isAmbiguousRemoteError(cause)) {
          try {
            const token = this.beginAuthorityRead();
            const remote = await this.readAuthority();
            if (!this.owns(lifecycle) || !command.owns()) {
              this.activeCommand = undefined;
              command.reject(new Error('Trap command lost engine ownership'));
              continue;
            }
            const match = command.matches(remote, before);
            if (forceSecretUncertain) {
              this.commit(remote, token);
              this.failed = {
                command,
                before,
                hasResult: false,
                canAcknowledgeUncertainty: true,
              };
              this.activeCommand = undefined;
              this.set({
                ...this.state,
                phase: 'uncertain',
                active: undefined,
                failedCommand: command.label,
                error: safeMessage(exposedCause),
                retryable: false,
                canAcknowledgeUncertainty: true,
              });
              discardSensitive(command);
              command.reject(exposedCause);
              return;
            }
            if (match === true) {
              this.commit(remote, token);
              this.activeCommand = undefined;
              this.set({
                ...this.state,
                phase: 'success',
                active: undefined,
                failedCommand: undefined,
              });
              command.resolve();
              continue;
            }
            this.failed = { command, before, hasResult: false };
            this.activeCommand = undefined;
            if (match === 'unknown') {
              this.commit(remote, token);
              this.failed.canAcknowledgeUncertainty = true;
              this.set({
                ...this.state,
                ...before,
                phase: 'uncertain',
                active: undefined,
                failedCommand: command.label,
                error: safeMessage(exposedCause),
                retryable: false,
                canAcknowledgeUncertainty: true,
              });
              discardSensitive(command);
              command.reject(exposedCause);
              return;
            }
            this.commit(remote, token);
            this.set({
              ...this.state,
              phase: 'conflict',
              active: undefined,
              failedCommand: command.label,
              error: safeMessage(exposedCause),
              remote,
              retryable: !command.sensitive,
              canAcknowledgeUncertainty: undefined,
            });
            discardSensitive(command);
            command.reject(exposedCause);
            return;
          } catch (readCause) {
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
              command.reject(new Error('Trap command lost engine ownership'));
              continue;
            }
            this.failed = { command, before, hasResult: false };
            this.activeCommand = undefined;
            this.set({
              ...this.state,
              ...before,
              phase: 'uncertain',
              active: undefined,
              failedCommand: command.label,
              error: safeMessage(command.sensitive ? sensitiveCommandError() : readCause),
              retryable: !command.sensitive,
              canAcknowledgeUncertainty: undefined,
            });
            discardSensitive(command);
            command.reject(command.sensitive ? sensitiveCommandError() : readCause);
            return;
          }
        }
        this.failed = { command, before, hasResult: false };
        this.activeCommand = undefined;
        this.set({
          ...this.state,
          ...before,
          phase: 'error-reverted',
          active: undefined,
          failedCommand: command.label,
          error: safeMessage(exposedCause),
          retryable: !command.sensitive,
          canAcknowledgeUncertainty: undefined,
        });
        discardSensitive(command);
        command.reject(exposedCause);
        return;
      }
      if (!this.owns(lifecycle) || !command.owns()) {
        this.activeCommand = undefined;
        command.reject(new Error('Trap command lost engine ownership'));
        continue;
      }
      let remote: TrapPersistentCollections;
      try {
        const token = this.beginAuthorityRead();
        remote = await this.readAuthority();
        if (!this.owns(lifecycle) || !command.owns()) {
          this.activeCommand = undefined;
          command.reject(new Error('Trap command lost engine ownership'));
          continue;
        }
        this.commit(remote, token);
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
          command.reject(new Error('Trap command lost engine ownership'));
          continue;
        }
        this.failed = { command, before, result, hasResult: true };
        this.activeCommand = undefined;
        this.set({
          ...this.state,
          ...before,
          phase: 'uncertain',
          active: undefined,
          failedCommand: command.label,
          error: safeMessage(command.sensitive ? sensitiveCommandError() : cause),
          retryable: !command.sensitive,
          canAcknowledgeUncertainty: undefined,
        });
        discardSensitive(command);
        command.reject(command.sensitive ? sensitiveCommandError() : cause);
        return;
      }
      if (command.matches(remote, before, result) !== true) {
        this.failed = { command, before, result, hasResult: true };
        this.activeCommand = undefined;
        this.set({
          ...this.state,
          phase: 'conflict',
          active: undefined,
          failedCommand: command.label,
          error: `Authoritative result conflicts with ${command.label}`,
          remote,
          retryable: !command.sensitive,
          canAcknowledgeUncertainty: undefined,
        });
        command.reject(new Error(`Authoritative result conflicts with ${command.label}`));
        return;
      }
      this.failed = undefined;
      this.activeCommand = undefined;
      this.set({
        ...this.state,
        phase: 'success',
        active: undefined,
        failedCommand: undefined,
        error: undefined,
        remote: undefined,
        retryable: undefined,
        canAcknowledgeUncertainty: undefined,
      });
      discardSensitive(command);
      command.resolve();
    }
  }

  private async readAuthority(): Promise<TrapPersistentCollections> {
    const [savedFilters, v3Users, rules, presets] = await Promise.all([
      this.engine.traps.savedFilters.list(),
      this.engine.traps.v3Users.list(),
      this.engine.traps.rules.list(),
      this.engine.traps.presets.list(),
    ]);
    return { savedFilters, v3Users, rules, presets };
  }

  private collections(): TrapPersistentCollections {
    return {
      savedFilters: this.state.savedFilters,
      v3Users: this.state.v3Users,
      rules: this.state.rules,
      presets: this.state.presets,
    };
  }

  private commit(value: TrapPersistentCollections, token: number): void {
    if (token < this.committedAuthority) return;
    this.committedAuthority = token;
    this.set({ ...this.state, ...copy(value) });
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

  private set(next: TrapPersistentCollectionsSnapshot): void {
    if (!this.active) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}

function normalizeQuery(query: Parameters<EngineAPI['traps']['savedFilters']['save']>[1]) {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}
function normalizeFilter(item: TrapSavedFilter) {
  return normalizeFilterInput(item.name, item.query);
}
function normalizeFilterInput(name: string, query: TrapSavedFilter['query']) {
  return { name: name.trim(), query: normalizeQuery(query) };
}
function normalizePreset(item: TrapSendPreset) {
  return normalizePresetInput(item.name, item.agentId, item.payload);
}
function normalizePresetInput(name: string, agentId: string, payload: NotificationPayload) {
  return { name: name.trim(), agentId, payload };
}
function normalizeRule(item: TrapRule) {
  return normalizeRuleDraft(item);
}
function normalizeRuleDraft(draft: TrapRuleDraft) {
  return {
    name: draft.name.trim(),
    enabled: Boolean(draft.enabled),
    priority: Math.trunc(draft.priority),
    condition: {
      ...(draft.condition.trapOidGlob !== undefined
        ? { trapOidGlob: draft.condition.trapOidGlob }
        : {}),
      ...(draft.condition.sourcePrefixes !== undefined
        ? { sourcePrefixes: draft.condition.sourcePrefixes }
        : {}),
      ...(draft.condition.varbindSubstrings !== undefined
        ? { varbindSubstrings: draft.condition.varbindSubstrings }
        : {}),
    },
    actions: draft.actions,
  };
}
function rulePatchMatches(item: TrapRule, patch: Partial<TrapRuleDraft>): boolean {
  const projected = normalizeRuleDraft({ ...item, ...patch });
  return equal(normalizeRule(item), projected);
}
function normalizeV3Draft(draft: TrapV3UserDraft) {
  return {
    name: draft.name.trim(),
    level: draft.level,
    authProtocol: draft.authProtocol,
    privProtocol: draft.privProtocol,
    authPresence:
      draft.authKey !== undefined ? Boolean(draft.authKey) : draft.clearAuthKey ? false : undefined,
    privPresence:
      draft.privKey !== undefined ? Boolean(draft.privKey) : draft.clearPrivKey ? false : undefined,
  };
}
function normalizeV3Profile(item: TrapV3UserProfile) {
  return {
    name: item.name,
    level: item.level,
    authProtocol: item.authProtocol,
    privProtocol: item.privProtocol,
    hasAuthKey: item.hasAuthKey,
    hasPrivKey: item.hasPrivKey,
  };
}
function v3DraftMatches(
  item: TrapV3UserProfile,
  intended: ReturnType<typeof normalizeV3Draft>,
  prior?: TrapV3UserProfile,
): boolean | 'unknown' {
  if (
    item.name !== intended.name ||
    item.level !== intended.level ||
    item.authProtocol !== intended.authProtocol ||
    item.privProtocol !== intended.privProtocol
  )
    return false;
  // Replacing an already-present write-only key cannot be proven from a list
  // that exposes only key presence. A timeout must remain uncertain.
  if (intended.authPresence !== undefined && item.hasAuthKey !== intended.authPresence)
    return false;
  if (intended.privPresence !== undefined && item.hasPrivKey !== intended.privPresence)
    return false;
  const authUnknown = intended.authPresence === true && prior?.hasAuthKey === true;
  const privUnknown = intended.privPresence === true && prior?.hasPrivKey === true;
  return authUnknown || privUnknown ? 'unknown' : true;
}
function multiplicity<T, S>(items: T[], semantic: S, normalize: (item: T) => S): number {
  return items.filter((item) => equal(normalize(item), semantic)).length;
}

function canonicalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (Array.isArray(value))
    return value.map((item) => (item === undefined ? null : canonicalize(item)));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  return value;
}

function safeMessage(cause: unknown): string {
  const raw = message(cause);
  return /authkey|privkey|password|secret|community/i.test(raw)
    ? 'The engine rejected the secret-bearing trap configuration.'
    : raw;
}

function sensitiveCommandError(): Error {
  return new Error(
    'The engine rejected the secret-bearing trap configuration. Re-enter the keys to retry.',
  );
}

function discardSensitive(command: Command): void {
  if (!command.sensitive) return;
  command.run = () => Promise.reject(new Error('Re-enter the SNMPv3 keys before retrying.'));
}

interface ControllerEntry {
  controller: TrapPersistentCollectionsController;
  owns: () => boolean;
}
const controllers = new WeakMap<EngineAPI, ControllerEntry>();

export function trapPersistentCollectionsController(
  engine: EngineAPI,
  owns: () => boolean = () => true,
): TrapPersistentCollectionsController {
  let entry = controllers.get(engine);
  if (!entry) {
    entry = { owns, controller: new TrapPersistentCollectionsController(engine) };
    controllers.set(engine, entry);
  }
  entry.owns = owns;
  if (owns()) entry.controller.activate();
  return entry.controller;
}

export function disposeTrapPersistentCollectionsController(engine: EngineAPI): void {
  controllers.get(engine)?.controller.dispose();
}
