import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
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
 * Single mounted host that renders transient, bottom-pinned toasts above the
 * workspace. The full-screen overlay is pointer-transparent, so only the toast
 * cards catch taps and the rest of the UI remains interactive.
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

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="box-none">
      <View
        style={[styles.stack, { padding: t.space.md, gap: t.space.sm }]}
        pointerEvents="box-none"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} accent={toneColor(toast.tone, t)} theme={t} onDismiss={dismissToast} />
        ))}
      </View>
    </View>
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
  overlay: {
    // Above in-tree workspace overlays such as the Command Palette backdrop.
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
