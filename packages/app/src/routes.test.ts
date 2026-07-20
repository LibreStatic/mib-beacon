import { describe, expect, it } from 'vitest';
import { replaceRouteForTab, routeForTab, tabFromUrl } from './routes';

describe('main-screen routes', () => {
  it('creates stable web routes and restores their tabs', () => {
    expect(routeForTab('query')).toBe('#/results');
    expect(routeForTab('liveMibs')).toBe('#/live-mibs');
    expect(tabFromUrl('https://localhost/#/live-mibs')).toBe('liveMibs');
    expect(tabFromUrl('https://localhost/#/tools')).toBe('tools');
    expect(tabFromUrl('https://localhost/#/results?snapshot=1')).toBe('query');
  });

  it('accepts native mibbeacon links and rejects unknown routes', () => {
    expect(tabFromUrl('mibbeacon://open/traps')).toBe('traps');
    expect(tabFromUrl('mibbeacon://settings')).toBe('settings');
    expect(tabFromUrl('https://localhost/#/unknown')).toBeNull();
  });

  it('does not assume React Native window has browser history', () => {
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {},
    });
    expect(() => replaceRouteForTab('liveMibs')).not.toThrow();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  });
});
