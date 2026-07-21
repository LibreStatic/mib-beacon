import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('trap receiver responsive layout', () => {
  it('wraps the receiver action when its split pane is narrow', () => {
    const source = readFileSync(new URL('./screens/TrapsScreen.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<Row style={styles.receiverControls}>');
    expect(source).toContain('<View style={styles.receiverAction}>');
    expect(source).toMatch(/receiverControls:\s*\{[^}]*flexWrap:\s*'wrap'[^}]*\}/s);
    expect(source).toMatch(/receiverAction:\s*\{[^}]*flexBasis:\s*120[^}]*minWidth:\s*120[^}]*\}/s);
  });

  it('routes split inspector read changes through the shared pending mutation boundary', () => {
    const source = readFileSync(new URL('./screens/TrapsScreen.tsx', import.meta.url), 'utf8');
    const detail = source.slice(
      source.indexOf('function TrapDetail'),
      source.indexOf('function SendWorkspace'),
    );

    expect(detail).not.toContain('markTrapRead(');
    expect(source).toContain('onMark={(read) =>');
    expect(source).toContain('disabled={clearPending}');
    expect(source).toContain('pending={pendingRecordIds.includes(selected.id)}');
  });

  it('labels clear and record pending states in the stable responsive capture branch', () => {
    const source = readFileSync(new URL('./screens/TrapsScreen.tsx', import.meta.url), 'utf8');

    expect(source.match(/clearPending\s*\?\s*'Clearing…'/g)).toHaveLength(1);
    expect(source.match(/Record action pending/g)?.length).toBeGreaterThanOrEqual(1);
    expect(source.match(/<TrapCaptureTools/g)).toHaveLength(1);
  });
});
