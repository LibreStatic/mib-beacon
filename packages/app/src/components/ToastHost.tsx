import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Button, Label, useTheme, type Theme } from '@mibbeacon/ui';
import { useAppStore } from '../store';
import type { ToastItem, ToastTone } from '../toast-queue';

function toneColor(tone: ToastTone, t: Theme): string {
  switch (tone) {
    case 'success':
      return t.ok;
    case 'error':
      return t.error;
    case 'warn':
      return t.warn;
    default:
      return t.accent;
  }
}

/**
 * Single mounted host that renders transient toasts above every other layer
 * (Dialog / CommandPalette are RN Modals, so on web we sit at a higher zIndex
 * and on native we wrap the stack in our own transparent Modal). Kept
 * bottom-pinned, short-lived, and tap-to-dismiss so the native Modal never
 * blocks the workspace for long.
 */
export function ToastHost() {
  const t = useTheme();
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);
  const announced = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const toast of toasts) {
      if (announced.current.has(toast.id)) continue;
      announced.current.add(toast.id);
      // Covers iOS, which has no accessibilityLiveRegion mapping.
      AccessibilityInfo.announceForAccessibility(toast.message);
    }
    // Forget ids that have left the queue so a re-pushed message announces again.
    const live = new Set(toasts.map((toast) => toast.id));
    for (const id of announced.current) if (!live.has(id)) announced.current.delete(id);
  }, [toasts]);

  const stack = (
    <View
      style={[styles.stack, { padding: t.space.md, gap: t.space.sm }]}
      pointerEvents="box-none"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} accent={toneColor(toast.tone, t)} theme={t} onDismiss={dismissToast} />
      ))}
    </View>
  );

  if (Platform.OS === 'web') {
    // Non-Modal overlay above CommandPalette (zIndex 10000); only cards catch taps.
    return (
      <View style={[StyleSheet.absoluteFill, styles.webRoot]} pointerEvents="box-none">
        {stack}
      </View>
    );
  }

  // Native: a transparent Modal is the only reliable way to sit above other Modals.
  return (
    <Modal
      visible={toasts.length > 0}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        const last = toasts[toasts.length - 1];
        if (last) dismissToast(last.id);
      }}
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {stack}
      </View>
    </Modal>
  );
}

function ToastCard({
  toast,
  accent,
  theme: t,
  onDismiss,
}: {
  toast: ToastItem;
  accent: string;
  theme: Theme;
  onDismiss: (id: string) => void;
}) {
  const isError = toast.tone === 'error';
  return (
    <Pressable
      onPress={() => onDismiss(toast.id)}
      accessibilityRole={isError ? 'alert' : 'text'}
      accessibilityLiveRegion={isError ? 'assertive' : 'polite'}
      accessibilityLabel={toast.message}
      style={[
        styles.card,
        {
          backgroundColor: t.surface,
          borderColor: t.border,
          borderLeftColor: accent,
          gap: t.space.sm,
          paddingVertical: t.space.sm,
          paddingHorizontal: t.space.md,
        },
      ]}
    >
      <View style={styles.message}>
        <Label tone={toast.tone === 'success' ? 'ok' : toast.tone === 'warn' ? 'warn' : isError ? 'error' : 'dim'}>
          {toast.message}
        </Label>
      </View>
      {toast.actionLabel ? (
        <Button
          title={toast.actionLabel}
          variant="ghost"
          small
          onPress={() => {
            toast.onAction?.();
            onDismiss(toast.id);
          }}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  webRoot: {
    // Above CommandPalette's backdrop (zIndex 10000) and any Dialog Modal.
    zIndex: 100000,
  },
  stack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 520,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderLeftWidth: 4,
    borderRadius: 10,
  },
  message: { flex: 1, flexShrink: 1 },
});
