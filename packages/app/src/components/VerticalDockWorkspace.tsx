import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type PointerEvent as NativePointerEvent,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@mibbeacon/ui';
import { clampSplitRatio, getWindowScopedStorageKey } from '../responsive-layout';

const DEFAULT_MAIN_RATIO = 0.65;
const verticalResizeCursor =
  Platform.OS === 'web'
    ? ({ cursor: 'row-resize', touchAction: 'none', userSelect: 'none' } as unknown as ViewStyle)
    : null;

interface PointerCaptureTarget {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
}

function readRatio(storageKey: string): number {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return DEFAULT_MAIN_RATIO;
  const stored = window.localStorage?.getItem(storageKey);
  const parsed = stored == null ? Number.NaN : Number(stored);
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
  const dragStart = useRef({ ratio, pageY: 0 });
  const activePointer = useRef<number | null>(null);
  const windowDragCleanup = useRef<(() => void) | null>(null);

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

  useEffect(
    () => () => {
      windowDragCleanup.current?.();
    },
    [],
  );

  if (!dock) return <View style={styles.root}>{main}</View>;
  const mainBasis = `${Math.round(ratio * 10_000) / 100}%` as const;
  const dragHandlers = {
    onPointerDown: (event: NativePointerEvent) => {
      if (activePointer.current !== null || event.nativeEvent.button !== 0) return;
      activePointer.current = event.nativeEvent.pointerId;
      dragStart.current = { ratio, pageY: event.nativeEvent.pageY };
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const pointerId = event.nativeEvent.pointerId;
        const start = dragStart.current;
        const move = (pointerEvent: PointerEvent) => {
          if (pointerEvent.pointerId !== pointerId) return;
          const delta = pointerEvent.pageY - start.pageY;
          updateRatio(height > 0 ? start.ratio + delta / height : start.ratio);
          pointerEvent.preventDefault();
        };
        const finish = (pointerEvent: PointerEvent) => {
          if (pointerEvent.pointerId !== pointerId) return;
          cleanup();
          activePointer.current = null;
        };
        const cleanup = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', finish);
          window.removeEventListener('pointercancel', finish);
          if (windowDragCleanup.current === cleanup) windowDragCleanup.current = null;
        };
        window.addEventListener('pointermove', move, { passive: false });
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
        windowDragCleanup.current = cleanup;
      }
      (event.currentTarget as unknown as PointerCaptureTarget).setPointerCapture?.(
        event.nativeEvent.pointerId,
      );
    },
    onPointerMove: (event: NativePointerEvent) => {
      if (activePointer.current !== event.nativeEvent.pointerId) return;
      if (windowDragCleanup.current !== null) return;
      const delta = event.nativeEvent.pageY - dragStart.current.pageY;
      updateRatio(height > 0 ? dragStart.current.ratio + delta / height : ratio);
      event.preventDefault();
    },
    onPointerUp: (event: NativePointerEvent) => {
      if (activePointer.current !== event.nativeEvent.pointerId) return;
      windowDragCleanup.current?.();
      activePointer.current = null;
      (event.currentTarget as unknown as PointerCaptureTarget).releasePointerCapture?.(
        event.nativeEvent.pointerId,
      );
    },
    onPointerCancel: (event: NativePointerEvent) => {
      if (activePointer.current === event.nativeEvent.pointerId) {
        windowDragCleanup.current?.();
        activePointer.current = null;
      }
    },
  };
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
        {...dragHandlers}
        style={({ pressed }) => [
          styles.dividerHit,
          verticalResizeCursor,
          { backgroundColor: pressed ? t.accentSoft : 'transparent' },
        ]}
      >
        <View style={[styles.divider, { backgroundColor: t.border }]} />
        <View style={[styles.grip, { backgroundColor: t.accent }]} />
      </Pressable>
      <View style={[styles.pane, styles.dock]}>{dock}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0 },
  pane: { minWidth: 0, minHeight: 0 },
  dock: { flex: 1 },
  dividerHit: { height: 18, alignItems: 'center', justifyContent: 'center' },
  divider: { position: 'absolute', height: 1, width: '100%' },
  grip: { width: 48, height: 4, borderRadius: 2 },
});
