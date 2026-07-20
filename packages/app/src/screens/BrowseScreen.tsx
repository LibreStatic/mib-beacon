import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  View,
  Pressable,
  FlatList,
  Modal,
  Platform,
  Share,
  ScrollView,
  StyleSheet,
  type TextInput,
} from 'react-native';
import { Button, Card, EmptyState, Field, KindGlyph, Mono, Pill, SectionTitle, Text, useTheme } from '@mibbeacon/ui';
import type { EngineInfo, MibNodeSummary, MibSearchHit } from '@mibbeacon/core/client';
import { useEngine } from '../engine-context';
import { useAppStore } from '../store';
import {
  loadChildren,
  selectNode,
  runSearch,
  openSearchHit,
  walkFromNode,
  getFromNode,
  clearModuleFocus,
  setFromNode,
  trapFromNode,
  prepareNodeOperation,
  openLiveMibScope,
  refreshModules,
} from '../actions';
import { OidLookupPanel } from '../components/OidLookupPanel';
import { SplitWorkspace } from '../components/SplitWorkspace';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { useResponsiveLayout } from '../responsive-context';
import { MibCatalogPane, MibImportModal, MibModuleStrip } from '../components/MibCatalogControls';
import { VerticalDockWorkspace } from '../components/VerticalDockWorkspace';
import { QueryScreen } from './QueryScreen';
import { nodeMetadataRows } from '../node-metadata';
import { highlightSegments } from '../search-highlights';
import { canUseBrowserEventTarget, isSearchFocusShortcut } from '../browser-shortcuts';
import { BROWSE_TITLE } from '../navigation';
import { replaceRouteForTab } from '../routes';
import { flattenVisibleTree, getTreeDisclosureVisual, getTreeRowBackground } from './browse-tree';

