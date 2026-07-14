import { decodeTableIndex } from '@mibbeacon/core/client';
import type { DecodedVarbind, TableIndexDescriptor } from '@mibbeacon/core/client';

export const TABLE_ROW_HEIGHT = 49;

export function tableViewportHeight(rowCount: number): number {
  return Math.min(600, Math.max(100, rowCount * TABLE_ROW_HEIGHT));
}

export interface TableViewColumn {
  oid: string;
  name: string;
  access?: string;
  syntax?: string;
}

export interface TableViewRow {
  key: string;
  indexes: { name: string; formatted: string }[];
  cells: Record<string, DecodedVarbind>;
}

export function buildTableRows(
  varbinds: readonly DecodedVarbind[],
  columns: readonly TableViewColumn[],
  indexes: readonly TableIndexDescriptor[],
): TableViewRow[] {
  const rows = new Map<string, TableViewRow>();
  for (const varbind of varbinds) {
    const column = columns
      .filter(({ oid }) => varbind.oid === oid || varbind.oid.startsWith(`${oid}.`))
      .sort((left, right) => right.oid.length - left.oid.length)[0];
    if (!column) continue;
    const suffix = varbind.oid.slice(column.oid.length).replace(/^\./, '');
    let decoded: ReturnType<typeof decodeTableIndex>;
    try {
      decoded = decodeTableIndex(suffix, indexes);
    } catch {
      decoded = { values: [], remaining: suffix.split('.').filter(Boolean).map(Number) };
    }
    const key = `${varbind.agentId ? `${varbind.agentId}|` : ''}${suffix || '(scalar)'}`;
    const row = rows.get(key) ?? {
      key,
      indexes: [
        ...(varbind.agentName ? [{ name: 'Agent', formatted: varbind.agentName }] : []),
        ...decoded.values.map(({ name, formatted }) => ({ name, formatted })),
      ],
      cells: {},
    };
    row.cells[column.oid] = varbind;
    rows.set(key, row);
  }
  return [...rows.values()].sort((left, right) => compareOidSuffix(left.key, right.key));
}

export function encodeTableIndex(
  values: readonly string[],
  descriptors: readonly TableIndexDescriptor[],
): string {
  if (values.length !== descriptors.length) throw new Error('Every table index value is required');
  const arcs = descriptors.flatMap((descriptor, index) => {
    const value = values[index]!.trim();
    if (/^IpAddress\b/i.test(descriptor.syntax)) {
      const parts = value.split('.').map(Number);
      if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        throw new Error(`${descriptor.name} must be an IPv4 address`);
      }
      return parts;
    }
    if (/^(?:INTEGER|Integer32|Unsigned\d*|Gauge\d*|Counter\d*|TimeTicks)\b/i.test(descriptor.syntax)) {
      if (!/^\d+$/.test(value)) throw new Error(`${descriptor.name} must be an integer`);
      return [Number(value)];
    }
    if (/^OBJECT IDENTIFIER\b/i.test(descriptor.syntax)) {
      const parts = value.split('.').filter(Boolean).map(Number);
      return descriptor.implied ? parts : [parts.length, ...parts];
    }
    const bytes = [...new TextEncoder().encode(value)];
    return descriptor.implied ? bytes : [bytes.length, ...bytes];
  });
  return arcs.join('.');
}

function compareOidSuffix(left: string, right: string): number {
  const [leftAgent = '', leftSuffix = left] = left.includes('|') ? left.split('|', 2) : ['', left];
  const [rightAgent = '', rightSuffix = right] = right.includes('|') ? right.split('|', 2) : ['', right];
  const agentOrder = leftAgent.localeCompare(rightAgent);
  if (agentOrder !== 0) return agentOrder;
  const a = leftSuffix.split('.').map(Number);
  const b = rightSuffix.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}
