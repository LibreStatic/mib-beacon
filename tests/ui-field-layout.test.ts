import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('shared field layout', () => {
  it('keeps multiline input bounds inside intrinsic-height field containers', () => {
    const source = readFileSync(
      new URL('../packages/ui/src/primitives.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toMatch(
      /field:\s*\{[^}]*flexGrow:\s*1[^}]*flexShrink:\s*1[^}]*flexBasis:\s*'auto'[^}]*minWidth:\s*0/s,
    );
  });
});