export function BrowseScreen({
  info = null,
  unified = false,
  focusSearchRequest = 0,
}: {
  info?: EngineInfo | null;
  unified?: boolean;
  focusSearchRequest?: number;
}) {
  const engine = useEngine();
  const t = useTheme();
  const { mode, width, height, supportsSplitView } = useResponsiveLayout();
  const cache = useAppStore((s) => s.childrenCache);
  const expanded = useAppStore((s) => s.expanded);
  const selected = useAppStore((s) => s.selected);
  const search = useAppStore((s) => s.search);
  const hits = useAppStore((s) => s.hits);
  const searchPhase = useAppStore((s) => s.searchPhase);
  const searchError = useAppStore((s) => s.searchError);
  const moduleFocus = useAppStore((s) => s.moduleFocus);
  const consoleOpen = useAppStore((s) => s.browserConsoleOpen);
  const running = useAppStore((s) => s.running);
  const searchInput = useRef<TextInput>(null);
  const [tabletDrawerOpen, setTabletDrawerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [contextNode, setContextNode] = useState<{ oid: string; name: string } | null>(null);

  const rows = useMemo(() => flattenVisibleTree(cache, expanded), [cache, expanded]);

  const onSearch = (q: string) => {
    const state = useAppStore.getState();
    state.setSearch(q);
    state.setHits([]);
    state.setSearchError(null);
    state.setSearchPhase(q.trim() ? 'debouncing' : 'idle');
  };

  useEffect(() => {
    if (!search.trim()) return;
    const timer = setTimeout(() => void runSearch(engine, search), 250);
    return () => clearTimeout(timer);
  }, [engine, search]);

  useEffect(() => {
    if (typeof window === 'undefined' || !canUseBrowserEventTarget(window)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSearchFocusShortcut(event)) return;
      event.preventDefault();
      searchInput.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (focusSearchRequest > 0) searchInput.current?.focus();
  }, [focusSearchRequest]);

  useEffect(() => setTabletDrawerOpen(false), [selected?.oid]);

  const toggle = (node: MibNodeSummary) => {
    const open = !expanded[node.oid];
    useAppStore.getState().setExpanded(node.oid, open);
    if (open) void loadChildren(engine, node.oid);
  };

  const pickHit = (oid: string) => void openSearchHit(engine, oid);
  const contextProps = (node: { oid: string; name: string }) => ({
    onLongPress: () => setContextNode(node),
    delayLongPress: 420,
    ...(Platform.OS === 'web'
      ? {
          onContextMenu: (event: { preventDefault(): void }) => {
            event.preventDefault();
            setContextNode(node);
          },
        }
      : {}),
  });
  const treeKeyboardProps = (node: MibNodeSummary, isExpanded: boolean) =>
    Platform.OS === 'web'
      ? {
          onKeyDown: (event: { key: string; preventDefault(): void }) => {
            if (event.key === 'ArrowRight' && node.hasChildren && !isExpanded) toggle(node);
            else if (event.key === 'ArrowLeft' && node.hasChildren && isExpanded) toggle(node);
            else if (event.key === 'Enter') void selectNode(engine, node.oid);
            else return;
            event.preventDefault();
          },
        }
      : {};
  const refreshTree = async () => {
    setRefreshing(true);
    try {
      useAppStore.getState().clearChildrenCache();
      await Promise.all([refreshModules(engine), loadChildren(engine, '')]);
    } finally {
      setRefreshing(false);
    }
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
        {unified && mode === 'compact' ? (
          <View style={styles.phoneCatalogActions}>
            <Button
              title="Import MIB"
              small
              variant="ghost"
              onPress={() => useAppStore.getState().setBrowserImportOpen(true)}
            />
          </View>
        ) : null}
        <View style={styles.searchFieldRow}>
          <Field
            ref={searchInput}
            placeholder="Search name, OID, or description…"
            value={search}
            onChangeText={onSearch}
          />
          {searchPhase === 'debouncing' ||
          searchPhase === 'searching' ||
          searchPhase === 'opening' ? (
            <ActivityIndicator color={t.accent} size="small" />
          ) : null}
        </View>
        {searchPhase !== 'idle' ? (
          <Text
            style={[styles.searchStatus, { color: searchPhase === 'error' ? t.error : t.textDim }]}
          >
            {searchPhase === 'debouncing'
              ? 'Waiting for you to finish typing…'
              : searchPhase === 'searching'
                ? 'Searching loaded MIB names, OIDs, and descriptions…'
                : searchPhase === 'opening'
                  ? 'Opening object and revealing its tree location…'
                  : (searchError ?? 'Search failed.')}
          </Text>
        ) : null}
      </View>

      {search.trim() ? (
        <FlatList
          data={hits}
          keyExtractor={(h) => h.oid + h.matched}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            searchPhase !== 'idle' ? null : /^\.?\d+(?:\.\d+)+$/.test(search.trim()) ? (
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
              onPress={() => pickHit(item.oid)}
              {...contextProps(item)}
              disabled={searchPhase === 'opening'}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.name} at ${item.oid}`}
              style={[
                styles.row,
                { borderBottomColor: t.border, opacity: searchPhase === 'opening' ? 0.55 : 1 },
              ]}
            >
              <KindGlyph kind={item.kind} />
              <View style={styles.rowText}>
                <Text style={{ color: t.text, fontWeight: '600' }}>
                  <HighlightedValue hit={item} field="name" value={item.name} />
                </Text>
                <Mono dim size={11}>
                  <HighlightedValue hit={item} field="oid" value={item.oid} />
                </Mono>
              </View>
              {item.module ? <Pill text={item.module} /> : null}
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={rows}
          refreshing={refreshing}
          onRefresh={() => void refreshTree()}
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
                  {...contextProps(node)}
                  {...treeKeyboardProps(node, isExpanded)}
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
      <Modal
        visible={Boolean(contextNode)}
        transparent
        animationType="fade"
        onRequestClose={() => setContextNode(null)}
      >
        <View style={styles.contextBackdrop}>
          <Card style={styles.contextCard}>
            <SectionTitle>{contextNode?.name ?? 'MIB object'}</SectionTitle>
            <Mono numberOfLines={1}>{contextNode?.oid}</Mono>
            <Button
              title="View details"
              onPress={() => {
                if (contextNode) void selectNode(engine, contextNode.oid);
                setContextNode(null);
              }}
            />
            <Button
              title="Walk subtree"
              variant="ghost"
              onPress={() => {
                if (contextNode) void walkFromNode(engine, contextNode.oid);
                setContextNode(null);
              }}
            />
            <Button
              title="Copy / share OID"
              variant="ghost"
              onPress={() => {
                if (contextNode) void Share.share({ message: contextNode.oid });
                setContextNode(null);
              }}
            />
            <Button title="Cancel" variant="ghost" onPress={() => setContextNode(null)} />
          </Card>
        </View>
      </Modal>
    </View>
  );

  const browseHeader = (
    <WorkspaceHeader
      title={BROWSE_TITLE}
      subtitle={
        unified
          ? 'SELECT A MIB · EXPLORE ITS OID TREE · RUN OPERATIONS IN PLACE'
          : 'EXPLORE THE OID TREE · INSPECT DEFINITIONS · LAUNCH OPERATIONS'
      }
      actions={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {mode === 'compact' ? (
            <Button
              title="Live data"
              small
              variant="ghost"
              onPress={() =>
                selected
                  ? openLiveMibScope(selected.oid)
                  : (() => {
                      useAppStore.getState().setTab('liveMibs');
                      replaceRouteForTab('liveMibs');
                    })()
              }
            />
          ) : null}
          {selected?.module ? <Pill text={selected.module} color={t.kind.module} /> : null}
        </View>
      }
    />
  );

  if (!supportsSplitView) {
    return (
      <View style={styles.container}>
        {browseHeader}
        {selected ? <DetailPanel embedded unified={unified} /> : navigator}
        {selected ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open operation controls"
            onPress={() => {
              const state = useAppStore.getState();
              state.setOid(selected.oid);
              state.setOidName(selected.name);
              state.setBrowserConsoleOpen(true);
            }}
            style={[styles.operationFab, { backgroundColor: t.accent }]}
          >
            <Text style={[styles.operationFabText, { color: t.accentText }]}>⇄ Run</Text>
          </Pressable>
        ) : null}
        <Modal
          visible={Boolean(selected && consoleOpen)}
          transparent
          animationType="slide"
          onRequestClose={() => useAppStore.getState().setBrowserConsoleOpen(false)}
        >
          <View style={styles.phoneSheetBackdrop}>
            <View style={[styles.phoneSheet, { backgroundColor: t.bg, borderColor: t.border }]}>
              <View style={[styles.consoleHead, { borderBottomColor: t.border }]}>
                <Text style={[styles.consoleTitle, { color: t.text }]}>Operation controls</Text>
                <Button
                  title="Close"
                  small
                  variant="ghost"
                  onPress={() => useAppStore.getState().setBrowserConsoleOpen(false)}
                />
              </View>
              <QueryScreen info={info} embedded />
            </View>
          </View>
        </Modal>
        {unified ? <MibImportModal /> : null}
      </View>
    );
  }

  const inspector = selected ? (
    <DetailPanel embedded unified={unified} />
  ) : (
    <BrowseInspectorEmpty />
  );
  const navigatorPane =
    unified && mode === 'medium' ? (
      <View style={styles.navigatorWrapper}>
        <MibModuleStrip />
        {navigator}
      </View>
    ) : (
      navigator
    );
  const browserSplit = (
    <SplitWorkspace
      workspace="browse"
      minPrimary={300}
      minSecondary={380}
      primary={navigatorPane}
      secondary={inspector}
    />
  );
  const tabletPortrait = mode === 'medium' && height > width;
  const tabletMain = tabletPortrait ? (
    selected ? (
      <View style={styles.container}>
        <View style={[styles.tabletDrawerBar, { borderBottomColor: t.border }]}>
          <Button
            title="Browse MIB tree"
            small
            variant="ghost"
            onPress={() => setTabletDrawerOpen(true)}
          />
        </View>
        {inspector}
        <Modal
          visible={tabletDrawerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setTabletDrawerOpen(false)}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close MIB tree drawer"
            onPress={() => setTabletDrawerOpen(false)}
            style={styles.tabletDrawerBackdrop}
          >
            <Pressable
              accessible={false}
              onPress={(event) => event.stopPropagation()}
              style={[styles.tabletDrawer, { backgroundColor: t.bg, borderColor: t.border }]}
            >
              {navigatorPane}
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    ) : (
      navigatorPane
    )
  ) : (
    browserSplit
  );
  const browserMain =
    unified && mode === 'expanded' ? (
      <SplitWorkspace
        workspace="mibModules"
        minPrimary={230}
        minSecondary={680}
        primary={<MibCatalogPane />}
        secondary={browserSplit}
      />
    ) : (
      tabletMain
    );
  const console =
    unified && consoleOpen ? (
      <View style={[styles.operationConsole, { backgroundColor: t.bg }]}>
        <View
          style={[styles.consoleHead, { backgroundColor: t.surface, borderBottomColor: t.border }]}
        >
          <View style={styles.consoleTitleRow}>
            <Text style={[styles.consoleTitle, { color: t.text }]}>SNMP operation console</Text>
            {running ? <Pill text="RUNNING" color={t.ok} /> : null}
          </View>
          <Button
            title="Hide console"
            small
            variant="ghost"
            onPress={() => useAppStore.getState().setBrowserConsoleOpen(false)}
          />
        </View>
        <QueryScreen info={info} embedded />
      </View>
    ) : undefined;

  return (
    <View style={styles.container}>
      {browseHeader}
      <VerticalDockWorkspace storageId="mib-navigation" main={browserMain} dock={console} />
      {unified ? <MibImportModal /> : null}
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

function DetailPanel({
  embedded = false,
  unified = false,
}: {
  embedded?: boolean;
  unified?: boolean;
}) {
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
      {nodeMetadataRows(selected).map(({ label, value }) => (
        <KV key={label} k={label} v={value} />
      ))}
      {selected.description ? (
        <Text style={[styles.desc, { color: t.textDim }]}>{selected.description}</Text>
      ) : null}
      <View style={styles.detailActions}>
        <Button
          title="Walk here"
          small
          onPress={() =>
            unified
              ? void prepareNodeOperation(engine, selected, 'walk')
              : walkFromNode(engine, selected.oid)
          }
        />
        {(selected.kind === 'scalar' || selected.kind === 'column') &&
        selected.access !== 'not-accessible' ? (
          <Button
            title="Get"
            small
            variant="ghost"
            onPress={() =>
              unified
                ? void prepareNodeOperation(engine, selected, 'get')
                : getFromNode(engine, selected)
            }
          />
        ) : null}
        {unified ? (
          <Button
            title="Get Next"
            small
            variant="ghost"
            onPress={() => void prepareNodeOperation(engine, selected, 'getNext')}
          />
        ) : null}
        {writable ? (
          <Button
            title="Set value"
            small
            variant="ghost"
            onPress={() =>
              unified
                ? void prepareNodeOperation(engine, selected, 'set', { execute: false })
                : setFromNode(selected)
            }
          />
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

function HighlightedValue({
  hit,
  field,
  value,
}: {
  hit: MibSearchHit;
  field: 'name' | 'oid';
  value: string;
}) {
  const t = useTheme();
  return highlightSegments(value, hit.highlights, field).map((segment, index) => (
    <Text
      key={`${segment.text}-${index}`}
      style={segment.highlighted ? { color: t.accent, fontWeight: '900' } : undefined}
    >
      {segment.text}
    </Text>
  ));
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  navigatorWrapper: { flex: 1, minWidth: 0, minHeight: 0 },
  navigator: { flex: 1, minWidth: 0, minHeight: 0 },
  operationConsole: { flex: 1, minWidth: 0, minHeight: 0 },
  consoleHead: {
    minHeight: 42,
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  consoleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  consoleTitle: { fontSize: 12, fontWeight: '800' },
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
  searchFieldRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchStatus: { fontSize: 10, lineHeight: 14, marginTop: 5 },
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
  phoneCatalogActions: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 8 },
  operationFab: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    minHeight: 48,
    minWidth: 96,
    borderRadius: 8,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
  },
  operationFabText: { fontSize: 14, fontWeight: '800' },
  phoneSheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.46)' },
  phoneSheet: {
    height: '88%',
    borderTopWidth: 1,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    overflow: 'hidden',
  },
  tabletDrawerBar: {
    minHeight: 48,
    borderBottomWidth: 1,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  tabletDrawerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)' },
  tabletDrawer: { width: '82%', maxWidth: 520, height: '100%', borderRightWidth: 1 },
  contextBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.42)',
    padding: 12,
  },
  contextCard: { width: '100%', maxWidth: 520, alignSelf: 'center' },
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
