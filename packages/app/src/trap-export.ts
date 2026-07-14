import { inferWireType } from '@mibbeacon/core/client';
import type { NotificationPayload, TrapRecord } from '@mibbeacon/core/client';

export type TrapExportFormat = 'json' | 'text' | 'csv';

export function serializeTraps(records: readonly TrapRecord[], format: TrapExportFormat): string {
  if (format === 'json') return JSON.stringify(records, null, 2);
  if (format === 'text') return records.map(trapAsText).join('\n\n---\n\n');
  const header = [
    'receivedAt',
    'source',
    'trap',
    'version',
    'severity',
    'read',
    'parseError',
    'varbinds',
  ];
  const rows = records.map((record) => [
    new Date(record.receivedAt).toISOString(),
    `${record.sourceAddress}:${record.sourcePort}`,
    record.trapName ?? record.trapOid ?? '',
    String(record.version),
    record.severity ?? '',
    record.readAt ? 'yes' : 'no',
    record.parseError ?? '',
    record.varbinds
      .map((varbind) => `${varbind.name ?? varbind.oid}=${String(varbind.formattedValue ?? varbind.value)}`)
      .join('; '),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

export function trapToNotificationPayload(record: TrapRecord): NotificationPayload {
  return {
    kind: 'trap',
    trapOid: record.trapOid ?? '1.3.6.1.6.3.1.1.5.1',
    ...(record.sysUpTime === undefined ? {} : { upTime: record.sysUpTime }),
    varbinds: record.varbinds
      .filter(
        ({ oid }) => oid !== '1.3.6.1.2.1.1.3.0' && oid !== '1.3.6.1.6.3.1.1.4.1.0',
      )
      .map((varbind) => ({
        oid: varbind.oid,
        type: inferWireType(varbind.typeName),
        value: String(varbind.rawValue ?? varbind.value),
        ...(varbind.rawHex && /octet|string/i.test(varbind.typeName)
          ? { value: varbind.rawHex.replace(/\s+/g, ''), encoding: 'hex' as const }
          : {}),
      })),
  };
}

function trapAsText(record: TrapRecord): string {
  return [
    `${new Date(record.receivedAt).toISOString()} ${record.trapName ?? record.trapOid ?? 'unknown trap'}`,
    `Source: ${record.sourceAddress}:${record.sourcePort} · SNMP version ${record.version}`,
    ...(record.parseError ? [`Parse error: ${record.parseError}`] : []),
    ...record.varbinds.map(
      (varbind) =>
        `${varbind.name ?? varbind.oid} (${varbind.typeName}): ${String(varbind.formattedValue ?? varbind.value)}`,
    ),
  ].join('\n');
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
