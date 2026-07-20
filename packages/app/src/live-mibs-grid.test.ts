import { describe, expect, it } from 'vitest';
import type { DecodedVarbind } from '@mibbeacon/core/client';
import { mergeLiveMibRows, valueText } from './live-mibs-grid';

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

describe('live MIB grid batches', () => {
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
});
