import { useEffect, useRef, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { getResponsiveMode } from './breakpoints';
import { Button, Card, Label, SectionTitle } from './primitives';

export interface DialogProps {
  visible: boolean;
  /** Invoked by hardware back, Escape (web), backdrop tap, and the header Close button. */
  onRequestClose: () => void;
  title: string;
  subtitle?: string;
  headerAccessory?: ReactNode;
  children: ReactNode;
  /** Sticky action row rendered below the scrollable body. */
  footer?: ReactNode;
  /** 'auto' presents a bottom sheet on compact widths and a centered card otherwise. */
  presentation?: 'auto' | 'sheet' | 'center';
  scrollable?: boolean;
  maxWidth?: number;
  /** Take the full sheet height instead of sizing to content. */
  fillHeight?: boolean;
  /** When false, backdrop taps and Escape are ignored (busy states). */
  dismissable?: boolean;
  closeAccessibilityLabel?: string;
}

type FocusTarget = { focus?: () => void; isConnected?: boolean } | null;

export function Dialog({
  visible,
  onRequestClose,
  title,
  subtitle,
  headerAccessory,
  children,
  footer,
  presentation = 'auto',
  scrollable = true,
  maxWidth = 720,
  fillHeight = false,
  dismissable = true,
  closeAccessibilityLabel,
}: DialogProps) {
  const { width, height } = useWindowDimensions();
  const sheet =
    presentation === 'sheet' ||
    (presentation === 'auto' && getResponsiveMode(width) === 'compact');
  const heading = useRef<View>(null);
  const previousFocus = useRef<FocusTarget>(null);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof document === 'undefined') return;
    previousFocus.current = document.activeElement as FocusTarget;
    return () => {
      const previous = previousFocus.current;
      if (previous?.isConnected !== false) {
        setTimeout(() => previous?.focus?.(), 0);
      }
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (dismissable) onRequestClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [dismissable, onRequestClose, visible]);

  const focusHeading = () => {
    const handle = findNodeHandle(heading.current);
    if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
  };
  const requestClose = () => {
    if (dismissable) onRequestClose();
  };

  const sheetMaxHeight = Math.round(height * 0.92);
  return (
    <Modal
      visible={visible}
      transparent
      animationType={sheet ? 'slide' : 'fade'}
      onShow={focusHeading}
      onRequestClose={requestClose}
    >
      <View
        style={[styles.backdrop, sheet ? styles.backdropSheet : styles.backdropCenter]}
        accessibilityViewIsModal
        accessibilityLabel={title}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={closeAccessibilityLabel ?? `Close ${title}`}
          onPress={requestClose}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'web' ? undefined : 'padding'}
          style={[styles.avoider, sheet ? null : { maxWidth }]}
        >
          <Card
            style={[
              styles.sheet,
              sheet ? styles.sheetBottom : null,
              { maxHeight: sheetMaxHeight },
              fillHeight ? { height: sheetMaxHeight } : null,
            ]}
          >
            <View
              ref={heading}
              style={styles.heading}
              accessible
              accessibilityRole="header"
              accessibilityLabel={title}
            >
              <View style={styles.headingText}>
                <SectionTitle>{title}</SectionTitle>
                {subtitle ? (
                  <Label tone="dim" size={11}>
                    {subtitle}
                  </Label>
                ) : null}
              </View>
              {headerAccessory}
              <Button
                title="Close"
                variant="ghost"
                small
                onPress={onRequestClose}
              />
            </View>
            {scrollable ? (
              <ScrollView
                style={styles.body}
                contentContainerStyle={styles.bodyContent}
                keyboardShouldPersistTaps="handled"
              >
                {children}
              </ScrollView>
            ) : (
              <View style={styles.bodyStatic}>{children}</View>
            )}
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </Card>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 9, 16, 0.76)',
  },
  backdropCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  backdropSheet: {
    justifyContent: 'flex-end',
  },
  avoider: {
    width: '100%',
    flexShrink: 1,
    alignSelf: 'center',
  },
  sheet: {
    width: '100%',
    flexShrink: 1,
  },
  sheetBottom: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headingText: {
    flex: 1,
    gap: 2,
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    gap: 8,
    paddingBottom: 4,
  },
  bodyStatic: {
    flexShrink: 1,
    gap: 8,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
});
