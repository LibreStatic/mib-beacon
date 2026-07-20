export const MIN_PATTERN_TRACE_CADENCE_MS = 250;
export const MIN_PATTERN_TRACE_DURATION_MS = 1_000;
export const MAX_PATTERN_TRACE_DURATION_MS = 60 * 60 * 1_000;
export const MAX_PATTERN_TRACE_IN_FLIGHT = 32;

export function validatePatternTraceWindow(cadenceMs: number, durationMs: number): void {
  if (!Number.isInteger(cadenceMs) || cadenceMs < MIN_PATTERN_TRACE_CADENCE_MS) {
    throw new Error(`Pattern cadence must be at least ${MIN_PATTERN_TRACE_CADENCE_MS} ms`);
  }
  if (!Number.isInteger(durationMs) || durationMs < MIN_PATTERN_TRACE_DURATION_MS) {
    throw new Error(`Pattern duration must be at least ${MIN_PATTERN_TRACE_DURATION_MS} ms`);
  }
  if (durationMs > MAX_PATTERN_TRACE_DURATION_MS) {
    throw new Error(`Pattern duration must be at most ${MAX_PATTERN_TRACE_DURATION_MS} ms`);
  }
}

export function patternHitTimes(startAt: number, endAt: number, cadenceMs: number): number[] {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return [];
  const hits: number[] = [];
  for (let hitAt = startAt; hitAt < endAt; hitAt += cadenceMs) hits.push(hitAt);
  return hits;
}

export function isPatternTraceColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}
