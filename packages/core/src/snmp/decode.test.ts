import { describe, it, expect } from 'vitest';
import snmp from 'net-snmp';
import { decodeVarbind } from './session';

describe('decodeVarbind', () => {
  it('decodes a printable OCTET STRING as text', () => {
    const vb = {
      oid: '1.3.6.1.2.1.1.1.0',
      type: snmp.ObjectType.OctetString,
      value: new TextEncoder().encode('Linux router'),
    };
    const d = decodeVarbind(vb);
    expect(d.isError).toBe(false);
    expect(d.typeName).toBe('OctetString');
    expect(d.value).toBe('Linux router');
  });

  it('decodes a binary OCTET STRING as spaced hex', () => {
    const vb = {
      oid: '1.3.6.1.2.1.2.2.1.6.1',
      type: snmp.ObjectType.OctetString,
      value: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    };
    expect(decodeVarbind(vb).value).toBe('de ad be ef');
  });

  it('decodes an INTEGER as a number', () => {
    const vb = { oid: '1.3.6.1.2.1.2.2.1.8.1', type: snmp.ObjectType.Integer, value: 1 };
    const d = decodeVarbind(vb);
    expect(d.value).toBe(1);
    expect(d.typeName).toBe('Integer');
  });

  it('flags an error varbind (NoSuchObject)', () => {
    const vb = { oid: '1.3.6.1.2.1.99.0', type: snmp.ObjectType.NoSuchObject, value: null };
    const d = decodeVarbind(vb);
    expect(d.isError).toBe(true);
    expect(d.errorText).toBeTruthy();
  });
});
