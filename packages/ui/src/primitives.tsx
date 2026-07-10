import type { ReactNode } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useTheme } from './theme';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.sectionTitle, { color: t.textDim }]}>{title}</Text>
      {children}
    </View>
  );
}

export function Field({
  label,
  ...props
}: { label: string } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: t.textDim }]}>{label}</Text>
      <TextInput
        placeholderTextColor={t.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
        {...props}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  disabled,
  tone = 'accent',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'accent' | 'error';
}) {
  const t = useTheme();
  const color = tone === 'error' ? t.error : t.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, { backgroundColor: color, opacity: disabled ? 0.5 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

export function Mono({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <Text style={[styles.mono, { color: t.mono }, style]}>{children}</Text>;
}

export function Label({ children, tone }: { children: ReactNode; tone?: 'ok' | 'error' | 'dim' }) {
  const t = useTheme();
  const color = tone === 'ok' ? t.ok : tone === 'error' ? t.error : tone === 'dim' ? t.textDim : t.text;
  return <Text style={{ color, fontSize: 13 }}>{children}</Text>;
}

const styles = StyleSheet.create({
  section: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12, gap: 8 },
  sectionTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  field: { gap: 4 },
  label: { fontSize: 12 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  button: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  mono: { fontFamily: 'monospace', fontSize: 12 },
});
