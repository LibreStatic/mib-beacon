import type { HttpClient, HttpRequest, HttpResponse } from '@mibbeacon/transport';

import { buildHttpHeaders, parseRetryAfterMs } from './http-template';
import type {
  JsonCatalogSourceConfig,
  MibSource,
  SecretResolver,
  SourceFetchContext,
  SourceFetchResult,
  SourceIndexStore,
} from './types';
import { DEFAULT_MIB_MAX_BYTES, validateMibContent } from './validator';

const CATALOG_MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface JsonCatalogPreviewEntry {
  name: string;
  url: string;
}

export async function previewJsonCatalog(
  config: JsonCatalogSourceConfig,
  http: HttpClient,
  resolveSecret?: SecretResolver,
  signal?: AbortSignal,
  limit = 20,
  onRaw?: (snippet: string) => void,
): Promise<JsonCatalogPreviewEntry[]> {
  const headers = await buildHttpHeaders(config, resolveSecret);
  const response = await http.fetch({
    url: config.catalogUrl,
    headers,
    timeoutMs: TIMEOUT_MS,
    maxBytes: CATALOG_MAX_BYTES,
    signal,
  });
  if (!response.ok) throw new Error(`Catalog request failed with HTTP ${response.status}`);
  onRaw?.(response.text.slice(0, 4_096));
  return extractCatalogEntries(config, JSON.parse(response.text) as unknown).slice(0, limit);
}

type PathSegment =
  { kind: 'property'; value: string } | { kind: 'index'; value: number } | { kind: 'wildcard' };

export function evaluateSimpleJsonPath(value: unknown, path: string): unknown[] {
  const segments = parseJsonPath(path);
  let values: unknown[] = [value];
  for (const segment of segments) {
    const next: unknown[] = [];
    for (const current of values) {
      if (segment.kind === 'wildcard') {
        if (Array.isArray(current)) next.push(...current);
        else if (isRecord(current)) next.push(...Object.values(current));
      } else if (segment.kind === 'index') {
        if (Array.isArray(current) && current[segment.value] !== undefined)
          next.push(current[segment.value]);
      } else if (isRecord(current) && current[segment.value] !== undefined) {
        next.push(current[segment.value]);
      }
    }
    values = next;
  }
  return values;
}

export class JsonCatalogSource implements MibSource {
  readonly id: string;
  readonly kind = 'json-catalog' as const;
  readonly name: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly hosts: string[];
  private index: Map<string, string> | null = null;
  private lastRefreshedAt: number | null = null;
  private etag: string | undefined;
  private refreshPromise: Promise<void> | null = null;
  private didLoad = false;

  constructor(
    private readonly config: JsonCatalogSourceConfig,
    private readonly http: HttpClient,
    private readonly resolveSecret?: SecretResolver,
    private readonly now: () => number = () => Date.now(),
    private readonly indexStore?: SourceIndexStore,
  ) {
    this.id = config.id;
    this.name = config.name;
    this.enabled = config.enabled;
    this.priority = config.priority;
    this.hosts = [new URL(config.catalogUrl).host];
  }

  async fetch(module: string, context: SourceFetchContext = {}): Promise<SourceFetchResult> {
    await this.loadPersisted();
    if (this.shouldRefresh()) {
      try {
        await this.refresh(context);
      } catch (error) {
        if (error instanceof CatalogHttpError) return this.notFound(module, error.response);
        throw error;
      }
    }
    const url = this.index?.get(module.toUpperCase());
    if (!url) return { status: 'not-found', module, sourceId: this.id };

    const headers =
      new URL(url).origin === new URL(this.config.catalogUrl).origin
        ? await buildHttpHeaders(this.config, this.resolveSecret)
        : undefined;
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

  async refresh(context: SourceFetchContext = {}): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh(context).finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  private async performRefresh(context: SourceFetchContext): Promise<void> {
    const headers = await buildHttpHeaders(this.config, this.resolveSecret);
    const request: HttpRequest & { signal?: AbortSignal } = {
      url: this.config.catalogUrl,
      headers: { ...headers, ...(this.etag ? { 'If-None-Match': this.etag } : {}) },
      timeoutMs: TIMEOUT_MS,
      maxBytes: CATALOG_MAX_BYTES,
      signal: context.signal,
    };
    const response = await this.http.fetch(request);
    if (response.status === 304 && this.index) {
      this.lastRefreshedAt = this.now();
      await this.indexStore?.save({
        entries: Object.fromEntries(this.index),
        ...(this.etag ? { etag: this.etag } : {}),
        refreshedAt: this.lastRefreshedAt,
      });
      return;
    }
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      throw new CatalogHttpError(response);
    }
    if (!response.ok) throw new Error(`Catalog request failed with HTTP ${response.status}`);
    const entries = extractCatalogEntries(this.config, JSON.parse(response.text) as unknown);
    const next = new Map<string, string>();
    for (const { name, url } of entries) {
      next.set(name.toUpperCase(), url);
    }
    this.index = next;
    this.lastRefreshedAt = this.now();
    this.etag = header(response.headers, 'etag');
    await this.indexStore?.save({
      entries: Object.fromEntries(next),
      ...(this.etag ? { etag: this.etag } : {}),
      refreshedAt: this.lastRefreshedAt,
    });
  }

