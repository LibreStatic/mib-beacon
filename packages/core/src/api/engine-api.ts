import type { EngineEventChannel, EngineEventListener, Unsubscribe } from '../events';
import type { AgentSpec, DecodedVarbind } from '../snmp/types';
import type { TrapReceiverConfig, TrapRecord } from '../snmp/receiver';
import type {
  ImportResult,
  MibNodeDetail,
  MibNodeSummary,
  MibSearchHit,
  ModuleInfo,
  ResolvedName,
} from '@omc/smi';

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

export interface OperationHandle {
  handleId: string;
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
  /** Fetch a MIB from a user-supplied URL and import it (user-initiated only). */
  importUrl(url: string): Promise<ImportResult>;
  list(): Promise<ModuleInfo[]>;
  unload(moduleName: string): Promise<void>;
  /** Children of an OID; omit for the tree roots. */
  tree(oid?: string): Promise<MibNodeSummary[]>;
  /** Detail for a numeric OID or symbol name. */
  node(oidOrName: string): Promise<MibNodeDetail | null>;
  search(query: string, limit?: number): Promise<MibSearchHit[]>;
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
  };
  events: {
    subscribe(channel: EngineEventChannel, listener: EngineEventListener): Unsubscribe;
  };
  // --- stubbed domains (implemented in their phase) ---
  agents: StubDomain;
  resolver: StubDomain;
  tools: StubDomain;
  logs: StubDomain;
}
