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
  clearModuleFocus,
  setFromNode,
  trapFromNode,
} from '../actions';
import { OidLookupPanel } from '../components/OidLookupPanel';
import { SplitWorkspace } from '../components/SplitWorkspace';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { useResponsiveLayout } from '../responsive-context';
import { flattenVisibleTree, getTreeDisclosureVisual, getTreeRowBackground } from './browse-tree';

export function BrowseScreen() {
  const engine = useEngine();
  const t = useTheme();
  const { supportsSplitView } = useResponsiveLayout();
  const cache = useAppStore((s) => s.childrenCache);
  const expanded = useAppStore((s) => s.expanded);
  const selected = useAppStore((s) => s.selected);
  const search = useAppStore((s) => s.search);
  const hits = useAppStore((s) => s.hits);
  const moduleFocus = useAppStore((s) => s.moduleFocus);

  const rows = useMemo(() => flattenVisibleTree(cache, expanded), [cache, expanded]);

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

  const navigator = (
    <View style={[styles.navigator, { borderRightColor: t.border }]}>
      {moduleFocus ? (
        <View
          style={[styles.focusBanner, { backgroundColor: t.surface, borderBottomColor: t.border }]}
        >
          <View style={styles.focusMain}>
            <Text style={[styles.focusEyebrow, { color: t.kind.module }]}>MODULE FOCUS</Text>
            <Text style={[styles.focusTitle, { color: t.text }]}>{moduleFocus.module.name}</Text>
            <Text style={{ color: t.textDim, fontSize: 11 }}>
              {moduleFocus.module.objectCount} definitions · {moduleFocus.dependencies.length}{' '}
              imports
            </Text>
          </View>
          <View style={styles.dependencyWrap}>
            {moduleFocus.dependencies.map((dep) => (
              <Pill
                key={dep.name}
                text={`${dep.loaded ? '↳' : '⚠'} ${dep.name}`}
                color={dep.loaded ? t.textDim : t.warn}
              />
            ))}
          </View>
          <Button
            title="All MIBs"
            small
            variant="ghost"
            onPress={() => void clearModuleFocus(engine)}
          />
        </View>
      ) : null}
      <View style={styles.searchWrap}>
        <Field
          placeholder="Search name, OID, or description…"
          value={search}
          onChangeText={onSearch}
        />
      </View>

      {search.trim() ? (
        <FlatList
          data={hits}
          keyExtractor={(h) => h.oid + h.matched}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            /^\.?\d+(?:\.\d+)+$/.test(search.trim()) ? (
              <View style={styles.lookupEmpty}>
                <EmptyState
                  title="OID is not in the loaded catalog"
                  hint="External lookup is optional and starts only when you press Resolve."
                />
                <OidLookupPanel oid={search} />
              </View>
            ) : (
              <EmptyState title="No matches" />
            )
          }
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
          ListEmptyComponent={
            moduleFocus ? (
              <EmptyState
                title="No OID assignments in this module"
                hint="This dependency may only define macros or textual conventions."
              />
            ) : null
          }
          renderItem={({ item }) => {
            const { node, depth, rootIndex } = item;
            const isSel = selected?.oid === node.oid;
            const role = 'role' in node ? node.role : undefined;
            const isExpanded = Boolean(expanded[node.oid]);
            const disclosure = getTreeDisclosureVisual(node.hasChildren, isExpanded);
            const disclosureColor =
              disclosure.tone === 'expanded'
                ? t.accent
                : disclosure.tone === 'collapsed'
                  ? t.kind.subtree
                  : t.textDim;
            return (
              <View
                style={[
                  styles.treeRow,
                  {
                    paddingLeft: 8 + depth * 14,
                    backgroundColor: isSel
                      ? t.accentSoft
                      : getTreeRowBackground(t.scheme, rootIndex, depth),
                    borderLeftColor:
                      role === 'module'
                        ? t.kind.module
                        : role === 'dependency'
                          ? t.warn
                          : 'transparent',
                  },
                ]}
              >
                <Pressable
                  onPress={() =>
                    node.hasChildren ? toggle(node) : void selectNode(engine, node.oid)
                  }
                  accessibilityRole="button"
                  accessibilityLabel={
                    node.hasChildren
                      ? `${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`
                      : `Select ${node.name}`
                  }
                  accessibilityState={node.hasChildren ? { expanded: isExpanded } : undefined}
                  style={styles.branchTrigger}
                >
                  <View style={styles.chevron}>
                    <Text
                      style={[
                        styles.disclosureIcon,
                        {
                          color: disclosureColor,
                          fontSize: 14,
                        },
                      ]}
                    >
                      {disclosure.glyph}
                    </Text>
                  </View>
                  <KindGlyph kind={node.kind} />
                </Pressable>
                <Pressable
                  onPress={() => void selectNode(engine, node.oid)}
                  accessibilityRole="button"
                  accessibilityLabel={`View details for ${node.name}`}
                  accessibilityState={{ selected: isSel }}
                  style={styles.nodeTrigger}
                >
                  <View style={styles.treeText}>
                    <Text
                      style={[styles.treeName, { color: role === 'parent' ? t.textDim : t.text }]}
                      numberOfLines={1}
                    >
                      {node.name}
                    </Text>
                    <Mono dim size={9} numberOfLines={1}>
                      {node.oid}
                    </Mono>
                  </View>
                  {role ? (
                    <Pill
                      text={role === 'module' ? 'this MIB' : role}
                      color={
                        role === 'module'
                          ? t.kind.module
                          : role === 'dependency'
                            ? t.warn
                            : t.textDim
                      }
                    />
                  ) : null}
                  {node.hasChildren ? (
                    <Text style={{ color: t.textDim, fontSize: 11 }}>{node.childCount}</Text>
                  ) : null}
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </View>
  );

  if (!supportsSplitView) {
    return (
      <View style={styles.container}>
        {navigator}
        {selected ? <DetailPanel /> : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WorkspaceHeader
        title="MIB explorer"
        subtitle="EXPLORE THE OID TREE · INSPECT DEFINITIONS · LAUNCH OPERATIONS"
        actions={
          selected?.module ? <Pill text={selected.module} color={t.kind.module} /> : undefined
        }
      />
      <SplitWorkspace
        workspace="browse"
        minPrimary={300}
        minSecondary={380}
        primary={navigator}
        secondary={selected ? <DetailPanel embedded /> : <BrowseInspectorEmpty />}
      />
    </View>
  );
}

function BrowseInspectorEmpty() {
  const t = useTheme();
  return (
    <View style={[styles.inspectorEmpty, { backgroundColor: t.bg }]}>
      <Text style={[styles.inspectorGlyph, { color: t.kind.subtree }]}>⌬</Text>
      <Text style={[styles.inspectorEmptyTitle, { color: t.text }]}>Select a MIB object</Text>
      <Text style={[styles.inspectorEmptyHint, { color: t.textDim }]}>
        Expand the tree or search by name, OID, or description. Object metadata and actions stay
        visible here while you continue browsing.
      </Text>
    </View>
  );
}

function DetailPanel({ embedded = false }: { embedded?: boolean }) {
  const engine = useEngine();
  const t = useTheme();
  const selected = useAppStore((s) => s.selected)!;
  const writable =
    selected.access === 'read-write' ||
    selected.access === 'read-create' ||
    selected.access === 'write-only';
  const content = (
    <>
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
        {(selected.kind === 'scalar' || selected.kind === 'column') &&
        selected.access !== 'not-accessible' ? (
          <Button title="Get" small variant="ghost" onPress={() => getFromNode(engine, selected)} />
        ) : null}
        {writable ? (
          <Button title="Set value" small variant="ghost" onPress={() => setFromNode(selected)} />
        ) : null}
        {selected.kind === 'notification' ? (
          <Button
            title="Send this trap"
            small
            variant="ghost"
            onPress={() => void trapFromNode(engine, selected)}
          />
        ) : null}
        <Button
          title="Close"
          small
          variant="ghost"
          onPress={() => useAppStore.getState().setSelected(null)}
        />
      </View>
    </>
  );

  if (embedded) {
    return (
      <View style={[styles.inspector, { backgroundColor: t.bg }]}>
        <View style={[styles.inspectorEyebrow, { borderBottomColor: t.border }]}>
          <Text style={[styles.inspectorEyebrowText, { color: t.textDim }]}>OBJECT INSPECTOR</Text>
          <Text style={[styles.inspectorAccess, { color: writable ? t.warn : t.ok }]}>
            {writable ? 'WRITABLE' : 'READ ONLY'}
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.inspectorContent}>{content}</ScrollView>
      </View>
    );
  }

  return (
    <Card style={styles.detail}>
      <ScrollView>{content}</ScrollView>
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
  navigator: { flex: 1, minWidth: 0, minHeight: 0 },
  focusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  focusMain: { minWidth: 150 },
  focusEyebrow: { fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  focusTitle: { fontSize: 15, fontWeight: '800' },
  dependencyWrap: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  searchWrap: { padding: 12, paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
  tree: { flex: 1 },
  treeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 2,
    minHeight: 44,
  },
  branchTrigger: {
    alignSelf: 'stretch',
    minHeight: 44,
    width: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chevron: { width: 20, alignItems: 'center' },
  disclosureIcon: { fontWeight: '800', lineHeight: 20 },
  nodeTrigger: {
    flex: 1,
    alignSelf: 'stretch',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 12,
  },
  treeText: { flex: 1 },
  treeName: { fontSize: 14 },
  detail: { margin: 12, maxHeight: '45%' },
  inspector: { flex: 1, minWidth: 0, minHeight: 0 },
  inspectorEyebrow: {
    height: 38,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inspectorEyebrowText: { fontSize: 9, fontWeight: '900', letterSpacing: 1.25 },
  inspectorAccess: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  inspectorContent: { padding: 20, paddingBottom: 32 },
  inspectorEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36 },
  inspectorGlyph: { fontSize: 42, marginBottom: 12 },
  inspectorEmptyTitle: { fontSize: 17, fontWeight: '800' },
  inspectorEmptyHint: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 360,
    marginTop: 7,
  },
  detailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  detailName: { fontSize: 16, fontWeight: '700' },
  desc: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  detailActions: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  kv: { flexDirection: 'row', gap: 8, marginTop: 6 },
  kvKey: { fontSize: 12, fontWeight: '700', width: 64 },
  kvVal: { fontSize: 12, flex: 1 },
  lookupEmpty: { padding: 12, gap: 8 },
});
