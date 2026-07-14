export type SnmpVersion = 'v1' | 'v2c' | 'v3';
export type SecurityLevel = 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';
export type AuthProtocol = 'md5' | 'sha' | 'sha224' | 'sha256' | 'sha384' | 'sha512';
/** node-net-snmp supports aes(128) / aes256b / aes256r — note: no aes192. */
export type PrivProtocol = 'des' | 'aes' | 'aes256b' | 'aes256r';

export interface V3Credentials {
  user: string;
  level: SecurityLevel;
  authProtocol?: AuthProtocol;
  authKey?: string;
  privProtocol?: PrivProtocol;
  privKey?: string;
  context?: string;
}

export interface AgentSpec {
  host: string;
  port?: number; // default 161
  version: SnmpVersion;
  transport?: 'udp4' | 'udp6';
  timeoutMs?: number; // default 5000
  retries?: number; // default 1
  community?: string; // v1/v2c
  v3?: V3Credentials;
}

export interface DecodedVarbind {
  oid: string;
  /** node-net-snmp numeric type. */
  type: number;
  typeName: string;
  /** Best-effort JS value (string/number/hex for buffers). */
  value: string | number;
  /** Lossless structured-clone-safe wire value before MIB presentation formatting. */
  rawValue?: string | number;
  /** Exact octets for binary values. */
  rawHex?: string;
  /** DISPLAY-HINT / enum / units-aware presentation value. */
  formattedValue?: string;
  enumLabel?: string;
  /** Present for group operations. */
  agentId?: string;
  agentName?: string;
  isError: boolean;
  errorText?: string;
  /** MIB-resolved display name (e.g. ifOperStatus.3), when a module matches. */
  name?: string;
}

export type SnmpWireType =
  | 'Integer'
  | 'OctetString'
  | 'ObjectIdentifier'
  | 'IpAddress'
  | 'Counter'
  | 'Gauge'
  | 'TimeTicks'
  | 'Opaque'
  | 'Counter64';

/** Structured-clone-safe typed value accepted by Set and notification sending. */
export interface SnmpVarbindInput {
  oid: string;
  type: SnmpWireType;
  value: string;
  encoding?: 'text' | 'hex';
}

export type NotificationKind = 'trap' | 'inform';

export interface NotificationPayload {
  kind: NotificationKind;
  trapOid: string;
  varbinds: SnmpVarbindInput[];
  upTime?: number;
  /** v1 agent-addr field; ignored by v2c/v3. */
  agentAddress?: string;
  /** Optional explicit SNMPv1 envelope fields. Generic 6 means enterprise-specific. */
  v1Enterprise?: string;
  v1Generic?: number;
  v1Specific?: number;
}

export interface NotificationSendRequest extends NotificationPayload {
  target: AgentSpec;
}

export interface NotificationSendResult {
  kind: NotificationKind;
  sentAt: number;
  acknowledged: boolean;
  responseVarbinds?: DecodedVarbind[];
}
