import { describe, expect, it } from 'vitest';
import { serializeQueryResults } from './result-export';

const results = [
  {
    oid: '1.3.6.1',
    name: 'sysName.0',
    type: 4,
    typeName: 'OctetString',
    value: 'edge, "west"',
    rawValue: '65 64 67 65',
    formattedValue: 'edge, "west"',
    isError: false,
  },
];

describe('query result export', () => {
  it('quotes CSV fields and includes formatted plus raw values', () => {
    const csv = serializeQueryResults(results, 'csv');
    expect(csv).toContain('Formatted Value,Raw Value');
    expect(csv).toContain('"edge, ""west""",65 64 67 65');
  });

  it('emits inspectable JSON without dropping raw fields', () => {
    expect(JSON.parse(serializeQueryResults(results, 'json'))[0]).toMatchObject({
      name: 'sysName.0',
      rawValue: '65 64 67 65',
    });
  });
});
