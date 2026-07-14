import { useMemo, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@mibbeacon/ui';

export function SwipeActionRow({
  children,
  accessibilityLabel,
  leftLabel,
  rightLabel,
  onSwipeLeft,
  onSwipeRight,
}: {
  children: ReactNode;
  accessibilityLabel: string;
  leftLabel: string;
  rightLabel: string;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
}) {
  const t = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_event, gesture) =>
          translateX.setValue(Math.max(-96, Math.min(96, gesture.dx))),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx <= -64) onSwipeLeft();
          else if (gesture.dx >= 64) onSwipeRight();
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () =>
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start(),
      }),
    [onSwipeLeft, onSwipeRight, translateX],
  );
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={`Swipe left to ${leftLabel}; swipe right to ${rightLabel}`}
      accessibilityActions={[
        { name: 'decrement', label: leftLabel },
        { name: 'increment', label: rightLabel },
      ]}
      onAccessibilityAction={(event) =>
        event.nativeEvent.actionName === 'decrement' ? onSwipeLeft() : onSwipeRight()
      }
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
