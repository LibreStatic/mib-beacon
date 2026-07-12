/**
 * Unified engine error model (see docs/plans/01-architecture.md §Error model).
 * Every engine failure carries a stable `code`, a human `message`, and — where
 * we can tell — an actionable `hint`. Distinguishing e.g. a v3 wrong-privacy
 * password from a UDP timeout is a headline UX goal; do not collapse them.
 */
export type OmcErrorCode =
  // transport
  | 'TIMEOUT'
  | 'HOST_UNREACHABLE'
  | 'PORT_BIND_DENIED'
  | 'SOCKET_ERROR'
  // snmp
  | 'REQ_FAILED'
  | 'REQ_TOO_BIG'
  | 'REQ_OID_NOT_INCREASING'
  | 'SET_WRONG_TYPE'
  | 'SET_NOT_WRITABLE'
  // snmpv3
  | 'V3_UNKNOWN_ENGINE_ID'
  | 'V3_UNKNOWN_USER'
  | 'V3_WRONG_AUTH'
  | 'V3_DECRYPT_FAILED'
  | 'V3_UNSUPPORTED_SECLEVEL'
  | 'V3_NOT_IN_TIME_WINDOW'
  // parser (plan 03)
  | 'MIB_PARSE_FAILED'
  | 'MIB_MISSING_IMPORTS'
  // resolver (plan 06/07)
  | 'SOURCE_UNREACHABLE'
  | 'SOURCE_AUTH_FAILED'
  | 'MODULE_NOT_FOUND'
  | 'CONTENT_VALIDATION_FAILED'
  // generic
  | 'NOT_IMPLEMENTED'
  | 'CANCELLED'
  | 'INTERNAL';

export interface OmcErrorOptions {
  hint?: string;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class OmcError extends Error {
  readonly code: OmcErrorCode;
  readonly hint?: string;
  readonly details?: Record<string, unknown>;

  constructor(code: OmcErrorCode, message: string, opts: OmcErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'OmcError';
    this.code = code;
    this.hint = opts.hint;
    this.details = opts.details;
  }

  toJSON() {
    return { code: this.code, message: this.message, hint: this.hint, details: this.details };
  }
}

/**
 * Map a raw node-net-snmp error (or any thrown value) to an OmcError.
 * node-net-snmp error class names are stable identifiers we key on.
 */
export function mapSnmpError(err: unknown): OmcError {
  if (err instanceof OmcError) return err;
  const e = err as { name?: string; message?: string } | null;
  const name = e?.name ?? '';
  const msg = e?.message ?? String(err);

  if (name === 'RequestTimedOutError' || /timed out|timeout/i.test(msg)) {
    return new OmcError('TIMEOUT', 'Request timed out', {
      hint: 'No response from the agent. Check reachability, port, and (for v3) that the security level/credentials match — a wrong v3 auth/priv often surfaces as a timeout when authorization is silent.',
      cause: err,
    });
  }
  if (/EHOSTUNREACH|ENETUNREACH|not reachable/i.test(msg)) {
    return new OmcError('HOST_UNREACHABLE', 'Host unreachable', { cause: err });
  }
  if (/EACCES|permission denied/i.test(msg)) {
    return new OmcError('PORT_BIND_DENIED', 'Permission denied binding the port', {
      hint: 'Binding ports < 1024 (e.g. 162 for traps) needs elevated privileges. Use the fallback port or grant cap_net_bind_service.',
      cause: err,
    });
  }
  // v3 USM report signatures (node-net-snmp surfaces these in the message)
  if (/usmStatsWrongDigests|wrong digest|authentication failure/i.test(msg)) {
    return new OmcError('V3_WRONG_AUTH', 'SNMPv3 authentication failed', {
      hint: 'Auth password or auth protocol mismatch.',
      cause: err,
    });
  }
  if (/usmStatsDecryptionErrors|decryption error/i.test(msg)) {
    return new OmcError('V3_DECRYPT_FAILED', 'SNMPv3 decryption failed', {
      hint: 'Privacy password or privacy protocol mismatch.',
      cause: err,
    });
  }
  if (/usmStatsUnknownUserNames|unknown user/i.test(msg)) {
    return new OmcError('V3_UNKNOWN_USER', 'SNMPv3 user unknown to the agent', { cause: err });
  }
  if (/usmStatsNotInTimeWindows|not in time window/i.test(msg)) {
    return new OmcError('V3_NOT_IN_TIME_WINDOW', 'SNMPv3 time window error (will resync)', {
      cause: err,
    });
  }
  if (/usmStatsUnknownEngineID|unknown engine/i.test(msg)) {
    return new OmcError('V3_UNKNOWN_ENGINE_ID', 'SNMPv3 engine ID discovery pending', {
      cause: err,
    });
  }
  if (/notwritable|not writable|readonly|read-only/i.test(msg)) {
    return new OmcError('SET_NOT_WRITABLE', 'The agent reports that this object is not writable', {
      hint: 'Choose an object whose MIB access is read-write/read-create and verify the agent write community or VACM view.',
      cause: err,
    });
  }
  if (/wrongtype|wrong type|bad value|wrongvalue|wrong value/i.test(msg)) {
    return new OmcError('SET_WRONG_TYPE', 'The agent rejected the Set value or wire type', {
      hint: 'Check the object syntax, enum/range constraints, instance suffix, and selected wire type.',
      cause: err,
    });
  }
  return new OmcError('REQ_FAILED', msg || 'SNMP request failed', { cause: err });
}
