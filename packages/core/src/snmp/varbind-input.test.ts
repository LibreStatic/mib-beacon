import { describe, expect, it } from 'vitest';
import snmp from 'net-snmp';
import { encodeVarbindInput } from './varbind-input';
import { inferWireType, validateVarbindInput } from './wire-types';

describe('encodeVarbindInput', () => {
  it('encodes signed and unsigned integer wire types', () => {
    expect(encodeVarbindInput({ oid: '1.3.6.1.2.1.1.7.0', type: 'Integer', value: '-4' })).toEqual({
      oid: '1.3.6.1.2.1.1.7.0',
      type: snmp.ObjectType.Integer,
      value: -4,
    });
    expect(
      encodeVarbindInput({ oid: '1.3.6.1.2.1.1.3.0', type: 'TimeTicks', value: '42' }),
    ).toEqual({
      oid: '1.3.6.1.2.1.1.3.0',
      type: snmp.ObjectType.TimeTicks,
      value: 42,
    });
  });

  it('encodes text and hexadecimal octet strings', () => {
    expect(
      encodeVarbindInput({ oid: '1.3.6.1.2.1.1.5.0', type: 'OctetString', value: 'router' }).value,
    ).toBe('router');
    const encoded = encodeVarbindInput({
      oid: '1.3.6.1.2.1.1.5.0',
      type: 'OctetString',
      value: 'de ad be ef',
      encoding: 'hex',
    });
    expect(Array.from(encoded.value as Uint8Array)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    const opaque = encodeVarbindInput({ oid: '1.3.6.1.4.1.1', type: 'Opaque', value: 'abc' });
    expect(Array.from(opaque.value as Uint8Array)).toEqual([0x61, 0x62, 0x63]);
  });

  it('preserves the full unsigned Counter64 range as eight bytes', () => {
    const encoded = encodeVarbindInput({
      oid: '1.3.6.1.2.1.31.1.1.1.6.1',
      type: 'Counter64',
      value: '18446744073709551615',
    });
    expect(Array.from(encoded.value as Uint8Array)).toEqual(new Array(8).fill(255));
  });

  it.each([
    [{ oid: 'not-an-oid', type: 'Integer', value: '1' } as const, /valid numeric OID/],
    [{ oid: '1.3.6.1', type: 'Integer', value: '1.2' } as const, /whole number/],
    [{ oid: '1.3.6.1', type: 'Gauge', value: '-1' } as const, /0 and 4294967295/],
    [{ oid: '1.3.6.1', type: 'IpAddress', value: '999.1.1.1' } as const, /IPv4/],
    [
      { oid: '1.3.6.1', type: 'OctetString', value: 'abc', encoding: 'hex' } as const,
      /even number/,
    ],
  ])('rejects invalid typed input %#', (input, message) => {
    expect(() => encodeVarbindInput(input)).toThrow(message);
  });
});

describe('inferWireType', () => {
  it.each([
    ['INTEGER { up(1), down(2) }', 'Integer'],
    ['DisplayString (SIZE 0..255)', 'OctetString'],
    ['OBJECT IDENTIFIER', 'ObjectIdentifier'],
    ['IpAddress', 'IpAddress'],
    ['Counter64', 'Counter64'],
    ['TimeTicks', 'TimeTicks'],
  ] as const)('maps %s to %s', (syntax, type) => {
    expect(inferWireType(syntax)).toBe(type);
  });

  it('defaults unknown textual conventions to OctetString', () => {
    expect(inferWireType('VendorOpaqueThing')).toBe('OctetString');
  });
});

describe('validateVarbindInput', () => {
  it('reports incomplete instances and invalid typed values', () => {
    expect(validateVarbindInput({ oid: '1.3.6.1.', type: 'Integer', value: '1' })).toMatch(
      /numeric OID/,
    );
    expect(validateVarbindInput({ oid: '1.3.6.1', type: 'Integer', value: '' })).toMatch(
      /whole number/,
    );
    expect(validateVarbindInput({ oid: '1.3.6.1', type: 'IpAddress', value: '300.1.1.1' })).toMatch(
      /IPv4/,
    );
  });

  it('accepts valid text and integer inputs', () => {
    expect(validateVarbindInput({ oid: '1.3.6.1', type: 'OctetString', value: '' })).toBeNull();
    expect(validateVarbindInput({ oid: '1.3.6.1', type: 'Integer', value: '-12' })).toBeNull();
  });
});
