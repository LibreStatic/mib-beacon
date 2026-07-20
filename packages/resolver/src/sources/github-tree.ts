import type { HttpClient, HttpRequest, HttpResponse } from '@mibbeacon/transport';

import type {
  GitHubTreeSourceConfig,
  MibSource,
  SecretResolver,
  SourceIndexStore,
  SourceFetchContext,
  SourceFetchResult,
} from './types';
import { parseRetryAfterMs } from './http-template';
import { DEFAULT_MIB_MAX_BYTES, validateMibContent } from './validator';

const TREE_MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MIB_EXTENSIONS = /\.(?:txt|mib|my)$/i;

interface GitTreeResponse {
  tree?: { path?: string; type?: string }[];
  truncated?: boolean;
}

export class GitHubTreeIndex {
  private index: Map<string, string> | null = null;
  private etag: string | undefined;
  private refreshPromise: Promise<void> | null = null;
  private didLoad = false;
  private refreshedAt: number | null = null;

  constructor(
    private readonly config: GitHubTreeSourceConfig,
    private readonly http: HttpClient,
    private readonly resolveSecret?: SecretResolver,
    private readonly indexStore?: SourceIndexStore,
    private readonly now: () => number = Date.now,
  ) {}

  async find(moduleName: string, context: SourceFetchContext = {}): Promise<string | null> {
    await this.loadPersisted();
    if (!this.index || this.shouldRefresh()) await this.refresh(context);
    return this.index?.get(moduleName.toUpperCase()) ?? null;
  }

  async findCandidates(
    evidence: string[],
    context: SourceFetchContext = {},
  ): Promise<{ module: string; path: string }[]> {
    await this.loadPersisted();
    if (!this.index || this.shouldRefresh()) await this.refresh(context);
    const terms = evidence
      .flatMap((value) => value.toUpperCase().split(/[^A-Z0-9]+/))
      .filter((term) => term.length >= 3 && !['MIB', 'THE', 'INC', 'CORP', 'ISO', 'ORG'].includes(term));
    if (terms.length === 0) return [];
    return [...(this.index?.entries() ?? [])]
      .filter(([module, path]) => terms.some((term) => `${module} ${path}`.toUpperCase().includes(term)))
      .map(([module, path]) => ({ module, path }))
      .slice(0, 50);
  }

  async refresh(context: SourceFetchContext = {}): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh(context).finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  private async performRefresh(context: SourceFetchContext): Promise<void> {
    const url = `https://api.github.com/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/git/trees/${encodeURIComponent(this.config.branch)}?recursive=1`;
    const headers = { ...(await buildGitHubHeaders(this.config, this.resolveSecret, true)) };
    if (this.etag) headers['If-None-Match'] = this.etag;
    const request: HttpRequest & { signal?: AbortSignal } = {
      url,
      headers,
      timeoutMs: TIMEOUT_MS,
      maxBytes: TREE_MAX_BYTES,
      signal: context.signal,
    };
    const response = await this.http.fetch(request);
    if (response.status === 304 && this.index) {
      this.refreshedAt = this.now();
      await this.persist();
      return;
    }
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      throw new GitHubHttpError(response);
    }
    if (!response.ok) throw new Error(`GitHub tree request failed with HTTP ${response.status}`);

    const parsed = JSON.parse(response.text) as GitTreeResponse;
    if (!Array.isArray(parsed.tree)) throw new Error('GitHub tree response is missing its tree array');
    if (parsed.truncated) throw new Error('GitHub tree response was truncated');

    const prefix = normalizedPrefix(this.config.pathPrefix);
    const paths = parsed.tree
      .filter((entry): entry is { path: string; type?: string } =>
        entry.type === 'blob' && typeof entry.path === 'string' && entry.path.startsWith(prefix),
      )
      .map(({ path }) => path)
      .sort();
    const next = new Map<string, string>();
    for (const path of paths) {
      const basename = path.slice(path.lastIndexOf('/') + 1);
      const moduleName = basename.replace(MIB_EXTENSIONS, '');
      if (moduleName) next.set(moduleName.toUpperCase(), next.get(moduleName.toUpperCase()) ?? path);
    }
    this.index = next;
    this.etag = header(response.headers, 'etag');
    this.refreshedAt = this.now();
    await this.persist();
  }

  private async loadPersisted(): Promise<void> {
    if (this.didLoad) return;
    this.didLoad = true;
    const snapshot = await this.indexStore?.load();
    if (!snapshot) return;
    this.index = new Map(Object.entries(snapshot.entries));
    this.etag = snapshot.etag;
    this.refreshedAt = snapshot.refreshedAt;
  }

  private shouldRefresh(): boolean {
    if (this.refreshedAt === null) return true;
    const refreshDays = this.config.refreshDays ?? 7;
    return this.now() - this.refreshedAt >= Math.max(0, refreshDays) * 86_400_000;
  }

  private async persist(): Promise<void> {
    if (!this.index || this.refreshedAt === null) return;
    await this.indexStore?.save({
      entries: Object.fromEntries(this.index),
      ...(this.etag ? { etag: this.etag } : {}),
      refreshedAt: this.refreshedAt,
    });
  }
}

