import type { StorageAdapter, Transport } from '@omc/transport';
import type { ImportResult, MibStore } from '@omc/smi';
import {
  IanaEnterpriseClient,
  MibResolver,
  OidBaseClient,
  OidRefClient,
  type MibImport,
  type CachedMib,
  type MibCache,
  type ResolverProgress,
  type ResolverResult,
} from '@omc/resolver';
import type {
  MibStartImportRequest,
  OidLookupResult,
  ResolverAPI,
  ResolverOperationState,
  ResolverOperationStatus,
  ResolverOperationResult,
  ResolverSourceDraft,
  ResolverSettings,
} from './api/engine-api';
import type { EventBus } from './events';
import { OmcError } from './errors';
import { getSetting, setSetting } from './db/migrate';
import { PersistentMibCache, ResolverSourceStore } from './db/resolver-store';
import { validateMibFileBatch } from './mib-file-limits';
import type { AsyncMutationQueue } from './async-mutex';

const DEFAULT_CONSENT_TTL_MS = 5 * 60 * 1_000;
const URL_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_SETTINGS: ResolverSettings = {
  enabled: true,
  autoResolveImports: true,
  externalConsentRemembered: false,
};

interface ResolverServiceOptions {
  now?: () => number;
  consentTtlMs?: number;
}

interface ImportOperation {
  status: ResolverOperationStatus;
  controller: AbortController;
  request:
    | MibStartImportRequest
    | { modules: string[] }
    | { sourceTest: { sourceId: string; module: string } }
    | { sourcePreview: ResolverSourceDraft }
    | { oidLookup: { oid: string; network: boolean } };
  consent?: (allowed: boolean) => void;
  consentTimer?: ReturnType<typeof setTimeout>;
  stagedStore?: MibStore;
  stagedCache?: StagedMibCache;
}

class StagedMibCache implements MibCache {
  private readonly writes = new Map<string, CachedMib>();
  private readonly deletions = new Set<string>();
  constructor(private readonly base: MibCache) {}
  async get(module: string): Promise<CachedMib | undefined> {
    if (this.deletions.has(module)) return undefined;
    return this.writes.get(module) ?? this.base.get(module);
  }
  async put(value: CachedMib): Promise<void> {
    this.deletions.delete(value.module);
    this.writes.set(value.module, value);
  }
  async delete(module: string): Promise<void> {
    this.writes.delete(module);
    this.deletions.add(module);
  }
  async clear(): Promise<void> {
    this.writes.clear();
    this.deletions.clear();
  }
  async commit(): Promise<void> {
    for (const module of this.deletions) await this.base.delete(module);
    for (const value of this.writes.values()) await this.base.put(value);
  }
}

export class ResolverService {
  readonly api: ResolverAPI;
  private readonly cache: PersistentMibCache;
  private readonly sourceStore: ResolverSourceStore;
  private readonly operations = new Map<string, ImportOperation>();
  private readonly now: () => number;
  private readonly consentTtlMs: number;
  private sequence = 0;

  constructor(
    private readonly transport: Transport,
    private readonly db: StorageAdapter,
    private readonly mibStore: MibStore,
    private readonly bus: EventBus,
    private readonly mutationQueue: AsyncMutationQueue,
    options: ResolverServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.consentTtlMs = options.consentTtlMs ?? DEFAULT_CONSENT_TTL_MS;
    this.cache = new PersistentMibCache(db, transport.files);
    this.sourceStore = new ResolverSourceStore(db, transport.secrets, transport.platform, this.now);
    this.sourceStore.seedBuiltIns();
    this.api = this.buildApi();
  }

  startImport(request: MibStartImportRequest): { handleId: string } {
    if ('files' in request && request.files) validateMibFileBatch(request.files);
    const operation = this.createOperation(request);
    void this.mutationQueue
      .run(() => this.runImport(operation))
      .catch((error) => this.failUnexpected(operation, error));
    return { handleId: operation.status.handleId };
  }

