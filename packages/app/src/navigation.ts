import type { ResponsiveMode } from './responsive-layout';
import type { Tab } from './store';

export interface NavigationTab {
  key: Tab;
  glyph: string;
  label: string;
}

export const BROWSE_TITLE = 'Browse';

const COMPACT_TABS: NavigationTab[] = [
  { key: 'browse', glyph: '⌬', label: BROWSE_TITLE },
  { key: 'query', glyph: '⇄', label: 'Results' },
  { key: 'traps', glyph: '⚑', label: 'Traps' },
  { key: 'tools', glyph: '⌁', label: 'Tools' },
  { key: 'settings', glyph: '⚙', label: 'Settings' },
];

const WORKBENCH_TABS: NavigationTab[] = [
  { key: 'browse', glyph: '⌬', label: BROWSE_TITLE },
  { key: 'liveMibs', glyph: '▦', label: 'Live MIBs' },
  { key: 'query', glyph: '⇄', label: 'Query' },
  { key: 'agents', glyph: '◎', label: 'Agents' },
  { key: 'traps', glyph: '⚑', label: 'Traps' },
  { key: 'tools', glyph: '⌁', label: 'Tools' },
  { key: 'settings', glyph: '⚙', label: 'Settings' },
];

export function getNavigationTabs(mode: ResponsiveMode): NavigationTab[] {
  return mode === 'compact' ? COMPACT_TABS : WORKBENCH_TABS;
}
