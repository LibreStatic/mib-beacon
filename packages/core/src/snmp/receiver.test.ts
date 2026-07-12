import { describe, expect, it } from 'vitest';
import { trapOidFromPdu } from './receiver';

describe('trapOidFromPdu', () => {
  it('normalizes standard v1 generic traps to SNMPv2 notification OIDs', () => {
    expect(trapOidFromPdu({ type: 4, varbinds: [], generic: 0 })).toBe('1.3.6.1.6.3.1.1.5.1');
  });

  it('normalizes enterprise-specific v1 traps per RFC 2576', () => {
    expect(
      trapOidFromPdu({
        type: 4,
        varbinds: [],
        generic: 6,
        specific: 42,
        enterprise: '1.3.6.1.4.1.9',
      }),
    ).toBe('1.3.6.1.4.1.9.0.42');
  });
});
