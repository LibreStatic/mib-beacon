import { forwardRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  View,
  Text,
  TextInput,
  Pressable,
  Switch,
  StyleSheet,
  type TextInputProps,
  type SwitchProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from './theme';
import { resolveButtonState } from './button-state';
import { resolveSwitchColors } from './switch-colors';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }, style]}>
      {children}
    </View>
  );
}

export function ThemedSwitch(props: SwitchProps) {
  const t = useTheme();
  const off = resolveSwitchColors(t, false);
  const on = resolveSwitchColors(t, true);
  const current = props.value ? on : off;
  const webColorProps = Platform.OS === 'web' ? { activeThumbColor: current.thumb } : {};
  return (
    <View style={[styles.nativeSwitchOutline, { borderColor: current.outline }]}>
      <Switch
        {...props}
        {...webColorProps}
        style={[Platform.OS === 'web' ? styles.webSwitch : null, props.style]}
        trackColor={{ false: off.track, true: on.track }}
        thumbColor={current.thumb}
        ios_backgroundColor={off.track}
      />
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text maxFontSizeMultiplier={1.3} style={[styles.sectionTitle, { color: t.textDim }]}>
      {children}
    </Text>
  );
}

export const Field = forwardRef<TextInput, { label?: string } & TextInputProps>(function Field(
  { label, onFocus, onBlur, style, multiline, accessibilityLabel, ...props },
  ref,
) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      {label ? (
        <Text maxFontSizeMultiplier={1.3} style={[styles.label, { color: t.textDim }]}>
          {label}
        </Text>
      ) : null}
      <TextInput
        {...props}
        ref={ref}
        placeholderTextColor={t.workbench.inputForeground}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={accessibilityLabel ?? label}
        multiline={multiline}
        maxFontSizeMultiplier={1.3}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          {
            color: t.workbench.inputForeground,
            borderColor: focused ? t.focus : t.border,
            backgroundColor: t.workbench.inputBackground,
            minHeight: t.density.controlMinHeight,
          },
          multiline ? styles.inputMultiline : null,
          style,
        ]}
      />
    </View>
  );
});

export function Button({
  title,
  onPress,
  disabled,
  loading,
  loadingTitle,
  variant = 'primary',
  small,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  /** Shows a spinner, swaps to `loadingTitle`, and suppresses presses. */
  loading?: boolean;
  loadingTitle?: string;
  variant?: 'primary' | 'ghost' | 'danger';
  small?: boolean;
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const { isBusy, isDisabled, label } = resolveButtonState({
    title,
    loading,
    loadingTitle,
    disabled,
  });
  const bg = variant === 'primary' ? t.accent : variant === 'danger' ? t.errorSoft : 'transparent';
  const fg = variant === 'primary' ? t.accentText : variant === 'danger' ? t.error : t.accent;
  const borderColor = variant === 'ghost' ? t.border : 'transparent';
  return (
    <Pressable
      onPress={() => {
        if (isBusy) return;
        onPress();
      }}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: isBusy, disabled: isDisabled }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        {
          backgroundColor: bg,
          borderColor: focused ? t.focus : borderColor,
          borderWidth: focused ? 2 : 1,
          minHeight: t.density.controlMinHeight,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <View style={styles.buttonContent}>
        {isBusy ? <ActivityIndicator size="small" color={fg} /> : null}
        <Text
          maxFontSizeMultiplier={1.3}
          style={[styles.buttonText, small && styles.buttonTextSmall, { color: fg }]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/** A pressable chip used for segmented choices (version, protocols). */
export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(active) }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.chip,
        {
          backgroundColor: active ? t.accentSoft : t.surfaceAlt,
          borderColor: focused ? t.focus : active ? t.accent : t.border,
          borderWidth: focused ? 2 : 1,
          minHeight: t.density.controlMinHeight,
        },
      ]}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        style={{ color: active ? t.accent : t.textDim, fontSize: 12, fontWeight: '600' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Pill({ text, color }: { text: string; color?: string }) {
  const t = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: t.surfaceAlt, borderColor: t.border }]}>
      <Text
        maxFontSizeMultiplier={1.3}
        style={{ color: color ?? t.textDim, fontSize: 10, fontWeight: '700' }}
      >
        {text}
      </Text>
    </View>
  );
}

export function Mono({
  children,
  dim,
  size = 12,
  numberOfLines,
}: {
  children: ReactNode;
  dim?: boolean;
  size?: number;
  numberOfLines?: number;
}) {
  const t = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      ellipsizeMode={numberOfLines ? 'middle' : undefined}
      maxFontSizeMultiplier={1.3}
      style={{ fontFamily: 'monospace', fontSize: size, color: dim ? t.textDim : t.mono }}
    >
      {children}
    </Text>
  );
}

export function Label({
  children,
  tone,
  size = 13,
}: {
  children: ReactNode;
  tone?: 'ok' | 'error' | 'warn' | 'dim';
  size?: number;
}) {
  const t = useTheme();
  const color =
    tone === 'ok'
      ? t.ok
      : tone === 'error'
        ? t.error
        : tone === 'warn'
          ? t.warn
          : tone === 'dim'
            ? t.textDim
            : t.text;
  return (
    <Text maxFontSizeMultiplier={1.3} style={{ color, fontSize: size }}>
      {children}
    </Text>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <Text
        maxFontSizeMultiplier={1.3}
        style={{ color: t.textDim, fontSize: 14, fontWeight: '600' }}
      >
        {title}
      </Text>
      {hint ? (
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ color: t.textDim, fontSize: 12, marginTop: 4, textAlign: 'center' }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  webSwitch: {
    width: 40,
    height: 22,
  },
  nativeSwitchOutline: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
  },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  sectionTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  field: { gap: 4, flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: 0 },
  label: { fontSize: 11, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  inputMultiline: {
    minHeight: 96,
    textAlignVertical: 'top',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  button: {
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { paddingVertical: 6, paddingHorizontal: 12 },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { fontWeight: '600', fontSize: 14 },
  buttonTextSmall: { fontSize: 12 },
  chip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
  empty: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 16 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
});
