import { describe, expect, it } from 'vitest';
import { highlightSegments } from './search-highlights';

describe('search highlight segments', () => {
  it('merges and clips matching ranges while preserving unmatched text', () => {
    expect(
      highlightSegments(
        'ifHCInOctets',
        [
          { field: 'name', start: 0, end: 4 },
          { field: 'name', start: 4, end: 6 },
          { field: 'oid', start: 0, end: 20 },
          { field: 'name', start: 10, end: 99 },
        ],
        'name',
      ),
    ).toEqual([
      { text: 'ifHCIn', highlighted: true },
      { text: 'Octe', highlighted: false },
      { text: 'ts', highlighted: true },
    ]);
  });
});
