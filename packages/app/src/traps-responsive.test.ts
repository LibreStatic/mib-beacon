import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('trap receiver responsive layout', () => {
  it('wraps the receiver action when its split pane is narrow', () => {
    const source = readFileSync(new URL('./screens/TrapsScreen.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<Row style={styles.receiverControls}>');
    expect(source).toContain('<View style={styles.receiverAction}>');
    expect(source).toMatch(
      /receiverControls:\s*\{[^}]*flexWrap:\s*'wrap'[^}]*\}/s,
    );
    expect(source).toMatch(
      /receiverAction:\s*\{[^}]*flexBasis:\s*120[^}]*minWidth:\s*120[^}]*\}/s,
    );
  });
});
