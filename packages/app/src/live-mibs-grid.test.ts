import { describe, expect, it } from 'vitest';
import type { DecodedVarbind, MibNodeDetail } from '@mibbeacon/core/client';
import {
  buildLiveMibDocumentGroups,
  liveMibInstanceKey,
  mergeLiveMibRows,
  valueText,
} from './live-mibs-grid';

const varbind = (
  oid: string,
  value: string | number,
  formattedValue?: string,
): DecodedVarbind => ({
  oid,
  type: 2,
  typeName: 'Integer',
  value,
  rawValue: value,
  ...(formattedValue ? { formattedValue } : {}),
  isError: false,
});

describe('live MIB document batches', () => {
  it('upserts values by instance OID while preserving unaffected rows', () => {
    const first = mergeLiveMibRows(new Map(), [
      varbind('1.3.6.1.2.1.1.1.0', 'a'),
      varbind('1.3.6.1.2.1.1.2.0', 'b'),
    ]);
    const second = mergeLiveMibRows(first, [varbind('1.3.6.1.2.1.1.1.0', 'changed')], 20);
    expect([...second.values()].map(({ value }) => value.value)).toEqual(['changed', 'b']);
    expect(second.get('1.3.6.1.2.1.1.1.0')?.updatedAt).toBe(20);
  });

  it('prefers formatted values when configured', () => {
    const item = varbind('1.2.3', 1, 'up(1)');
    expect(valueText(item, true)).toBe('up(1)');
    expect(valueText(item, false)).toBe('1');
  });

  it('uses printable OctetString text instead of its lossless hex representation', () => {
    const item = {
      ...varbind('1.2.3', 'edge'),
      rawValue: '65 64 67 65',
      rawHex: '65 64 67 65',
    };
    expect(valueText(item, true)).toBe('edge');
    expect(valueText(item, false)).toBe('65 64 67 65');
  });

  it('groups instances as module, object, and JSON-style instance keys', () => {
    const metadata = {
      oid: '1.3.6.1.2.1.1.5',
      name: 'sysName',
      module: 'SNMPv2-MIB',
    } as MibNodeDetail;
    const rows = [
      {
        oid: `${metadata.oid}.0`,
        value: varbind(`${metadata.oid}.0`, 'edge'),
        metadata,
        updatedAt: 1,
      },
    ];

    const groups = buildLiveMibDocumentGroups(rows);
    expect(groups).toMatchObject([
      {
        name: 'SNMPv2-MIB',
        objects: [{ name: 'sysName', definitionOid: metadata.oid, rows }],
      },
    ]);
    expect(liveMibInstanceKey(rows[0]!)).toBe('0');
  });

  it('uses resolved names to group rows while metadata hydration is pending', () => {
    const row = {
      oid: '1.3.6.1.2.1.2.2.1.2.7',
      value: { ...varbind('1.3.6.1.2.1.2.2.1.2.7', 'uplink'), name: 'ifDescr.7' },
      updatedAt: 1,
    };
    expect(buildLiveMibDocumentGroups([row])).toMatchObject([
      { name: 'MIB objects', objects: [{ name: 'ifDescr', rows: [row] }] },
    ]);
    expect(liveMibInstanceKey(row)).toBe('7');
  });
});
