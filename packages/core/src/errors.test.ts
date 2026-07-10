import { describe, it, expect } from 'vitest';
import { OmcError, mapSnmpError } from './errors';

describe('mapSnmpError', () => {
  it('passes through an existing OmcError', () => {
    const e = new OmcError('TIMEOUT', 'x');
    expect(mapSnmpError(e)).toBe(e);
  });

  it('maps a RequestTimedOutError to TIMEOUT with a v3-aware hint', () => {
    const err = mapSnmpError({ name: 'RequestTimedOutError', message: 'Request timed out' });
    expect(err.code).toBe('TIMEOUT');
    expect(err.hint).toMatch(/v3|credential/i);
  });

  it('distinguishes wrong auth from wrong privacy (not a bare timeout)', () => {
    expect(mapSnmpError({ message: 'usmStatsWrongDigests' }).code).toBe('V3_WRONG_AUTH');
    expect(mapSnmpError({ message: 'usmStatsDecryptionErrors' }).code).toBe('V3_DECRYPT_FAILED');
    expect(mapSnmpError({ message: 'usmStatsUnknownUserNames' }).code).toBe('V3_UNKNOWN_USER');
  });

  it('maps EACCES to PORT_BIND_DENIED with elevation hint', () => {
    const err = mapSnmpError({ message: 'bind EACCES 0.0.0.0:162' });
    expect(err.code).toBe('PORT_BIND_DENIED');
    expect(err.hint).toMatch(/cap_net_bind_service|privile/i);
  });

  it('maps host unreachable', () => {
    expect(mapSnmpError({ message: 'connect EHOSTUNREACH' }).code).toBe('HOST_UNREACHABLE');
  });

  it('falls back to REQ_FAILED for unknown errors', () => {
    expect(mapSnmpError({ message: 'weird' }).code).toBe('REQ_FAILED');
  });

  it('serializes to a structured-clone-safe JSON shape', () => {
    const json = new OmcError('V3_WRONG_AUTH', 'nope', { hint: 'check auth' }).toJSON();
    expect(json).toEqual({ code: 'V3_WRONG_AUTH', message: 'nope', hint: 'check auth', details: undefined });
  });
});
