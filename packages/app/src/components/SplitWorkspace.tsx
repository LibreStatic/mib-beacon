import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type PointerEvent as NativePointerEvent,
  type ViewStyle,
} from 'react-native';
import { Button, useTheme } from '@mibbeacon/ui';
import {
  adjustSplitRatio,
  canFitSplit,
  getSplitPaneSizes,
  getWorkspaceDefaultRatio,
  SPLIT_DIVIDER_WIDTH,
  splitAccessibilityDelta,
  type WorkspaceKey,
} from '../responsive-layout';

interface SplitWorkspaceProps {
  workspace: WorkspaceKey;
  accessibilityLabel?: string;
  primary: ReactNode;
  secondary: ReactNode;
  minPrimary?: number;
  minSecondary?: number;
  active?: boolean;
  stackWhenInactive?: boolean;
  inactivePane?: 'primary' | 'secondary' | 'stack';
  inactiveSecondaryHeader?: ReactNode;
  primaryDrawer?: {
    open: boolean;
    onClose: () => void;
    accessibilityLabel: string;
    closeLabel: string;
  };
}

export function ContainerAwareSplitWorkspace({
  fallback,
  minPrimary = 280,
  minSecondary = 340,
  preservePrimary = false,
  stackOnFallback = false,
  splitEnabled = true,
  ...splitProps
}: SplitWorkspaceProps & {
  fallback?: ReactNode;
  preservePrimary?: boolean;
  stackOnFallback?: boolean;
  splitEnabled?: boolean;
}) {
  const [containerSize, setContainerSize] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => setContainerSize(event.nativeEvent.layout.width);
  const splitActive = splitEnabled && canFitSplit(containerSize, { minPrimary, minSecondary });
  const preserveMountedPanes =
    preservePrimary || stackOnFallback || splitProps.inactivePane !== undefined;

  useEffect(() => {
    if (splitActive && splitProps.primaryDrawer?.open) splitProps.primaryDrawer.onClose();
  }, [splitActive, splitProps.primaryDrawer]);

  return (
    <View style={styles.measureRoot} onLayout={onLayout}>
      {preserveMountedPanes ? (
        <SplitWorkspace
          {...splitProps}
          minPrimary={minPrimary}
          minSecondary={minSecondary}
          active={splitActive}
          stackWhenInactive={stackOnFallback}
        />
      ) : splitActive ? (
        <SplitWorkspace {...splitProps} minPrimary={minPrimary} minSecondary={minSecondary} />
      ) : (
        (fallback ?? null)
      )}
    </View>
  );
}

const memoryRatios = new Map<string, number>();
export function resetSplitWorkspaceLayouts(): void {
  memoryRatios.clear();
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith('mibbeacon:split:')) window.localStorage.removeItem(key);
  }
}

const horizontalResizeCursor =
  Platform.OS === 'web'
    ? ({ cursor: 'col-resize', touchAction: 'none', userSelect: 'none' } as unknown as ViewStyle)
    : null;

interface PointerCaptureTarget {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
}

interface FocusableTarget {
  focus(): void;
}

interface FocusablePane {
  contains(target: unknown): boolean;
  firstFocusable(): FocusableTarget | null;
}

interface FocusCandidate extends FocusableTarget {
  disabled?: boolean;
  hidden?: boolean;
  inert?: boolean;
  isConnected?: boolean;
  tabIndex?: number;
  parentElement?: unknown;
  getAttribute?(name: string): string | null;
  getClientRects?(): ArrayLike<unknown>;
  closest?(selector: string): unknown;
}

interface FocusRoot {
  querySelectorAll(selector: string): ArrayLike<FocusCandidate> | Iterable<FocusCandidate>;
}

const focusableSelector =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function isEnabledFocusableTarget(candidate: FocusCandidate): boolean {
  const attribute = (name: string) => candidate.getAttribute?.(name) ?? null;
  if (
    candidate.disabled ||
    candidate.hidden ||
    candidate.inert ||
    candidate.isConnected === false ||
    (candidate.tabIndex !== undefined && candidate.tabIndex < 0) ||
    attribute('disabled') !== null ||
    attribute('aria-disabled') === 'true' ||
    attribute('aria-hidden') === 'true' ||
    attribute('inert') !== null ||
    candidate.closest?.('[hidden], [aria-hidden="true"], [inert]')
  )
    return false;
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return true;
  let current: unknown = candidate;
  while (current) {
    try {
      const style = window.getComputedStyle(current as Element);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse'
      )
        return false;
    } catch {
      // Unit-test focus surrogates are not DOM Elements.
    }
    current = (current as { parentElement?: unknown }).parentElement ?? null;
  }
  const isJsdom =
    typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom');
  if (
    !isJsdom &&
    candidate.isConnected === true &&
    typeof candidate.getClientRects === 'function' &&
    candidate.getClientRects().length === 0
  )
    return false;
  return true;
}

