import type { DecodedVarbind, MibNodeDetail } from '@mibbeacon/core/client';

export interface LiveMibGridRow {
  oid: string;
  value: DecodedVarbind;
  metadata?: MibNodeDetail;
  updatedAt: number;
}

export function mergeLiveMibRows(
  current: ReadonlyMap<string, LiveMibGridRow>,
  batch: readonly DecodedVarbind[],
  now = Date.now(),
): Map<string, LiveMibGridRow> {
  const next = new Map(current);
  for (const value of batch) {
    const existing = next.get(value.oid);
    next.set(value.oid, { oid: value.oid, value, updatedAt: now, metadata: existing?.metadata });
  }
  return next;
}

export function attachLiveMibMetadata(
  current: ReadonlyMap<string, LiveMibGridRow>,
  oid: string,
  metadata: MibNodeDetail,
): Map<string, LiveMibGridRow> {
  const row = current.get(oid);
  if (!row) return new Map(current);
  const next = new Map(current);
  next.set(oid, { ...row, metadata });
  return next;
}

export function valueText(value: DecodedVarbind, preferFormatted = true): string {
  return String(
    preferFormatted
      ? (value.formattedValue ?? value.rawValue ?? value.value)
      : (value.rawValue ?? value.value),
  );
}
