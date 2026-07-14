import { describe, expect, it } from 'vitest';
import type { TrapRecord } from '@mibbeacon/core/client';
import { serializeTraps, trapToNotificationPayload } from './trap-export';

const record: TrapRecord = {
  id: 'trap-1',
  receivedAt: 0,
  sourceAddress: '192.0.2.1',
  sourcePort: 162,
  version: 1,
  pduType: 167,
  trapOid: '1.3.6.1.6.3.1.1.5.3',
  trapName: 'linkDown',
  varbinds: [
    { oid: '1.3.6.1.2.1.1.3.0', type: 67, typeName: 'TimeTicks', value: 50, isError: false },
    { oid: '1.3.6.1.2.1.2.2.1.8.7', type: 2, typeName: 'Integer', value: 2, isError: false },
  ],
};

describe('trap export and replay', () => {
  it('exports portable JSON, text, and quoted CSV', () => {
    expect(serializeTraps([record], 'json')).toContain('linkDown');
    expect(serializeTraps([record], 'text')).toContain('192.0.2.1:162');
    expect(serializeTraps([record], 'csv')).toContain('"linkDown"');
  });

  it('builds an editable replay payload without mandatory envelope varbinds', () => {
    expect(trapToNotificationPayload(record)).toEqual({
      kind: 'trap',
      trapOid: record.trapOid,
      varbinds: [
        { oid: '1.3.6.1.2.1.2.2.1.8.7', type: 'Integer', value: '2' },
      ],
    });
  });
});
