import { describe, expect, it } from 'vitest';
import { formatVarbindWithMib } from './varbind-format';

const base = {
  oid: '1.3.6.1',
  type: 2,
  typeName: 'Integer',
  value: 2,
  rawValue: 2,
  isError: false,
};

describe('formatVarbindWithMib', () => {
  it('retains raw values while applying enum labels and units', () => {
    expect(
      formatVarbindWithMib(base, {
        oid: '1.3.6.1',
        name: 'ifOperStatus',
        kind: 'column',
        hasChildren: false,
        childCount: 0,
        enumValues: { up: 1, down: 2 },
        units: 'state',
      }),
    ).toMatchObject({ rawValue: 2, value: 2, formattedValue: 'down(2) state', enumLabel: 'down' });
  });

  it('formats binary octets with a DISPLAY-HINT and preserves exact hex', () => {
    expect(
      formatVarbindWithMib(
        { ...base, value: '00 11 22 33 44 55', rawValue: '00 11 22 33 44 55', rawHex: '00 11 22 33 44 55' },
        {
          oid: '1.3.6.1',
          name: 'macAddress',
          kind: 'column',
          hasChildren: false,
          childCount: 0,
          displayHint: '1x:',
        },
      ),
    ).toMatchObject({ rawHex: '00 11 22 33 44 55', formattedValue: '00:11:22:33:44:55' });
  });
});
