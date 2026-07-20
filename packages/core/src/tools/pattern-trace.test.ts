import { describe, expect, it } from 'vitest';
import {
  MAX_PATTERN_TRACE_DURATION_MS,
  MIN_PATTERN_TRACE_CADENCE_MS,
  patternHitTimes,
  validatePatternTraceWindow,
} from './pattern-trace';

describe('pattern trace scheduling', () => {
  it('creates fixed-cadence hits in a half-open time window', () => {
    expect(patternHitTimes(1_000, 3_000, 500)).toEqual([1_000, 1_500, 2_000, 2_500]);
  });

  it('accepts the documented active-trace bounds', () => {
    expect(() => validatePatternTraceWindow(500, 60_000)).not.toThrow();
    expect(MIN_PATTERN_TRACE_CADENCE_MS).toBe(250);
    expect(MAX_PATTERN_TRACE_DURATION_MS).toBe(60 * 60 * 1_000);
  });

  it('rejects unsafe cadence and duration values', () => {
    expect(() => validatePatternTraceWindow(249, 60_000)).toThrow(/cadence/i);
    expect(() => validatePatternTraceWindow(500, 999)).toThrow(/duration/i);
    expect(() => validatePatternTraceWindow(500, MAX_PATTERN_TRACE_DURATION_MS + 1)).toThrow(
      /duration/i,
    );
  });
});
