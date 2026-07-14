import type { Tab } from './store';

const ROUTES: Record<Tab, string> = {
  browse: 'browse',
  query: 'results',
  agents: 'agents',
  traps: 'traps',
  tools: 'tools',
  mibs: 'mibs',
  settings: 'settings',
};

export function routeForTab(tab: Tab): string {
  return `#/${ROUTES[tab]}`;
}

export function tabFromUrl(url: string): Tab | null {
  const route =
    url.match(/#\/?([^/?#]+)/)?.[1] ??
    url.match(/^mibbeacon:\/\/(?:[^/]+\/)?([^/?#]+)/)?.[1] ??
    url.match(/\/(browse|results|query|agents|traps|tools|mibs|settings)(?:[/?#]|$)/)?.[1];
  if (!route) return null;
  if (route === 'results' || route === 'query') return 'query';
  const entry = Object.entries(ROUTES).find(([, value]) => value === route);
  return (entry?.[0] as Tab | undefined) ?? null;
}
