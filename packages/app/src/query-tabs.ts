import type { QueryResultTab } from './store';

export function queryResultTabAccessibilityLabel(tab: QueryResultTab): string {
  return `Result tab ${tab.title}, ${tab.stats.count} varbinds, ${tab.stats.batches} batches, ${tab.stats.ms} milliseconds`;
}

export function queryResultTabPresentation(tab: QueryResultTab, activeId: string | null) {
  return {
    selected: tab.id === activeId,
    pinned: tab.pinned,
    pinIcon: '📌',
    pinLabel: `${tab.pinned ? 'Unpin' : 'Pin'} result tab ${tab.title}`,
    closeLabel: `Close result tab ${tab.title}`,
    closeDisabled: tab.pinned,
  };
}
