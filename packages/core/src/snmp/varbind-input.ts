/// <reference path="../../../smi/src/net-snmp.d.ts" />
import { Buffer } from 'buffer';
import snmp from 'net-snmp';
import type { Varbind } from 'net-snmp';
import { MibBeaconError } from '../errors';
import type { SnmpVarbindInput } from './types';
import { validateVarbindInput } from './wire-types';

const OID = /^\d+(?:\.\d+)+$/;
const MAX_U32 = 4_294_967_295;
const MAX_U64 = (1n << 64n) - 1n;

function invalid(message: string): never {
  throw new MibBeaconError('SET_WRONG_TYPE', message);
}

function integer(value: string, min: number, max: number): number {
  if (!/^-?\d+$/.test(value.trim())) invalid('Value must be a whole number.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    invalid(`Value must be between ${min} and ${max}.`);
  }
  return parsed;
}

function bytes(value: string): Buffer {
  const compact = value
    .trim()
    .replace(/^0x/i, '')
    .replace(/[\s:-]/g, '');
  if (compact.length % 2 !== 0) invalid('Hex input must contain an even number of digits.');
  if (!/^[0-9a-f]*$/i.test(compact)) invalid('Hex input contains a non-hexadecimal character.');
  return Buffer.from(compact, 'hex');
}

function counter64(value: string): Buffer {
  if (!/^\d+$/.test(value.trim())) invalid('Counter64 must be an unsigned whole number.');
  const parsed = BigInt(value);
  if (parsed > MAX_U64) invalid(`Counter64 must be between 0 and ${MAX_U64}.`);
  const result = Buffer.alloc(8);
  let remaining = parsed;
  for (let i = 7; i >= 0; i--) {
    result[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

export function encodeVarbindInput(input: SnmpVarbindInput): Varbind {
  const validationError = validateVarbindInput(input);
  if (validationError) invalid(validationError);
  const oid = input.oid.trim();
  if (!OID.test(oid)) invalid('OID must be a valid numeric OID such as 1.3.6.1.2.1.1.5.0.');

  switch (input.type) {
    case 'Integer':
      return {
        oid,
        type: snmp.ObjectType.Integer!,
        value: integer(input.value, -2_147_483_648, 2_147_483_647),
      };
    case 'Counter':
    case 'Gauge':
    case 'TimeTicks':
      return {
        oid,
        type: snmp.ObjectType[input.type]!,
        value: integer(input.value, 0, MAX_U32),
      };
    case 'Counter64':
      return { oid, type: snmp.ObjectType.Counter64!, value: counter64(input.value) };
    case 'ObjectIdentifier': {
      const value = input.value.trim();
      if (!OID.test(value)) invalid('Object identifier value must be a valid numeric OID.');
      return { oid, type: snmp.ObjectType.OID!, value };
    }
    case 'IpAddress': {
      const value = input.value.trim();
      const parts = value.split('.');
      if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) {
        invalid('Value must be a valid IPv4 address.');
      }
      return { oid, type: snmp.ObjectType.IpAddress!, value };
    }
    case 'OctetString':
      return {
        oid,
        type: snmp.ObjectType[input.type]!,
        value: input.encoding === 'hex' ? bytes(input.value) : input.value,
      };
    case 'Opaque':
      return {
        oid,
        type: snmp.ObjectType.Opaque!,
        value: input.encoding === 'hex' ? bytes(input.value) : Buffer.from(input.value, 'utf8'),
      };
  }
}
