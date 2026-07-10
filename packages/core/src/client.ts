/**
 * Renderer-safe entry point. Exposes ONLY the lightweight helpers and types the
 * UI needs — never the engine implementation (createEngine → net-snmp → node
 * builtins), so the browser/renderer bundle stays free of the SNMP stack.
 * Hosts that actually run the engine import from '@omc/core' instead.
 */
export {
  EventBus,
  type EngineEvent,
  type EngineEventChannel,
  type EngineEventListener,
  type Unsubscribe,
} from './events';
export { OmcError, type OmcErrorCode } from './errors';
export type {
  EngineAPI,
  EngineInfo,
  GetRequest,
  WalkRequest,
  OperationHandle,
  TrapReceiverStatus,
  MibsAPI,
} from './api/engine-api';
export type {
  MibNodeKind,
  MibNodeSummary,
  MibNodeDetail,
  ModuleInfo,
  ImportResult,
  MibSearchHit,
  ResolvedName,
} from '@omc/smi';
export type {
  AgentSpec,
  V3Credentials,
  SnmpVersion,
  SecurityLevel,
  AuthProtocol,
  PrivProtocol,
  DecodedVarbind,
} from './snmp/types';
export type { TrapRecord, TrapReceiverConfig, TrapV3User } from './snmp/receiver';
export {
  createEngineProxy,
  type ProxyAdapter,
  type BridgeResult,
} from './proxy';