function enabledFocusableTargets(root: FocusRoot | null): FocusCandidate[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll(focusableSelector)).filter(isEnabledFocusableTarget);
}

export function firstEnabledFocusable(root: FocusRoot | null): FocusableTarget | null {
  return enabledFocusableTargets(root)[0] ?? null;
}

export function restoreDrawerFocus({
  splitActive,
  previous,
  previousIsVisible = true,
  divider,
  primary,
}: {
  splitActive: boolean;
  previous: FocusableTarget | null;
  previousIsVisible?: boolean;
  divider: FocusableTarget | null;
  primary: FocusableTarget | null;
}): void {
  const eligiblePrevious =
    previous && isEnabledFocusableTarget(previous as FocusCandidate) ? previous : null;
  (splitActive
    ? (divider ?? primary)
    : previousIsVisible
      ? (eligiblePrevious ?? primary)
      : primary
  )?.focus();
}

export function transferFocusForInactivePaneChange({
  splitActive,
  previousSplitActive,
  previousMode,
  nextMode,
  activeElement,
  primary,
  secondary,
}: {
  splitActive: boolean;
  previousSplitActive: boolean | null;
  previousMode: 'primary' | 'secondary' | 'stack' | null;
  nextMode: 'primary' | 'secondary' | 'stack';
  activeElement: unknown;
  primary: FocusablePane;
  secondary: FocusablePane;
}): void {
  if (splitActive || previousSplitActive === null || previousMode === null) return;
  const primaryWillHide =
    nextMode === 'secondary' &&
    (previousSplitActive || previousMode === 'primary' || previousMode === 'stack');
  const secondaryWillHide =
    nextMode === 'primary' &&
    (previousSplitActive || previousMode === 'secondary' || previousMode === 'stack');
  if (primaryWillHide && primary.contains(activeElement)) {
    secondary.firstFocusable()?.focus();
  } else if (secondaryWillHide && secondary.contains(activeElement)) {
    primary.firstFocusable()?.focus();
  }
}

function readRatio(key: string, fallback: number): number {
  const memory = memoryRatios.get(key);
  if (memory !== undefined) return memory;
  if (Platform.OS !== 'web' || typeof window === 'undefined') return fallback;
  const stored = window.localStorage?.getItem(`mibbeacon:split:${key}`);
  const parsed = stored == null ? Number.NaN : Number(stored);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function writeRatio(key: string, ratio: number): void {
  memoryRatios.set(key, ratio);
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.localStorage?.setItem(`mibbeacon:split:${key}`, String(ratio));
  }
}

