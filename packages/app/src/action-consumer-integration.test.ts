import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appRoot = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');
const queryScreen = readFileSync(new URL('./screens/QueryScreen.tsx', import.meta.url), 'utf8');

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
    expect(queryScreen).toContain('dispatchQueryAction(queryShortcutActionId(shortcut))');
    expect(queryScreen).not.toMatch(/if \(shortcut === 'get'\).*runGet/s);
  });
});
