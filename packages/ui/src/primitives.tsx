import type { ReactNode } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from './theme';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.sectionTitle, { color: t.textDim }]}>{children}</Text>;
}

export function Field({ label, ...props }: { label?: string } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      {label ? <Text style={[styles.label, { color: t.textDim }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={t.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          { color: t.text, borderColor: t.border, backgroundColor: t.surfaceAlt },
          props.multiline ? styles.inputMultiline : null,
          props.style,
        ]}
        {...props}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  disabled,
  variant = 'primary',
  small,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  small?: boolean;
}) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.accent : variant === 'danger' ? t.errorSoft : 'transparent';
  const fg = variant === 'primary' ? t.accentText : variant === 'danger' ? t.error : t.accent;
  const borderColor = variant === 'ghost' ? t.border : 'transparent';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, borderColor, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, small && styles.buttonTextSmall, { color: fg }]}>{title}</Text>
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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.chip,
        {
          backgroundColor: active ? t.accentSoft : t.surfaceAlt,
          borderColor: active ? t.accent : t.border,
        },
      ]}
    >
      <Text style={{ color: active ? t.accent : t.textDim, fontSize: 12, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Pill({ text, color }: { text: string; color?: string }) {
  const t = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: t.surfaceAlt, borderColor: t.border }]}>
      <Text style={{ color: color ?? t.textDim, fontSize: 10, fontWeight: '700' }}>{text}</Text>
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
    tone === 'ok' ? t.ok : tone === 'error' ? t.error : tone === 'warn' ? t.warn : tone === 'dim' ? t.textDim : t.text;
  return <Text style={{ color, fontSize: size }}>{children}</Text>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={{ color: t.textDim, fontSize: 14, fontWeight: '600' }}>{title}</Text>
      {hint ? (
        <Text style={{ color: t.textDim, fontSize: 12, marginTop: 4, textAlign: 'center' }}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  sectionTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  field: { gap: 4, flex: 1 },
  label: { fontSize: 11, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top', fontFamily: 'monospace', fontSize: 12 },
  button: {
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { paddingVertical: 6, paddingHorizontal: 12 },
  buttonText: { fontWeight: '600', fontSize: 14 },
  buttonTextSmall: { fontSize: 12 },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12 },
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
  empty: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 16 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
});
