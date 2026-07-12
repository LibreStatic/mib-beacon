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
export { inferWireType, validateVarbindInput } from './snmp/wire-types';
export type {
  EngineAPI,
  EngineInfo,
  GetRequest,
  SetRequest,
  WalkRequest,
  OperationHandle,
  TrapReceiverStatus,
  MibsAPI,
  MibStartImportRequest,
  ResolverAPI,
  ResolverOperationState,
  ResolverOperationStatus,
  ResolverConsentResponse,
  ResolverSettings,
  ResolverSourceDraft,
  ResolverSourceSecrets,
  ResolverSourceTestResult,
  ResolverSourcePreviewResult,
  ResolverOperationResult,
  ResolverCacheStats,
  OidLookupRequest,
  OidLookupResult,
  ResolverHistoryEntry,
} from './api/engine-api';
export type { SourceConfig, SourceKind } from '@omc/resolver';
export type {
  MibNodeKind,
  MibNodeSummary,
  MibNodeDetail,
  ModuleInfo,
  ModuleDependency,
  ModuleView,
  ModuleTreeRole,
  ModuleTreeNode,
  ImportResult,
  MibSearchHit,
  ResolvedName,
  MibTextFile,
  MibFileImportInspection,
  MibModuleCollisionKind,
  MibFileInspection,
  MibFilesInspection,
} from '@omc/smi';
export type {
  AgentSpec,
  V3Credentials,
  SnmpVersion,
  SecurityLevel,
  AuthProtocol,
  PrivProtocol,
  DecodedVarbind,
  SnmpWireType,
  SnmpVarbindInput,
  NotificationKind,
  NotificationPayload,
  NotificationSendRequest,
  NotificationSendResult,
} from './snmp/types';
export type { TrapRecord, TrapReceiverConfig, TrapV3User } from './snmp/receiver';
export { createEngineProxy, type ProxyAdapter, type BridgeResult } from './proxy';
