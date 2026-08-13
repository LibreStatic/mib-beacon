import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appRoot = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');
const queryScreen = readFileSync(new URL('./screens/QueryScreen.tsx', import.meta.url), 'utf8');
const browseScreen = readFileSync(new URL('./screens/BrowseScreen.tsx', import.meta.url), 'utf8');
const toolsScreen = readFileSync(new URL('./screens/ToolsScreen.tsx', import.meta.url), 'utf8');
const trapsScreen = readFileSync(new URL('./screens/TrapsScreen.tsx', import.meta.url), 'utf8');
const packetConsole = readFileSync(
  new URL('./components/PacketConsole.tsx', import.meta.url),
  'utf8',
);
const agentsScreen = readFileSync(new URL('./screens/AgentsScreen.tsx', import.meta.url), 'utf8');
const liveMibsScreen = readFileSync(
  new URL('./screens/LiveMibsScreen.tsx', import.meta.url),
  'utf8',
);
const settingsScreen = readFileSync(
  new URL('./screens/SettingsScreen.tsx', import.meta.url),
  'utf8',
);

describe('registered Query action lifecycle', () => {
  it('mounts Query action registration persistently above conditional screens', () => {
    expect(appRoot).toContain('<RegisteredQueryActions');
    expect(appRoot.indexOf('<RegisteredQueryActions')).toBeLessThan(
      appRoot.indexOf("activeTab === 'query'"),
    );
    expect(queryScreen).not.toContain('useRegisteredActions');
  });

  it('mounts the destructive resolver-cache action persistently for the Command Palette', () => {
    expect(appRoot).toContain('<RegisteredResolverCacheActions />');
    expect(appRoot.indexOf('<RegisteredResolverCacheActions')).toBeLessThan(
      appRoot.indexOf("activeTab === 'settings'"),
    );
    expect(appRoot).toContain('authorizeActionConfirmation');
  });

  it('routes operation chips, run/stop buttons, and shortcuts through registry action IDs', () => {
    expect(queryScreen).toContain(
      'dispatchQueryAction(`query:prepare-${QUERY_OPERATION_SLUGS[item.key]}`)',
    );
    expect(queryScreen).toContain("dispatchQueryAction('query:run-current')");
    expect(queryScreen).toContain("dispatchQueryAction('query:stop')");
    expect(queryScreen).toContain('dispatchQueryAction(`query:show-${item.pane}`)');
    expect(queryScreen).toContain('dispatchQueryAction(queryShortcutActionId(shortcut))');
    expect(queryScreen).not.toMatch(/if \(shortcut === 'get'\).*runGet/s);
  });

  it('registers each audited product action owner and routes shared pointer handlers through IDs', () => {
    expect(browseScreen).toContain("useRegisteredCatalogActions('browse'");
    expect(browseScreen).toContain("dispatchAction('browse:clear-module-focus')");
    expect(toolsScreen).toContain("useRegisteredCatalogActions('tools'");
    expect(trapsScreen).toContain("useRegisteredCatalogActions('traps'");
    expect(trapsScreen).toContain("executeAction('traps:apply-filter')");
    expect(packetConsole).toContain("useRegisteredCatalogActions('packets'");
    expect(packetConsole).toContain("dispatchAction('packets:clear')");
    expect(agentsScreen).toContain("useRegisteredCatalogActions('agents'");
    expect(agentsScreen).toContain("dispatchAction('agents:reconcile')");
    expect(liveMibsScreen).toContain("useRegisteredCatalogActions('liveMibs'");
    expect(liveMibsScreen).toContain("'live-mibs:refresh',");
    expect(settingsScreen).toContain("useRegisteredCatalogActions('settings'");
    expect(settingsScreen).toContain('dispatchRegistered(');
  });
});
