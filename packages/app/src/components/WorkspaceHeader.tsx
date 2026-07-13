import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@omc/ui';

export function WorkspaceHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: t.surface, borderBottomColor: t.border }]}>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: t.text }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: t.textDim }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  subtitle: { fontSize: 10, marginTop: 2, letterSpacing: 0.25 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
