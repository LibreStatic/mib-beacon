import { formatOctetStringDisplayHint } from './display-hint';

export interface TableIndexDescriptor {
  name: string;
  syntax: string;
  implied?: boolean;
  displayHint?: string;
}

export interface DecodedTableIndexValue {
  name: string;
  raw: number[];
  formatted: string;
}

export interface DecodedTableIndex {
  values: DecodedTableIndexValue[];
  remaining: number[];
}

export function decodeTableIndex(
  suffix: string | readonly number[],
  descriptors: readonly TableIndexDescriptor[],
): DecodedTableIndex {
  const arcs =
    typeof suffix === 'string' ? suffix.split('.').filter(Boolean).map(Number) : [...suffix];
  if (arcs.some((arc) => !Number.isSafeInteger(arc) || arc < 0)) {
    throw new Error('Table index suffix must contain non-negative integer OID arcs');
  }
  let offset = 0;
  const values = descriptors.map((descriptor, descriptorIndex) => {
    const available = arcs.length - offset;
    const { length, prefixArcs } = encodedLength(
      descriptor,
      available,
      descriptorIndex === descriptors.length - 1,
      arcs[offset],
    );
    offset += prefixArcs;
    const remaining = arcs.length - offset;
    if (remaining < length) {
      throw new Error(`${descriptor.name} requires ${length} index arcs, only ${remaining} remain`);
    }
    const raw = arcs.slice(offset, offset + length);
    offset += length;
    return { name: descriptor.name, raw, formatted: formatIndexValue(raw, descriptor) };
  });
  return { values, remaining: arcs.slice(offset) };
}

function encodedLength(
  descriptor: TableIndexDescriptor,
  available: number,
  isLast: boolean,
  lengthArc?: number,
): { length: number; prefixArcs: number } {
  if (/^IpAddress\b/i.test(descriptor.syntax)) return { length: 4, prefixArcs: 0 };
  if (
    /^(?:INTEGER|Integer32|Unsigned\d*|Gauge\d*|Counter\d*|TimeTicks)\b/i.test(descriptor.syntax)
  ) {
    return { length: 1, prefixArcs: 0 };
  }
  const isOctets = /^(?:OCTET STRING|BITS)\b/i.test(descriptor.syntax);
  const isOid = /^OBJECT IDENTIFIER\b/i.test(descriptor.syntax);
  if (!isOctets && !isOid) return { length: 1, prefixArcs: 0 };
  const fixed = descriptor.syntax.match(/\bSIZE\s*\(?\s*(\d+)\s*\)?/i);
  if (fixed && !descriptor.syntax.slice(fixed.index).includes('..')) {
    return { length: Number.parseInt(fixed[1]!, 10), prefixArcs: 0 };
  }
  if (descriptor.implied) {
    if (!isLast)
      throw new Error(`${descriptor.name} uses IMPLIED but is not the final table index`);
    return { length: available, prefixArcs: 0 };
  }
  if (lengthArc === undefined) {
    throw new Error(`${descriptor.name} is missing its variable-length index prefix`);
  }
  return { length: lengthArc, prefixArcs: 1 };
}

function formatIndexValue(raw: number[], descriptor: TableIndexDescriptor): string {
  if (/^IpAddress\b/i.test(descriptor.syntax)) {
    if (raw.some((arc) => arc > 255))
      throw new Error(`${descriptor.name} contains an invalid IP octet`);
    return raw.join('.');
  }
  if (/^(?:OCTET STRING|BITS)\b/i.test(descriptor.syntax)) {
    if (raw.some((arc) => arc > 255))
      throw new Error(`${descriptor.name} contains an invalid octet`);
    return descriptor.displayHint
      ? formatOctetStringDisplayHint(Uint8Array.from(raw), descriptor.displayHint)
      : raw.map((value) => value.toString(16).padStart(2, '0')).join(':');
  }
  if (/^OBJECT IDENTIFIER\b/i.test(descriptor.syntax)) return raw.join('.');
  return String(raw[0]);
}
