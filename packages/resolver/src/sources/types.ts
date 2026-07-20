import type { HttpClient } from '@mibbeacon/transport';

export type SourceKind = 'cache' | 'http-template' | 'github-tree' | 'json-catalog' | 'ftp';
export type HttpAuthKind = 'none' | 'basic';

export interface SourceConfigBase {
  id: string;
  kind: SourceKind;
  name: string;
  enabled: boolean;
  priority: number;
  builtIn?: boolean;
  testModule?: string;
  /** Set only when a persisted source was disabled because its configuration is invalid. */
  validationError?: string;
  /** Runtime usage counters kept separately from editable source configuration. */
  stats?: { lastUsedAt?: number; lastResult?: string; cacheHits: number };
}

export interface CacheSourceConfig extends SourceConfigBase {
  kind: 'cache';
}

export interface HttpAuthConfig {
  authKind: HttpAuthKind;
  username?: string;
  passwordRef?: string;
  headers?: Record<string, string>;
  /** Header name to SecretStore reference. Values are resolved only at request time. */
  secretHeaders?: Record<string, string>;
}

export interface HttpTemplateSourceConfig extends SourceConfigBase, HttpAuthConfig {
  kind: 'http-template';
  urlTemplate: string;
  fixedExtension?: string;
  /** Optional case-insensitive regular expression used by specialized sources. */
  modulePattern?: string;
}

export interface GitHubTreeSourceConfig extends SourceConfigBase {
  kind: 'github-tree';
  owner: string;
  repo: string;
  branch: string;
  pathPrefix?: string;
  tokenRef?: string;
  refreshDays?: number;
}

export interface FtpSourceConfig extends SourceConfigBase {
  kind: 'ftp';
  host: string;
  port?: number;
  secure: 'none' | 'ftps-explicit';
  anonymous: boolean;
  username?: string;
  passwordRef?: string;
  pathTemplate: string;
  fixedExtension?: string;
}

export interface JsonCatalogSourceConfig extends SourceConfigBase, HttpAuthConfig {
  kind: 'json-catalog';
  catalogUrl: string;
  urlQuery: string;
  nameQuery?: string;
  refreshDays?: number;
}

export type SourceConfig =
  | CacheSourceConfig
  | HttpTemplateSourceConfig
  | GitHubTreeSourceConfig
  | JsonCatalogSourceConfig
  | FtpSourceConfig;

export interface SourceFetchFound {
  status: 'found';
  /** The module name requested from the source. */
  module: string;
  content: string;
  sourceId: string;
  location: string;
  /** The module name declared by the returned MIB. */
  moduleName?: string;
  warnings?: string[];
}

export interface SourceFetchNotFound {
  status: 'not-found';
  module: string;
  sourceId: string;
  httpStatus?: number;
  retryAfterMs?: number;
  reason?: string;
  stage?: 'configuration' | 'connect' | 'auth' | 'index' | 'fetch' | 'validation' | 'not-found' | 'retrieve';
  responseExcerpt?: string;
}

export type SourceFetchResult = SourceFetchFound | SourceFetchNotFound;

export interface SourceFetchContext {
  signal?: AbortSignal;
}

export interface SourceCandidate {
  module: string;
  sourceId: string;
  location?: string;
}

export interface MibSource {
  readonly id: string;
  readonly kind: SourceKind;
  readonly name: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly hosts: string[];
  fetch(module: string, context?: SourceFetchContext): Promise<SourceFetchResult>;
  discover?(evidence: string[], context?: SourceFetchContext): Promise<SourceCandidate[]>;
}

export type SecretResolver = (reference: string) => Promise<string | null>;

export interface SourceFactoryContext {
  http: HttpClient;
  resolveSecret?: SecretResolver;
}

export interface SourceIndexSnapshot {
  entries: Record<string, string>;
  etag?: string;
  refreshedAt: number;
}

export interface SourceIndexStore {
  load(): Promise<SourceIndexSnapshot | null>;
  save(snapshot: SourceIndexSnapshot): Promise<void>;
}
