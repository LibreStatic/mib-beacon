import type { EngineEventChannel, EngineEventListener, Unsubscribe } from '../events';
import type {
  AgentSpec,
  DecodedVarbind,
  NotificationSendRequest,
  NotificationSendResult,
  SnmpVarbindInput,
} from '../snmp/types';
import type { TrapReceiverConfig, TrapRecord } from '../snmp/receiver';
import type {
  ImportResult,
  MibFilesInspection,
  MibTextFile,
  MibNodeDetail,
  MibNodeSummary,
  MibSearchHit,
  ModuleInfo,
  ModuleTreeNode,
  ModuleView,
  ResolvedName,
} from '@mibbeacon/smi';
import type {
  IanaEnterpriseRecord,
  OidBaseRecord,
  OidRefRecord,
  SourceConfig,
} from '@mibbeacon/resolver';

/**
 * The single seam between UI and engine (docs/plans/01). Everything is async
 * and structured-clone-safe so it proxies over Electron IPC / WebSocket
 * unchanged. Domains still pending their phase are stubbed.
 */

export interface EngineInfo {
  platform: 'node' | 'react-native';
  engineVersion: string;
  netSnmpVersion: string;
  /** Cipher availability probe (spike S2: is DES usable on this build?). */
  ciphers: { des: boolean; aes128: boolean; aes256: boolean };
}

export interface GetRequest {
  agent: AgentSpec;
  oids: string[];
}

export interface WalkRequest {
  agent: AgentSpec;
  baseOid: string;
  maxRepetitions?: number;
}

export interface SetRequest {
  agent: AgentSpec;
  varbinds: SnmpVarbindInput[];
}

export interface OperationHandle {
  handleId: string;
}

export type MibStartImportRequest =
  | {
      files: MibTextFile[];
      url?: never;
      batchLabel?: string;
      replaceModules?: string[];
    }
  | { url: string; files?: never };

export type ResolverOperationState =
  | 'started'
  | 'resolving-cache'
  | 'awaiting-consent'
  | 'resolving'
  | 'done'
  | 'partial'
  | 'error'
  | 'cancelled'
  | 'expired';

export interface ResolverOperationStatus {
  handleId: string;
  state: ResolverOperationState;
  startedAt: number;
  updatedAt: number;
  expiresAt?: number;
  missingModules: string[];
  sourceHosts: string[];
  loadedModules: string[];
  failures: { module?: string; message: string }[];
  result?: ResolverOperationResult;
}

export interface ResolverConsentResponse {
  allow: boolean;
  /** Checked means grant this operation only; unchecked remembers consent. */
  askAgain: boolean;
}

export interface ResolverSettings {
  enabled: boolean;
  autoResolveImports: boolean;
  externalConsentRemembered: boolean;
}

export interface ResolverSourceSecrets {
  password?: string;
  token?: string;
  headers?: Record<string, string>;
}

export interface ResolverSourceDraft {
  config: SourceConfig;
  secrets?: ResolverSourceSecrets;
  clearSecrets?: ('password' | 'token' | 'headers')[];
}

export interface ResolverSourceTestResult {
  ok: boolean;
  module: string;
  sourceId: string;
  location?: string;
  message?: string;
}

export interface ResolverSourcePreviewResult {
  kind: 'source-preview';
  sourceId: string;
  entries: { name: string; url: string }[];
}

export interface ResolverCacheStats {
  entries: number;
  bytes: number;
}

export interface OidLookupRequest {
  oid: string;
  network?: boolean;
}

export interface OidLookupResult {
  oid: string;
  loaded: ResolvedName | null;
  enterprise: IanaEnterpriseRecord | null;
  oidBase: OidBaseRecord | null;
  oidRef: OidRefRecord | null;
  fromCache: boolean;
  candidates: { module: string; sourceId: string; location?: string }[];
}

export type ResolverOperationResult =
  | ResolverSourcePreviewResult
  | ResolverSourceTestResult
  | OidLookupResult
  | ImportResult
  | {
      resolution?: unknown;
      retry?: ImportResult;
      message?: string;
      reason?: string;
      code?: string;
    };

export interface ResolverHistoryEntry {
  handleId: string;
  status: ResolverOperationState;
  requested: unknown;
  result: unknown;
  startedAt: number;
  finishedAt: number;
}

