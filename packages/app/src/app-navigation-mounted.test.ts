import { act, createElement } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot, type TestInstance } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T>(styles: T) => styles },
  View: 'View',
}));

const theme = {
  accent: '#00f',
  border: '#777',
  ok: '#0a0',
  surfaceAlt: '#222',
  text: '#fff',
  textDim: '#bbb',
  workbench: {
    sideBarBackground: '#111',
    activityBarBackground: '#000',
    panelBorder: '#444',
    sideBarForeground: '#fff',
    activityBarForeground: '#fff',
  },
  components: {
    selected: { background: '#333', border: '#55f', icon: '#fff', foreground: '#fff' },
    hover: { background: '#222', border: '#777', icon: '#fff', foreground: '#fff' },
    badge: { background: '#c00', foreground: '#fff' },
  },
};

vi.mock('@mibbeacon/ui', () => ({ Text: 'Text', useTheme: () => theme }));
vi.mock('./components/MibBeaconMark', () => ({ MibBeaconMark: 'MibBeaconMark' }));
vi.mock('./components/PacketConsole', () => ({ PacketActivityLights: 'PacketActivityLights' }));

import {
  AppNavigation,
  NAVIGATION_ACTION_MIN_HEIGHT,
  NAVIGATION_ITEM_MIN_HEIGHT,
} from './components/AppNavigation';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tabs = [
  { key: 'browse' as const, glyph: 'B', label: 'Browse' },
  { key: 'liveMibs' as const, glyph: 'L', label: 'Live MIBs' },
  { key: 'query' as const, glyph: 'Q', label: 'Query' },
  { key: 'agents' as const, glyph: 'A', label: 'Agents' },
  { key: 'traps' as const, glyph: 'T', label: 'Traps' },
  { key: 'tools' as const, glyph: 'O', label: 'Tools' },
  { key: 'settings' as const, glyph: 'S', label: 'Settings' },
];

function flattenStyle(style: unknown): Record<string, unknown> {
  const values = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...values.filter((value) => value && typeof value === 'object'));
}

function renderNavigation(height: number, expanded: boolean) {
  const selected: string[] = [];
  const footer: string[] = [];
  const renderer = createRoot();
  act(() => {
    renderer.render(
      createElement(
        'View',
        { style: { height } },
        createElement(AppNavigation, {
          tabs,
          expanded,
          tab: 'browse',
          trapCount: 3,
          info: null,
          onSelect: (tab) => selected.push(tab),
          onCommands: () => footer.push('commands'),
          onShortcuts: () => footer.push('shortcuts'),
          onNewWindow: () => footer.push('new-window'),
        }),
      ),
    );
  });
  return { renderer, selected, footer };
}

describe('desktop navigation at short viewport heights', () => {
  it('uses one deliberate scroll region for navigation and footer actions', () => {
    const source = readFileSync(new URL('./components/AppNavigation.tsx', import.meta.url), 'utf8');

    expect(source).toContain('nativeID="app-navigation-scroll-region"');
    expect(source).toContain('contentContainerStyle={styles.navigationScrollContent}');
    expect(source).toContain('showsVerticalScrollIndicator');
  });

  it.each([480, 600])(
    'keeps Settings and every footer action in the same reachable scroll flow at %ipx',
    (height) => {
      const { renderer, selected, footer } = renderNavigation(height, true);
      const root = renderer.container;
      const scroll = root.queryAll(
        (node) =>
          node.type === 'ScrollView' && node.props.nativeID === 'app-navigation-scroll-region',
      )[0]!;
      const controls = scroll.queryAll((node) => node.type === 'Pressable');
      const labels = controls.map((node) => node.props.accessibilityLabel as string);

      expect(labels).toEqual([
        ...tabs.map(({ label }) => label),
        'Command palette',
        'Keyboard shortcuts',
        'New window',
      ]);
      expect(scroll.props.showsVerticalScrollIndicator).toBe(true);
      expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');

      const settings = controls.find((node) => node.props.accessibilityLabel === 'Settings')!;
      const commands = controls.find(
        (node) => node.props.accessibilityLabel === 'Command palette',
      )!;
      act(() => settings.props.onPress());
      act(() => commands.props.onPress());
      expect(selected).toEqual(['settings']);
      expect(footer).toEqual(['commands']);

      for (const control of controls) {
        const raw =
          typeof control.props.style === 'function'
            ? control.props.style({ pressed: false })
            : control.props.style;
        const style = flattenStyle(raw);
        expect(Number(style.minHeight)).toBeGreaterThanOrEqual(
          tabs.some(({ label }) => label === control.props.accessibilityLabel)
            ? NAVIGATION_ITEM_MIN_HEIGHT
            : NAVIGATION_ACTION_MIN_HEIGHT,
        );
      }
      act(() => renderer.unmount());
    },
  );

  it('preserves DOM focus order and rail tooltip layering', () => {
    const { renderer } = renderNavigation(480, false);
    const controls = renderer.container.queryAll((node) => node.type === 'Pressable');
    expect(controls.map((node) => node.props.accessibilityLabel)).toEqual([
      ...tabs.map(({ label }) => label),
      'Command palette',
      'Keyboard shortcuts',
      'New window',
    ]);

    const settings = controls.find((node) => node.props.accessibilityLabel === 'Settings')!;
    const scroll = renderer.container.queryAll(
      (node) =>
        node.type === 'ScrollView' && node.props.nativeID === 'app-navigation-scroll-region',
    )[0]!;
    act(() => {
      scroll.props.onLayout({ nativeEvent: { layout: { y: 66, height: 400 } } });
      settings.props.onLayout({ nativeEvent: { layout: { y: 306, height: 46 } } });
      scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 100 } } });
    });
    act(() => settings.props.onHoverIn());
    const tooltips = renderer.container.queryAll((node: TestInstance) => {
      const style = flattenStyle(node.props.style);
      return node.type === 'View' && style.position === 'absolute' && style.zIndex === 20;
    });
    expect(tooltips).toHaveLength(1);
    const tooltip = tooltips[0]!;
    let ancestor: TestInstance | null = tooltip.parent;
    let scrollAncestor: TestInstance | null = null;
    while (ancestor) {
      if (
        ancestor.type === 'ScrollView' &&
        ancestor.props.nativeID === 'app-navigation-scroll-region'
      ) {
        scrollAncestor = ancestor;
        break;
      }
      ancestor = ancestor.parent;
    }
    expect(scrollAncestor).toBeNull();
    const tooltipStyle = flattenStyle(tooltip.props.style);
    expect(Number(tooltipStyle.left)).toBeGreaterThanOrEqual(64);
    expect(Number(tooltipStyle.minWidth)).toBeGreaterThan(0);
    expect(tooltipStyle.top).toBe(277);
    expect(tooltip.props.nativeID).toBe('app-navigation-rail-tooltip');
    expect(tooltip.props.pointerEvents).toBe('none');
    act(() => renderer.unmount());
  });
});
