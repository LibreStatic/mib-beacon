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

  it('keeps agent prerequisites actionable when no saved profiles exist', () => {
    const liveMibs = readFileSync(join(__dirname, 'screens', 'LiveMibsScreen.tsx'), 'utf-8');
    const agentStrip = liveMibs
      .split('style={styles.agentStrip}')[1]
      ?.split('</ScrollView>')[0];
    expect(liveMibs).toContain("adHocHost ? (");
    expect(liveMibs).toContain('No target configured. Create a saved agent here to start scanning.');
    expect(liveMibs).toContain('title="New profile"');
    expect(liveMibs).toContain('<AgentProfileDialog');
    expect(liveMibs).toContain('style={[styles.agentBar');
    expect(agentStrip).not.toContain('title="New profile"');
  });

  it('auto-selects newly created profiles without exposing saved credentials', () => {
    const liveMibs = readFileSync(join(__dirname, 'screens', 'LiveMibsScreen.tsx'), 'utf-8');
    expect(liveMibs).toContain('engine.agents.create(agentDraftFromEditor(profileEditor))');
    expect(liveMibs).toContain('selectAgentProfile(created)');
    expect(liveMibs).toContain('info={info}');
  });

  it('detaches the previous scan before switching live targets', () => {
    const liveMibs = readFileSync(join(__dirname, 'screens', 'LiveMibsScreen.tsx'), 'utf-8');
    const targetReset = liveMibs
      .split('const previousHandle = handleRef.current;')[1]
      ?.split('}, [engine, scope?.oid, selectedAgentId]);')[0];
    expect(targetReset).toContain('handleRef.current = null');
    expect(targetReset).toContain('scanRequestSequence.current += 1');
    expect(targetReset).toContain('engine.liveMibs.scan.cancel(previousHandle)');
    expect(targetReset).toContain('setRows(new Map())');
    expect(targetReset).toContain('setScan(null)');
    expect(liveMibs).toContain('}, [engine, scope?.oid, selectedAgentId]);');
  });

  it('waits for the selected profile settings before restarting a scan', () => {
    const liveMibs = readFileSync(join(__dirname, 'screens', 'LiveMibsScreen.tsx'), 'utf-8');
    expect(liveMibs).toContain('settingsAgentId !== selectedAgentId');
    expect(liveMibs).toContain('setSettingsAgentId(selectedAgentId)');
    expect(liveMibs).toContain("setError('Loading settings for the selected agent.');");
    expect(liveMibs).toContain('disabled={scanStarting || settingsAgentId !== selectedAgentId}');
  });

  it('routes asynchronous scan starts through the latest-request guard', () => {
    const liveMibs = readFileSync(join(__dirname, 'screens', 'LiveMibsScreen.tsx'), 'utf-8');
    expect(liveMibs).toContain('runLatestLiveMibScanRequest');
    expect(liveMibs).toContain('currentHandle: () => handleRef.current');
    expect(liveMibs).toContain('startingRequestRef.current');
  });

  it('consumes palette create requests so navigation does not reopen a dismissed dialog', () => {
    const liveMibs = readFileSync(join(__dirname, 'screens', 'LiveMibsScreen.tsx'), 'utf-8');
    expect(liveMibs).toContain('onCreateProfileRequestHandled();');
  });
});