  private buildApi(): ResolverAPI {
    return {
      respondConsent: async (handleId, response) => {
        const operation = this.requireOperation(handleId);
        if (operation.status.state !== 'awaiting-consent' || !operation.consent) {
          throw new Error(`Operation is not awaiting consent: ${handleId}`);
        }
        if (operation.consentTimer) clearTimeout(operation.consentTimer);
        if (response.allow && !response.askAgain) {
          this.writeSettings({ externalConsentRemembered: true });
        }
        if (!response.allow) this.finish(operation, 'cancelled', 'cancelled', { reason: 'External access denied' });
        const resume = operation.consent;
        operation.consent = undefined;
        resume(response.allow);
      },
      cancel: async (handleId) => {
        const operation = this.operations.get(handleId);
        if (!operation || isTerminal(operation.status.state)) return;
        operation.controller.abort();
        if (operation.consentTimer) clearTimeout(operation.consentTimer);
        operation.consent?.(false);
        operation.consent = undefined;
        this.finish(operation, 'cancelled', 'cancelled', { reason: 'Cancelled by user' });
      },
      status: async (handleId) => {
        const operation = this.operations.get(handleId);
        return operation ? cloneStatus(operation.status) : null;
      },
      settings: {
        get: async () => this.readSettings(),
        update: async (patch) => this.writeSettings(patch),
      },
      sources: {
        list: async () => this.sourceStore.list(),
        create: (draft) => this.sourceStore.create(draft),
        update: (sourceId, draft) => this.sourceStore.update(sourceId, draft),
        remove: (sourceId) => this.sourceStore.remove(sourceId),
        reorder: async (sourceIds) => this.sourceStore.reorder(sourceIds),
        test: async (sourceId, module) => {
          const operation = this.createOperation({ sourceTest: { sourceId, module } });
          void this.runSourceTest(operation, sourceId, module).catch((error) =>
            this.failUnexpected(operation, error),
          );
          return { handleId: operation.status.handleId };
        },
        preview: async (draft) => {
          const operation = this.createOperation({ sourcePreview: draft });
          void this.runSourcePreview(operation, draft).catch((error) =>
            this.failUnexpected(operation, error),
          );
          return { handleId: operation.status.handleId };
        },
        exportCustom: async () => this.sourceStore.exportCustom(),
        importCustom: (serialized) => this.sourceStore.importCustom(serialized),
      },
      cache: {
        stats: async () => this.cache.stats(),
        clear: () => this.cache.clear(),
      },
      history: {
        list: async (limit = 50) => this.listHistory(limit),
      },
      resolveModules: async (modules) => {
        const operation = this.createOperation({ modules });
          void this.mutationQueue
            .run(() => this.runExplicitResolution(operation, modules))
            .catch((error) => this.failUnexpected(operation, error));
        return { handleId: operation.status.handleId };
      },
      lookupOid: async (request) => {
        const operation = this.createOperation({
          oidLookup: { oid: request.oid, network: request.network ?? true },
        });
        void this.runOidLookup(operation, request.oid, request.network ?? true).catch((error) =>
          this.failUnexpected(operation, error),
        );
        return { handleId: operation.status.handleId };
      },
    };
  }

  private createOperation(request: ImportOperation['request']): ImportOperation {
    const startedAt = this.now();
    const handleId = `mib-import-${startedAt}-${this.sequence++}`;
    const operation: ImportOperation = {
      request,
      controller: new AbortController(),
      status: {
        handleId,
        state: 'started',
        startedAt,
        updatedAt: startedAt,
        missingModules: [],
        sourceHosts: [],
        loadedModules: [],
        failures: [],
      },
    };
    this.operations.set(handleId, operation);
    this.emit(operation, 'started', { request: summarizeRequest(request) });
    return operation;
  }

