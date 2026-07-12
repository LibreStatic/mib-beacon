import { describe, expect, it } from 'vitest';

import { getMibFilenameVariants } from './variants';

describe('getMibFilenameVariants', () => {
  it('probes case and extension variants in deterministic order', () => {
    expect(getMibFilenameVariants('If-Mib')).toEqual([
      'If-Mib',
      'If-Mib.txt',
      'If-Mib.mib',
      'If-Mib.my',
      'If-Mib.TXT',
      'If-Mib.MIB',
      'If-Mib.MY',
      'IF-MIB',
      'IF-MIB.txt',
      'IF-MIB.mib',
      'IF-MIB.my',
      'IF-MIB.TXT',
      'IF-MIB.MIB',
      'IF-MIB.MY',
      'if-mib',
      'if-mib.txt',
      'if-mib.mib',
      'if-mib.my',
      'if-mib.TXT',
      'if-mib.MIB',
      'if-mib.MY',
    ]);
  });

  it('deduplicates variants when the supplied name is already uppercase', () => {
    const variants = getMibFilenameVariants('IF-MIB');
    expect(variants).toHaveLength(14);
    expect(new Set(variants).size).toBe(variants.length);
  });

  it('uses a declared fixed extension with bounded name and extension casing', () => {
    expect(getMibFilenameVariants('If-Mib', '.my')).toEqual([
      'If-Mib.my',
      'If-Mib.MY',
      'IF-MIB.my',
      'IF-MIB.MY',
      'if-mib.my',
      'if-mib.MY',
    ]);
    expect(getMibFilenameVariants('IF-MIB', 'my')).toEqual([
      'IF-MIB.my',
      'IF-MIB.MY',
      'if-mib.my',
      'if-mib.MY',
    ]);
  });
});