export function SplitWorkspace({
  workspace,
  accessibilityLabel,
  primary,
  secondary,
  minPrimary = 280,
  minSecondary = 340,
  active = true,
  stackWhenInactive = false,
  inactivePane,
  inactiveSecondaryHeader,
  primaryDrawer,
}: SplitWorkspaceProps) {
  const t = useTheme();
  const windowNamespace =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('windowId') ?? 'browser')
      : 'native';
  const storageKey = `${windowNamespace}:${workspace}`;
  const defaultRatio = getWorkspaceDefaultRatio(workspace);
  const [containerSize, setContainerSize] = useState(0);
  const [ratio, setRatio] = useState(() => readRatio(storageKey, defaultRatio));
  const dragStart = useRef({ ratio, pageX: 0 });
  const activePointer = useRef<number | null>(null);
  const primaryPaneRef = useRef<View>(null);
  const secondaryPaneRef = useRef<View>(null);
  const dividerRef = useRef<View>(null);
  const previousWebFocus = useRef<HTMLElement | null>(null);
  const drawerWasOpen = useRef(false);
  const previousInactiveMode = useRef<'primary' | 'secondary' | 'stack' | null>(null);
  const previousSplitActive = useRef<boolean | null>(null);

  const updateRatio = (next: number) => {
    const sizes = getSplitPaneSizes(containerSize, next, { minPrimary, minSecondary });
    if (!sizes) return;
    setRatio(sizes.ratio);
    writeRatio(storageKey, sizes.ratio);
  };

  useEffect(() => {
    if (active && containerSize > 0) updateRatio(ratio);
    // Re-clamp persisted sizes only when the available width changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, containerSize]);

  const onLayout = (event: LayoutChangeEvent) => setContainerSize(event.nativeEvent.layout.width);
  const paneSizes = getSplitPaneSizes(containerSize, ratio, { minPrimary, minSecondary });
  const splitContentSize = paneSizes ? paneSizes.primary + paneSizes.secondary : 0;
  const primaryBasis = paneSizes?.primary ?? minPrimary;
  const webKeyboardProps =
    Platform.OS === 'web'
      ? {
          onKeyDown: (event: { key: string; preventDefault: () => void }) => {
            const delta = event.key === 'ArrowRight' ? 24 : event.key === 'ArrowLeft' ? -24 : 0;
            if (event.key === 'Home') updateRatio(0);
            else if (event.key === 'End') updateRatio(1);
            else if (delta) {
              updateRatio(
                adjustSplitRatio({
                  containerSize: splitContentSize,
                  ratio,
                  delta,
                  minPrimary,
                  minSecondary,
                }),
              );
            } else return;
            event.preventDefault();
          },
          onDoubleClick: () => updateRatio(defaultRatio),
        }
      : {};
  const dragHandlers = {
    onPointerDown: (event: NativePointerEvent) => {
      if (activePointer.current !== null || event.nativeEvent.button !== 0) return;
      activePointer.current = event.nativeEvent.pointerId;
      dragStart.current = { ratio, pageX: event.nativeEvent.pageX };
      (event.currentTarget as unknown as PointerCaptureTarget).setPointerCapture?.(
        event.nativeEvent.pointerId,
      );
    },
    onPointerMove: (event: NativePointerEvent) => {
      if (activePointer.current !== event.nativeEvent.pointerId) return;
      updateRatio(
        adjustSplitRatio({
          containerSize: splitContentSize,
          ratio: dragStart.current.ratio,
          delta: event.nativeEvent.pageX - dragStart.current.pageX,
          minPrimary,
          minSecondary,
        }),
      );
      event.preventDefault();
    },
    onPointerUp: (event: NativePointerEvent) => {
      if (activePointer.current !== event.nativeEvent.pointerId) return;
      activePointer.current = null;
      (event.currentTarget as unknown as PointerCaptureTarget).releasePointerCapture?.(
        event.nativeEvent.pointerId,
      );
    },
    onPointerCancel: (event: NativePointerEvent) => {
      if (activePointer.current === event.nativeEvent.pointerId) activePointer.current = null;
    },
  };

  const inactiveMode = inactivePane ?? (stackWhenInactive ? 'stack' : 'primary');
  const drawerOpen = !active && inactiveMode === 'secondary' && Boolean(primaryDrawer?.open);
  const primaryStyle = active
    ? { flexBasis: primaryBasis }
    : inactiveMode === 'primary'
      ? styles.unsplitPane
      : drawerOpen
        ? [styles.drawerPane, { backgroundColor: t.bg, borderRightColor: t.border }]
        : styles.hiddenPane;
  const secondaryStyle =
    active || inactiveMode === 'secondary' || inactiveMode === 'stack'
      ? styles.secondary
      : styles.hiddenPane;
  const webDrawerProps =
    Platform.OS === 'web' && drawerOpen
      ? {
          onKeyDown: (event: { key: string; shiftKey?: boolean; preventDefault(): void }) => {
            if (event.key === 'Escape') {
              primaryDrawer?.onClose();
              event.preventDefault();
              return;
            }
            if (event.key !== 'Tab') return;
            const drawer = primaryPaneRef.current as unknown as HTMLElement | null;
            if (!drawer || typeof document === 'undefined') return;
            const focusable = enabledFocusableTargets(drawer);
            if (!focusable.length) return;
            const first = focusable[0]!;
            const last = focusable.at(-1)!;
            if (event.shiftKey && (document.activeElement as unknown) === first) {
              last.focus();
              event.preventDefault();
            } else if (!event.shiftKey && (document.activeElement as unknown) === last) {
              first.focus();
              event.preventDefault();
            }
          },
        }
      : {};

  useEffect(() => {
    const previousMode = previousInactiveMode.current;
    const wasSplitActive = previousSplitActive.current;
    previousInactiveMode.current = inactiveMode;
    previousSplitActive.current = active;
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const pane = (node: HTMLElement | null): FocusablePane => ({
      contains: (target) => Boolean(node && target && node.contains(target as Node)),
      firstFocusable: () => firstEnabledFocusable(node),
    });
    transferFocusForInactivePaneChange({
      splitActive: active,
      previousSplitActive: wasSplitActive,
      previousMode,
      nextMode: inactiveMode,
      activeElement: document.activeElement,
      primary: pane(primaryPaneRef.current as unknown as HTMLElement | null),
      secondary: pane(secondaryPaneRef.current as unknown as HTMLElement | null),
    });
  }, [active, inactiveMode]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const primaryNode = primaryPaneRef.current as unknown as HTMLElement | null;
    const secondaryNode = secondaryPaneRef.current as unknown as HTMLElement | null;
    if (drawerOpen) {
      if (!drawerWasOpen.current)
        previousWebFocus.current = document.activeElement as HTMLElement | null;
      drawerWasOpen.current = true;
      secondaryNode?.setAttribute('inert', '');
      firstEnabledFocusable(primaryNode)?.focus();
    } else {
      secondaryNode?.removeAttribute('inert');
      if (drawerWasOpen.current) {
        const visiblePane = inactiveMode === 'secondary' ? secondaryNode : primaryNode;
        const paneTarget = firstEnabledFocusable(visiblePane) ?? visiblePane;
        const hiddenPane =
          inactiveMode === 'primary'
            ? secondaryNode
            : inactiveMode === 'secondary'
              ? primaryNode
              : null;
        const previous = previousWebFocus.current;
        restoreDrawerFocus({
          splitActive: active,
          previous,
          previousIsVisible: !previous || !hiddenPane?.contains(previous),
          divider: dividerRef.current as unknown as HTMLElement | null,
          primary: paneTarget,
        });
      }
      drawerWasOpen.current = false;
      previousWebFocus.current = null;
    }
    return () => secondaryNode?.removeAttribute('inert');
  }, [active, drawerOpen, inactiveMode]);

  useEffect(() => {
    if (!drawerOpen || Platform.OS === 'web' || !primaryDrawer) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      primaryDrawer.onClose();
      return true;
    });
    return () => subscription.remove();
  }, [drawerOpen, primaryDrawer]);

  return (
    <View
      style={[styles.root, !active && inactiveMode === 'stack' ? styles.stackedRoot : null]}
      onLayout={onLayout}
    >
      {drawerOpen && primaryDrawer ? (
        <Pressable
          key="drawer-backdrop"
          accessibilityRole="button"
          accessibilityLabel={`Close ${primaryDrawer.accessibilityLabel}`}
          onPress={primaryDrawer.onClose}
          style={styles.drawerBackdrop}
        />
      ) : null}
      <View
        key="primary-pane"
        ref={primaryPaneRef}
        accessibilityViewIsModal={drawerOpen || undefined}
        accessibilityLabel={drawerOpen ? primaryDrawer?.accessibilityLabel : undefined}
        onAccessibilityEscape={drawerOpen ? primaryDrawer?.onClose : undefined}
        {...webDrawerProps}
        style={[styles.pane, primaryStyle]}
      >
        {primaryDrawer ? (
          <View style={[styles.drawerHeader, !drawerOpen ? styles.hiddenHeader : null]}>
            <Button
              title={primaryDrawer.closeLabel}
              small
              variant="ghost"
              onPress={primaryDrawer.onClose}
            />
          </View>
        ) : null}
        <View style={styles.paneContent}>{primary}</View>
      </View>
      {active ? (
        <Pressable
          key="divider"
          ref={dividerRef}
          accessibilityRole="adjustable"
          accessibilityLabel={accessibilityLabel ?? `Resize ${workspace} workspace panes`}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            const delta = splitAccessibilityDelta(event.nativeEvent.actionName);
            if (delta === null) return;
            updateRatio(
              adjustSplitRatio({
                containerSize: splitContentSize,
                ratio,
                delta,
                minPrimary,
                minSecondary,
              }),
            );
          }}
          onLongPress={() => updateRatio(defaultRatio)}
          delayLongPress={450}
          {...dragHandlers}
          {...webKeyboardProps}
          style={({ pressed }) => [
            styles.dividerHit,
            horizontalResizeCursor,
            { backgroundColor: pressed ? t.accentSoft : 'transparent' },
          ]}
        >
          <View style={[styles.divider, { backgroundColor: t.border }]} />
        </Pressable>
      ) : null}
      <View
        key="secondary-pane"
        ref={secondaryPaneRef}
        accessibilityElementsHidden={drawerOpen}
        importantForAccessibility={drawerOpen ? 'no-hide-descendants' : 'auto'}
        pointerEvents={drawerOpen ? 'none' : 'auto'}
        style={[styles.pane, secondaryStyle]}
      >
        {inactiveSecondaryHeader ? (
          <View style={active ? styles.hiddenHeader : null}>{inactiveSecondaryHeader}</View>
        ) : null}
        <View style={styles.paneContent}>{secondary}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  measureRoot: { flex: 1, minWidth: 0, minHeight: 0 },
  root: { flex: 1, minWidth: 0, minHeight: 0, flexDirection: 'row' },
  stackedRoot: { flexDirection: 'column' },
  pane: { minWidth: 0, minHeight: 0 },
  paneContent: { flex: 1, minWidth: 0, minHeight: 0 },
  unsplitPane: { flex: 1 },
  hiddenPane: { display: 'none' },
  hiddenHeader: { display: 'none' },
  secondary: { flex: 1 },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  drawerPane: {
    position: 'absolute',
    zIndex: 11,
    left: 0,
    top: 0,
    bottom: 0,
    width: '82%',
    maxWidth: 520,
    borderRightWidth: 1,
  },
  drawerHeader: {
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  dividerHit: {
    width: SPLIT_DIVIDER_WIDTH,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { width: 1, height: '100%' },
});
