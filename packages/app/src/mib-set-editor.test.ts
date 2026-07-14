import { describe, expect, it } from 'vitest';
import { bitIsSelected, mibRangeError, toggleBitHex } from './mib-set-editor';

describe('MIB-aware Set editor helpers', () => {
  it('validates numeric values against a retained MIB range', () => {
    const node = {
      oid: '1.3.6.1', name: 'level', kind: 'scalar', hasChildren: false, childCount: 0,
      syntax: 'INTEGER (1..5)',
    } as const;
    expect(mibRangeError(node, '7')).toMatch(/1\.\.5/);
    expect(mibRangeError(node, '4')).toBeNull();
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
