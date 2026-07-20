import { describe, expect, it } from 'vitest';
import { DEFAULT_PATTERN_TRACE_COLOR, normalizePatternTraceColor } from './pattern-trace-settings';

describe('pattern trace settings', () => {
  it('normalizes valid hex colors and falls back for invalid values', () => {
    expect(DEFAULT_PATTERN_TRACE_COLOR).toBe('#ef4444');
    expect(normalizePatternTraceColor(' #12ABef ')).toBe('#12abef');
    expect(normalizePatternTraceColor('red')).toBe(DEFAULT_PATTERN_TRACE_COLOR);
    expect(normalizePatternTraceColor('#123')).toBe(DEFAULT_PATTERN_TRACE_COLOR);
  });
});
