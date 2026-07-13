import type { FileStore, SecretStore, StorageAdapter, Transport } from '@mibbeacon/transport';
import {
  BUILTIN_SOURCE_CONFIGS,
  FtpSource,
  GitHubTreeSource,
  HttpTemplateSource,
  JsonCatalogSource,
  evaluateSimpleJsonPath,
  previewJsonCatalog,
  PassiveFtpClient,
  type CachedMib,
  type MibCache,
  type MibSource,
  type SourceConfig,
  type SourceIndexStore,
  type SourceIndexSnapshot,
} from '@mibbeacon/resolver';
import type {
  ResolverCacheStats,
  ResolverSourceDraft,
  ResolverSourceTestResult,
  ResolverSourcePreviewResult,
} from '../api/engine-api';

const BUILTIN_PRIORITY_OFFSET = 1_000;

interface CacheRow {
  module: string;
  content_key: string;
  source_id: string;
  location: string;
  warnings_json: string;
  stored_at: number;
}

export class PersistentMibCache implements MibCache {
  private readonly directory: string;

  constructor(
    private readonly db: StorageAdapter,
    private readonly files: FileStore,
  ) {
    this.directory = files.join(files.dataDir(), 'resolver-cache');
  }

  async get(module: string): Promise<CachedMib | undefined> {
    const row = this.db.get<CacheRow>(
      'SELECT module, content_key, source_id, location, warnings_json, stored_at FROM resolver_cache WHERE module = ?',
      [module],
    );
    if (!row) return undefined;
    const path = this.path(row.content_key);
    if (!(await this.files.exists(path))) {
      this.db.run('DELETE FROM resolver_cache WHERE module = ?', [module]);
      return undefined;
    }
    return {
      module: row.module,
      content: await this.files.readText(path),
      sourceId: row.source_id,
      location: row.location,
      warnings: JSON.parse(row.warnings_json) as string[],
      storedAt: row.stored_at,
    };
  }

  async put(value: CachedMib): Promise<void> {
    const contentKey = contentAddress(value.content);
    await this.files.ensureDir(this.directory);
    await this.files.writeText(this.path(contentKey), value.content);
    this.db.run(
      `INSERT INTO resolver_cache
       (module, content_key, source_id, location, warnings_json, size_bytes, stored_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(module) DO UPDATE SET content_key=excluded.content_key,
       source_id=excluded.source_id, location=excluded.location,
       warnings_json=excluded.warnings_json, size_bytes=excluded.size_bytes,
       stored_at=excluded.stored_at`,
      [
        value.module,
        contentKey,
        value.sourceId,
        value.location,
        JSON.stringify(value.warnings ?? []),
        new TextEncoder().encode(value.content).byteLength,
        value.storedAt ?? Date.now(),
      ],
    );
  }

  async delete(module: string): Promise<void> {
    const row = this.db.get<{ content_key: string }>(
      'SELECT content_key FROM resolver_cache WHERE module = ?',
      [module],
    );
    this.db.run('DELETE FROM resolver_cache WHERE module = ?', [module]);
    if (row && !this.db.get('SELECT 1 FROM resolver_cache WHERE content_key = ?', [row.content_key])) {
      await this.files.remove(this.path(row.content_key));
    }
  }

  async clear(): Promise<void> {
    this.db.run('DELETE FROM resolver_cache');
    await this.files.remove(this.directory);
  }

  stats(): ResolverCacheStats {
    return (
      this.db.get<ResolverCacheStats>(
        'SELECT COUNT(*) AS entries, COALESCE(SUM(size_bytes), 0) AS bytes FROM resolver_cache',
      ) ?? { entries: 0, bytes: 0 }
    );
  }

  private path(contentKey: string): string {
    return this.files.join(this.directory, `${contentKey}.mib`);
  }
}

export class ResolverSourceStore {
  private readonly constructionErrors = new Map<string, string>();

  constructor(
    private readonly db: StorageAdapter,
    private readonly secrets: SecretStore,
    private readonly platform: Transport['platform'],
    private readonly now: () => number = Date.now,
  ) {}

