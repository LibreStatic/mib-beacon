import { act, createElement, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

const nativeBack = vi.hoisted(() => ({
  handler: null as null | (() => boolean),
  remove: vi.fn(),
}));

vi.mock('react-native', () => ({
  BackHandler: {
    addEventListener: vi.fn((_event: string, handler: () => boolean) => {
      nativeBack.handler = handler;
      return { remove: nativeBack.remove };
    }),
  },
  Platform: { OS: 'web' },
  Pressable: 'Pressable',
  StyleSheet: { create: <T>(styles: T) => styles },
  View: 'View',
}));

vi.mock('@mibbeacon/ui', () => ({
  Button: 'Button',
  useTheme: () => ({ accentSoft: '#123456', border: '#abcdef' }),
}));

import {
  ContainerAwareSplitWorkspace,
  firstEnabledFocusable,
  restoreDrawerFocus,
  transferFocusForInactivePaneChange,
} from './components/SplitWorkspace';
import { TRAP_SPLIT_MINIMUMS } from './responsive-layout';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('mounted container-aware split transitions', () => {
  it('skips a disabled first focus candidate when moving focus into a pane', () => {
    const disabled = {
      disabled: true,
      hidden: false,
      tabIndex: 0,
      focus: vi.fn(),
      getAttribute: () => null,
      closest: () => null,
    };
    const enabled = {
      disabled: false,
      hidden: false,
      tabIndex: 0,
      focus: vi.fn(),
      getAttribute: () => null,
      closest: () => null,
    };
    const pane = {
      querySelectorAll: () => [disabled, enabled],
    };

    firstEnabledFocusable(pane)?.focus();

    expect(disabled.focus).not.toHaveBeenCalled();
    expect(enabled.focus).toHaveBeenCalledOnce();
  });

  it('skips candidates hidden by a CSS-hidden ancestor', () => {
    const hiddenAncestor = { parentElement: null };
    const hidden = {
      disabled: false,
      hidden: false,
      tabIndex: 0,
      parentElement: hiddenAncestor,
      focus: vi.fn(),
      getAttribute: () => null,
      closest: () => null,
    };
    const enabled = {
      disabled: false,
      hidden: false,
      tabIndex: 0,
      parentElement: null,
      focus: vi.fn(),
      getAttribute: () => null,
      closest: () => null,
    };
    const pane = { querySelectorAll: () => [hidden, enabled] };
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        getComputedStyle: (target: unknown) => ({
          display: target === hiddenAncestor ? 'none' : 'block',
          visibility: 'visible',
        }),
      },
    });

    try {
      firstEnabledFocusable(pane)?.focus();

      expect(hidden.focus).not.toHaveBeenCalled();
      expect(enabled.focus).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it('skips connected candidates with no rendered client rectangles outside jsdom', () => {
    const notRendered = {
      disabled: false,
      hidden: false,
      isConnected: true,
      tabIndex: 0,
      parentElement: null,
      focus: vi.fn(),
      getAttribute: () => null,
      getClientRects: () => [],
      closest: () => null,
    };
    const rendered = {
      disabled: false,
      hidden: false,
      isConnected: true,
      tabIndex: 0,
      parentElement: null,
      focus: vi.fn(),
      getAttribute: () => null,
      getClientRects: () => [{}],
      closest: () => null,
    };
    const pane = { querySelectorAll: () => [notRendered, rendered] };
    const originalWindow = globalThis.window;
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: 'focus-eligibility-browser-test' },
    });

    try {
      firstEnabledFocusable(pane)?.focus();

      expect(notRendered.focus).not.toHaveBeenCalled();
      expect(rendered.focus).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      });
    }
  });

  it('transfers focus only when an unsplit pane switch would hide the active descendant', () => {
    const activeInPrimary = {};
    const activeInSecondary = {};
    const elsewhere = {};
    const primaryTarget = { focus: vi.fn() };
    const secondaryTarget = { focus: vi.fn() };
    const primary = {
      contains: (target: unknown) => target === activeInPrimary,
      firstFocusable: () => primaryTarget,
    };
    const secondary = {
      contains: (target: unknown) => target === activeInSecondary,
      firstFocusable: () => secondaryTarget,
    };

    transferFocusForInactivePaneChange({
      splitActive: false,
      previousSplitActive: false,
      previousMode: 'primary',
      nextMode: 'secondary',
      activeElement: activeInPrimary,
      primary,
      secondary,
    });
    expect(secondaryTarget.focus).toHaveBeenCalledOnce();

    transferFocusForInactivePaneChange({
      splitActive: false,
      previousSplitActive: false,
      previousMode: 'secondary',
      nextMode: 'primary',
      activeElement: activeInSecondary,
      primary,
      secondary,
    });
    expect(primaryTarget.focus).toHaveBeenCalledOnce();

    transferFocusForInactivePaneChange({
      splitActive: false,
      previousSplitActive: true,
      previousMode: 'secondary',
      nextMode: 'secondary',
      activeElement: activeInPrimary,
      primary,
      secondary,
    });
    expect(secondaryTarget.focus).toHaveBeenCalledTimes(2);

    transferFocusForInactivePaneChange({
      splitActive: false,
      previousSplitActive: true,
      previousMode: 'primary',
      nextMode: 'primary',
      activeElement: activeInSecondary,
      primary,
      secondary,
    });
    expect(primaryTarget.focus).toHaveBeenCalledTimes(2);

    for (const input of [
      {
        splitActive: false,
        previousSplitActive: null,
        previousMode: null,
        nextMode: 'primary' as const,
      },
      {
        splitActive: true,
        previousSplitActive: false,
        previousMode: 'primary' as const,
        nextMode: 'secondary' as const,
      },
      {
        splitActive: false,
        previousSplitActive: false,
        previousMode: 'primary' as const,
        nextMode: 'secondary' as const,
      },
    ]) {
      transferFocusForInactivePaneChange({
        ...input,
        activeElement: elsewhere,
        primary,
        secondary,
      });
    }
    expect(primaryTarget.focus).toHaveBeenCalledTimes(2);
    expect(secondaryTarget.focus).toHaveBeenCalledTimes(2);
  });

  it('closes an inline native drawer on Android hardware Back and removes the subscription', () => {
    const originalPlatform = Platform.OS;
    (Platform as { OS: string }).OS = 'android';
    nativeBack.handler = null;
    nativeBack.remove.mockClear();

    function NativeDrawerHarness() {
      const [open, setOpen] = useState(true);
      return createElement(ContainerAwareSplitWorkspace, {
        workspace: 'browse',
        minPrimary: 300,
        minSecondary: 380,
        inactivePane: 'secondary',
        primaryDrawer: {
          open,
          onClose: () => setOpen(false),
          accessibilityLabel: 'MIB tree drawer',
          closeLabel: 'Close MIB tree drawer',
        },
        primary: createElement(View, { testID: 'native-drawer' }),
        secondary: createElement(View, { testID: 'native-background' }),
      });
    }

    const renderer = createRoot();
    act(() => renderer.render(createElement(NativeDrawerHarness)));
    expect(nativeBack.handler).not.toBeNull();
    act(() => expect(nativeBack.handler?.()).toBe(true));
    expect(
      renderer.container.queryAll((node) => node.props.accessibilityLabel === 'MIB tree drawer'),
    ).toHaveLength(0);
    expect(nativeBack.remove).toHaveBeenCalledOnce();

    act(() => renderer.unmount());
    (Platform as { OS: string }).OS = originalPlatform;
  });

  it('restores focus to the visible divider when a drawer becomes a split pane', () => {
    const previous = { focus: vi.fn() };
    const divider = { focus: vi.fn() };
    const primary = { focus: vi.fn() };

    restoreDrawerFocus({ splitActive: true, previous, divider, primary });
    expect(divider.focus).toHaveBeenCalledOnce();
    expect(previous.focus).not.toHaveBeenCalled();

    restoreDrawerFocus({ splitActive: false, previous, divider, primary });
    expect(previous.focus).toHaveBeenCalledOnce();

    restoreDrawerFocus({
      splitActive: false,
      previous,
      previousIsVisible: false,
      divider,
      primary,
    });
    expect(primary.focus).toHaveBeenCalledOnce();
    expect(previous.focus).toHaveBeenCalledOnce();
  });

  it.each([
    ['disabled', { disabled: true, hidden: false, inert: false }],
    ['hidden', { disabled: false, hidden: true, inert: false }],
    ['inert', { disabled: false, hidden: false, inert: true }],
  ])('does not restore a captured %s target', (_state, flags) => {
    const previous = {
      ...flags,
      tabIndex: 0,
      focus: vi.fn(),
      getAttribute: (name: string) => (name === 'inert' && flags.inert ? '' : null),
      closest: () => null,
    };
    const fallback = { focus: vi.fn() };

    restoreDrawerFocus({
      splitActive: false,
      previous,
      divider: null,
      primary: fallback,
    });

    expect(previous.focus).not.toHaveBeenCalled();
    expect(fallback.focus).toHaveBeenCalledOnce();
  });

  it('keeps the primary draft owner mounted through initial measurement and threshold resizes', () => {
    let mountCount = 0;
    const DraftProbe = ({
      draft,
      setDraft,
    }: {
      draft: string;
      setDraft: (draft: string) => void;
    }) =>
      createElement(View, {
        testID: 'trap-draft-owner',
        accessibilityLabel: draft,
        onTouchEnd: (next: string) => setDraft(next),
      });

    function DraftOwner() {
      const [draft, setDraft] = useState('unsaved-v3-user');
      useEffect(() => {
        mountCount += 1;
      }, []);
      return createElement(DraftProbe, { draft, setDraft });
    }

    let renderer: Root;
    act(() => {
      renderer = createRoot();
      renderer.render(
        createElement(ContainerAwareSplitWorkspace, {
          workspace: 'traps',
          ...TRAP_SPLIT_MINIMUMS,
          preservePrimary: true,
          stackOnFallback: true,
          fallback: createElement(View, { testID: 'compact-fallback' }),
          primary: createElement(DraftOwner),
          secondary: createElement(View, { testID: 'trap-inspector' }),
        }),
      );
    });

    const root = renderer!.container;
    const one = (predicate: (node: TestInstance) => boolean) => {
      const matches = root.queryAll(predicate);
      expect(matches).toHaveLength(1);
      return matches[0]!;
    };
    const measure = root.queryAll((node) => typeof node.props.onLayout === 'function')[0]!;
    const draftOwner = () => one((node) => node.props.testID === 'trap-draft-owner');
    const splitDirection = () => {
      const splitRoot = one(
        (node) =>
          Array.isArray(node.props.style) &&
          node.props.style.some((style: { flexDirection?: string } | null) =>
            Boolean(style?.flexDirection),
          ),
      );
      return Object.assign({}, ...splitRoot.props.style.filter(Boolean)).flexDirection;
    };

    expect(mountCount).toBe(1);
    expect(one((node) => node.props.testID === 'trap-inspector')).toBeDefined();
    act(() => draftOwner().props.onTouchEnd('edited-before-measurement'));
    act(() => measure.props.onLayout({ nativeEvent: { layout: { width: 748 } } }));
    expect(draftOwner().props.accessibilityLabel).toBe('edited-before-measurement');
    expect(mountCount).toBe(1);
    expect(splitDirection()).toBe('column');

    act(() => measure.props.onLayout({ nativeEvent: { layout: { width: 749 } } }));
    expect(draftOwner().props.accessibilityLabel).toBe('edited-before-measurement');
    expect(mountCount).toBe(1);
    expect(splitDirection()).toBe('row');

    act(() => measure.props.onLayout({ nativeEvent: { layout: { width: 748 } } }));
    expect(draftOwner().props.accessibilityLabel).toBe('edited-before-measurement');
    expect(mountCount).toBe(1);
    expect(splitDirection()).toBe('column');
  });

  it('keeps a stateful Query result pane mounted when the divider appears and disappears', () => {
    let mountCount = 0;
    const ResultProbe = ({
      draft,
      setDraft,
    }: {
      draft: string;
      setDraft: (draft: string) => void;
    }) =>
      createElement(View, {
        testID: 'query-result-draft',
        accessibilityLabel: draft,
        onTouchEnd: (next: string) => setDraft(next),
      });
    function StatefulResults() {
      const [draft, setDraft] = useState('new-row-index');
      useEffect(() => {
        mountCount += 1;
      }, []);
      return createElement(ResultProbe, { draft, setDraft });
    }

    let renderer: Root;
    act(() => {
      renderer = createRoot();
      renderer.render(
        createElement(ContainerAwareSplitWorkspace, {
          workspace: 'query',
          minPrimary: 340,
          minSecondary: 420,
          stackOnFallback: true,
          primary: createElement(View, { testID: 'query-config' }),
          secondary: createElement(StatefulResults),
        }),
      );
    });
    const root = renderer!.container;
    const measure = root.queryAll((node) => typeof node.props.onLayout === 'function')[0]!;
    const result = () => {
      const matches = root.queryAll((node) => node.props.testID === 'query-result-draft');
      expect(matches).toHaveLength(1);
      return matches[0]!;
    };

    act(() => result().props.onTouchEnd('edited-row-index'));
    act(() => measure.props.onLayout({ nativeEvent: { layout: { width: 768 } } }));
    expect(result().props.accessibilityLabel).toBe('edited-row-index');
    expect(mountCount).toBe(1);

    act(() => measure.props.onLayout({ nativeEvent: { layout: { width: 769 } } }));
    expect(result().props.accessibilityLabel).toBe('edited-row-index');
    expect(mountCount).toBe(1);

    act(() => measure.props.onLayout({ nativeEvent: { layout: { width: 768 } } }));
    expect(result().props.accessibilityLabel).toBe('edited-row-index');
    expect(mountCount).toBe(1);
  });

  it('keeps Browse navigator and inspector identities while closing its drawer at 688/689', () => {
    const mounts = { navigator: 0, inspector: 0 };
    const PaneProbe = ({ id }: { id: 'navigator' | 'inspector' }) => {
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
    function BrowseHarness() {
      const [drawerOpen, setDrawerOpen] = useState(true);
      return createElement(ContainerAwareSplitWorkspace, {
        workspace: 'browse',
        minPrimary: 300,
        minSecondary: 380,
        inactivePane: 'secondary',
        inactiveSecondaryHeader: createElement(View, { testID: 'open-tree-drawer' }),
        primaryDrawer: {
          open: drawerOpen,
          onClose: () => setDrawerOpen(false),
          accessibilityLabel: 'MIB tree drawer',
          closeLabel: 'Close MIB tree drawer',
        },
        primary: createElement(PaneProbe, { id: 'navigator' }),
        secondary: createElement(PaneProbe, { id: 'inspector' }),
      });
    }

    const renderer = createRoot();
    act(() => renderer.render(createElement(BrowseHarness)));
    const root = renderer.container;
    const measure = root.queryAll((node) => typeof node.props.onLayout === 'function')[0]!;
    const pane = (id: string) => root.queryAll((node) => node.props.testID === id)[0]!;

    act(() => pane('navigator').props.onTouchEnd('navigator-scroll-27'));
    act(() => measure.props.onLayout({ nativeEvent: { layout: { width: 688 } } }));
    expect(pane('navigator').props.accessibilityLabel).toBe('navigator-scroll-27');
    expect(
      root.queryAll((node) => node.props.accessibilityLabel === 'MIB tree drawer'),
    ).toHaveLength(1);
    expect(
      root.queryAll((node) => node.props.importantForAccessibility === 'no-hide-descendants'),
    ).toHaveLength(1);

    act(() => measure.props.onLayout({ nativeEvent: { layout: { width: 689 } } }));
    expect(pane('navigator').props.accessibilityLabel).toBe('navigator-scroll-27');
    expect(
      root.queryAll((node) => node.props.accessibilityLabel === 'MIB tree drawer'),
    ).toHaveLength(0);
    expect(
      root.queryAll((node) => node.props.importantForAccessibility === 'no-hide-descendants'),
    ).toHaveLength(0);
    expect(mounts).toEqual({ navigator: 1, inspector: 1 });

    act(() => measure.props.onLayout({ nativeEvent: { layout: { width: 688 } } }));
    expect(
      root.queryAll((node) => node.props.accessibilityLabel === 'MIB tree drawer'),
    ).toHaveLength(0);
    expect(mounts).toEqual({ navigator: 1, inspector: 1 });
  });

  it('keeps Browse catalog and nested browser identities at the outer 857/858 boundary', () => {
    const mounts = { catalog: 0, browser: 0 };
    const PaneProbe = ({ id }: { id: 'catalog' | 'browser' }) => {
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
    function CatalogHarness() {
      const [drawerOpen, setDrawerOpen] = useState(true);
      return createElement(ContainerAwareSplitWorkspace, {
        workspace: 'mibModules',
        minPrimary: 160,
        minSecondary: 689,
        inactivePane: 'secondary',
        inactiveSecondaryHeader: createElement(View, { testID: 'open-catalog-drawer' }),
        primaryDrawer: {
          open: drawerOpen,
          onClose: () => setDrawerOpen(false),
          accessibilityLabel: 'MIB catalog drawer',
          closeLabel: 'Close MIB catalog drawer',
        },
        primary: createElement(PaneProbe, { id: 'catalog' }),
        secondary: createElement(PaneProbe, { id: 'browser' }),
      });
    }

    const renderer = createRoot();
    act(() => renderer.render(createElement(CatalogHarness)));
    const root = renderer.container;
    const measure = root.queryAll((node) => typeof node.props.onLayout === 'function')[0]!;
    const pane = (id: string) => root.queryAll((node) => node.props.testID === id)[0]!;

    act(() => pane('catalog').props.onTouchEnd('catalog-scroll-12'));
    act(() => measure.props.onLayout({ nativeEvent: { layout: { width: 857 } } }));
    expect(pane('catalog').props.accessibilityLabel).toBe('catalog-scroll-12');
    expect(
      root.queryAll((node) => node.props.accessibilityLabel === 'MIB catalog drawer'),
    ).toHaveLength(1);
    expect(
      root.queryAll((node) => node.props.importantForAccessibility === 'no-hide-descendants'),
    ).toHaveLength(1);

    act(() => measure.props.onLayout({ nativeEvent: { layout: { width: 858 } } }));
    expect(pane('catalog').props.accessibilityLabel).toBe('catalog-scroll-12');
    expect(
      root.queryAll((node) => node.props.accessibilityLabel === 'MIB catalog drawer'),
    ).toHaveLength(0);
    expect(
      root.queryAll((node) => node.props.importantForAccessibility === 'no-hide-descendants'),
    ).toHaveLength(0);
    expect(mounts).toEqual({ catalog: 1, browser: 1 });

    act(() => measure.props.onLayout({ nativeEvent: { layout: { width: 857 } } }));
    expect(
      root.queryAll((node) => node.props.accessibilityLabel === 'MIB catalog drawer'),
    ).toHaveLength(0);
    expect(mounts).toEqual({ catalog: 1, browser: 1 });
  });
});
