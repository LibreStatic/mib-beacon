import { describe, expect, it } from 'vitest';
import {
  MAX_MIB_BATCH_BYTES,
  MAX_MIB_FILE_BYTES,
  MAX_MIB_FILE_COUNT,
  validateMibFileBatch,
} from './mib-file-limits';

describe('validateMibFileBatch', () => {
  it('accepts exact count, per-file, and total UTF-8 byte boundaries', () => {
    expect(() => validateMibFileBatch(
      Array.from({ length: MAX_MIB_FILE_COUNT }, (_, index) => ({ name: `${index}`, content: '' })),
    )).not.toThrow();
    expect(() => validateMibFileBatch([{ name: 'exact', content: 'x'.repeat(MAX_MIB_FILE_BYTES) }]))
      .not.toThrow();
    expect(() => validateMibFileBatch(
      Array.from({ length: MAX_MIB_BATCH_BYTES / MAX_MIB_FILE_BYTES }, (_, index) => ({
        name: `${index}`,
        content: 'x'.repeat(MAX_MIB_FILE_BYTES),
      })),
    )).not.toThrow();
  });

  it('counts encoded bytes rather than UTF-16 code units', () => {
    const content = 'é'.repeat(Math.floor(MAX_MIB_FILE_BYTES / 2) + 1);
    expect(content.length).toBeLessThan(MAX_MIB_FILE_BYTES);
    expect(() => validateMibFileBatch([{ name: 'utf8', content }])).toThrow(/5 MiB/);
  });
});
