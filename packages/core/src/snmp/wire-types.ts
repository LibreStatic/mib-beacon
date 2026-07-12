import type { SnmpVarbindInput, SnmpWireType } from './types';

const NUMERIC_OID = /^\d+(?:\.\d+)+$/;

export function validateVarbindInput(input: SnmpVarbindInput): string | null {
  if (!NUMERIC_OID.test(input.oid.trim())) {
    return 'OID must be a valid numeric OID, including any required instance suffix.';
  }
  const value = input.value.trim();
  if (input.type === 'Integer') {
    if (!/^-?\d+$/.test(value)) return 'Value must be a whole number.';
    const parsed = BigInt(value);
    if (parsed < -2_147_483_648n || parsed > 2_147_483_647n)
      return 'Integer is outside the signed 32-bit range.';
  } else if (input.type === 'Counter' || input.type === 'Gauge' || input.type === 'TimeTicks') {
    if (!/^\d+$/.test(value)) return 'Value must be a whole number between 0 and 4294967295.';
    if (BigInt(value) > 4_294_967_295n)
      return `${input.type} is outside the unsigned 32-bit range.`;
  } else if (input.type === 'Counter64') {
    if (!/^\d+$/.test(value)) return 'Counter64 must be an unsigned whole number.';
    if (BigInt(value) > (1n << 64n) - 1n) return 'Counter64 is outside the unsigned 64-bit range.';
  } else if (input.type === 'ObjectIdentifier' && !NUMERIC_OID.test(value)) {
    return 'Object identifier value must be a complete numeric OID.';
  } else if (input.type === 'IpAddress') {
    const parts = value.split('.');
    if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) {
      return 'Value must be a valid IPv4 address.';
    }
  }
  if ((input.type === 'OctetString' || input.type === 'Opaque') && input.encoding === 'hex') {
    const compact = value.replace(/^0x/i, '').replace(/[\s:-]/g, '');
    if (compact.length % 2 !== 0) return 'Hex input must contain an even number of digits.';
    if (!/^[0-9a-f]*$/i.test(compact)) return 'Hex input contains a non-hexadecimal character.';
  }
  return null;
}

/** Best-effort SMI syntax to editable SNMP wire type mapping for renderer forms. */
export function inferWireType(syntax?: string): SnmpWireType {
  const normalized = syntax?.trim().toLowerCase() ?? '';
  if (/counter64/.test(normalized)) return 'Counter64';
  if (/timeticks/.test(normalized)) return 'TimeTicks';
  if (/ipaddress/.test(normalized)) return 'IpAddress';
  if (/object\s+identifier|\boid\b/.test(normalized)) return 'ObjectIdentifier';
  if (/counter32|\bcounter\b/.test(normalized)) return 'Counter';
  if (/gauge32|unsigned32|\bgauge\b/.test(normalized)) return 'Gauge';
  if (/integer32|\binteger\b/.test(normalized)) return 'Integer';
  if (/^opaque(?:\s|$)/.test(normalized)) return 'Opaque';
  return 'OctetString';
}
