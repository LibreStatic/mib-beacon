import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('trap composer responsive envelope rows', () => {
  it('wraps the SNMPv1 envelope fields instead of forcing a single compressed row', () => {
    const source = fs.readFileSync('packages/app/src/components/TrapComposerDialog.tsx', 'utf8');

    expect(source).toContain('styles.v1EnvelopeRow');
    expect(source).toContain('styles.v1EnvelopeField');
    expect(source).toContain('v1EnvelopeRow:');
    expect(source).toContain('flexWrap: \'wrap\'');
  });
});