  private async loadPersisted(): Promise<void> {
    if (this.didLoad) return;
    this.didLoad = true;
    const snapshot = await this.indexStore?.load();
    if (!snapshot) return;
    this.index = new Map(Object.entries(snapshot.entries));
    this.etag = snapshot.etag;
    this.lastRefreshedAt = snapshot.refreshedAt;
  }

  private shouldRefresh(): boolean {
    if (!this.index || this.lastRefreshedAt === null) return true;
    if (this.config.refreshDays === undefined) return false;
    return this.now() - this.lastRefreshedAt >= Math.max(0, this.config.refreshDays) * DAY_MS;
  }

  private notFound(module: string, response: HttpResponse): SourceFetchResult {
    const retryAfterMs = parseRetryAfterMs(response.headers, this.now());
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

class CatalogHttpError extends Error {
  constructor(readonly response: HttpResponse) {
    super(`Catalog request failed with HTTP ${response.status}`);
  }
}

function parseJsonPath(path: string): PathSegment[] {
  if (!path.startsWith('$')) throw new Error(`Unsupported JSONPath: ${path}`);
  const segments: PathSegment[] = [];
  let offset = 1;
  while (offset < path.length) {
    if (path[offset] === '.') {
      const match = path.slice(offset).match(/^\.([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (!match?.[1]) throw new Error(`Unsupported JSONPath: ${path}`);
      segments.push({ kind: 'property', value: match[1] });
      offset += match[0].length;
      continue;
    }
    const rest = path.slice(offset);
    const wildcard = rest.match(/^\[\*\]/);
    if (wildcard) {
      segments.push({ kind: 'wildcard' });
      offset += wildcard[0].length;
      continue;
    }
    const index = rest.match(/^\[(\d+)\]/);
    if (index?.[1]) {
      segments.push({ kind: 'index', value: Number(index[1]) });
      offset += index[0].length;
      continue;
    }
    const property = rest.match(/^\[['"]([^'"\]]+)['"]\]/);
    if (property?.[1]) {
      segments.push({ kind: 'property', value: property[1] });
      offset += property[0].length;
      continue;
    }
    throw new Error(`Unsupported JSONPath: ${path}`);
  }
  return segments;
}

function moduleNameFromUrl(url: string): string {
  const pathname = new URL(url, 'https://catalog.invalid/').pathname;
  const basename = decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1));
  return basename.replace(/\.(?:txt|mib|my)$/i, '');
}

function extractCatalogEntries(
  config: JsonCatalogSourceConfig,
  catalog: unknown,
): JsonCatalogPreviewEntry[] {
  const urls = evaluateSimpleJsonPath(catalog, config.urlQuery);
  const names = config.nameQuery
    ? evaluateSimpleJsonPath(catalog, config.nameQuery)
    : urls.map((url) => moduleNameFromUrl(assertString(url, 'Catalog URL')));
  if (urls.length !== names.length) {
    throw new Error('JSON catalog nameQuery and urlQuery must return the same number of values');
  }
  return urls.map((url, index) => ({
    name: assertString(names[index], 'Catalog module name'),
    url: new URL(assertString(url, 'Catalog URL'), config.catalogUrl).toString(),
  }));
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function header(headers: Record<string, string>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
}
