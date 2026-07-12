import { describe, expect, it } from 'vitest';

import { DEFAULT_MIB_MAX_BYTES, validateMibContent } from './validator';

describe('validateMibContent', () => {
  it('accepts an SMI module with leading comments', () => {
    const content = '-- generated file\n\nIF-MIB DEFINITIONS ::= BEGIN\nEND';
    expect(validateMibContent('IF-MIB', content)).toEqual({
      ok: true,
      moduleName: 'IF-MIB',
      warnings: [],
    });
  });

  it('accepts PIB-DEFINITIONS syntax', () => {
    const content = 'POLICY-MIB PIB-DEFINITIONS ::= BEGIN\nEND';
    expect(validateMibContent('POLICY-MIB', content).ok).toBe(true);
  });

  it('rejects HTML soft-200 responses', () => {
    const content = '<!DOCTYPE html><html><body>not found</body></html>';
    expect(validateMibContent('IF-MIB', content)).toMatchObject({
      ok: false,
      code: 'HTML_RESPONSE',
    });
  });

  it('rejects bodies larger than five MiB by default', () => {
    const content = `BIG-MIB DEFINITIONS ::= BEGIN\n-- ${'x'.repeat(DEFAULT_MIB_MAX_BYTES)}\nEND`;
    expect(validateMibContent('BIG-MIB', content)).toMatchObject({
      ok: false,
      code: 'CONTENT_TOO_LARGE',
    });
  });

  it('rejects text without a definition header in the first 2 KiB', () => {
    const content = `${' '.repeat(2049)}LATE-MIB DEFINITIONS ::= BEGIN\nEND`;
    expect(validateMibContent('LATE-MIB', content)).toMatchObject({
      ok: false,
      code: 'INVALID_MIB_HEADER',
    });
  });

  it('rejects content declaring a different module name', () => {
    expect(validateMibContent('REQUESTED-MIB', 'ACTUAL-MIB DEFINITIONS ::= BEGIN\nEND')).toEqual({
      ok: false,
      code: 'MODULE_NAME_MISMATCH',
      message: 'Requested REQUESTED-MIB but content defines ACTUAL-MIB',
    });
  });
});
