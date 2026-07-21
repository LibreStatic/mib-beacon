import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('container-aware split activation', () => {
  it('measures the split container and renders a supplied fallback before minima fit', () => {
    const source = read('./components/SplitWorkspace.tsx');

    expect(source).toContain('export function ContainerAwareSplitWorkspace');
    expect(source).toContain('canFitSplit(containerSize');
    expect(source).toContain('fallback');
    expect(source).toContain('onLayout={onLayout}');
    expect(source).toContain('splitAccessibilityDelta(event.nativeEvent.actionName)');
  });

  it.each([
    ['./components/BrowseSplitWorkspace.tsx', 'workspace="browse"'],
    ['./components/BrowseSplitWorkspace.tsx', 'workspace="mibModules"'],
  ])('%s keeps %s panes mounted with an inactive drawer mode', (path, workspace) => {
    const source = read(path);
    const start = source.indexOf(workspace);
    const opening = source.lastIndexOf('<ContainerAwareSplitWorkspace', start);

    expect(opening).toBeGreaterThanOrEqual(0);
    expect(source.slice(opening, start + 1_200)).toContain('inactivePane=');
    expect(source.slice(opening, start + 1_200)).toContain('primaryDrawer=');
  });

  it('keeps Query configuration and result panes mounted while stacking below the threshold', () => {
    const source = read('./screens/QueryScreen.tsx');

    expect(source).toContain("workspace={embedded ? 'operationConsole' : 'query'}");
    expect(source).toContain('stackOnFallback');
    expect(source.match(/<TableViewResult/g)).toHaveLength(1);
  });

  it('keeps both Browse levels reachable through deliberate drawers when splits do not fit', () => {
    const source = read('./components/BrowseSplitWorkspace.tsx');

    expect(source).toContain('title={treeDrawer.openLabel}');
    expect(source).toContain('title={catalogDrawer.openLabel}');
    expect(source).toContain('primary={catalog}');
    expect(source).toContain('primary={navigatorPane}');
  });

  it('mounts the stateful trap capture tools only once across responsive layouts', () => {
    const source = read('./screens/TrapsScreen.tsx');

    expect(source.match(/<TrapCaptureTools/g)).toHaveLength(1);
    expect(source).toContain('preservePrimary');
    expect(source).toContain('stackOnFallback={Boolean(selected)}');
  });

  it('keeps stable drawer content separate from its accessible backdrop and close action', () => {
    const source = read('./components/SplitWorkspace.tsx');

    expect(source).toContain('accessibilityViewIsModal={drawerOpen || undefined}');
    expect(source).toContain('onAccessibilityEscape={drawerOpen ? primaryDrawer?.onClose');
    expect(source).toContain('key="drawer-backdrop"');
    expect(source).toContain('key="primary-pane"');
    expect(source).toContain('<View style={styles.paneContent}>{primary}</View>');
    expect(source).toContain('title={primaryDrawer.closeLabel}');
    expect(source).toContain("secondaryNode?.setAttribute('inert', '')");
    expect(source).toContain("if (event.key !== 'Tab') return");
    expect(source).toContain('restoreDrawerFocus({');
    expect(source).toContain('divider: dividerRef.current');
    expect(source).toContain("BackHandler.addEventListener('hardwareBackPress'");
  });
});