  private async runImport(operation: ImportOperation): Promise<void> {
    if (!('files' in operation.request || 'url' in operation.request)) return;
    operation.stagedStore = this.mibStore.fork();
    operation.stagedCache = new StagedMibCache(this.cache);
    const files = await this.materializeRequest(operation.request, operation.controller.signal);
    if (operation.controller.signal.aborted) return;
    const replaceModules = 'files' in operation.request && operation.request.files
      ? operation.request.replaceModules ?? []
      : [];
    const initial = this.importIntoStage(operation, files, replaceModules);
    operation.status.loadedModules.push(...initial.loaded);
    this.emit(operation, 'local-result', initial);
    const missing = collectMissing(initial);
    if (missing.length === 0) {
      const state = initial.errors.length === 0 ? 'done' : 'error';
      operation.status.failures.push(...initial.errors.map((error) => ({ message: error.message })));
      if (state === 'done') this.commitStage(operation);
      this.finish(operation, state, state, initial);
      return;
    }
    operation.status.failures.push(
      ...initial.errors
        .filter((error) => error.code !== 'MIB_MISSING_IMPORTS')
        .map((error) => ({ message: error.message })),
    );
    const failedNames = new Set(
      initial.errors.filter((error) => error.code === 'MIB_MISSING_IMPORTS').map((error) => error.name),
    );
    // Batch parsing is atomic, so retry the exact submitted batch after its
    // external dependencies have been resolved.
    const retryFiles = initial.loaded.length === 0 ? files : files.filter((file) => failedNames.has(file.name));
    await this.resolveAndRetry(operation, missing, retryFiles);
  }

  private async runExplicitResolution(operation: ImportOperation, modules: string[]): Promise<void> {
    operation.stagedStore = this.mibStore.fork();
    operation.stagedCache = new StagedMibCache(this.cache);
    await this.resolveAndRetry(
      operation,
      modules.map((module) => ({ module, symbols: [] })),
      [],
      true,
    );
  }

  private async resolveAndRetry(
    operation: ImportOperation,
    missing: MibImport[],
    retryFiles: { name: string; content: string }[],
    explicit = false,
  ): Promise<void> {
    if (!this.readSettings().enabled || (!explicit && !this.readSettings().autoResolveImports)) {
      operation.status.failures.push(...missing.map(({ module }) => ({ module, message: 'Automatic resolution is disabled' })));
      operation.status.loadedModules = [];
      this.finish(operation, 'error', 'error', {});
      return;
    }
    this.transition(operation, 'resolving-cache');
    const cacheResult = await this.runResolver(operation, missing, []);
    if (operation.controller.signal.aborted) return;
    if (cacheResult.status === 'resolved') {
      this.loadResolvedDocuments(operation, cacheResult);
      await this.retryAndFinish(operation, retryFiles, cacheResult);
      return;
    }

    const sources = this.availableSources();
    operation.status.missingModules = unique(cacheResult.failed.map((failure) => failure.module));
    operation.status.sourceHosts = unique(sources.flatMap((source) => source.hosts));
    if (sources.length === 0) {
      operation.status.failures.push(
        ...cacheResult.failed.map((failure) => ({ module: failure.module, message: failure.reason })),
      );
      operation.status.loadedModules = [];
      this.finish(operation, 'error', 'error', {
        message: 'No enabled external resolver sources',
      });
      return;
    }
    const settings = this.readSettings();
    if (!settings.externalConsentRemembered) {
      const allowed = await this.waitForConsent(operation);
      if (!allowed || operation.controller.signal.aborted || isTerminal(operation.status.state)) return;
    }
    this.transition(operation, 'resolving');
    const networkResult = await this.runResolver(operation, missing, sources);
    this.loadResolvedDocuments(operation, networkResult);
    if (operation.controller.signal.aborted) return;
    await this.retryAndFinish(operation, retryFiles, networkResult);
  }

  private availableSources() {
    const now = this.now();
    const cooling = new Set(
      this.db
        .all<{ source_id: string }>('SELECT source_id FROM resolver_cooldowns WHERE until_at > ?', [now])
        .map((row) => row.source_id),
    );
    return this.sourceStore.instantiate(this.transport).filter((source) => !cooling.has(source.id));
  }

