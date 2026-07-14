import { useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@mibbeacon/ui';
import { clampSplitRatio, getWindowScopedStorageKey } from '../responsive-layout';

const DEFAULT_MAIN_RATIO = 0.65;

function readRatio(storageKey: string): number {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return DEFAULT_MAIN_RATIO;
  const parsed = Number(window.localStorage?.getItem(storageKey));
  return Number.isFinite(parsed) ? parsed : DEFAULT_MAIN_RATIO;
}

export function VerticalDockWorkspace({
  storageId,
  main,
  dock,
}: {
  storageId: string;
  main: ReactNode;
  dock?: ReactNode;
}) {
  const t = useTheme();
  const windowNamespace =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('windowId') ?? 'browser')
      : 'native';
  const storageKey = getWindowScopedStorageKey(windowNamespace, `dock:${storageId}`);
  const [height, setHeight] = useState(0);
  const [ratio, setRatio] = useState(() => readRatio(storageKey));
  const dragStart = useRef(ratio);

  const updateRatio = (next: number) => {
    const clamped = clampSplitRatio({
      containerSize: height,
      ratio: next,
      minPrimary: 260,
      minSecondary: 190,
    });
    setRatio(clamped);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.localStorage?.setItem(storageKey, String(clamped));
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => Boolean(dock),
        onMoveShouldSetPanResponder: () => Boolean(dock),
        onPanResponderGrant: () => {
          dragStart.current = ratio;
        },
        onPanResponderMove: (_event, gesture) =>
          updateRatio(height > 0 ? dragStart.current + gesture.dy / height : ratio),
      }),
    // The responder must capture the current geometry at drag start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dock, height, ratio],
  );

  if (!dock) return <View style={styles.root}>{main}</View>;
  const mainBasis = `${Math.round(ratio * 10_000) / 100}%` as const;
  return (
    <View style={styles.root} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
      <View style={[styles.pane, { flexBasis: mainBasis }]}>{main}</View>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel="Resize MIB operation console"
        accessibilityValue={{ min: 0, max: 100, now: Math.round((1 - ratio) * 100) }}
        onAccessibilityAction={(event) => {
          const delta = event.nativeEvent.actionName === 'increment' ? -24 : 24;
          updateRatio(height > 0 ? ratio + delta / height : ratio);
        }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onLongPress={() => updateRatio(DEFAULT_MAIN_RATIO)}
        {...panResponder.panHandlers}
        style={({ pressed }) => [
          styles.dividerHit,
          { backgroundColor: pressed ? t.accentSoft : 'transparent' },
        ]}
      >
        <View style={[styles.divider, { backgroundColor: t.border }]} />
      </Pressable>
      <View style={[styles.pane, styles.dock]}>{dock}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0 },
  pane: { minWidth: 0, minHeight: 0 },
  dock: { flex: 1 },
  dividerHit: { height: 9, justifyContent: 'center' },
  divider: { height: 1, width: '100%' },
});
