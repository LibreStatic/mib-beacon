import type { QueryResultTab } from './store';

export function queryResultTabAccessibilityLabel(tab: QueryResultTab): string {
  return `Result tab ${tab.title}, ${tab.stats.count} varbinds, ${tab.stats.batches} batches, ${tab.stats.ms} milliseconds`;
}
