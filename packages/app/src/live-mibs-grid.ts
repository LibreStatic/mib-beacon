import type { DecodedVarbind, MibNodeDetail } from '@mibbeacon/core/client';

export interface LiveMibGridRow {
  oid: string;
  value: DecodedVarbind;
  metadata?: MibNodeDetail;
  updatedAt: number;
}

export interface LiveMibDocumentObject {
  id: string;
  name: string;
  definitionOid: string;
  rows: LiveMibGridRow[];
}

export interface LiveMibDocumentModule {
  id: string;
  name: string;
  objects: LiveMibDocumentObject[];
}

export function liveMibInstanceKey(row: LiveMibGridRow): string {
  const definitionOid = row.metadata?.oid;
  if (definitionOid && row.oid.startsWith(`${definitionOid}.`))
    return row.oid.slice(definitionOid.length + 1);
  const resolvedName = row.value.name;
  if (resolvedName?.includes('.')) return resolvedName.slice(resolvedName.indexOf('.') + 1);
  return row.oid;
}

export function buildLiveMibDocumentGroups(
  rows: readonly LiveMibGridRow[],
): LiveMibDocumentModule[] {
  const modules = new Map<string, Map<string, LiveMibDocumentObject>>();
  for (const row of rows) {
    const resolvedName = row.value.name?.split('.')[0];
    const moduleName = row.metadata?.module ?? 'MIB objects';
    const definitionOid = row.metadata?.oid ?? `name:${resolvedName ?? row.oid}`;
    const objectName = row.metadata?.name ?? resolvedName ?? row.oid;
    let objects = modules.get(moduleName);
    if (!objects) {
      objects = new Map();
      modules.set(moduleName, objects);
    }
    let object = objects.get(definitionOid);
    if (!object) {
      object = {
        id: `${moduleName}:${definitionOid}`,
        name: objectName,
        definitionOid,
        rows: [],
      };
      objects.set(definitionOid, object);
    }
    object.rows.push(row);
  }
  return [...modules.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, objects]) => ({
      id: `module:${name}`,
      name,
      objects: [...objects.values()]
        .sort(
          (left, right) =>
            left.name.localeCompare(right.name) ||
            left.definitionOid.localeCompare(right.definitionOid, undefined, { numeric: true }),
        )
        .map((object) => ({
          ...object,
          rows: [...object.rows].sort((left, right) =>
            left.oid.localeCompare(right.oid, undefined, { numeric: true }),
          ),
        })),
    }));
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
      ? (value.formattedValue ?? value.value)
      : (value.rawValue ?? value.value),
  );
}
