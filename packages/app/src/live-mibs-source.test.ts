// Test-only source inspection; application code still uses the EngineAPI seam.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Live MIB source guards', () => {
  it('keeps the Live MIB entry reachable in the compact Browse branch', () => {
    const browse = readFileSync(join(__dirname, 'screens', 'BrowseScreen.tsx'), 'utf-8');
    const compactBranch = browse
      .split('if (!supportsSplitView) {')[1]
      ?.split('const inspector =')[0];
    expect(compactBranch).toContain('{browseHeader}');
  });

  it('keeps the FlatList viewability callback stable across refresh renders', () => {
    const liveMibs = readFileSync(join(__dirname, 'screens', 'LiveMibsScreen.tsx'), 'utf-8');
    expect(liveMibs).toContain('onViewableItemsChanged={onViewableItemsChanged}');
    expect(liveMibs).not.toContain('onViewableItemsChanged={({ viewableItems }) =>');
  });

  it('reconciles terminal scan status when an event races a reconnect', () => {
    const liveMibs = readFileSync(join(__dirname, 'screens', 'LiveMibsScreen.tsx'), 'utf-8');
    expect(liveMibs).toContain('engine.liveMibs.scan.status(handleId)');
    expect(liveMibs).toContain("['started', 'running'].includes(scan.state)");
  });

  it('keeps the compact tree and grid reachable with vertical scrolling', () => {
    const liveMibs = readFileSync(join(__dirname, 'screens', 'LiveMibsScreen.tsx'), 'utf-8');
    expect(liveMibs).toContain('style={styles.compactWorkspaceScroll}');
    expect(liveMibs).toContain('contentContainerStyle={styles.compactWorkspaceContent}');
  });
});
