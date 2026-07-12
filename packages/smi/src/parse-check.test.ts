import { describe, expect, it } from 'vitest';
import { parseCheckMibText } from './parse-check';

describe('parseCheckMibText', () => {
  it('accepts a syntactically valid module whose imports are not loaded', () => {
    const result = parseCheckMibText(`VENDOR-MIB DEFINITIONS ::= BEGIN
IMPORTS vendorRoot FROM VENDOR-ROOT-MIB;
vendorObjects OBJECT IDENTIFIER ::= { vendorRoot 1 }
END`);
    expect(result.ok).toBe(true);
  });

  it('rejects malformed declarations even when imports are missing', () => {
    const result = parseCheckMibText(`BROKEN-MIB DEFINITIONS ::= BEGIN
IMPORTS vendorRoot FROM VENDOR-ROOT-MIB;
this is not a declaration
END`);
    expect(result.ok).toBe(false);
  });

  it('rejects a header-only document containing no valid declarations', () => {
    const result = parseCheckMibText('BROKEN-MIB DEFINITIONS ::= BEGIN\nthis is not a declaration\nEND');
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });
});
