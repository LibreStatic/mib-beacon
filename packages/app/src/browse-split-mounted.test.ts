import { act, createElement, useEffect, useState } from 'react';
import { View } from 'react-native';
import { createRoot, type TestInstance } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  BackHandler: { addEventListener: vi.fn() },
  Platform: { OS: 'web' },
  Pressable: 'Pressable',
  StyleSheet: { create: <T>(styles: T) => styles, absoluteFillObject: {} },
  View: 'View',
}));

vi.mock('@mibbeacon/ui', () => ({
  Button: 'Button',
  useTheme: () => ({ accentSoft: '#123456', bg: '#ffffff', border: '#abcdef' }),
}));

import { BrowseSplitWorkspace } from './components/BrowseSplitWorkspace';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('mounted Browse mode transitions', () => {
  it('keeps catalog, navigator, and inspector state across the 1023/1024 mode boundary', () => {
    const mounts = { catalog: 0, navigator: 0, inspector: 0 };
    const Probe = ({ id }: { id: keyof typeof mounts }) => {
      const [surrogate, setSurrogate] = useState(`${id}-scroll-0`);
      useEffect(() => {
        mounts[id] += 1;
      }, [id]);
      return createElement(View, {
        testID: id,
        accessibilityLabel: surrogate,
        onTouchEnd: (next: string) => setSurrogate(next),
      });
    };
    const workspace = (viewportWidth: number) =>
      createElement(BrowseSplitWorkspace, {
        expanded: viewportWidth >= 1024,
        selected: true,
        moduleStrip: createElement(View, { testID: 'module-strip' }),
        catalog: createElement(Probe, { id: 'catalog' }),
        navigator: createElement(Probe, { id: 'navigator' }),
        inspector: createElement(Probe, { id: 'inspector' }),
        treeDrawer: {
          open: false,
          onOpen: vi.fn(),
          onClose: vi.fn(),
          accessibilityLabel: 'MIB tree drawer',
          openLabel: 'Open MIB tree drawer',
          closeLabel: 'Close MIB tree drawer',
        },
        catalogDrawer: {
          open: false,
          onOpen: vi.fn(),
          onClose: vi.fn(),
          accessibilityLabel: 'MIB catalog drawer',
          openLabel: 'Open MIB catalog drawer',
          closeLabel: 'Close MIB catalog drawer',
        },
      });

    const renderer = createRoot();
    act(() => renderer.render(workspace(1023)));
    const root = renderer.container;
    const pane = (id: string) =>
      root.queryAll((node: TestInstance) => node.props.testID === id)[0]!;

    act(() => pane('catalog').props.onTouchEnd('catalog-scroll-12'));
    act(() => pane('navigator').props.onTouchEnd('navigator-scroll-27'));
    act(() => pane('inspector').props.onTouchEnd('inspector-scroll-4'));

    act(() => renderer.render(workspace(1024)));

    expect(pane('catalog').props.accessibilityLabel).toBe('catalog-scroll-12');
    expect(pane('navigator').props.accessibilityLabel).toBe('navigator-scroll-27');
    expect(pane('inspector').props.accessibilityLabel).toBe('inspector-scroll-4');
    expect(mounts).toEqual({ catalog: 1, navigator: 1, inspector: 1 });

    act(() => renderer.render(workspace(1023)));
    expect(mounts).toEqual({ catalog: 1, navigator: 1, inspector: 1 });
  });
});
