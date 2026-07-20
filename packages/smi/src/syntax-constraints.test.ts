import { describe, expect, it } from 'vitest';
import { extractSyntaxConstraints } from './format-syntax';

describe('extractSyntaxConstraints', () => {
  it('preserves every numeric range instead of only the first range', () => {
    expect(
      extractSyntaxConstraints({
        INTEGER: {
          ranges: [
            { min: 0, max: 10 },
            { min: 20, max: 30 },
          ],
        },
      }),
    ).toEqual({
      numericRanges: [
        { min: 0, max: 10 },
        { min: 20, max: 30 },
      ],
    });
  });

  it('preserves every OCTET STRING size range', () => {
    expect(
      extractSyntaxConstraints({
        'OCTET STRING': {
          sizes: [
            { min: 0, max: 32 },
            { min: 64, max: 64 },
          ],
        },
      }),
    ).toEqual({
      sizeRanges: [
        { min: 0, max: 32 },
        { min: 64, max: 64 },
      ],
    });
  });

  it('returns no constraints for plain or enumerated syntax', () => {
    expect(extractSyntaxConstraints('Integer32')).toBeUndefined();
    expect(extractSyntaxConstraints({ INTEGER: { up: 1, down: 2 } })).toBeUndefined();
  });
});