  private runResolver(operation: ImportOperation, missing: MibImport[], sources: ReturnType<ResolverService['availableSources']>): Promise<ResolverResult> {
    const resolver = new MibResolver({
      sources,
      cache: operation.stagedCache ?? this.cache,
      now: this.now,
    });
    return resolver.resolve({
      missingImports: missing,
      availableModules: this.requireStage(operation).listModules().map((module) => module.name),
      signal: operation.controller.signal,
      onProgress: (progress) => this.onProgress(operation, progress),
    });
  }

  private onProgress(operation: ImportOperation, progress: ResolverProgress): void {
    if (progress.type === 'source-cooldown') {
      this.db.run(
        `INSERT INTO resolver_cooldowns (source_id, http_status, until_at, updated_at)
         VALUES (?, ?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET
         http_status=excluded.http_status, until_at=excluded.until_at, updated_at=excluded.updated_at`,
        [progress.sourceId, progress.httpStatus, progress.until, this.now()],
      );
    }
    this.emit(operation, 'source-progress', progress);
  }

  private loadResolvedDocuments(operation: ImportOperation, result: ResolverResult): void {
    const stagedStore = this.requireStage(operation);
    for (const document of result.documents) {
      if (stagedStore.listModules().some((module) => module.name === document.module)) continue;
      const imported = stagedStore.importTexts([{ name: document.module, content: document.content }]);
      operation.status.loadedModules.push(...imported.loaded);
      operation.status.failures.push(
        ...imported.errors.map((error) => ({ module: document.module, message: error.message })),
      );
    }
  }

