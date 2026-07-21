import type {
  AgentCreateDraft,
  AgentGroup,
  AgentProfile,
  AgentUpdateDraft,
  EngineAPI,
} from '@mibbeacon/core/client';
import { isAmbiguousRemoteError } from './live-mib-settings-transaction';
import { useAppStore } from './store';

export type AgentCollectionPhase =
  'confirmed' | 'queued' | 'updating' | 'success' | 'error-reverted' | 'uncertain' | 'conflict';
export interface AgentPersistentCollections {
  profiles: AgentProfile[];
  groups: AgentGroup[];
}
export interface AgentPersistentCollectionsSnapshot extends AgentPersistentCollections {
  readiness: { phase: 'unloaded' | 'loading' | 'ready' } | { phase: 'error'; error: string };
  phase: AgentCollectionPhase;
  queued: number;
  active?: string;
  failedCommand?: string;
  error?: string;
  remote?: AgentPersistentCollections;
  retryable?: boolean;
  canAcknowledgeUncertainty?: boolean;
}
type Match = (
  remote: AgentPersistentCollections,
  before: AgentPersistentCollections,
  result?: unknown,
) => boolean | 'unknown';
type Command = {
  label: string;
  owns: () => boolean;
  run: () => Promise<unknown>;
  project: (before: AgentPersistentCollections, result?: unknown) => AgentPersistentCollections;
  matches: Match;
  sensitive: boolean;
  resolve: () => void;
  reject: (cause: unknown) => void;
};
const empty = (): AgentPersistentCollections => ({ profiles: [], groups: [] });
const copy = (x: AgentPersistentCollections) => ({
  profiles: [...x.profiles],
  groups: [...x.groups],
});
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const safe = (e: unknown) =>
  /community|authkey|privkey|password|secret/i.test(msg(e))
    ? 'The engine rejected the credential-bearing agent change.'
    : msg(e);
const secretError = () =>
  new Error(
    'The engine rejected the credential-bearing agent change. Re-enter credentials to retry.',
  );
export function agentCollectionStatusText(snapshot: AgentPersistentCollectionsSnapshot) {
  if (snapshot.readiness.phase === 'loading')
    return `Loading confirmed agents…${snapshot.queued ? ` · ${snapshot.queued} queued` : ''}`;
  if (snapshot.readiness.phase === 'error') return snapshot.readiness.error;
  if (snapshot.phase === 'queued') return `${snapshot.queued} agent change(s) queued`;
  if (snapshot.phase === 'updating')
    return `Updating ${snapshot.active ?? 'agents'}… · ${snapshot.queued} queued`;
  if (snapshot.phase === 'success') return 'Agent configuration saved and confirmed';
  if (snapshot.phase === 'error-reverted')
    return `Change rejected; last-confirmed agents restored${snapshot.error ? ` · ${snapshot.error}` : ''}`;
  if (snapshot.phase === 'uncertain')
    return `Agent change outcome uncertain; reconcile with the engine${snapshot.error ? ` · ${snapshot.error}` : ''}`;
  if (snapshot.phase === 'conflict')
    return `Remote agent configuration conflict; reconcile or acknowledge${snapshot.error ? ` · ${snapshot.error}` : ''}`;
  return snapshot.phase;
}

