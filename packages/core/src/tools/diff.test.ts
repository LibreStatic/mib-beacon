import { describe, expect, it } from 'vitest';
import { diffWalks, parseNumericSnmpwalk } from './diff';

describe('walk parsing and diff', () => {
  it('parses net-snmp numeric output including quoted and typed values', () => {
    expect(
      parseNumericSnmpwalk('.1.3.6.1.2.1.1.5.0 = STRING: "router"\n.1.3.6.1.2.1.1.3.0 = Timeticks: (42) 0:00:00.42'),
    ).toEqual([
      { oid: '1.3.6.1.2.1.1.5.0', type: 'STRING', value: 'router' },
      { oid: '1.3.6.1.2.1.1.3.0', type: 'Timeticks', value: '(42) 0:00:00.42' },
    ]);
  });

  it('aligns equal, changed, added, and removed OIDs', () => {
    expect(
      diffWalks(
        [{ oid: '1', value: 'same' }, { oid: '2', value: 'old' }, { oid: '3', value: 'gone' }],
        [{ oid: '1', value: 'same' }, { oid: '2', value: 'new' }, { oid: '4', value: 'added' }],
      ).map(({ oid, status }) => ({ oid, status })),
    ).toEqual([
      { oid: '1', status: 'equal' },
      { oid: '2', status: 'different' },
      { oid: '3', status: 'only-a' },
      { oid: '4', status: 'only-b' },
    ]);
  });
});