  private async retryAndFinish(
    operation: ImportOperation,
    retryFiles: { name: string; content: string }[],
    resolution: ResolverResult,
  ): Promise<void> {
    const replaceModules = 'files' in operation.request && operation.request.files
      ? operation.request.replaceModules ?? []
      : [];
    const retry = retryFiles.length
      ? this.importIntoStage(operation, retryFiles, replaceModules)
      : { loaded: [], errors: [] };
    operation.status.loadedModules = unique([...operation.status.loadedModules, ...retry.loaded]);
    operation.status.failures.push(
      ...resolution.failed.map((failure) => ({ module: failure.module, message: failure.reason })),
      ...retry.errors.map((error) => ({ message: error.message })),
    );
    const hasFailures = operation.status.failures.length > 0 || resolution.status !== 'resolved';
    const state: ResolverOperationState = hasFailures ? 'error' : 'done';
    if (hasFailures) operation.status.loadedModules = [];
    if (state === 'done' && !operation.controller.signal.aborted) {
      this.commitStage(operation);
      try {
        await operation.stagedCache?.commit();
      } catch (error) {
        this.emit(operation, 'cache-warning', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.finish(operation, state, state, { resolution, retry });
  }

  private waitForConsent(operation: ImportOperation): Promise<boolean> {
    const expiresAt = this.now() + this.consentTtlMs;
    operation.status.expiresAt = expiresAt;
    return new Promise<boolean>((resolve) => {
      operation.consent = resolve;
      operation.consentTimer = setTimeout(() => {
        if (operation.status.state !== 'awaiting-consent') return;
        operation.consent = undefined;
        this.finish(operation, 'expired', 'error', { code: 'CONSENT_EXPIRED' });
        resolve(false);
      }, this.consentTtlMs);
      unrefTimer(operation.consentTimer);
      this.transition(operation, 'awaiting-consent');
      this.emit(operation, 'consent-required', {
        missingModules: operation.status.missingModules,
        sourceHosts: operation.status.sourceHosts,
        expiresAt,
      });
    });
  }

  private async materializeRequest(
    request: MibStartImportRequest,
    signal: AbortSignal,
  ): Promise<{ name: string; content: string }[]> {
    if ('files' in request && request.files) return request.files.map((file) => ({ ...file }));
    const response = await this.transport.http.fetch({ url: request.url, maxBytes: URL_MAX_BYTES, signal });
    if (!response.ok) throw new OmcError('SOURCE_UNREACHABLE', `fetch failed with HTTP ${response.status}`);
    validateMibResponse(response.text);
    return [{ name: request.url.split('/').pop() || 'downloaded-mib', content: response.text }];
  }

  private importIntoStage(
    operation: ImportOperation,
    files: { name: string; content: string; relativePath?: string }[],
    replaceModules: string[] = [],
  ): ImportResult {
    const stagedStore = this.requireStage(operation);
    const result = replaceModules.length
      ? stagedStore.replaceTexts(files, replaceModules)
      : stagedStore.importTexts(files);
    return result;
  }

  private requireStage(operation: ImportOperation): MibStore {
    if (!operation.stagedStore) throw new Error('Resolver operation has no staged catalog');
    return operation.stagedStore;
  }

  private commitStage(operation: ImportOperation): void {
    if (operation.controller.signal.aborted) throw new Error('Resolver operation aborted');
    const stagedStore = this.requireStage(operation);
    const sources = stagedStore.userSourceDocuments();
    this.db.transaction(() => {
      this.db.run('DELETE FROM mib_modules');
      for (const source of sources) {
        this.db.run(
          'INSERT INTO mib_modules (name, content, loaded_at) VALUES (?, ?, ?)',
          [source.name, source.content, this.now()],
        );
      }
    });
    // The in-memory swap is non-throwing and occurs only after SQLite commits.
    this.mibStore.adopt(stagedStore);
    this.bus.emit({
      channel: 'tools',
      kind: 'catalog-changed',
      payload: { action: 'import', modules: [...operation.status.loadedModules] },
    });
  }

  private readSettings(): ResolverSettings {
    return { ...DEFAULT_SETTINGS, ...(getSetting<Partial<ResolverSettings>>(this.db, 'resolver.settings') ?? {}) };
  }

  private writeSettings(patch: Partial<ResolverSettings>): ResolverSettings {
    const settings = { ...this.readSettings(), ...patch };
    setSetting(this.db, 'resolver.settings', settings);
    return settings;
  }

  private async lookupOid(
    oid: string,
    network: boolean,
    signal?: AbortSignal,
  ): Promise<OidLookupResult> {
    throwIfAborted(signal);
    const loaded = this.mibStore.index.resolve(oid);
    const cached = this.db.get<{ value_json: string; expires_at: number }>(
      "SELECT value_json, expires_at FROM resolver_lookup_cache WHERE kind = 'aggregate' AND lookup_key = ?",
      [oid],
    );
    if (cached && cached.expires_at > this.now()) {
      return { ...(JSON.parse(cached.value_json) as OidLookupResult), loaded, fromCache: true };
    }
    const normalizedOid = oid.startsWith('.') ? oid.slice(1) : oid;
    const localEvidence = loaded?.definitionOid === normalizedOid
      ? [loaded.name, loaded.module ?? '']
      : [];
    const candidates = this.sourceStore.candidates(localEvidence);
    if (!network) return { oid, loaded, enterprise: null, oidBase: null, oidRef: null, fromCache: false, candidates };
    const [enterprise, oidBase, oidRef] = await Promise.all([
      new IanaEnterpriseClient(this.transport.http).lookupOid(oid, signal).catch(() => null),
      new OidBaseClient(this.transport.http).lookup(oid, signal).catch(() => null),
      new OidRefClient(this.transport.http).lookup(oid, signal).catch(() => null),
    ]);
    throwIfAborted(signal);
    const relevantCandidates = this.sourceStore.candidates([
      ...localEvidence,
      enterprise?.organization ?? '',
      oidBase?.asn1Notation ?? '',
      oidRef?.title ?? '',
    ]);
    const result: OidLookupResult = {
      oid,
      loaded,
      enterprise,
      oidBase,
      oidRef,
      fromCache: false,
      candidates: relevantCandidates,
    };
    this.db.run(
      `INSERT INTO resolver_lookup_cache (kind, lookup_key, value_json, expires_at, stored_at)
       VALUES ('aggregate', ?, ?, ?, ?) ON CONFLICT(kind, lookup_key) DO UPDATE SET
       value_json=excluded.value_json, expires_at=excluded.expires_at, stored_at=excluded.stored_at`,
      [oid, JSON.stringify(result), this.now() + 7 * 24 * 60 * 60 * 1_000, this.now()],
    );
    return result;
  }

  private transition(operation: ImportOperation, state: ResolverOperationState): void {
    if (isTerminal(operation.status.state)) return;
    operation.status.state = state;
    operation.status.updatedAt = this.now();
  }

  private finish(
    operation: ImportOperation,
    state: Extract<ResolverOperationState, 'done' | 'partial' | 'error' | 'cancelled' | 'expired'>,
    eventKind: string,
    payload: unknown,
  ): void {
    if (isTerminal(operation.status.state)) return;
    this.transition(operation, state);
    if (operation.consentTimer) clearTimeout(operation.consentTimer);
    const safeResult = redactPayload(payload);
    operation.status.result = safeResult as ResolverOperationResult;
    operation.status.missingModules = [];
    operation.status.sourceHosts = [];
    operation.status.expiresAt = undefined;
    this.emit(operation, eventKind, { status: cloneStatus(operation.status), result: safeResult });
    this.db.run(
      `INSERT INTO resolver_history
       (handle_id, status, requested_json, result_json, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [operation.status.handleId, state, JSON.stringify(summarizeRequest(operation.request)), JSON.stringify(safeResult), operation.status.startedAt, this.now()],
    );
    operation.request = { modules: [] };
    operation.stagedStore = undefined;
    operation.stagedCache = undefined;
    this.pruneOperations();
  }

  private failUnexpected(operation: ImportOperation, error: unknown): void {
    if (isTerminal(operation.status.state)) return;
    const message = error instanceof Error ? error.message : String(error);
    operation.status.failures.push({ message });
    this.finish(operation, 'error', 'error', { message });
  }

  private emit(operation: ImportOperation, kind: string, payload: unknown): void {
    this.bus.emit({ channel: 'resolver', handleId: operation.status.handleId, kind, payload });
  }

  private requireOperation(handleId: string): ImportOperation {
    const operation = this.operations.get(handleId);
    if (!operation) throw new Error(`Unknown resolver operation: ${handleId}`);
    return operation;
  }

  private async runSourceTest(
    operation: ImportOperation,
    sourceId: string,
    module: string,
  ): Promise<void> {
    const source = this.availableSources().find((candidate) => candidate.id === sourceId);
    if (!source) {
      this.finish(operation, 'error', 'error', { ok: false, sourceId, module, message: 'Source is disabled or unavailable' });
      return;
    }
    operation.status.missingModules = [module];
    operation.status.sourceHosts = source.hosts;
    if (!this.readSettings().externalConsentRemembered) {
      const allowed = await this.waitForConsent(operation);
      if (!allowed || isTerminal(operation.status.state)) return;
    }
    this.transition(operation, 'resolving');
    const result = await this.sourceStore.test(
      sourceId,
      module,
      this.transport,
      operation.controller.signal,
    );
    this.finish(operation, result.ok ? 'done' : 'error', result.ok ? 'done' : 'error', result);
  }

  private async runSourcePreview(
    operation: ImportOperation,
    draft: ResolverSourceDraft,
  ): Promise<void> {
    if (draft.config.kind !== 'json-catalog') {
      this.finish(operation, 'error', 'error', { message: 'Only JSON catalog sources can be previewed' });
      return;
    }
    let host: string;
    try {
      host = new URL(draft.config.catalogUrl).host;
    } catch {
      this.finish(operation, 'error', 'error', { message: 'Invalid JSON catalog URL' });
      return;
    }
    operation.status.sourceHosts = [host];
    if (!this.readSettings().externalConsentRemembered) {
      const allowed = await this.waitForConsent(operation);
      if (!allowed || isTerminal(operation.status.state)) return;
    }
    this.transition(operation, 'resolving');
    const result = await this.sourceStore.preview(
      draft,
      this.transport,
      operation.controller.signal,
    );
    throwIfAborted(operation.controller.signal);
    this.finish(operation, 'done', 'done', result);
  }

  private async runOidLookup(
    operation: ImportOperation,
    oid: string,
    network: boolean,
  ): Promise<void> {
    const preliminary = await this.lookupOid(oid, false, operation.controller.signal);
    const normalizedOid = oid.startsWith('.') ? oid.slice(1) : oid;
    const hasExactLocal = preliminary.loaded?.definitionOid === normalizedOid;
    if (!network || hasExactLocal || preliminary.fromCache) {
      this.finish(operation, 'done', 'done', preliminary);
      return;
    }
    if (network && !this.readSettings().externalConsentRemembered) {
      operation.status.sourceHosts = ['www.iana.org', 'oid-base.com', 'oidref.com'];
      const allowed = await this.waitForConsent(operation);
      if (!allowed || isTerminal(operation.status.state)) return;
    }
    this.transition(operation, 'resolving');
    const result = await this.lookupOid(oid, network, operation.controller.signal);
    this.finish(operation, 'done', 'done', result);
  }

  private listHistory(limit: number) {
    const bounded = Math.max(1, Math.min(200, Math.trunc(limit)));
    return this.db
      .all<{
        handle_id: string;
        status: ResolverOperationState;
        requested_json: string;
        result_json: string;
        started_at: number;
        finished_at: number;
      }>(
        `SELECT handle_id, status, requested_json, result_json, started_at, finished_at
         FROM resolver_history ORDER BY id DESC LIMIT ?`,
        [bounded],
      )
      .map((row) => ({
        handleId: row.handle_id,
        status: row.status,
        requested: JSON.parse(row.requested_json) as unknown,
        result: JSON.parse(row.result_json) as unknown,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
      }));
  }

  private pruneOperations(): void {
    const terminal = [...this.operations.entries()].filter(([, operation]) =>
      isTerminal(operation.status.state),
    );
    for (const [handleId] of terminal.slice(0, Math.max(0, terminal.length - 100))) {
      this.operations.delete(handleId);
    }
  }
}

function collectMissing(result: ImportResult): MibImport[] {
  const merged = new Map<string, Set<string>>();
  for (const item of result.errors.flatMap((error) => error.missingImports ?? [])) {
    const symbols = merged.get(item.module) ?? new Set<string>();
    item.symbols.forEach((symbol) => symbols.add(symbol));
    merged.set(item.module, symbols);
  }
  return [...merged].map(([module, symbols]) => ({ module, symbols: [...symbols] }));
}

function cloneStatus(status: ResolverOperationStatus): ResolverOperationStatus {
  return {
    ...status,
    missingModules: [...status.missingModules],
    sourceHosts: [...status.sourceHosts],
    loadedModules: [...status.loadedModules],
    failures: status.failures.map((failure) => ({ ...failure })),
  };
}

function isTerminal(state: ResolverOperationState): boolean {
  return ['done', 'partial', 'error', 'cancelled', 'expired'].includes(state);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function summarizeRequest(request: ImportOperation['request']): unknown {
  if ('modules' in request) return { modules: request.modules };
  if ('sourceTest' in request) return request;
  if ('sourcePreview' in request) {
    return { sourcePreview: { id: request.sourcePreview.config.id, kind: request.sourcePreview.config.kind } };
  }
  if ('oidLookup' in request) return request;
  if ('url' in request) return { url: request.url };
  return { files: request.files.map((file) => ({ name: file.name, bytes: file.content.length })) };
}

function redactPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPayload);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'content') continue;
    result[key] = redactPayload(child);
  }
  return result;
}

function validateMibResponse(content: string): void {
  const head = content.slice(0, 2048);
  if (/<html|<!doctype/i.test(head) || !/DEFINITIONS\s*::=\s*BEGIN/.test(content)) {
    throw new OmcError('CONTENT_VALIDATION_FAILED', 'response is not a MIB module');
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Resolver operation aborted');
  error.name = 'AbortError';
  throw error;
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer !== 'object' || timer === null || !('unref' in timer)) return;
  const unref = (timer as { unref?: () => void }).unref;
  if (typeof unref === 'function') unref.call(timer);
}
