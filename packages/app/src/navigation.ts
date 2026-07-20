import type { ResponsiveMode } from './responsive-layout';
import type { Tab } from './store';

export interface NavigationTab {
  key: Tab;
  glyph: string;
  label: string;
  description?: string;
}

export interface CompactNavigationItem {
  key: Tab | 'more';
  glyph: string;
  label: string;
}

export const BROWSE_TITLE = 'Browse';

const COMPACT_PRIMARY_TABS: NavigationTab[] = [
  { key: 'browse', glyph: '⌬', label: BROWSE_TITLE },
  { key: 'query', glyph: '⇄', label: 'Results' },
  { key: 'traps', glyph: '⚑', label: 'Traps' },
  { key: 'tools', glyph: '⌁', label: 'Tools' },
];

const COMPACT_OVERFLOW_TABS: NavigationTab[] = [
  {
    key: 'liveMibs',
    glyph: '▦',
    label: 'Live MIBs',
    description: 'Scan and edit live values from a saved target.',
  },
  {
    key: 'agents',
    glyph: '◎',
    label: 'Agent profiles',
    description: 'Create, test, edit, and delete saved SNMP targets.',
  },
  {
    key: 'settings',
    glyph: '⚙',
    label: 'Settings',
    description: 'Manage appearance, resolver, capture, and app preferences.',
  },
];

const COMPACT_TABS: NavigationTab[] = [
  COMPACT_PRIMARY_TABS[0]!,
  COMPACT_OVERFLOW_TABS[0]!,
  COMPACT_PRIMARY_TABS[1]!,
  COMPACT_OVERFLOW_TABS[1]!,
  COMPACT_PRIMARY_TABS[2]!,
  COMPACT_PRIMARY_TABS[3]!,
  COMPACT_OVERFLOW_TABS[2]!,
];

const COMPACT_BOTTOM_NAVIGATION: CompactNavigationItem[] = [
  ...COMPACT_PRIMARY_TABS,
  { key: 'more', glyph: '⋯', label: 'More' },
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

export function getCompactBottomNavigationItems(): CompactNavigationItem[] {
  return COMPACT_BOTTOM_NAVIGATION;
}

export function getCompactOverflowTabs(): NavigationTab[] {
  return COMPACT_OVERFLOW_TABS;
}

export function isCompactOverflowTab(tab: Tab): boolean {
  return COMPACT_OVERFLOW_TABS.some((item) => item.key === tab);
}
