import { describe, expect, it } from 'vitest';
import { expandIpv4Target } from './discovery';

describe('IPv4 discovery target expansion', () => {
  it('expands a CIDR without network/broadcast addresses', () => {
    expect(expandIpv4Target('192.0.2.0/30')).toEqual(['192.0.2.1', '192.0.2.2']);
  });

  it('expands an inclusive address range', () => {
    expect(expandIpv4Target('192.0.2.8-192.0.2.10')).toEqual([
      '192.0.2.8',
      '192.0.2.9',
      '192.0.2.10',
    ]);
  });

  it('enforces mobile /24-sized safety unless explicitly overridden', () => {
    expect(() => expandIpv4Target('10.0.0.0/23', { maxHosts: 254 })).toThrow(/exceeds.*254/i);
    expect(expandIpv4Target('10.0.0.0/23', { maxHosts: 510, includeEdges: false })).toHaveLength(510);
  });
});
