import { useMemo, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { Text, useTheme } from '@mibbeacon/ui';

export function SwipeActionRow({
  children,
  accessibilityLabel,
  leftLabel,
  rightLabel,
  onSwipeLeft,
  onSwipeRight,
  disabled = false,
}: {
  children: ReactNode;
  accessibilityLabel: string;
  leftLabel: string;
  rightLabel: string;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !disabled && Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_event, gesture) =>
          translateX.setValue(Math.max(-96, Math.min(96, gesture.dx))),
        onPanResponderRelease: (_event, gesture) => {
          if (!disabled && gesture.dx <= -64) onSwipeLeft();
          else if (!disabled && gesture.dx >= 64) onSwipeRight();
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () =>
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start(),
      }),
    [disabled, onSwipeLeft, onSwipeRight, translateX],
  );
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={
        disabled
          ? 'Trap action pending'
          : `Swipe left to ${leftLabel}; swipe right to ${rightLabel}`
      }
      accessibilityState={{ disabled }}
      accessibilityActions={
        disabled
          ? []
          : [
              { name: 'decrement', label: leftLabel },
              { name: 'increment', label: rightLabel },
            ]
      }
      onAccessibilityAction={(event) => {
        if (disabled) return;
        if (event.nativeEvent.actionName === 'decrement') onSwipeLeft();
        else if (event.nativeEvent.actionName === 'increment') onSwipeRight();
      }}
      style={styles.root}
    >
      <View style={styles.actions} pointerEvents="none">
        <Text style={[styles.action, { color: t.semantic.status.up }]}>{rightLabel}</Text>
        <Text style={[styles.action, { color: t.semantic.status.down }]}>{leftLabel}</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...responder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden' },
  actions: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  action: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
});
