import { describe, expect, it } from 'vitest';
import { routeForTab, tabFromUrl } from './routes';

describe('main-screen routes', () => {
  it('creates stable web routes and restores their tabs', () => {
    expect(routeForTab('query')).toBe('#/results');
    expect(tabFromUrl('https://localhost/#/tools')).toBe('tools');
    expect(tabFromUrl('https://localhost/#/results?snapshot=1')).toBe('query');
  });

  it('accepts native mibbeacon links and rejects unknown routes', () => {
    expect(tabFromUrl('mibbeacon://open/traps')).toBe('traps');
    expect(tabFromUrl('mibbeacon://settings')).toBe('settings');
    expect(tabFromUrl('https://localhost/#/unknown')).toBeNull();
  });
});
