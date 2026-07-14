import { describe, expect, it } from 'vitest';
import { decodeTableIndex } from './table-info';

describe('table instance index decoding', () => {
  it('decodes integer, variable string, IPv4, and port composite indexes', () => {
    expect(
      decodeTableIndex('3.3.102.111.111.192.168.1.2.161', [
        { name: 'slot', syntax: 'INTEGER' },
        { name: 'label', syntax: 'OCTET STRING (SIZE 0..32)', displayHint: '255a' },
        { name: 'address', syntax: 'IpAddress' },
        { name: 'port', syntax: 'INTEGER' },
      ]),
    ).toEqual({
      values: [
        { name: 'slot', raw: [3], formatted: '3' },
        { name: 'label', raw: [102, 111, 111], formatted: 'foo' },
        { name: 'address', raw: [192, 168, 1, 2], formatted: '192.168.1.2' },
        { name: 'port', raw: [161], formatted: '161' },
      ],
      remaining: [],
    });
  });

  it('uses the remaining arcs for a final IMPLIED string index', () => {
    expect(
      decodeTableIndex('7.115.119.49', [
        { name: 'id', syntax: 'INTEGER' },
        { name: 'name', syntax: 'OCTET STRING', displayHint: '255a', implied: true },
      ]),
    ).toEqual({
      values: [
        { name: 'id', raw: [7], formatted: '7' },
        { name: 'name', raw: [115, 119, 49], formatted: 'sw1' },
      ],
      remaining: [],
    });
  });

  it('decodes fixed-size MAC indexes without a length prefix', () => {
    expect(
      decodeTableIndex('0.17.34.51.68.255', [
        { name: 'mac', syntax: 'OCTET STRING (SIZE 6)', displayHint: '1x:' },
      ]).values[0]?.formatted,
    ).toBe('00:11:22:33:44:ff');
  });

  it('fails clearly when an index suffix is truncated', () => {
    expect(() =>
      decodeTableIndex('4.65.66', [{ name: 'name', syntax: 'OCTET STRING', displayHint: '255a' }]),
    ).toThrow('name requires 4 index arcs, only 2 remain');
  });
});