export class GitHubTreeSource implements MibSource {
  readonly id: string;
  readonly kind = 'github-tree' as const;
  readonly name: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly hosts = ['api.github.com', 'raw.githubusercontent.com'];
  private readonly index: GitHubTreeIndex;

  constructor(
    private readonly config: GitHubTreeSourceConfig,
    private readonly http: HttpClient,
    private readonly resolveSecret?: SecretResolver,
    indexStore?: SourceIndexStore,
  ) {
    this.id = config.id;
    this.name = config.name;
    this.enabled = config.enabled;
    this.priority = config.priority;
    this.index = new GitHubTreeIndex(config, http, resolveSecret, indexStore);
  }

  async fetch(module: string, context: SourceFetchContext = {}): Promise<SourceFetchResult> {
    let path: string | null;
    try {
      path = await this.index.find(module, context);
    } catch (error) {
      if (error instanceof GitHubHttpError) return this.notFound(module, error.response);
      throw error;
    }
    if (!path) return { status: 'not-found', module, sourceId: this.id };
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/${encodeURIComponent(this.config.branch)}/${encodedPath}`;
    const headers = await buildGitHubHeaders(this.config, this.resolveSecret);
    const request: HttpRequest & { signal?: AbortSignal } = {
      url,
      headers,
      timeoutMs: TIMEOUT_MS,
      maxBytes: DEFAULT_MIB_MAX_BYTES,
      signal: context.signal,
    };
    const response = await this.http.fetch(request);
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      return this.notFound(module, response);
    }
    if (!response.ok) return { status: 'not-found', module, sourceId: this.id };
    const validation = validateMibContent(module, response.text);
    if (!validation.ok)
      return {
        status: 'not-found', module, sourceId: this.id, stage: 'validation',
        reason: `Validation failed: ${validation.message}`,
        responseExcerpt: response.text.slice(0, 240),
      };
    return {
      status: 'found',
      module,
      content: response.text,
      sourceId: this.id,
      location: url,
      moduleName: validation.moduleName,
      warnings: validation.warnings,
    };
  }

  async discover(evidence: string[], context: SourceFetchContext = {}) {
    return (await this.index.findCandidates(evidence, context)).map(({ module, path }) => ({
      module,
      sourceId: this.id,
      location: `https://raw.githubusercontent.com/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/${encodeURIComponent(this.config.branch)}/${path.split('/').map(encodeURIComponent).join('/')}`,
    }));
  }

  private notFound(module: string, response: HttpResponse): SourceFetchResult {
    const retryAfterMs = parseRetryAfterMs(response.headers);
    return {
      status: 'not-found',
      module,
      sourceId: this.id,
      httpStatus: response.status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      reason: `HTTP ${response.status}`,
    };
  }
}

class GitHubHttpError extends Error {
  constructor(readonly response: HttpResponse) {
    super(`GitHub request failed with HTTP ${response.status}`);
  }
}

async function buildGitHubHeaders(
  config: GitHubTreeSourceConfig,
  resolveSecret?: SecretResolver,
  api = false,
): Promise<Record<string, string> | undefined> {
  const headers: Record<string, string> = api ? { Accept: 'application/vnd.github+json' } : {};
  if (config.tokenRef) {
    if (!resolveSecret) throw new Error('GitHub tokenRef requires a secret resolver');
    const token = await resolveSecret(config.tokenRef);
    if (token === null) throw new Error(`Secret not found: ${config.tokenRef}`);
    headers.Authorization = `Bearer ${token}`;
  }
  return Object.keys(headers).length ? headers : undefined;
}

function normalizedPrefix(prefix?: string): string {
  if (!prefix) return '';
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

function header(headers: Record<string, string>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
}
