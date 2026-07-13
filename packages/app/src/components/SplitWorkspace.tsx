import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useTheme } from '@mibbeacon/ui';
import {
  adjustSplitRatio,
  clampSplitRatio,
  getWorkspaceDefaultRatio,
  type WorkspaceKey,
} from '../responsive-layout';

const memoryRatios = new Map<string, number>();

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
  primary,
  secondary,
  minPrimary = 280,
  minSecondary = 340,
}: {
  workspace: WorkspaceKey;
  primary: ReactNode;
  secondary: ReactNode;
  minPrimary?: number;
  minSecondary?: number;
}) {
  const t = useTheme();
  const windowNamespace =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('windowId') ?? 'browser')
      : 'native';
  const storageKey = `${windowNamespace}:${workspace}`;
  const defaultRatio = getWorkspaceDefaultRatio(workspace);
  const [containerSize, setContainerSize] = useState(0);
  const [ratio, setRatio] = useState(() => readRatio(storageKey, defaultRatio));
  const dragStart = useRef(ratio);

  const updateRatio = (next: number) => {
    const clamped = clampSplitRatio({
      containerSize,
      ratio: next,
      minPrimary,
      minSecondary,
    });
    setRatio(clamped);
    writeRatio(storageKey, clamped);
  };

  useEffect(() => {
    if (containerSize > 0) updateRatio(ratio);
    // Re-clamp persisted sizes only when the available width changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerSize]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStart.current = ratio;
        },
        onPanResponderMove: (_event, gesture) => {
          updateRatio(
            adjustSplitRatio({
              containerSize,
              ratio: dragStart.current,
              delta: gesture.dx,
              minPrimary,
              minSecondary,
            }),
          );
        },
      }),
    // PanResponder must capture the latest dimensions and ratio at drag start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [containerSize, minPrimary, minSecondary, ratio],
  );

  const onLayout = (event: LayoutChangeEvent) => setContainerSize(event.nativeEvent.layout.width);
  const primaryBasis = `${Math.round(ratio * 10_000) / 100}%` as const;
  const webKeyboardProps =
    Platform.OS === 'web'
      ? {
          onKeyDown: (event: { key: string; preventDefault: () => void }) => {
            const delta = event.key === 'ArrowRight' ? 24 : event.key === 'ArrowLeft' ? -24 : 0;
            if (event.key === 'Home') updateRatio(0);
            else if (event.key === 'End') updateRatio(1);
            else if (delta) {
              updateRatio(
                adjustSplitRatio({ containerSize, ratio, delta, minPrimary, minSecondary }),
              );
            } else return;
            event.preventDefault();
          },
          onDoubleClick: () => updateRatio(defaultRatio),
        }
      : {};

  return (
    <View style={styles.root} onLayout={onLayout}>
      <View style={[styles.pane, { flexBasis: primaryBasis }]}>{primary}</View>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel={`Resize ${workspace} workspace panes`}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          const delta = event.nativeEvent.actionName === 'increment' ? 24 : -24;
          updateRatio(adjustSplitRatio({ containerSize, ratio, delta, minPrimary, minSecondary }));
        }}
        onLongPress={() => updateRatio(defaultRatio)}
        delayLongPress={450}
        {...webKeyboardProps}
        style={({ pressed }) => [
          styles.dividerHit,
          { backgroundColor: pressed ? t.accentSoft : 'transparent' },
        ]}
        {...panResponder.panHandlers}
      >
        <View style={[styles.divider, { backgroundColor: t.border }]} />
      </Pressable>
      <View style={[styles.pane, styles.secondary]}>{secondary}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0, flexDirection: 'row' },
  pane: { minWidth: 0, minHeight: 0 },
  secondary: { flex: 1 },
  dividerHit: {
    width: 9,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { width: 1, height: '100%' },
});
