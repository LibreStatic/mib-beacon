export const DEFAULT_PATTERN_TRACE_COLOR = '#ef4444';

export function isPatternTraceColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

export function normalizePatternTraceColor(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? '';
  return isPatternTraceColor(normalized) ? normalized : DEFAULT_PATTERN_TRACE_COLOR;
}
