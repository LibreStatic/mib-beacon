import type { EngineEventChannel, EngineEventListener, Unsubscribe } from '../events';
import type {
  AuthProtocol,
  AgentSpec,
  DecodedVarbind,
  NotificationSendRequest,
  NotificationSendResult,
  NotificationPayload,
  SnmpVarbindInput,
  PrivProtocol,
  SecurityLevel,
  SnmpVersion,
} from '../snmp/types';
import type { RowStatusCreateResult } from '../ops/row-status';
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
  OidTranslation,
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

export interface AgentProfileInput {
  name: string;
  host: string;
  port?: number;
  transport?: 'udp4' | 'udp6';
  version: SnmpVersion;
  timeoutMs?: number;
  retries?: number;
  getBulkNonRepeaters?: number;
  getBulkMaxRepetitions?: number;
}

export interface AgentV3Input {
  user: string;
  level: SecurityLevel;
  authProtocol?: AuthProtocol;
  privProtocol?: PrivProtocol;
  context?: string;
  contextEngineId?: string;
}

export interface AgentSecretsInput {
  community?: string;
  authKey?: string;
  privKey?: string;
}

export interface AgentProfile extends Required<AgentProfileInput> {
  id: string;
  v3?: AgentV3Input;
  hasCommunity: boolean;
  hasAuthKey: boolean;
  hasPrivKey: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

export interface AgentCreateDraft {
  profile: AgentProfileInput;
  v3?: AgentV3Input;
  secrets?: AgentSecretsInput;
}

export interface AgentUpdateDraft {
  profile?: Partial<AgentProfileInput>;
  v3?: AgentV3Input | null;
  secrets?: AgentSecretsInput;
  clearSecrets?: (keyof AgentSecretsInput)[];
}

export interface AgentGroup {
  id: string;
  name: string;
  agentIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentTestResult {
  latencyMs: number;
  varbinds: DecodedVarbind[];
}

export interface AgentsAPI {
  list(): Promise<AgentProfile[]>;
  get(id: string): Promise<AgentProfile | null>;
  create(draft: AgentCreateDraft): Promise<AgentProfile>;
  update(id: string, draft: AgentUpdateDraft): Promise<AgentProfile>;
  delete(id: string): Promise<void>;
  markUsed(id: string): Promise<void>;
  test(id: string): Promise<AgentTestResult>;
  groups: {
    list(): Promise<AgentGroup[]>;
    get(id: string): Promise<AgentGroup | null>;
    create(input: { name: string; agentIds: string[] }): Promise<AgentGroup>;
    update(id: string, input: { name?: string; agentIds?: string[] }): Promise<AgentGroup>;
    delete(id: string): Promise<void>;
  };
}

export type AgentTarget =
  { agent: AgentSpec; agentId?: never } | { agentId: string; agent?: never };

export type OperationTarget =
  AgentTarget | { groupId: string; concurrency?: number; agent?: never; agentId?: never };

export type GetRequest = AgentTarget & {
  oids: string[];
};

export type WalkRequest = AgentTarget & {
  baseOid: string;
  maxRepetitions?: number;
};

export type SetRequest = AgentTarget & {
  varbinds: SnmpVarbindInput[];
};

export type OperationStartRequest = OperationTarget &
  (
    | { kind: 'get' | 'getNext'; oids: string[] }
    | {
        kind: 'getBulk';
        oids: string[];
        nonRepeaters?: number;
        maxRepetitions?: number;
      }
    | { kind: 'set'; varbinds: SnmpVarbindInput[] }
    | {
        kind: 'walk' | 'subtree-fetch' | 'table-fetch';
        baseOid: string;
        columnOids?: string[];
        maxRepetitions?: number;
        maxVarbinds?: number;
      }
  );

export interface OperationStats {
  count: number;
  durationMs: number;
  pduCount: number;
}

export type BookmarkOperation = 'get' | 'getNext' | 'getBulk' | 'set' | 'walk';

export interface OperationBookmarkInput {
  name: string;
  agentId: string;
  oid: string;
  operation: BookmarkOperation;
}

export interface OperationBookmark extends OperationBookmarkInput {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface WalkSnapshotInput {
  name: string;
  agentName: string;
  baseOid: string;
  results: DecodedVarbind[];
}

export interface WalkSnapshotSummary {
  id: string;
  name: string;
  agentName: string;
  baseOid: string;
  resultCount: number;
  createdAt: number;
}

export interface WalkSnapshot extends WalkSnapshotSummary {
  results: DecodedVarbind[];
}

export type TableRowCreateRequest = AgentTarget & {
  rowStatusOid: string;
  requiredColumns: SnmpVarbindInput[];
};

export type TableRowDeleteRequest = AgentTarget & { rowStatusOid: string };

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
  code?: 'SOURCE_AUTH_FAILED' | 'MODULE_NOT_FOUND' | 'SOURCE_UNREACHABLE';
  stage?:
    | 'configuration'
    | 'connect'
    | 'auth'
    | 'index'
    | 'fetch'
    | 'validation'
    | 'not-found'
    | 'retrieve';
  httpStatus?: number;
  responseExcerpt?: string;
}

export interface ResolverSourcePreviewResult {
  kind: 'source-preview';
  sourceId: string;
  entries: { name: string; url: string }[];
  rawSnippet?: string;
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
  /** Best local match found only in the resolver cache, without mutating the catalog. */
  cached: ResolvedName | null;
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
  /** Load a dependency closure exclusively from the local resolver cache. */
  loadCachedModules(modules: string[]): Promise<OperationHandle>;
  lookupOid(request: OidLookupRequest): Promise<OperationHandle>;
}

export interface TrapReceiverStatus {
  running: boolean;
  port?: number;
  count: number;
  drops: number;
  transports?: ('udp4' | 'udp6')[];
}

export interface TrapQuery {
  from?: number;
  to?: number;
  source?: string;
  trap?: string;
  version?: number;
  text?: string;
  unread?: boolean;
  limit?: number;
  offset?: number;
}

export interface TrapSavedFilter {
  id: string;
  name: string;
  query: TrapQuery;
  createdAt: number;
  updatedAt: number;
}

export interface TrapV3UserProfile {
  name: string;
  level: SecurityLevel;
  authProtocol?: AuthProtocol;
  privProtocol?: PrivProtocol;
  hasAuthKey: boolean;
  hasPrivKey: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TrapV3UserDraft {
  name: string;
  level: SecurityLevel;
  authProtocol?: AuthProtocol;
  authKey?: string;
  privProtocol?: PrivProtocol;
  privKey?: string;
  clearAuthKey?: boolean;
  clearPrivKey?: boolean;
}

export interface TrapSendPreset {
  id: string;
  name: string;
  agentId: string;
  payload: NotificationPayload;
  createdAt: number;
  updatedAt: number;
}

export interface TrapRuleCondition {
  trapOidGlob?: string;
  sourcePrefixes?: string[];
  varbindSubstrings?: string[];
}

export interface TrapRuleActions {
  severity?: 'info' | 'warning' | 'critical';
  color?: string;
  notify?: boolean;
  /** Reserved post-v1 actions. They remain persisted but disabled by the v1 UI/engine. */
  sound?: boolean;
  exec?: { command: string };
  forward?: { host: string; port?: number };
}

export interface TrapRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  condition: TrapRuleCondition;
  actions: TrapRuleActions;
  createdAt: number;
  updatedAt: number;
}

export type TrapRuleDraft = Omit<TrapRule, 'id' | 'createdAt' | 'updatedAt'>;
export type NotificationAgentSendRequest = NotificationPayload & { agentId: string };

export type PollMode = 'raw' | 'delta' | 'rate-per-sec';
export interface PollSeries {
  id: string;
  name: string;
  agentId: string;
  oid: string;
  intervalMs: number;
  mode: PollMode;
  counterBits: 32 | 64;
  retention: number;
  paused: boolean;
  errorCount: number;
  nextDueAt: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}
export type PollSeriesDraft = Pick<PollSeries, 'name' | 'agentId' | 'oid' | 'intervalMs' | 'mode'> &
  Partial<Pick<PollSeries, 'counterBits' | 'retention' | 'paused'>>;
export interface PollSample {
  id: number;
  seriesId: string;
  sampledAt: number;
  rawValue: string;
  value: number | null;
  typeName?: string;
}
export interface PollWatch {
  id: string;
  seriesId: string;
  name: string;
  operator?: '>' | '<' | '==' | '!=';
  threshold?: number;
  thresholdMode: 'value' | 'raw';
  breaching: boolean;
  current?: PollSample;
  stats?: { min: number; max: number; avg: number };
  lastChangeAt?: number;
}
export interface PollChart {
  id: string;
  name: string;
  seriesIds: string[];
  hiddenSeriesIds: string[];
  createdAt: number;
  updatedAt: number;
}
export interface DiscoveryCredential {
  agentId?: string;
  community?: string;
  label: string;
}
export interface DiscoveryResult {
  ip: string;
  credentialLabel: string;
  credentialAgentId?: string;
  version: SnmpVersion;
  latencyMs: number;
  sysName?: string;
  sysDescr?: string;
  sysObjectId?: string;
  sysUpTime?: string;
}
export interface WalkDiffRow {
  oid: string;
  name?: string;
  valueA?: string;
  valueB?: string;
  status: 'equal' | 'different' | 'only-a' | 'only-b';
}
export interface PortViewRow {
  index: string;
  name: string;
  alias?: string;
  adminStatus?: number;
  operStatus?: number;
  speedBitsPerSecond?: number;
  inOctets?: string;
  outOctets?: string;
  inErrors?: string;
  outErrors?: string;
  highCapacity: boolean;
  inBitsPerSecond?: number;
  outBitsPerSecond?: number;
  inUtilizationPercent?: number;
  outUtilizationPercent?: number;
  inErrorRate?: number;
  outErrorRate?: number;
}
export interface ToolsAPI {
  polls: {
    list(): Promise<PollSeries[]>;
    create(draft: PollSeriesDraft): Promise<PollSeries>;
    update(id: string, patch: Partial<PollSeriesDraft>): Promise<PollSeries>;
    remove(id: string): Promise<void>;
    samples(id: string, limit?: number): Promise<PollSample[]>;
    sampleNow(ids?: string[]): Promise<void>;
    exportCsv(id: string): Promise<string>;
  };
  watches: {
    list(): Promise<PollWatch[]>;
    save(
      input: Omit<PollWatch, 'id' | 'breaching' | 'current' | 'stats' | 'lastChangeAt'> & {
        id?: string;
      },
    ): Promise<PollWatch>;
    remove(id: string): Promise<void>;
  };
  charts: {
    list(): Promise<PollChart[]>;
    save(input: {
      id?: string;
      name: string;
      seriesIds: string[];
      hiddenSeriesIds?: string[];
    }): Promise<PollChart>;
    remove(id: string): Promise<void>;
  };
  discovery: {
    start(input: {
      target: string;
      credentials: DiscoveryCredential[];
      concurrency?: number;
      allowLargeMobileRange?: boolean;
      prePing?: boolean;
    }): Promise<OperationHandle>;
    cancel(handleId: string): Promise<void>;
    saveAgent(input: {
      ip: string;
      name?: string;
      credentialAgentId?: string;
      community?: string;
    }): Promise<AgentProfile>;
  };
  compare: {
    live(input: { agentAId: string; agentBId: string; baseOid: string }): Promise<WalkDiffRow[]>;
    start(input: { agentAId: string; agentBId: string; baseOid: string }): Promise<OperationHandle>;
    cancel(handleId: string): Promise<void>;
    text(a: string, b: string): Promise<WalkDiffRow[]>;
    snapshots(aId: string, bId: string): Promise<WalkDiffRow[]>;
  };
  ports: {
    inspect(agentId: string): Promise<PortViewRow[]>;
    start(agentId: string): Promise<OperationHandle>;
    cancel(handleId: string): Promise<void>;
    monitor(
      agentId: string,
      index: string,
      highCapacity: boolean,
      intervalMs?: number,
    ): Promise<PollSeries[]>;
  };
  reachability: {
    start(input: {
      kind: 'ping' | 'traceroute';
      target: string;
      count?: number;
      intervalMs?: number;
    }): Promise<OperationHandle>;
    cancel(handleId: string): Promise<void>;
  };
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
}

export interface LogQuery {
  level?: LogLevel;
  minLevel?: LogLevel;
  since?: number;
  until?: number;
  search?: string;
  /** Returns the latest matching entries while preserving chronological order. */
  limit?: number;
}

export interface LogsAPI {
  query(filter?: LogQuery): Promise<LogEntry[]>;
  setLevel(level: LogLevel): Promise<void>;
  export(path?: string): Promise<{ path: string; count: number }>;
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
  /** Translate numeric OIDs or symbolic names, preserving instance suffixes. */
  translate(oidOrName: string): Promise<OidTranslation | null>;
}

export interface EngineAPI {
  system: {
    info(): Promise<EngineInfo>;
  };
  mibs: MibsAPI;
  ops: {
    get(req: GetRequest): Promise<DecodedVarbind[]>;
    getNext(req: GetRequest): Promise<DecodedVarbind[]>;
    getBulk(
      req: GetRequest & { nonRepeaters?: number; maxRepetitions?: number },
    ): Promise<DecodedVarbind[]>;
    set(req: SetRequest): Promise<DecodedVarbind[]>;
    /** Starts any operation and streams batch/done/error events on the ops channel. */
    start(req: OperationStartRequest): Promise<OperationHandle>;
    /** Streams `ops` events ({kind: 'batch'|'done'|'error', handleId}). */
    startWalk(req: WalkRequest): Promise<OperationHandle>;
    cancel(handleId: string): Promise<void>;
    bookmarks: {
      list(): Promise<OperationBookmark[]>;
      create(input: OperationBookmarkInput): Promise<OperationBookmark>;
      delete(id: string): Promise<void>;
    };
    snapshots: {
      list(): Promise<WalkSnapshotSummary[]>;
      create(input: WalkSnapshotInput): Promise<WalkSnapshotSummary>;
      get(id: string): Promise<WalkSnapshot | null>;
      delete(id: string): Promise<void>;
    };
    createTableRow(req: TableRowCreateRequest): Promise<RowStatusCreateResult>;
    deleteTableRow(req: TableRowDeleteRequest): Promise<DecodedVarbind[]>;
  };
  traps: {
    startReceiver(cfg: TrapReceiverConfig): Promise<TrapReceiverStatus>;
    stopReceiver(): Promise<void>;
    status(): Promise<TrapReceiverStatus>;
    list(): Promise<TrapRecord[]>;
    query(query: TrapQuery): Promise<TrapRecord[]>;
    markRead(ids: string[], read?: boolean): Promise<void>;
    delete(ids: string[]): Promise<void>;
    unreadCount(): Promise<number>;
    clear(): Promise<void>;
    v3Users: {
      list(): Promise<TrapV3UserProfile[]>;
      upsert(draft: TrapV3UserDraft): Promise<TrapV3UserProfile>;
      remove(name: string): Promise<void>;
    };
    savedFilters: {
      list(): Promise<TrapSavedFilter[]>;
      save(name: string, query: TrapQuery): Promise<TrapSavedFilter>;
      remove(id: string): Promise<void>;
    };
    presets: {
      list(): Promise<TrapSendPreset[]>;
      save(name: string, agentId: string, payload: NotificationPayload): Promise<TrapSendPreset>;
      remove(id: string): Promise<void>;
    };
    rules: {
      list(): Promise<TrapRule[]>;
      create(draft: TrapRuleDraft): Promise<TrapRule>;
      update(id: string, draft: Partial<TrapRuleDraft>): Promise<TrapRule>;
      remove(id: string): Promise<void>;
    };
    send(
      req: NotificationSendRequest | NotificationAgentSendRequest,
    ): Promise<NotificationSendResult>;
  };
  events: {
    subscribe(channel: EngineEventChannel, listener: EngineEventListener): Unsubscribe;
  };
  // --- stubbed domains (implemented in their phase) ---
  agents: AgentsAPI;
  resolver: ResolverAPI;
  tools: ToolsAPI;
  logs: LogsAPI;
}
