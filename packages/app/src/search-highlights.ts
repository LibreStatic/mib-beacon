import type { MibSearchHit } from '@mibbeacon/core/client';

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

export function highlightSegments(
  value: string,
  highlights: MibSearchHit['highlights'],
  field: 'name' | 'oid' | 'description',
): HighlightSegment[] {
  const ranges = (highlights ?? [])
    .filter((highlight) => highlight.field === field)
    .map(({ start, end }) => ({
      start: Math.max(0, Math.min(value.length, start)),
      end: Math.max(0, Math.min(value.length, end)),
    }))
    .filter(({ start, end }) => end > start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  const segments: HighlightSegment[] = [];
  let offset = 0;
  for (const range of merged) {
    if (range.start > offset)
      segments.push({ text: value.slice(offset, range.start), highlighted: false });
    segments.push({ text: value.slice(range.start, range.end), highlighted: true });
    offset = range.end;
  }
  if (offset < value.length) segments.push({ text: value.slice(offset), highlighted: false });
  return segments.length > 0 ? segments : [{ text: value, highlighted: false }];
}
