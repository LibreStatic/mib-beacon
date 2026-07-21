import { describe, expect, it } from 'vitest';
import { normalizeNumericOid } from './oid';

describe('numeric OID normalization', () => {
  it('canonicalizes the ASN.1 iso root alias without accepting named paths', () => {
    expect(normalizeNumericOid('iso.3.6.1')).toBe('1.3.6.1');
    expect(normalizeNumericOid(' .ISO.3.6.1 ')).toBe('1.3.6.1');
    expect(normalizeNumericOid('.1.3.6.1')).toBe('1.3.6.1');
    expect(normalizeNumericOid('iso.org.dod')).toBeNull();
  });
});
