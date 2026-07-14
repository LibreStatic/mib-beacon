import { describe, expect, it } from 'vitest';
import type { TrapRecord } from '../snmp/receiver';
import { evaluateTrapRules, matchesTrapRule } from './rules';

const trap: TrapRecord = {
  id: 'trap-1',
  receivedAt: 1,
  sourceAddress: '192.0.2.45',
  sourcePort: 1234,
  version: 1,
  pduType: 167,
  trapOid: '1.3.6.1.6.3.1.1.5.3',
  varbinds: [
    { oid: '1.3.6.1.2.1.2.2.1.8.7', name: 'ifOperStatus.7', type: 2, typeName: 'Integer', value: 'down', isError: false },
  ],
};

describe('trap rules', () => {
  it('matches OID globs, IPv4 prefixes, and case-insensitive varbind substrings', () => {
    expect(
      matchesTrapRule(
        {
          trapOidGlob: '1.3.6.1.6.3.1.1.5.*',
          sourcePrefixes: ['192.0.2.0/24'],
          varbindSubstrings: ['OPERSTATUS', 'down'],
        },
        trap,
      ),
    ).toBe(true);
    expect(matchesTrapRule({ sourcePrefixes: ['198.51.100.0/24'] }, trap)).toBe(false);
  });

  it('merges enabled matches in priority order and collects notification actions', () => {
    const result = evaluateTrapRules(
      [
        {
          id: 'low', name: 'Low', enabled: true, priority: 20, condition: {},
          actions: { severity: 'critical', notify: true }, createdAt: 1, updatedAt: 1,
        },
        {
          id: 'high', name: 'High', enabled: true, priority: 10, condition: {},
          actions: { severity: 'warning', color: '#f59e0b' }, createdAt: 1, updatedAt: 1,
        },
        {
          id: 'off', name: 'Off', enabled: false, priority: 1, condition: {},
          actions: { notify: true }, createdAt: 1, updatedAt: 1,
        },
      ],
      trap,
    );
    expect(result.matchedRuleIds).toEqual(['high', 'low']);
    expect(result.actions).toEqual({ severity: 'critical', color: '#f59e0b', notify: true });
    expect(result.notifyRules.map(({ id }) => id)).toEqual(['low']);
  });
});