export class AgentPersistentCollectionsController {
  private state: AgentPersistentCollectionsSnapshot = {
    ...empty(),
    readiness: { phase: 'unloaded' },
    phase: 'confirmed',
    queued: 0,
  };
  private listeners = new Set<() => void>();
  private queue: Command[] = [];
  private loadPromise?: Promise<AgentPersistentCollections>;
  private draining?: Promise<void>;
  private activeCommand?: Command;
  private failed?: {
    command: Omit<Command, 'resolve' | 'reject'>;
    before: AgentPersistentCollections;
    result?: unknown;
    hasResult: boolean;
  };
  private active = true;
  private lifecycle = 0;
  private seq = 0;
  private latestReadStarted = 0;
  private committed = 0;
  private pending?: { value: AgentPersistentCollections; token: number };
  constructor(
    private engine: EngineAPI,
    private publish?: (value: AgentPersistentCollections) => void,
  ) {}
  snapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  statusFor(label: string) {
    return this.state.active === label && this.state.phase === 'updating'
      ? 'updating'
      : this.queue.some((x) => x.label === label)
        ? 'queued'
        : undefined;
  }
  activate() {
    if (this.active) return;
    this.active = true;
    this.lifecycle++;
    this.queue = [];
    this.loadPromise = undefined;
    this.draining = undefined;
    this.failed = undefined;
    this.pending = undefined;
    this.seq = 0;
    this.latestReadStarted = 0;
    this.committed = 0;
    this.state = { ...empty(), readiness: { phase: 'unloaded' }, phase: 'confirmed', queued: 0 };
  }
  beginAuthorityRead() {
    return ++this.seq;
  }
  load(): Promise<AgentPersistentCollections> {
    if (!this.active || this.state.readiness.phase === 'ready')
      return Promise.resolve(this.collections());
    if (this.loadPromise) return this.loadPromise;
    const life = this.lifecycle,
      token = this.beginRead();
    this.set({ ...this.state, readiness: { phase: 'loading' } });
    const p = this.read()
      .then((v) => {
        if (this.owns(life) && token === this.latestReadStarted) {
          this.commit(v, token);
          this.set({ ...this.state, readiness: { phase: 'ready' } });
          void this.ensureDrain();
        }
        return v;
      })
      .catch((e) => {
        if (this.owns(life) && token === this.latestReadStarted && token >= this.committed) {
          this.rejectQueued(e);
          this.set({
            ...this.state,
            readiness: { phase: 'error', error: safe(e) },
            phase: 'error-reverted',
            queued: 0,
            error: safe(e),
          });
        }
        throw e;
      })
      .finally(() => {
        if (this.owns(life) && this.loadPromise === p) this.loadPromise = undefined;
      });
    return (this.loadPromise = p);
  }
  async refresh(_origin: 'refresh' | 'event' = 'refresh', accepts: () => boolean = () => true) {
    const life = this.lifecycle,
      token = this.beginRead();
    const v = await this.read();
    if (this.owns(life) && accepts()) this.applyAuthority(v, token);
    return this.collections();
  }
  applyAuthority(value: AgentPersistentCollections, token = ++this.seq) {
    if (!this.active || token < this.committed || token < this.latestReadStarted) return;
    if (this.draining || this.state.phase === 'updating') {
      if (!this.pending || token > this.pending.token) this.pending = { value: copy(value), token };
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
    });
    if (this.queue.length) void this.ensureDrain();
  }

  async createProfile(draft: AgentCreateDraft, owns = () => true) {
    const semantic = profileDraft(draft);
    let created: AgentProfile | undefined;
    let reconciled: AgentProfile | undefined;
    await this.enqueue(
      `profile:create:${draft.profile.name.trim()}`,
      owns,
      async () => (created = await this.engine.agents.create(draft)),
      (before, result) => ({
        ...before,
        profiles: result ? [...before.profiles, result as AgentProfile] : before.profiles,
      }),
      (remote, before, result) => {
        if (result) return remote.profiles.some((x) => samePublic(x, result as AgentProfile));
        const candidates = remote.profiles.filter(
          (candidate) =>
            !before.profiles.some((prior) => prior.id === candidate.id) &&
            profileBaseMatches(candidate, semantic),
        );
        if (candidates.length === 1) {
          reconciled = candidates[0];
          return true;
        }
        return candidates.length > 1 ? 'unknown' : false;
      },
      true,
    );
    return created ?? reconciled!;
  }
  async updateProfile(id: string, draft: AgentUpdateDraft, owns = () => true) {
    const semantic = profileUpdateSemantic(draft);
    let updated: AgentProfile | undefined;
    let reconciled: AgentProfile | undefined;
    await this.enqueue(
      `profile:update:${id}`,
      owns,
      async () => (updated = await this.engine.agents.update(id, draft)),
      (before, result) => ({
        ...before,
        profiles: before.profiles.map((x) => (x.id === id ? ((result as AgentProfile) ?? x) : x)),
      }),
      (remote, before, result) => {
        const found = remote.profiles.find((x) => x.id === id);
        if (!found) return false;
        if (result) return samePublic(found, result as AgentProfile);
        const match = profileUpdateMatch(
          found,
          before.profiles.find((x) => x.id === id),
          semantic,
        );
        if (match === true) reconciled = found;
        return match;
      },
      true,
    );
    return updated ?? reconciled!;
  }
  async saveDiscoveredProfile(
    input: Parameters<EngineAPI['tools']['discovery']['saveAgent']>[0],
    owns = () => true,
  ) {
    const publicIntent = { ip: input.ip, name: input.name?.trim() || input.ip };
    let created: AgentProfile | undefined;
    let reconciled: AgentProfile | undefined;
    await this.enqueue(
      `profile:discovery:${input.ip}`,
      owns,
      async () => (created = await this.engine.tools.discovery.saveAgent(input)),
      (before, result) => ({
        ...before,
        profiles: result ? [...before.profiles, result as AgentProfile] : before.profiles,
      }),
      (remote, before, result) => {
        if (result) return remote.profiles.some((x) => samePublic(x, result as AgentProfile));
        const candidates = remote.profiles.filter(
          (candidate) =>
            !before.profiles.some((prior) => prior.id === candidate.id) &&
            candidate.host === publicIntent.ip &&
            candidate.name === publicIntent.name,
        );
        // Discovery credentials and transport details are write-only through
        // this high-level API. A timeout cannot prove which matching public
        // candidate was created, even when only one is visible.
        if (candidates.length === 1) reconciled = candidates[0];
        return candidates.length ? 'unknown' : false;
      },
      true,
    );
    return created ?? reconciled!;
  }
  deleteProfile(id: string, owns = () => true) {
    return this.enqueue(
      `profile:delete:${id}`,
      owns,
      () => this.engine.agents.delete(id),
      (before) => ({
        profiles: before.profiles.filter((x) => x.id !== id),
        groups: before.groups.map((x) => ({ ...x, agentIds: x.agentIds.filter((a) => a !== id) })),
      }),
      (remote) =>
        !remote.profiles.some((x) => x.id === id) &&
        remote.groups.every((x) => !x.agentIds.includes(id)),
      false,
    );
  }
  createGroup(input: { name: string; agentIds: string[] }, owns = () => true) {
    const sem = { name: input.name.trim(), agentIds: unique(input.agentIds) };
    return this.enqueue(
      `group:create:${sem.name}`,
      owns,
      () => this.engine.agents.groups.create(input),
      (before, result) => ({
        ...before,
        groups: result ? [...before.groups, result as AgentGroup] : before.groups,
      }),
      (remote, before, result) =>
        result
          ? remote.groups.some((x) => sameGroup(x, result as AgentGroup))
          : multiplicity(remote.groups, sem) > multiplicity(before.groups, sem),
    );
  }
  updateGroup(id: string, input: { name?: string; agentIds?: string[] }, owns = () => true) {
    return this.enqueue(
      `group:update:${id}`,
      owns,
      () => this.engine.agents.groups.update(id, input),
      (before, result) => ({
        ...before,
        groups: before.groups.map((x) =>
          x.id === id ? ((result as AgentGroup) ?? { ...x, ...input }) : x,
        ),
      }),
      (remote, before) => {
        const found = remote.groups.find((x) => x.id === id),
          prior = before.groups.find((x) => x.id === id);
        return (
          !!found &&
          !!prior &&
          sameGroup(found, {
            ...prior,
            ...input,
            agentIds: input.agentIds ? unique(input.agentIds) : prior.agentIds,
          })
        );
      },
    );
  }
  deleteGroup(id: string, owns = () => true) {
    return this.enqueue(
      `group:delete:${id}`,
      owns,
      () => this.engine.agents.groups.delete(id),
      (before) => ({ ...before, groups: before.groups.filter((x) => x.id !== id) }),
      (remote) => !remote.groups.some((x) => x.id === id),
    );
  }
  acknowledge() {
    if (!['error-reverted', 'conflict'].includes(this.state.phase)) return;
    this.failed = undefined;
    this.set({
      ...this.state,
      phase: this.queue.length ? 'queued' : 'confirmed',
      error: undefined,
      remote: undefined,
      failedCommand: undefined,
      retryable: undefined,
    });
    void this.ensureDrain();
  }
  acknowledgeUncertainty() {
    if (this.state.phase !== 'uncertain' || !this.failed || !this.state.canAcknowledgeUncertainty)
      return;
    this.failed = undefined;
    this.set({
      ...this.state,
      phase: this.queue.length ? 'queued' : 'confirmed',
      error: undefined,
      failedCommand: undefined,
      canAcknowledgeUncertainty: undefined,
    });
    void this.ensureDrain();
  }
  retryFailed() {
    if (!this.failed || this.state.phase !== 'error-reverted') return Promise.resolve();
    if (this.failed.command.sensitive)
      return Promise.reject(new Error('Re-enter credentials before retrying.'));
    const f = this.failed.command;
    this.failed = undefined;
    this.set({
      ...this.state,
      phase: 'confirmed',
      error: undefined,
      failedCommand: undefined,
      retryable: undefined,
    });
    return this.enqueue(f.label, f.owns, f.run, f.project, f.matches, false, true);
  }
  async reconcile() {
    const life = this.lifecycle,
      token = this.beginRead(),
      remote = await this.read();
    if (!this.owns(life) || token !== this.latestReadStarted) return;
    const failed = this.failed,
      match = failed?.command.matches(
        remote,
        failed.before,
        failed.hasResult ? failed.result : undefined,
      );
    this.commit(remote, token);
    if (failed && match !== true) {
      if (match === 'unknown') {
        this.set({
          ...this.state,
          phase: 'uncertain',
          canAcknowledgeUncertainty: true,
          retryable: false,
        });
        return;
      }
      this.set({
        ...this.state,
        phase: 'conflict',
        remote,
        error: `Remote authority does not contain ${failed.command.label}`,
        retryable: !failed.command.sensitive,
      });
      return;
    }
    this.failed = undefined;
    this.set({
      ...this.state,
      readiness: { phase: 'ready' },
      phase: 'success',
      error: undefined,
      remote: undefined,
      failedCommand: undefined,
      retryable: undefined,
    });
  }
  dispose() {
    if (!this.active) return;
    this.active = false;
    this.lifecycle++;
    this.listeners.clear();
    const e = new Error('Agent collections controller was disposed');
    this.activeCommand?.reject(e);
    this.activeCommand = undefined;
    this.rejectQueued(e);
    this.failed = undefined;
  }

  private enqueue(
    label: string,
    owns: () => boolean,
    run: () => Promise<unknown>,
    project: Command['project'],
    matches: Match,
    sensitive = false,
    prepend = false,
  ) {
    if (!this.active) return Promise.reject(new Error('Agent collections controller was disposed'));
    if (['error-reverted', 'uncertain', 'conflict'].includes(this.state.phase))
      return Promise.reject(
        new Error('Resolve the previous agent change before submitting another.'),
      );
    const promise = new Promise<void>((resolve, reject) => {
      const c = { label, owns, run, project, matches, sensitive, resolve, reject };
      if (prepend) this.queue.unshift(c);
      else this.queue.push(c);
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
  private ensureDrain() {
    if (
      !this.active ||
      this.draining ||
      this.state.readiness.phase !== 'ready' ||
      ['error-reverted', 'uncertain', 'conflict'].includes(this.state.phase)
    )
      return this.draining ?? Promise.resolve();
    const life = this.lifecycle;
    const p = this.drain(life).finally(() => {
      if (this.owns(life) && this.draining === p) {
        this.draining = undefined;
        const q = this.pending;
        this.pending = undefined;
        if (q && q.token > this.committed) this.commit(q.value, q.token);
        if (this.queue.length) void this.ensureDrain();
      }
    });
    return (this.draining = p);
  }
  private async drain(life: number) {
    while (this.owns(life) && this.queue.length) {
      const c = this.queue.shift()!,
        before = this.collections();
      this.activeCommand = c;
      if (!c.owns()) {
        this.activeCommand = undefined;
        c.reject(new Error('Agent command lost engine ownership'));
        this.set({
          ...this.state,
          phase: this.queue.length ? 'queued' : 'confirmed',
          active: undefined,
          queued: this.queue.length,
        });
        continue;
      }
      this.committed = Math.max(this.committed, this.beginAuthorityRead());
      this.set({
        ...this.state,
        phase: 'updating',
        active: c.label,
        queued: this.queue.length,
        error: undefined,
      });
      let result: unknown;
      try {
        const running = c.run();
        if (c.sensitive)
          c.run = () => Promise.reject(new Error('Re-enter credentials before retrying.'));
        result = await running;
      } catch (e) {
        if (!this.owns(life) || !c.owns()) {
          this.activeCommand = undefined;
          c.reject(new Error('Agent command lost engine ownership'));
          if (this.owns(life))
            this.set({
              ...this.state,
              ...before,
              phase: this.queue.length ? 'queued' : 'confirmed',
              active: undefined,
              queued: this.queue.length,
            });
          continue;
        }
        if (/rollback outcome unknown/i.test(msg(e))) {
          this.rejectQueued();
          this.failed = { command: c, before, hasResult: false };
          this.activeCommand = undefined;
          this.set({
            ...this.state,
            ...before,
            phase: 'uncertain',
            active: undefined,
            queued: this.queue.length,
            failedCommand: c.label,
            error: safe(secretError()),
            retryable: false,
            canAcknowledgeUncertainty: true,
          });
          c.reject(secretError());
          return;
        }
        if (isAmbiguousRemoteError(e)) {
          try {
            const token = this.beginRead(),
              remote = await this.read();
            if (token !== this.latestReadStarted)
              throw new Error('Agent authority read was superseded');
            if (!this.owns(life) || !c.owns()) {
              this.activeCommand = undefined;
              c.reject(new Error('Agent command lost engine ownership'));
              if (this.owns(life))
                this.set({
                  ...this.state,
                  ...before,
                  phase: this.queue.length ? 'queued' : 'confirmed',
                  active: undefined,
                  queued: this.queue.length,
                });
              continue;
            }
            const match = c.matches(remote, before);
            this.commit(remote, token);
            if (match === true) {
              this.activeCommand = undefined;
              this.set({ ...this.state, phase: 'success', active: undefined });
              c.resolve();
              continue;
            }
            this.failed = { command: c, before, hasResult: false };
            this.rejectQueued();
            this.activeCommand = undefined;
            this.set({
              ...this.state,
              phase: match === 'unknown' ? 'uncertain' : 'conflict',
              active: undefined,
              queued: this.queue.length,
              failedCommand: c.label,
              error: safe(c.sensitive ? secretError() : e),
              remote: match === false ? remote : undefined,
              retryable: !c.sensitive,
              canAcknowledgeUncertainty: match === 'unknown',
            });
            c.reject(c.sensitive ? secretError() : e);
            return;
          } catch (readError) {
            this.failed = { command: c, before, hasResult: false };
            this.rejectQueued();
            this.activeCommand = undefined;
            this.set({
              ...this.state,
              ...before,
              phase: 'uncertain',
              active: undefined,
              queued: this.queue.length,
              failedCommand: c.label,
              error: safe(c.sensitive ? secretError() : readError),
              retryable: !c.sensitive,
            });
            c.reject(c.sensitive ? secretError() : readError);
            return;
          }
        }
        this.failed = { command: c, before, hasResult: false };
        this.rejectQueued();
        this.activeCommand = undefined;
        this.set({
          ...this.state,
          ...before,
          phase: 'error-reverted',
          active: undefined,
          queued: this.queue.length,
          failedCommand: c.label,
          error: safe(c.sensitive ? secretError() : e),
          retryable: !c.sensitive,
        });
        c.reject(c.sensitive ? secretError() : e);
        return;
      }
      if (!this.owns(life) || !c.owns()) {
        this.activeCommand = undefined;
        c.reject(new Error('Agent command lost engine ownership'));
        if (this.owns(life))
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
        const token = this.beginRead(),
          remote = await this.read();
        if (token !== this.latestReadStarted)
          throw new Error('Agent authority read was superseded');
        if (!this.owns(life) || !c.owns()) {
          this.activeCommand = undefined;
          c.reject(new Error('Agent command lost engine ownership'));
          if (this.owns(life))
            this.set({
              ...this.state,
              ...before,
              phase: this.queue.length ? 'queued' : 'confirmed',
              active: undefined,
              queued: this.queue.length,
            });
          continue;
        }
        this.commit(remote, token);
        if (c.matches(remote, before, result) !== true) {
          this.failed = { command: c, before, result, hasResult: true };
          this.rejectQueued();
          this.activeCommand = undefined;
          this.set({
            ...this.state,
            phase: 'conflict',
            active: undefined,
            queued: this.queue.length,
            failedCommand: c.label,
            error: `Authoritative result conflicts with ${c.label}`,
            remote,
            retryable: !c.sensitive,
          });
          c.reject(new Error(`Authoritative result conflicts with ${c.label}`));
          return;
        }
      } catch (e) {
        this.failed = { command: c, before, result, hasResult: true };
        this.rejectQueued();
        this.activeCommand = undefined;
        this.set({
          ...this.state,
          ...before,
          phase: 'uncertain',
          active: undefined,
          queued: this.queue.length,
          failedCommand: c.label,
          error: safe(c.sensitive ? secretError() : e),
          retryable: !c.sensitive,
        });
        c.reject(c.sensitive ? secretError() : e);
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
      });
      c.resolve();
    }
  }
  private async read() {
    const [profiles, groups] = await Promise.all([
      this.engine.agents.list(),
      this.engine.agents.groups.list(),
    ]);
    return { profiles, groups };
  }
  private rejectQueued(
    cause: unknown = new Error('Agent change cancelled because the previous change failed.'),
  ) {
    this.queue.splice(0).forEach((command) => {
      if (command.sensitive)
        command.run = () => Promise.reject(new Error('Re-enter credentials before retrying.'));
      command.reject(cause);
    });
  }
  private collections() {
    return { profiles: this.state.profiles, groups: this.state.groups };
  }
  private commit(v: AgentPersistentCollections, token: number) {
    if (token < this.committed || token < this.latestReadStarted) return;
    this.committed = token;
    this.set({ ...this.state, ...copy(v) });
    this.publish?.(copy(v));
  }
  private beginRead() {
    const token = this.beginAuthorityRead();
    this.latestReadStarted = token;
    return token;
  }
  private owns(life: number) {
    return this.active && this.lifecycle === life;
  }
  private set(v: AgentPersistentCollectionsSnapshot) {
    if (!this.active) return;
    this.state = v;
    this.listeners.forEach((x) => x());
  }
}

function unique(x: string[]) {
  return [...new Set(x)];
}
function sameGroup(
  a: Pick<AgentGroup, 'name' | 'agentIds'>,
  b: Pick<AgentGroup, 'name' | 'agentIds'>,
) {
  return (
    a.name === b.name.trim() && JSON.stringify(a.agentIds) === JSON.stringify(unique(b.agentIds))
  );
}
function multiplicity(groups: AgentGroup[], s: { name: string; agentIds: string[] }) {
  return groups.filter((x) => sameGroup(x, s)).length;
}
function samePublic(a: AgentProfile, b: AgentProfile) {
  return JSON.stringify(publicProfile(a)) === JSON.stringify(publicProfile(b));
}
function publicProfile(x: AgentProfile) {
  const {
    id,
    name,
    host,
    port,
    transport,
    version,
    timeoutMs,
    retries,
    getBulkNonRepeaters,
    getBulkMaxRepetitions,
    v3,
    hasCommunity,
    hasAuthKey,
    hasPrivKey,
  } = x;
  return {
    id,
    name,
    host,
    port,
    transport,
    version,
    timeoutMs,
    retries,
    getBulkNonRepeaters,
    getBulkMaxRepetitions,
    v3,
    hasCommunity,
    hasAuthKey,
    hasPrivKey,
  };
}
function profileDraft(d: AgentCreateDraft) {
  const active =
    d.profile.version !== 'v3'
      ? new Set(['community'])
      : d.v3?.level === 'authPriv'
        ? new Set(['authKey', 'privKey'])
        : d.v3?.level === 'authNoPriv'
          ? new Set(['authKey'])
          : new Set<string>();
  const presence = (key: 'community' | 'authKey' | 'privKey') =>
    active.has(key)
      ? d.secrets?.[key] !== undefined
        ? Boolean(d.secrets[key])
        : undefined
      : false;
  return {
    ...d.profile,
    name: d.profile.name.trim(),
    host: d.profile.host.trim(),
    port: d.profile.port ?? 161,
    transport: d.profile.transport ?? 'udp4',
    timeoutMs: d.profile.timeoutMs ?? 5000,
    retries: d.profile.retries ?? 1,
    getBulkNonRepeaters: d.profile.getBulkNonRepeaters ?? 0,
    getBulkMaxRepetitions: d.profile.getBulkMaxRepetitions ?? 20,
    v3: d.v3 ? { ...d.v3, user: d.v3.user.trim() } : undefined,
    presence: {
      community: presence('community'),
      authKey: presence('authKey'),
      privKey: presence('privKey'),
    },
  };
}
function profileBaseMatches(x: AgentProfile, s: ReturnType<typeof profileDraft>) {
  return (
    x.name === s.name &&
    x.host === s.host &&
    x.port === s.port &&
    x.transport === s.transport &&
    x.version === s.version &&
    x.timeoutMs === s.timeoutMs &&
    x.retries === s.retries &&
    x.getBulkNonRepeaters === s.getBulkNonRepeaters &&
    x.getBulkMaxRepetitions === s.getBulkMaxRepetitions &&
    JSON.stringify(x.v3) === JSON.stringify(s.v3) &&
    (s.presence.community === undefined || x.hasCommunity === s.presence.community) &&
    (s.presence.authKey === undefined || x.hasAuthKey === s.presence.authKey) &&
    (s.presence.privKey === undefined || x.hasPrivKey === s.presence.privKey)
  );
}
interface ProfileUpdateSemantic {
  profile?: AgentUpdateDraft['profile'];
  v3?: AgentUpdateDraft['v3'];
  v3Specified: boolean;
  presence: Record<'community' | 'authKey' | 'privKey', boolean | undefined>;
}
function profileUpdateSemantic(draft: AgentUpdateDraft): ProfileUpdateSemantic {
  const presence = (key: 'community' | 'authKey' | 'privKey') => {
    if (draft.secrets?.[key] !== undefined) return Boolean(draft.secrets[key]);
    return draft.clearSecrets?.includes(key) ? false : undefined;
  };
  return {
    ...(draft.profile
      ? {
          profile: {
            ...draft.profile,
            ...(draft.profile.name === undefined ? {} : { name: draft.profile.name.trim() }),
            ...(draft.profile.host === undefined ? {} : { host: draft.profile.host.trim() }),
          },
        }
      : {}),
    ...(draft.v3 !== undefined
      ? { v3: draft.v3 ? { ...draft.v3, user: draft.v3.user.trim() } : null }
      : {}),
    v3Specified: draft.v3 !== undefined,
    presence: {
      community: presence('community'),
      authKey: presence('authKey'),
      privKey: presence('privKey'),
    },
  };
}
function profileUpdateMatch(
  x: AgentProfile,
  prior: AgentProfile | undefined,
  semantic: ProfileUpdateSemantic,
): boolean | 'unknown' {
  if (!prior) return false;
  const expected = {
    ...prior,
    ...semantic.profile,
    v3: semantic.v3Specified ? (semantic.v3 ?? undefined) : prior.v3,
  };
  const active =
    expected.version !== 'v3'
      ? new Set(['community'])
      : expected.v3?.level === 'authPriv'
        ? new Set(['authKey', 'privKey'])
        : expected.v3?.level === 'authNoPriv'
          ? new Set(['authKey'])
          : new Set<string>();
  const intendedPresence = (key: 'community' | 'authKey' | 'privKey') => {
    if (!active.has(key)) return false;
    return semantic.presence[key];
  };
  if (
    !profileBaseMatches(x, {
      ...expected,
      presence: {
        community: intendedPresence('community'),
        authKey: intendedPresence('authKey'),
        privKey: intendedPresence('privKey'),
      },
    } as ReturnType<typeof profileDraft>)
  )
    return false;
  return (intendedPresence('community') === true && prior.hasCommunity) ||
    (intendedPresence('authKey') === true && prior.hasAuthKey) ||
    (intendedPresence('privKey') === true && prior.hasPrivKey)
    ? 'unknown'
    : true;
}

interface RegistryEntry {
  controller: AgentPersistentCollectionsController;
  owns: () => boolean;
}
const registry = new WeakMap<EngineAPI, RegistryEntry>();
export function agentPersistentCollectionsController(
  engine: EngineAPI,
  owns: () => boolean = () => true,
) {
  let entry = registry.get(engine);
  if (!entry) {
    const controller = new AgentPersistentCollectionsController(engine, (value) => {
      const current = registry.get(engine);
      if (current?.controller !== controller || !current.owns()) return;
      const state = useAppStore.getState();
      state.setAgentProfiles(value.profiles);
      state.setAgentGroups(value.groups);
      if (state.selectedAgentId) {
        const selected = value.profiles.find((profile) => profile.id === state.selectedAgentId);
        state.selectAgentProfile(selected ?? null);
      }
      if (
        state.selectedAgentGroupId &&
        !value.groups.some((group) => group.id === state.selectedAgentGroupId)
      )
        state.selectAgentGroup(null);
    });
    entry = { owns, controller };
    registry.set(engine, entry);
  }
  entry.owns = owns;
  if (owns()) entry.controller.activate();
  return entry.controller;
}
export function disposeAgentPersistentCollectionsController(engine: EngineAPI) {
  registry.get(engine)?.controller.dispose();
}
