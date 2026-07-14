interface OctetHintPart {
  length: number;
  format: 'x' | 'd' | 'o' | 'a' | 't';
  separator: string;
}

export function formatOctetStringDisplayHint(bytes: Uint8Array, hint: string): string {
  const parts = parseOctetHint(hint);
  if (parts.length === 0)
    return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join(' ');
  let offset = 0;
  let partIndex = 0;
  let output = '';
  while (offset < bytes.length) {
    const part = parts[partIndex] ?? parts[parts.length - 1]!;
    const length = Math.min(part.length, bytes.length - offset);
    if (length <= 0) break;
    const chunk = bytes.slice(offset, offset + length);
    output += formatOctets(chunk, part.format, part.length);
    offset += length;
    if (offset < bytes.length) output += part.separator;
    partIndex += 1;
  }
  return output;
}

export function formatIntegerDisplayHint(value: number | bigint, hint: string): string {
  const match = hint.trim().match(/^([dxo])(?:-([0-9]+))?$/i);
  if (!match) return String(value);
  const format = match[1]!.toLowerCase();
  const integer = BigInt(value);
  if (format === 'x') return integer.toString(16);
  if (format === 'o') return integer.toString(8);
  const decimalPlaces = Number.parseInt(match[2] ?? '0', 10);
  if (decimalPlaces === 0) return integer.toString(10);
  const negative = integer < 0n;
  const digits = (negative ? -integer : integer).toString(10).padStart(decimalPlaces + 1, '0');
  const split = digits.length - decimalPlaces;
  return `${negative ? '-' : ''}${digits.slice(0, split)}.${digits.slice(split)}`;
}

function parseOctetHint(hint: string): OctetHintPart[] {
  const parts: OctetHintPart[] = [];
  let offset = 0;
  while (offset < hint.length) {
    if (hint[offset] === '*') offset += 1;
    const lengthMatch = hint.slice(offset).match(/^\d+/);
    if (!lengthMatch) break;
    offset += lengthMatch[0].length;
    const format = hint[offset]?.toLowerCase();
    if (!format || !['x', 'd', 'o', 'a', 't'].includes(format)) break;
    offset += 1;
    let separator = '';
    if (offset < hint.length && !/[0-9*]/.test(hint[offset]!)) {
      separator = hint[offset]!;
      offset += 1;
    }
    parts.push({
      length: Number.parseInt(lengthMatch[0], 10),
      format: format as OctetHintPart['format'],
      separator,
    });
  }
  return parts;
}

function formatOctets(
  bytes: Uint8Array,
  format: OctetHintPart['format'],
  declaredLength: number,
): string {
  if (format === 'a' || format === 't') return new TextDecoder().decode(bytes);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  if (format === 'x') return value.toString(16).padStart(declaredLength * 2, '0');
  if (format === 'o') return value.toString(8);
  return value.toString(10);
}
