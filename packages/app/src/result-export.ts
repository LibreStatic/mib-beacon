import type { DecodedVarbind } from '@mibbeacon/core/client';

export type ResultExportFormat = 'csv' | 'json';

export function serializeQueryResults(
  results: readonly DecodedVarbind[],
  format: ResultExportFormat,
): string {
  if (format === 'json') return JSON.stringify(results, null, 2);
  const rows = results.map((item) => [
    item.name ?? '',
    item.oid,
    item.formattedValue ?? String(item.value),
    item.rawHex ?? String(item.rawValue ?? item.value),
    item.typeName,
    item.isError ? item.errorText ?? 'error' : '',
  ]);
  return [
    ['Name', 'OID', 'Formatted Value', 'Raw Value', 'Type', 'Error'],
    ...rows,
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
