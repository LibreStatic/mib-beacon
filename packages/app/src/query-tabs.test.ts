import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './store';
import { queryResultTabAccessibilityLabel, queryResultTabPresentation } from './query-tabs';

describe('query result tabs', () => {
  beforeEach(() => {
    useAppStore.setState({ queryTabs: [], activeQueryTabId: null, results: [] });
    vi.restoreAllMocks();
  });

  it('captures, selects, pins, and closes independent result snapshots', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(100).mockReturnValue(200);
    const store = useAppStore.getState();
    store.setResults([
      { oid: '1.3.6.1', type: 2, typeName: 'Integer', value: 1, isError: false },
    ]);
    store.setStats({ count: 1, batches: 1, ms: 10 });
    store.saveQueryResultTab('Agent A · get · system');
    const first = useAppStore.getState().activeQueryTabId!;

    useAppStore.getState().setResults([
      { oid: '1.3.6.2', type: 2, typeName: 'Integer', value: 2, isError: false },
    ]);
    useAppStore.getState().saveQueryResultTab('Agent A · walk · interfaces');
    useAppStore.getState().selectQueryResultTab(first);
    expect(useAppStore.getState().results[0]?.value).toBe(1);

    useAppStore.getState().toggleQueryResultTabPin(first);
    useAppStore.getState().closeQueryResultTab(first);
    expect(useAppStore.getState().queryTabs.find((tab) => tab.id === first)?.pinned).toBe(true);
  });

  it('announces result volume and streaming stats from the tab itself', () => {
    expect(
      queryResultTabAccessibilityLabel({
        id: 'walk',
        title: 'Lab · walk · 1.3.6.1.2.1',
        results: Array.from({ length: 1_761 }, (_, index) => ({
          oid: `1.3.6.1.2.1.${index}`,
          type: 2,
          typeName: 'Integer',
          value: index,
          isError: false,
        })),
        stats: { count: 1_761, batches: 89, ms: 10_076 },
        pinned: false,
        createdAt: 1,
      }),
    ).toBe('Result tab Lab · walk · 1.3.6.1.2.1, 1761 varbinds, 89 batches, 10076 milliseconds');
  });

  it('exposes pin and close as explicit controls on every result tab', () => {
    const tab = {
      id: 'walk',
      title: 'Lab · walk · 1.3.6.1.2.1',
      results: [],
      stats: { count: 0, batches: 0, ms: 0 },
      pinned: false,
      createdAt: 1,
    };

    expect(queryResultTabPresentation(tab, 'walk')).toMatchObject({
      selected: true,
      pinned: false,
      pinIcon: '📌',
      pinLabel: 'Pin result tab Lab · walk · 1.3.6.1.2.1',
      closeLabel: 'Close result tab Lab · walk · 1.3.6.1.2.1',
      closeDisabled: false,
    });

    expect(queryResultTabPresentation({ ...tab, pinned: true }, 'other')).toMatchObject({
      selected: false,
      pinned: true,
      pinIcon: '📌',
      closeDisabled: true,
    });
  });
});
