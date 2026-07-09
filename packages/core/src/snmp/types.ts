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
  isError: boolean;
  errorText?: string;
}
