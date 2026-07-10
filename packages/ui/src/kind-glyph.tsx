import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from './theme';

export type NodeKind =
  | 'module-identity'
  | 'subtree'
  | 'table'
  | 'entry'
  | 'column'
  | 'scalar'
  | 'notification'
  | 'unknown';

const GLYPHS: Record<NodeKind, string> = {
  'module-identity': 'M',
  subtree: '•',
  table: 'T',
  entry: 'E',
  column: 'c',
  scalar: 's',
  notification: '!',
  unknown: '?',
};

export const KIND_LABELS: Record<NodeKind, string> = {
  'module-identity': 'module identity',
  subtree: 'subtree',
  table: 'table',
  entry: 'table entry',
  column: 'column',
  scalar: 'scalar',
  notification: 'notification',
  unknown: 'undefined arc',
};

/** Small colored badge identifying a MIB node's kind in tree rows. */
export function KindGlyph({ kind }: { kind: NodeKind }) {
  const t = useTheme();
  const color =
    kind === 'table'
      ? t.kind.table
      : kind === 'entry'
        ? t.kind.entry
        : kind === 'column'
          ? t.kind.column
          : kind === 'scalar'
            ? t.kind.scalar
            : kind === 'notification'
              ? t.kind.notification
              : kind === 'module-identity'
                ? t.kind.module
                : t.kind.subtree;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={{ color, fontSize: 10, fontWeight: '800', lineHeight: 12 }}>{GLYPHS[kind]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
