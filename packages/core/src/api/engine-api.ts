import type { EngineEventChannel, EngineEventListener, Unsubscribe } from '../events';
import type { AgentSpec, DecodedVarbind } from '../snmp/types';
import type { TrapReceiverConfig, TrapRecord } from '../snmp/receiver';

/**
 * The single seam between UI and engine (docs/plans/01). This is the SPIKE-scope
 * surface: the browse/query/table/resolver domains are stubbed here and fleshed
 * out per-domain in plans 03–08. Everything is async and structured-clone-safe
 * so it proxies over Electron IPC unchanged.
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

/** Domains not yet implemented in the spike (see the referenced plan). */
export interface StubDomain {
  readonly plannedIn: string;
}

export interface EngineAPI {
  system: {
    info(): Promise<EngineInfo>;
  };
  ops: {
    get(req: GetRequest): Promise<DecodedVarbind[]>;
    /** Streams `ops` events ({kind: 'batch'|'done'|'error', handleId}). */
    startWalk(req: WalkRequest): Promise<OperationHandle>;
    cancel(handleId: string): Promise<void>;
  };
  traps: {
    startReceiver(cfg: TrapReceiverConfig): Promise<TrapReceiverStatus>;
    stopReceiver(): Promise<void>;
    status(): Promise<TrapReceiverStatus>;
    /** In-memory list for the spike; SQLite-backed store lands in plan 05. */
    list(): Promise<TrapRecord[]>;
    clear(): Promise<void>;
  };
  events: {
    subscribe(channel: EngineEventChannel, listener: EngineEventListener): Unsubscribe;
  };
  // --- stubbed domains (throw NOT_IMPLEMENTED until their phase) ---
  mibs: StubDomain;
  agents: StubDomain;
  resolver: StubDomain;
  tools: StubDomain;
  logs: StubDomain;
}
