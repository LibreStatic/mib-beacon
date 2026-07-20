import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('settings responsive layout', () => {
  it('lets the resolver hero copy shrink beside its status pill on narrow phones', () => {
    const source = readFileSync(new URL('./screens/SettingsScreen.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<View style={styles.heroCopy}>');
    expect(source).toMatch(/heroCopy:\s*\{[^}]*flex:\s*1[^}]*minWidth:\s*0[^}]*\}/s);
  });
});
