import { useMemo } from 'react';
import { View, Text, Pressable, FlatList, ScrollView, StyleSheet } from 'react-native';
import { Card, Field, Button, Pill, Mono, EmptyState, KindGlyph, useTheme } from '@omc/ui';
import type { MibNodeSummary } from '@omc/core/client';
import { useEngine } from '../engine-context';
import { useAppStore } from '../store';
import {
  loadChildren,
  selectNode,
  revealOid,
  runSearch,
  walkFromNode,
  getFromNode,
} from '../actions';

interface Flat {
  node: MibNodeSummary;
  depth: number;
}

function flattenVisible(
  cache: Record<string, MibNodeSummary[]>,
  expanded: Record<string, boolean>,
): Flat[] {
  const out: Flat[] = [];
  const walk = (oid: string, depth: number) => {
    const children = cache[oid];
    if (!children) return;
    for (const node of children) {
      out.push({ node, depth });
      if (expanded[node.oid]) walk(node.oid, depth + 1);
    }
  };
  walk('', 0);
  return out;
}

export function BrowseScreen() {
  const engine = useEngine();
  const t = useTheme();
  const cache = useAppStore((s) => s.childrenCache);
  const expanded = useAppStore((s) => s.expanded);
  const selected = useAppStore((s) => s.selected);
  const search = useAppStore((s) => s.search);
  const hits = useAppStore((s) => s.hits);

  const rows = useMemo(() => flattenVisible(cache, expanded), [cache, expanded]);

  const onSearch = (q: string) => {
    useAppStore.getState().setSearch(q);
    void runSearch(engine, q);
  };

  const toggle = (node: MibNodeSummary) => {
    const open = !expanded[node.oid];
    useAppStore.getState().setExpanded(node.oid, open);
    if (open) void loadChildren(engine, node.oid);
  };

  const pickHit = async (oid: string) => {
    useAppStore.getState().setSearch('');
    useAppStore.getState().setHits([]);
    await revealOid(engine, oid);
    await selectNode(engine, oid);
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <Field placeholder="Search name, OID, or description…" value={search} onChangeText={onSearch} />
      </View>

      {search.trim() ? (
        <FlatList
          data={hits}
          keyExtractor={(h) => h.oid + h.matched}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<EmptyState title="No matches" />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => void pickHit(item.oid)}
              style={[styles.row, { borderBottomColor: t.border }]}
            >
              <KindGlyph kind={item.kind} />
              <View style={styles.rowText}>
                <Text style={{ color: t.text, fontWeight: '600' }}>{item.name}</Text>
                <Mono dim size={11}>
                  {item.oid}
                </Mono>
              </View>
              {item.module ? <Pill text={item.module} /> : null}
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.node.oid}
          style={styles.tree}
          renderItem={({ item }) => {
            const { node, depth } = item;
            const isSel = selected?.oid === node.oid;
            return (
              <Pressable
                onPress={() => void selectNode(engine, node.oid)}
                style={[
                  styles.treeRow,
                  { paddingLeft: 8 + depth * 14, backgroundColor: isSel ? t.accentSoft : 'transparent' },
                ]}
              >
                <Pressable
                  onPress={() => (node.hasChildren ? toggle(node) : void selectNode(engine, node.oid))}
                  hitSlop={8}
                  style={styles.chevron}
                >
                  <Text style={{ color: t.textDim, fontSize: 12 }}>
                    {node.hasChildren ? (expanded[node.oid] ? '▾' : '▸') : '·'}
                  </Text>
                </Pressable>
                <KindGlyph kind={node.kind} />
                <Text style={[styles.treeName, { color: t.text }]} numberOfLines={1}>
                  {node.name}
                </Text>
                {node.hasChildren ? (
                  <Text style={{ color: t.textDim, fontSize: 11 }}>{node.childCount}</Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}

      {selected ? <DetailPanel /> : null}
    </View>
  );
}

function DetailPanel() {
  const engine = useEngine();
  const t = useTheme();
  const selected = useAppStore((s) => s.selected)!;
  return (
    <Card style={styles.detail}>
      <ScrollView>
        <View style={styles.detailHead}>
          <Text style={[styles.detailName, { color: t.text }]}>{selected.name}</Text>
          <Pill text={selected.kind} color={t.accent} />
          {selected.module ? <Pill text={selected.module} /> : null}
        </View>
        <Mono size={12}>{selected.oid}</Mono>
        {selected.syntax ? <KV k="Syntax" v={selected.syntax} /> : null}
        {selected.access ? <KV k="Access" v={selected.access} /> : null}
        {selected.status ? <KV k="Status" v={selected.status} /> : null}
        {selected.indexes?.length ? <KV k="Index" v={selected.indexes.join(', ')} /> : null}
        {selected.objects?.length ? <KV k="Objects" v={selected.objects.join(', ')} /> : null}
        {selected.description ? (
          <Text style={[styles.desc, { color: t.textDim }]}>{selected.description}</Text>
        ) : null}
        <View style={styles.detailActions}>
          <Button title="Walk here" small onPress={() => walkFromNode(engine, selected.oid)} />
          {(selected.kind === 'scalar' || selected.kind === 'column') && selected.access !== 'not-accessible' ? (
            <Button title="Get" small variant="ghost" onPress={() => getFromNode(engine, selected)} />
          ) : null}
          <Button
            title="Close"
            small
            variant="ghost"
            onPress={() => useAppStore.getState().setSelected(null)}
          />
        </View>
      </ScrollView>
    </Card>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  const t = useTheme();
  return (
    <View style={styles.kv}>
      <Text style={[styles.kvKey, { color: t.textDim }]}>{k}</Text>
      <Text style={[styles.kvVal, { color: t.text }]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchWrap: { padding: 12, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1 },
  tree: { flex: 1 },
  treeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12, paddingVertical: 7 },
  chevron: { width: 16, alignItems: 'center' },
  treeName: { flex: 1, fontSize: 14 },
  detail: { margin: 12, maxHeight: '45%' },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 },
  detailName: { fontSize: 16, fontWeight: '700' },
  desc: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  detailActions: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  kv: { flexDirection: 'row', gap: 8, marginTop: 6 },
  kvKey: { fontSize: 12, fontWeight: '700', width: 64 },
  kvVal: { fontSize: 12, flex: 1 },
});
