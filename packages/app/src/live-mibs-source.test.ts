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

  it('keeps compact tree and document panes independently reachable', () => {
    const liveMibs = readFileSync(join(__dirname, 'screens', 'LiveMibsScreen.tsx'), 'utf-8');
    expect(liveMibs).toContain("mode === 'compact' ? styles.compactWorkspace : null");
    expect(liveMibs).toContain("nestedScrollEnabled={mode === 'compact'}");
    expect(liveMibs).toContain('compactGridPane: { flex: 1, minHeight: 0 }');
  });

  it('renders live values as an editable document tree instead of a pivot grid', () => {
    const liveMibs = readFileSync(join(__dirname, 'screens', 'LiveMibsScreen.tsx'), 'utf-8');
    expect(liveMibs).toContain('function LiveMibDocumentTree');
    expect(liveMibs).toContain('&quot;{propertyKey}&quot;');
    expect(liveMibs).not.toContain('function LiveMibPivot');
  });

  it('keeps transactional cell state above collapsible virtualized rows', () => {
    const liveMibs = readFileSync(join(__dirname, 'screens', 'LiveMibsScreen.tsx'), 'utf-8');
    const tree = liveMibs.split('function LiveMibDocumentTree')[1]?.split('function LiveMibRow')[0];
    const row = liveMibs.split('function LiveMibRow')[1];
    expect(tree).toContain('const [cellStates, setCellStates]');
    expect(tree).toContain('requestSequences');
    expect(row).not.toContain('useState<LiveMibCellState>');
    expect(row).toContain("visible={cell.phase === 'awaiting-confirmation'}");
  });
});