  seedBuiltIns(): void {
    for (const [index, source] of BUILTIN_SOURCE_CONFIGS.entries()) {
      const config = { ...source, priority: BUILTIN_PRIORITY_OFFSET + index } as SourceConfig;
      this.db.run(
        `INSERT OR IGNORE INTO resolver_sources
         (id, kind, name, enabled, priority, built_in, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [config.id, config.kind, config.name, config.enabled ? 1 : 0, config.priority, JSON.stringify(config), this.now(), this.now()],
      );
    }
  }

  list(): SourceConfig[] {
    return this.db
      .all<{ id: string; kind: string; name: string; config_json: string; enabled: number; priority: number; built_in: number }>(
        'SELECT id, kind, name, config_json, enabled, priority, built_in FROM resolver_sources ORDER BY priority, name',
      )
      .map((row) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.config_json) as unknown;
          assertValidSourceConfig(parsed, this.platform);
          const stored = parsed as SourceConfig;
          if (!this.secrets.isEncrypted() && hasStoredSecretReferences(stored)) {
            throw new Error('Stored credentials are unavailable because encrypted credential storage is not configured on this engine host');
          }
          const config = sanitizePersistedRefs({
            ...stored,
            enabled: Boolean(row.enabled),
            priority: row.priority,
            builtIn: Boolean(row.built_in),
          });
          const constructionError = this.constructionErrors.get(config.id);
          return constructionError
            ? { ...config, enabled: false, validationError: constructionError }
            : config;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return invalidPersistedSource(row, parsed, message);
        }
      });
  }

  get(sourceId: string): SourceConfig | undefined {
    return this.list().find((source) => source.id === sourceId);
  }

  async create(draft: ResolverSourceDraft): Promise<SourceConfig> {
    if (draft.config.kind === 'cache') throw new Error('Cache source is built-in only');
    if (this.get(draft.config.id)) throw new Error(`Resolver source already exists: ${draft.config.id}`);
    this.assertCredentialStorage(draft);
    assertValidSourceConfig(draft.config, this.platform);
    const safeDraft = { ...draft, config: stripCallerSecretRefs(draft.config) };
    const config = await this.withSecrets({ ...safeDraft.config, builtIn: false }, safeDraft);
    const customPriorities = this.list().filter((source) => !source.builtIn).map((source) => source.priority);
    config.priority = customPriorities.length === 0 ? 0 : Math.min(...customPriorities) - 1;
    this.write(config, false);
    return config;
  }

  async update(sourceId: string, draft: ResolverSourceDraft): Promise<SourceConfig> {
    const current = this.get(sourceId);
    if (!current) throw new Error(`Unknown resolver source: ${sourceId}`);
    this.assertCredentialStorage(draft);
    assertValidSourceConfig(draft.config, this.platform);
    if (!current.builtIn && draft.config.kind === 'cache') throw new Error('Cache source is built-in only');
    if (current.builtIn && (draft.config.id !== sourceId || draft.config.kind !== current.kind)) {
      throw new Error('Built-in source identity and kind cannot be changed');
    }
    const safeDraft = { ...draft, config: stripCallerSecretRefs(draft.config) };
    const config = await this.withSecrets(
      { ...safeDraft.config, id: sourceId, builtIn: Boolean(current.builtIn), priority: current.priority },
      safeDraft,
      current,
    );
    this.write(config, Boolean(current.builtIn));
    this.invalidateSource(sourceId);
    return config;
  }

  async remove(sourceId: string): Promise<void> {
    const current = this.get(sourceId);
    if (!current) return;
    if (current.builtIn) throw new Error('Built-in resolver sources cannot be removed');
    await this.deleteSecrets(current);
    this.db.run('DELETE FROM resolver_sources WHERE id = ?', [sourceId]);
    this.invalidateSource(sourceId);
  }

  reorder(sourceIds: string[]): SourceConfig[] {
    const all = this.list();
    const requested = new Set(sourceIds);
    const ordered = [
      ...sourceIds.flatMap((id) => all.find((source) => source.id === id) ?? []),
      ...all.filter((source) => !requested.has(source.id)),
    ];
    this.db.transaction(() => {
      ordered.forEach((source, index) => {
        this.db.run('UPDATE resolver_sources SET priority = ?, updated_at = ? WHERE id = ?', [index, this.now(), source.id]);
      });
    });
    return this.list();
  }

  exportCustom(): string {
    const configs = this.list().filter((source) => !source.builtIn).map(redactSecretReferences);
    return JSON.stringify({ version: 1, sources: configs }, null, 2);
  }

  async importCustom(serialized: string): Promise<SourceConfig[]> {
    const parsed = JSON.parse(serialized) as { sources?: unknown[] };
    if (!Array.isArray(parsed.sources)) throw new Error('Source export must contain a sources array');
    const configs: SourceConfig[] = [];
    for (const value of parsed.sources) {
      assertValidSourceConfig(value, this.platform);
      if (value.kind === 'cache') throw new Error('Cache source is built-in only');
      configs.push(value);
    }
    for (const value of configs) {
      const existing = this.get(value.id);
      if (existing?.builtIn) continue;
      if (existing) await this.update(value.id, { config: value });
      else await this.create({ config: value });
    }
    return this.list();
  }

  instantiate(transport: Transport): MibSource[] {
    const resolveSecret = (reference: string) => transport.secrets.get(reference);
    const ftpClient = new PassiveFtpClient(transport.tcp);
    return this.list().flatMap((config): MibSource[] => {
      if (!config.enabled || config.kind === 'cache' || config.validationError) return [];
      try {
        let source: MibSource;
        if (config.kind === 'http-template') source = new HttpTemplateSource(config, transport.http, resolveSecret);
        else if (config.kind === 'github-tree') {
          source = new GitHubTreeSource(config, transport.http, resolveSecret, this.indexStore(config.id));
        } else if (config.kind === 'json-catalog') {
          source = new JsonCatalogSource(config, transport.http, resolveSecret, this.now, this.indexStore(config.id));
        } else {
          source = new FtpSource(config, ftpClient, resolveSecret);
        }
        this.constructionErrors.delete(config.id);
        return [source];
      } catch (error) {
        this.constructionErrors.set(
          config.id,
          `Source could not be initialized: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      }
    });
  }

  async test(
    sourceId: string,
    module: string,
    transport: Transport,
    signal?: AbortSignal,
  ): Promise<ResolverSourceTestResult> {
    const source = this.instantiate(transport).find((candidate) => candidate.id === sourceId);
    if (!source) return { ok: false, sourceId, module, message: 'Source is disabled or unavailable' };
    try {
      const result = await source.fetch(module, { signal });
      return result.status === 'found'
        ? { ok: true, sourceId, module, location: result.location }
        : { ok: false, sourceId, module, message: result.reason ?? 'Module not found' };
    } catch (error) {
      return { ok: false, sourceId, module, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async preview(
    draft: ResolverSourceDraft,
    transport: Transport,
    signal?: AbortSignal,
  ): Promise<ResolverSourcePreviewResult> {
    assertValidSourceConfig(draft.config, this.platform);
    if (draft.config.kind !== 'json-catalog') {
      throw new Error('Source preview requires a valid JSON catalog configuration');
    }
    const config = stripCallerSecretRefs(draft.config);
    if (config.kind !== 'json-catalog') throw new Error('Source preview requires JSON catalog');
    const ephemeral = new Map<string, string>();
    if (draft.secrets?.password) {
      config.passwordRef = 'preview:password';
      ephemeral.set(config.passwordRef, draft.secrets.password);
    }
    if (draft.secrets?.headers) {
      config.secretHeaders = {};
      for (const [name, value] of Object.entries(draft.secrets.headers)) {
        const reference = `preview:header:${headerKey(name)}`;
        config.secretHeaders[name] = reference;
        ephemeral.set(reference, value);
      }
    }
    const entries = await previewJsonCatalog(
      config,
      transport.http,
      async (reference) => ephemeral.get(reference) ?? null,
      signal,
      20,
    );
    return { kind: 'source-preview', sourceId: config.id, entries };
  }

  candidates(evidence: string[]): { module: string; sourceId: string; location?: string }[] {
    const terms = evidence
      .flatMap((value) => value.toUpperCase().split(/[^A-Z0-9]+/))
      .filter(
        (term) =>
          term.length >= 3 &&
          !['MIB', 'THE', 'INC', 'CORP', 'ISO', 'ORG', 'DOD', 'INTERNET', 'PRIVATE', 'ENTERPRISES'].includes(term),
      );
    if (terms.length === 0) return [];
    const candidates: { module: string; sourceId: string; location?: string }[] = [];
    for (const row of this.db.all<{ source_id: string; value_json: string }>(
      'SELECT source_id, value_json FROM resolver_source_indexes ORDER BY updated_at DESC',
    )) {
      const parsed = JSON.parse(row.value_json) as { entries?: Record<string, string> };
      for (const [module, location] of Object.entries(parsed.entries ?? {})) {
        const haystack = `${module} ${location}`.toUpperCase();
        if (!terms.some((term) => haystack.includes(term))) continue;
        candidates.push({ module, sourceId: row.source_id, location });
        if (candidates.length >= 50) return candidates;
      }
    }
    return candidates;
  }

  private indexStore(sourceId: string): SourceIndexStore {
    return {
      load: async () => {
        const row = this.db.get<{ value_json: string }>(
          "SELECT value_json FROM resolver_source_indexes WHERE source_id = ? AND index_key = 'modules'",
          [sourceId],
        );
        return row ? (JSON.parse(row.value_json) as Awaited<ReturnType<SourceIndexStore['load']>>) : null;
      },
      save: async (snapshot: SourceIndexSnapshot) => {
        this.db.run(
          `INSERT INTO resolver_source_indexes
           (source_id, index_key, value_json, etag, updated_at)
           VALUES (?, 'modules', ?, ?, ?) ON CONFLICT(source_id, index_key) DO UPDATE SET
           value_json=excluded.value_json, etag=excluded.etag, updated_at=excluded.updated_at`,
          [sourceId, JSON.stringify(snapshot), snapshot.etag ?? null, snapshot.refreshedAt],
        );
      },
    };
  }

  private write(config: SourceConfig, builtIn: boolean): void {
    this.constructionErrors.delete(config.id);
    this.db.run(
      `INSERT INTO resolver_sources
       (id, kind, name, enabled, priority, built_in, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, name=excluded.name,
       enabled=excluded.enabled, priority=excluded.priority, built_in=excluded.built_in,
       config_json=excluded.config_json, updated_at=excluded.updated_at`,
      [config.id, config.kind, config.name, config.enabled ? 1 : 0, config.priority, builtIn ? 1 : 0, JSON.stringify(config), this.now(), this.now()],
    );
  }

  private async withSecrets(
    config: SourceConfig,
    draft: ResolverSourceDraft,
    current?: SourceConfig,
  ): Promise<SourceConfig> {
    const next = { ...config } as SourceConfig;
    const candidatePasswordRef = current && 'passwordRef' in current ? current.passwordRef : undefined;
    const candidateTokenRef = current?.kind === 'github-tree' ? current.tokenRef : undefined;
    const currentPasswordRef = isOwnedRef(next.id, candidatePasswordRef) ? candidatePasswordRef : undefined;
    const currentTokenRef = isOwnedRef(next.id, candidateTokenRef) ? candidateTokenRef : undefined;
    const currentSecretHeaders =
      current && (current.kind === 'http-template' || current.kind === 'json-catalog')
        ? Object.fromEntries(
            Object.entries(current.secretHeaders ?? {}).filter(([, ref]) => isOwnedRef(next.id, ref)),
          )
        : undefined;
    const usesPassword =
      next.kind === 'ftp' ||
      ((next.kind === 'http-template' || next.kind === 'json-catalog') && next.authKind === 'basic');
    const clears = new Set(draft.clearSecrets ?? []);
    if (currentPasswordRef && usesPassword && !draft.secrets?.password && !clears.has('password')) {
      (next as SourceConfig & { passwordRef: string }).passwordRef = currentPasswordRef;
    }
    if (currentPasswordRef && (!usesPassword || clears.has('password'))) {
      await this.secrets.delete(currentPasswordRef);
      delete (next as SourceConfig & { passwordRef?: string }).passwordRef;
    }
    if (next.kind === 'github-tree' && currentTokenRef && !draft.secrets?.token && !clears.has('token')) {
      next.tokenRef = currentTokenRef;
    }
    if (currentTokenRef && (next.kind !== 'github-tree' || clears.has('token'))) {
      await this.secrets.delete(currentTokenRef);
      if (next.kind === 'github-tree') delete next.tokenRef;
    }
    if (next.kind === 'http-template' || next.kind === 'json-catalog') {
      if (currentSecretHeaders && !draft.secrets?.headers && !clears.has('headers')) {
        next.secretHeaders = { ...currentSecretHeaders };
      }
      if (clears.has('headers')) {
        await Promise.all(Object.values(currentSecretHeaders ?? {}).map((ref) => this.secrets.delete(ref)));
        delete next.secretHeaders;
      }
      if (draft.secrets?.headers) {
        await Promise.all(Object.values(currentSecretHeaders ?? {}).map((ref) => this.secrets.delete(ref)));
        next.secretHeaders = {};
        for (const [name, value] of Object.entries(draft.secrets.headers)) {
          const ref = `resolver-source:${next.id}:header:${headerKey(name)}`;
          await this.secrets.set(ref, value);
          next.secretHeaders[name] = ref;
        }
      }
    } else if (currentSecretHeaders) {
      await Promise.all(Object.values(currentSecretHeaders).map((ref) => this.secrets.delete(ref)));
    }
    if (draft.secrets?.password && usesPassword) {
      const reference = `resolver-source:${next.id}:password`;
      await this.secrets.set(reference, draft.secrets.password);
      (next as SourceConfig & { passwordRef: string }).passwordRef = reference;
      if (currentPasswordRef && currentPasswordRef !== reference) await this.secrets.delete(currentPasswordRef);
    }
    if (draft.secrets?.token && next.kind === 'github-tree') {
      const reference = `resolver-source:${next.id}:token`;
      await this.secrets.set(reference, draft.secrets.token);
      next.tokenRef = reference;
      if (currentTokenRef && currentTokenRef !== reference) await this.secrets.delete(currentTokenRef);
    }
    return next;
  }

  private async deleteSecrets(config: SourceConfig): Promise<void> {
    if ('passwordRef' in config && isOwnedRef(config.id, config.passwordRef)) {
      await this.secrets.delete(config.passwordRef!);
    }
    if (config.kind === 'github-tree' && isOwnedRef(config.id, config.tokenRef)) {
      await this.secrets.delete(config.tokenRef!);
    }
    if (config.kind === 'http-template' || config.kind === 'json-catalog') {
      await Promise.all(
        Object.values(config.secretHeaders ?? {})
          .filter((ref) => isOwnedRef(config.id, ref))
          .map((ref) => this.secrets.delete(ref)),
      );
    }
  }

  private invalidateSource(sourceId: string): void {
    this.db.run('DELETE FROM resolver_source_indexes WHERE source_id = ?', [sourceId]);
    this.db.run('DELETE FROM resolver_cooldowns WHERE source_id = ?', [sourceId]);
    this.db.run('DELETE FROM resolver_lookup_cache');
  }

  private assertCredentialStorage(draft: ResolverSourceDraft): void {
    const hasCredentials = Boolean(
      draft.secrets?.password ||
      draft.secrets?.token ||
      (draft.secrets?.headers && Object.keys(draft.secrets.headers).length > 0),
    );
    if (hasCredentials && !this.secrets.isEncrypted()) {
      throw new Error(
        'Encrypted credential storage is unavailable on this engine host; configure encrypted storage or remove the source credentials',
      );
    }
  }
}

function contentAddress(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${bytes.byteLength.toString(16)}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function redactSecretReferences(config: SourceConfig): SourceConfig {
  const copy = { ...config } as SourceConfig & { passwordRef?: string; tokenRef?: string };
  delete copy.passwordRef;
  delete copy.tokenRef;
  delete (copy as SourceConfig & { secretHeaders?: Record<string, string> }).secretHeaders;
  return copy;
}

function headerKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function stripCallerSecretRefs(config: SourceConfig): SourceConfig {
  const safe = { ...config } as SourceConfig & {
    passwordRef?: string;
    tokenRef?: string;
    secretHeaders?: Record<string, string>;
  };
  delete safe.passwordRef;
  delete safe.tokenRef;
  delete safe.secretHeaders;
  delete safe.validationError;
  return safe;
}

function isOwnedRef(sourceId: string, reference?: string): boolean {
  return Boolean(reference?.startsWith(`resolver-source:${sourceId}:`));
}

function sanitizePersistedRefs(config: SourceConfig): SourceConfig {
  const safe = { ...config } as SourceConfig & {
    passwordRef?: string;
    tokenRef?: string;
    secretHeaders?: Record<string, string>;
  };
  if (safe.passwordRef && !isOwnedRef(config.id, safe.passwordRef)) delete safe.passwordRef;
  if (safe.tokenRef && !isOwnedRef(config.id, safe.tokenRef)) delete safe.tokenRef;
  if (safe.secretHeaders) {
    safe.secretHeaders = Object.fromEntries(
      Object.entries(safe.secretHeaders).filter(([, ref]) => isOwnedRef(config.id, ref)),
    );
    if (Object.keys(safe.secretHeaders).length === 0) delete safe.secretHeaders;
  }
  return safe;
}

function hasStoredSecretReferences(config: SourceConfig): boolean {
  return Boolean(
    ('passwordRef' in config && config.passwordRef) ||
    (config.kind === 'github-tree' && config.tokenRef) ||
    ((config.kind === 'http-template' || config.kind === 'json-catalog') &&
      Object.keys(config.secretHeaders ?? {}).length > 0),
  );
}

function assertValidSourceConfig(
  value: unknown,
  platform: Transport['platform'],
): asserts value is SourceConfig {
  if (!isSourceConfig(value)) throw new Error('Invalid resolver source configuration');
  if (!value.id.trim() || !value.name.trim() || !Number.isFinite(value.priority)) {
    throw new Error('Invalid resolver source configuration: ID, name, and priority are required');
  }
  if (value.kind === 'http-template') {
    if (!value.urlTemplate.includes('@mib@')) {
      throw new Error('HTTP URL template must contain @mib@');
    }
    assertHttpUrl(
      value.urlTemplate.replaceAll('@mib@', 'MODULE-MIB').replaceAll('@first@', 'M'),
      'HTTP URL template',
    );
    if (value.modulePattern) {
      try {
        new RegExp(value.modulePattern, 'i');
      } catch {
        throw new Error('HTTP module regular expression is invalid');
      }
    }
  }
  if (value.kind === 'json-catalog') {
    assertHttpUrl(value.catalogUrl, 'JSON catalog URL');
    assertJsonPath(value.urlQuery, 'URL JSONPath');
    if (value.nameQuery) assertJsonPath(value.nameQuery, 'Name JSONPath');
  }
  if (value.kind === 'ftp') {
    if (!value.host.trim() || /[\s/:]/.test(value.host)) {
      throw new Error('FTP host must be a hostname without a scheme, path, or port');
    }
    if (!value.pathTemplate.includes('@mib@')) {
      throw new Error('FTP path template must contain @mib@');
    }
    if (/[\r\n]/.test(value.pathTemplate)) throw new Error('FTP path template cannot contain newlines');
    if (value.port !== undefined && (!Number.isInteger(value.port) || value.port < 1 || value.port > 65_535)) {
      throw new Error('FTP port must be between 1 and 65535');
    }
    if (platform === 'react-native' && value.secure === 'ftps-explicit') {
      throw new Error(
        'Explicit FTPS is not supported on React Native because certificate and hostname verification cannot be guaranteed; use FTP or a Node/Electron engine host',
      );
    }
  }
}

function assertHttpUrl(value: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute HTTP or HTTPS URL`);
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.host) {
    throw new Error(`${label} must use HTTP or HTTPS`);
  }
}

function assertJsonPath(path: string, label: string): void {
  try {
    evaluateSimpleJsonPath({}, path);
  } catch (error) {
    throw new Error(`${label} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function invalidPersistedSource(
  row: { id: string; kind: string; name: string; priority: number; built_in: number },
  parsed: unknown,
  message: string,
): SourceConfig {
  if (isSourceConfig(parsed)) {
    return {
      ...sanitizePersistedRefs(parsed),
      id: row.id,
      name: row.name,
      enabled: false,
      priority: row.priority,
      builtIn: Boolean(row.built_in),
      validationError: message,
    };
  }
  return {
    id: row.id,
    kind: 'http-template',
    name: row.name,
    enabled: false,
    priority: row.priority,
    builtIn: Boolean(row.built_in),
    urlTemplate: '',
    authKind: 'none',
    validationError: message,
  };
}

function isSourceConfig(value: unknown): value is SourceConfig {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' || !record.id ||
    typeof record.kind !== 'string' ||
    typeof record.name !== 'string' ||
    typeof record.enabled !== 'boolean' ||
    typeof record.priority !== 'number'
  ) return false;
  if (record.kind === 'cache') return true;
  if (record.kind === 'http-template') {
    return typeof record.urlTemplate === 'string' &&
      (record.authKind === 'none' || record.authKind === 'basic');
  }
  if (record.kind === 'github-tree') {
    return typeof record.owner === 'string' && typeof record.repo === 'string' &&
      typeof record.branch === 'string';
  }
  if (record.kind === 'json-catalog') {
    return typeof record.catalogUrl === 'string' && typeof record.urlQuery === 'string' &&
      (record.authKind === 'none' || record.authKind === 'basic');
  }
  if (record.kind === 'ftp') {
    return typeof record.host === 'string' && typeof record.pathTemplate === 'string' &&
      (record.secure === 'none' || record.secure === 'ftps-explicit') &&
      typeof record.anonymous === 'boolean';
  }
  return false;
}
