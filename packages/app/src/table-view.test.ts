import { describe, expect, it } from 'vitest';
import { buildTableRows, encodeTableIndex, tableViewportHeight } from './table-view';

describe('Table View row assembly', () => {
  it('decodes composite indexes and preserves sparse cells', () => {
    const rows = buildTableRows(
      [
        { oid: '1.3.6.1.1.10.0.0.1.80', type: 2, typeName: 'Integer', value: 1, isError: false },
        { oid: '1.3.6.1.2.10.0.0.1.80', type: 4, typeName: 'OctetString', value: 'open', isError: false },
        { oid: '1.3.6.1.1.10.0.0.2.443', type: 2, typeName: 'Integer', value: 2, isError: false },
      ],
      [
        { oid: '1.3.6.1.1', name: 'state' },
        { oid: '1.3.6.1.2', name: 'label' },
      ],
      [
        { name: 'address', syntax: 'IpAddress' },
        { name: 'port', syntax: 'INTEGER' },
      ],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      indexes: [
        { name: 'address', formatted: '10.0.0.1' },
        { name: 'port', formatted: '80' },
      ],
      cells: { '1.3.6.1.1': { value: 1 }, '1.3.6.1.2': { value: 'open' } },
    });
    expect(rows[1]?.cells['1.3.6.1.2']).toBeUndefined();
  });

  it('encodes integer, IP, variable string, and IMPLIED index values', () => {
    expect(
      encodeTableIndex(
        ['7', '10.0.0.1', 'ab', 'tail'],
        [
          { name: 'id', syntax: 'INTEGER' },
          { name: 'address', syntax: 'IpAddress' },
          { name: 'name', syntax: 'OCTET STRING' },
          { name: 'tail', syntax: 'OCTET STRING', implied: true },
        ],
      ),
    ).toBe('7.10.0.0.1.2.97.98.116.97.105.108');
  });

  it('bounds the virtualized row viewport for empty, small, and very large tables', () => {
    expect(tableViewportHeight(0)).toBe(100);
    expect(tableViewportHeight(3)).toBe(147);
    expect(tableViewportHeight(10_000)).toBe(600);
  });

  it('assembles ten thousand sparse rows without losing stable index order', () => {
    const rows = buildTableRows(
      Array.from({ length: 10_000 }, (_, index) => ({
        oid: `1.3.6.1.1.${index + 1}`,
        type: 2,
        typeName: 'Integer',
        value: index + 1,
        isError: false,
      })),
      [{ oid: '1.3.6.1.1', name: 'value' }],
      [{ name: 'index', syntax: 'INTEGER' }],
    );
    expect(rows).toHaveLength(10_000);
    expect(rows[0]?.key).toBe('1');
    expect(rows.at(-1)?.key).toBe('10000');
  });
});
