import { describe, expect, it } from 'vitest';
import { bitIsSelected, mibRangeError, mibSizeError, toggleBitHex } from './mib-set-editor';

describe('MIB-aware Set editor helpers', () => {
  it('validates numeric values against a retained MIB range', () => {
    const node = {
      oid: '1.3.6.1', name: 'level', kind: 'scalar', hasChildren: false, childCount: 0,
      syntax: 'INTEGER (1..5)',
    } as const;
    expect(mibRangeError(node, '7')).toMatch(/1\.\.5/);
    expect(mibRangeError(node, '4')).toBeNull();
  });

  it('accepts values in any structured disjoint range', () => {
    const node = {
      oid: '1.3.6.1',
      name: 'level',
      kind: 'scalar',
      hasChildren: false,
      childCount: 0,
      syntax: 'INTEGER',
      numericRanges: [
        { min: 1, max: 5 },
        { min: 10, max: 12 },
      ],
    } as const;
    expect(mibRangeError(node, '11')).toBeNull();
    expect(mibRangeError(node, '7')).toMatch(/1\.\.5 or 10\.\.12/);
  });

  it('validates UTF-8 byte length against structured size ranges', () => {
    const node = {
      oid: '1.3.6.1',
      name: 'label',
      kind: 'scalar',
      hasChildren: false,
      childCount: 0,
      syntax: 'OCTET STRING',
      sizeRanges: [{ min: 2, max: 4 }],
    } as const;
    expect(mibSizeError(node, 'ab')).toBeNull();
    expect(mibSizeError(node, 'ééé')).toMatch(/2\.\.4 bytes/);
  });

  it('toggles BITS positions using SNMP most-significant-bit ordering', () => {
    const selected = toggleBitHex('', 0);
    expect(selected).toBe('80');
    const twoBits = toggleBitHex(selected, 9);
    expect(twoBits).toBe('80 40');
    expect(bitIsSelected(twoBits, 0)).toBe(true);
    expect(bitIsSelected(twoBits, 9)).toBe(true);
    expect(toggleBitHex(twoBits, 0)).toBe('00 40');
  });
});