export interface ResolverAPI {
  respondConsent(handleId: string, response: ResolverConsentResponse): Promise<void>;
  cancel(handleId: string): Promise<void>;
  status(handleId: string): Promise<ResolverOperationStatus | null>;
  settings: {
    get(): Promise<ResolverSettings>;
    update(patch: Partial<ResolverSettings>): Promise<ResolverSettings>;
  };
  sources: {
    list(): Promise<SourceConfig[]>;
    create(draft: ResolverSourceDraft): Promise<SourceConfig>;
    update(sourceId: string, draft: ResolverSourceDraft): Promise<SourceConfig>;
    remove(sourceId: string): Promise<void>;
    reorder(sourceIds: string[]): Promise<SourceConfig[]>;
    test(sourceId: string, module: string): Promise<OperationHandle>;
    preview(draft: ResolverSourceDraft): Promise<OperationHandle>;
    exportCustom(): Promise<string>;
    importCustom(serialized: string): Promise<SourceConfig[]>;
  };
  cache: {
    stats(): Promise<ResolverCacheStats>;
    clear(): Promise<void>;
  };
  history: { list(limit?: number): Promise<ResolverHistoryEntry[]> };
  resolveModules(modules: string[]): Promise<OperationHandle>;
  lookupOid(request: OidLookupRequest): Promise<OperationHandle>;
}

export interface TrapReceiverStatus {
  running: boolean;
  port?: number;
  count: number;
}

/** Domains not yet implemented (see the referenced plan). */
export interface StubDomain {
  readonly plannedIn: string;
}

export interface MibsAPI {
  /** Parse MIB files given as raw text (works on every platform). */
  importTexts(files: { name: string; content: string }[]): Promise<ImportResult>;
  /** Analyze selected files without changing the loaded catalog. */
  inspectFiles(files: MibTextFile[]): Promise<MibFilesInspection>;
  /** User modules that must be replaced atomically with this module. */
  replacementGroup(moduleName: string): Promise<string[] | null>;
  /** Fetch a MIB from a user-supplied URL and import it (user-initiated only). */
  importUrl(url: string): Promise<ImportResult>;
  startImport(request: MibStartImportRequest): Promise<OperationHandle>;
  list(): Promise<ModuleInfo[]>;
  module(moduleName: string): Promise<ModuleView | null>;
  moduleTree(moduleName: string, oid?: string): Promise<ModuleTreeNode[]>;
  unload(moduleName: string): Promise<void>;
  /** Children of an OID; omit for the tree roots. */
  tree(oid?: string): Promise<MibNodeSummary[]>;
  /** Detail for a numeric OID or symbol name. */
  node(oidOrName: string, moduleName?: string): Promise<MibNodeDetail | null>;
  search(query: string, limit?: number): Promise<MibSearchHit[]>;
  moduleSearch(moduleName: string, query: string, limit?: number): Promise<MibSearchHit[]>;
  /** Longest-prefix name resolution for (instance) OIDs. */
  resolve(oid: string): Promise<ResolvedName | null>;
}

export interface EngineAPI {
  system: {
    info(): Promise<EngineInfo>;
  };
  mibs: MibsAPI;
  ops: {
    get(req: GetRequest): Promise<DecodedVarbind[]>;
    getNext(req: GetRequest): Promise<DecodedVarbind[]>;
    set(req: SetRequest): Promise<DecodedVarbind[]>;
    /** Streams `ops` events ({kind: 'batch'|'done'|'error', handleId}). */
    startWalk(req: WalkRequest): Promise<OperationHandle>;
    cancel(handleId: string): Promise<void>;
  };
  traps: {
    startReceiver(cfg: TrapReceiverConfig): Promise<TrapReceiverStatus>;
    stopReceiver(): Promise<void>;
    status(): Promise<TrapReceiverStatus>;
    /** In-memory list for now; SQLite-backed store lands in plan 05. */
    list(): Promise<TrapRecord[]>;
    clear(): Promise<void>;
    send(req: NotificationSendRequest): Promise<NotificationSendResult>;
  };
  events: {
    subscribe(channel: EngineEventChannel, listener: EngineEventListener): Unsubscribe;
  };
  // --- stubbed domains (implemented in their phase) ---
  agents: StubDomain;
  resolver: ResolverAPI;
  tools: StubDomain;
  logs: StubDomain;
}
