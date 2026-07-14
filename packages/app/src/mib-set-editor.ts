import type { MibNodeDetail } from '@mibbeacon/core/client';

export function mibRangeError(node: MibNodeDetail | null | undefined, value: string): string | null {
  const range = node?.syntax?.match(/\(\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\)/);
  if (!range || !/^-?\d+$/.test(value.trim())) return null;
  const numeric = Number(value);
  const min = Number(range[1]);
  const max = Number(range[2]);
  return numeric < min || numeric > max ? `Value must satisfy the MIB range ${min}..${max}.` : null;
}

export function toggleBitHex(currentHex: string, position: number): string {
  const compact = currentHex.replace(/[^0-9a-f]/gi, '');
  const bytes = Array.from({ length: Math.max(Math.ceil((position + 1) / 8), compact.length / 2) }, (_, index) =>
    Number.parseInt(compact.slice(index * 2, index * 2 + 2) || '00', 16),
  );
  const byte = Math.floor(position / 8);
  const mask = 1 << (7 - (position % 8));
  bytes[byte] = bytes[byte]! ^ mask;
  return bytes.map((value) => value.toString(16).padStart(2, '0')).join(' ');
}

export function bitIsSelected(hex: string, position: number): boolean {
  const compact = hex.replace(/[^0-9a-f]/gi, '');
  const byte = Number.parseInt(compact.slice(Math.floor(position / 8) * 2, Math.floor(position / 8) * 2 + 2) || '00', 16);
  return Boolean(byte & (1 << (7 - (position % 8))));
}
