import { describe, expect, it } from 'vitest';
import { counterDelta, derivePollValue, interfaceUtilization, summarizeSamples } from './math';

describe('poll and interface math', () => {
  it('handles Counter32 and Counter64 wrap exactly', () => {
    expect(counterDelta('4294967290', '5', 32)).toBe(11n);
    expect(counterDelta('18446744073709551610', '5', 64)).toBe(11n);
  });

  it('derives raw, delta, and per-second rate values', () => {
    expect(derivePollValue('raw', '42', undefined, 1_000, 32)).toBe(42);
    expect(derivePollValue('delta', '110', { raw: '100', at: 0 }, 1_000, 32)).toBe(10);
    expect(derivePollValue('rate-per-sec', '150', { raw: '100', at: 0 }, 2_000, 32)).toBe(25);
  });

  it('computes utilization and returns null for unknown speed', () => {
    expect(interfaceUtilization(125_000_000, 1_000_000_000)).toBe(100);
    expect(interfaceUtilization(125_000, 0)).toBeNull();
  });

  it('summarizes finite samples', () => {
    expect(summarizeSamples([3, Number.NaN, 1, 8])).toEqual({ min: 1, max: 8, avg: 4 });
  });
});
