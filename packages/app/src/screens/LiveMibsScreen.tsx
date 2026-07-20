import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Chip,
  Dialog,
  EmptyState,
  Field,
  Label,
  Mono,
  Pill,
  Row,
  SectionTitle,
  Text,
  ThemedSwitch,
  useTheme,
} from '@mibbeacon/ui';
import { inferWireType, MibBeaconError, validateVarbindInput } from '@mibbeacon/core/client';
import type {
  EngineInfo,
  AgentTarget,
  DecodedVarbind,
  LiveMibScanStatus,
  LiveMibSettings,
  LiveMibWorkflowCandidate,
  LiveMibWorkflowRequest,
  LiveMibWorkflowStatus,
  MibNodeDetail,
  MibNodeSummary,
} from '@mibbeacon/core/client';
import { useEngine } from '../engine-context';
import { useAppStore } from '../store';
import { useResponsiveLayout } from '../responsive-context';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import {
  beginLiveCellWrite,
  DEFAULT_LIVE_MIB_SETTINGS,
  failLiveCellWrite,
  getBooleanEnumValues,
  inferLiveMibEditor,
  markLiveCellUncertain,
  mergeLiveCellRemote,
  resolveLiveMibSettings,
  succeedLiveCellWrite,
  type LiveMibCellState,
} from '../live-mibs-model';
import {
  attachLiveMibMetadata,
  buildLiveMibDocumentGroups,
  liveMibInstanceKey,
  mergeLiveMibRows,
  valueText,
  type LiveMibGridRow,
} from '../live-mibs-grid';
import { useFileImportAdapter } from '../file-import-context';
import { bitIsSelected, mibRangeError, mibSizeError, toggleBitHex } from '../mib-set-editor';
import { refreshAgentProfiles } from '../actions';
import { AgentProfileDialog } from '../components/AgentProfileDialog';
import {
  agentDraftFromEditor,
  EMPTY_AGENT_EDITOR,
  type AgentEditorState,
} from '../agent-profile-form';
import { runLatestLiveMibScanRequest } from '../live-mibs-scan-request';

type TreeCache = Record<string, MibNodeSummary[]>;

interface TreeRow {
  node: MibNodeSummary;
  depth: number;
}

type LiveMibDocumentItem =
  | { kind: 'branch'; id: string; label: string; count: number; depth: number }
  | { kind: 'close'; id: string; depth: number }
  | { kind: 'value'; id: string; depth: number; propertyKey: string; row: LiveMibGridRow };

function flattenTree(cache: TreeCache, expanded: Record<string, boolean>): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (parent: string, depth: number) => {
    for (const node of cache[parent] ?? []) {
      rows.push({ node, depth });
      if (expanded[node.oid]) visit(node.oid, depth + 1);
    }
  };
  visit('', 0);
  return rows;
}

function targetForWorkspace(): AgentTarget | null {
  const state = useAppStore.getState();
  if (state.selectedAgentId) return { agentId: state.selectedAgentId };
  if (!state.agent.host.trim()) return null;
  return {
    agent: {
      host: state.agent.host.trim(),
      port: Number(state.agent.port) || 161,
      transport: state.agent.transport,
      version: state.agent.version,
      timeoutMs: Number(state.agent.timeoutMs) || 5_000,
      retries: Number(state.agent.retries) || 1,
      ...(state.agent.version === 'v3'
        ? {
            v3: {
              user: state.agent.v3.user,
              level: state.agent.v3.level,
              authProtocol: state.agent.v3.authProtocol,
              authKey: state.agent.v3.authKey,
              privProtocol: state.agent.v3.privProtocol,
              privKey: state.agent.v3.privKey,
              context: state.agent.v3.context,
            },
          }
        : { community: state.agent.community }),
    },
  };
}

export function LiveMibsScreen({
  info,
  createProfileRequest,
  onCreateProfileRequestHandled,
}: {
  info: EngineInfo | null;
  createProfileRequest: number;
  onCreateProfileRequestHandled: () => void;
}) {
  const engine = useEngine();
  const t = useTheme();
  const { mode } = useResponsiveLayout();
  const profiles = useAppStore((state) => state.agentProfiles);
  const selectedAgentId = useAppStore((state) => state.selectedAgentId);
  const adHocHost = useAppStore((state) => state.agent.host.trim());
  const requestedScopeOid = useAppStore((state) => state.liveMibScopeOid);
  const [settings, setSettings] = useState<LiveMibSettings>(DEFAULT_LIVE_MIB_SETTINGS);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null | undefined>(undefined);
  const [profileEditor, setProfileEditor] = useState<AgentEditorState>(EMPTY_AGENT_EDITOR);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [treeCache, setTreeCache] = useState<TreeCache>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [scope, setScope] = useState<MibNodeDetail | null>(null);
  const [treeSearch, setTreeSearch] = useState('');
  const [rows, setRows] = useState<Map<string, LiveMibGridRow>>(new Map());
  const [scan, setScan] = useState<LiveMibScanStatus | null>(null);
  const [scanStarting, setScanStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const handleRef = useRef<string | null>(null);
  const scanRequestSequence = useRef(0);
  const startingRequestRef = useRef<number | null>(null);
  const visibleOidsRef = useRef<string[]>([]);
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: { item: LiveMibDocumentItem }[] }) => {
      visibleOidsRef.current = viewableItems
        .flatMap(({ item }) => (item.kind === 'value' ? [item.row.oid] : []))
        .filter(Boolean);
    },
  ).current;

  const openProfileEditor = useCallback(() => {
    setProfileEditor(EMPTY_AGENT_EDITOR);
    setProfileError(null);
    setProfileEditorOpen(true);
  }, []);

  const closeProfileEditor = useCallback(() => {
    if (profileBusy) return;
    setProfileEditorOpen(false);
    setProfileEditor(EMPTY_AGENT_EDITOR);
    setProfileError(null);
  }, [profileBusy]);

  useEffect(() => {
    if (createProfileRequest <= 0) return;
    openProfileEditor();
    onCreateProfileRequestHandled();
  }, [createProfileRequest, onCreateProfileRequestHandled, openProfileEditor]);

  const createProfile = async () => {
    if (profileBusy) return;
    setProfileBusy(true);
    setProfileError(null);
    try {
      const created = await engine.agents.create(agentDraftFromEditor(profileEditor));
      await refreshAgentProfiles(engine);
      useAppStore.getState().selectAgentProfile(created);
      useAppStore.getState().pushToast({ tone: 'success', message: 'Profile created and selected' });
      setProfileEditorOpen(false);
      setProfileEditor(EMPTY_AGENT_EDITOR);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setProfileError(message);
      useAppStore.getState().pushToast({ tone: 'error', message });
    } finally {
      setProfileBusy(false);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    void engine.mibs.tree().then((root) => setTreeCache({ '': root }));
  }, [engine]);

  useEffect(() => {
    if (!requestedScopeOid) return;
    let active = true;
    void engine.mibs.node(requestedScopeOid).then((detail) => {
      if (active && detail) setScope(detail);
    });
    return () => {
      active = false;
    };
  }, [engine, requestedScopeOid]);

  useEffect(() => {
    const previousHandle = handleRef.current;
    handleRef.current = null;
    scanRequestSequence.current += 1;
    startingRequestRef.current = null;
    setScanStarting(false);
    if (previousHandle) void engine.liveMibs.scan.cancel(previousHandle);
    setRows(new Map());
    setScan(null);
    setError(null);
    visibleOidsRef.current = [];
  }, [engine, scope?.oid, selectedAgentId]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      engine.liveMibs.settings.get(),
      selectedAgentId ? engine.liveMibs.agentOverrides.get(selectedAgentId) : Promise.resolve(null),
    ])
      .then(([globalSettings, overrides]) => {
        if (!active) return;
        setSettings(resolveLiveMibSettings(globalSettings, overrides));
        setSettingsAgentId(selectedAgentId);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setSettingsAgentId(undefined);
        setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      active = false;
    };
  }, [engine, selectedAgentId]);

  const hydrateMetadata = useCallback(
    async (batch: DecodedVarbind[]) => {
      await Promise.all(
        batch.map(async ({ oid }) => {
          const resolved = await engine.mibs.resolve(oid);
          if (!resolved) return;
          const detail = await engine.mibs.node(resolved.definitionOid, resolved.module);
          if (detail) setRows((current) => attachLiveMibMetadata(current, oid, detail));
        }),
      );
    },
    [engine],
  );

  useEffect(
    () =>
      engine.events.subscribe('live-mibs', (event) => {
        if (!handleRef.current || event.handleId !== handleRef.current) return;
        if (event.kind === 'batch') {
          const batch = event.payload as DecodedVarbind[];
          setRows((current) => mergeLiveMibRows(current, batch));
          void hydrateMetadata(batch);
        } else if (
          ['started', 'progress', 'done', 'partial', 'error', 'cancelled'].includes(event.kind)
        ) {
          setScan(event.payload as LiveMibScanStatus);
        }
      }),
    [engine, hydrateMetadata],
  );

  // Reconcile authoritative terminal state if a reconnect drops a progress or
  // completion event. Row batches remain event-driven.
  useEffect(() => {
    if (!scan || !['started', 'running'].includes(scan.state)) return;
    const timer = setInterval(() => {
      const handleId = handleRef.current;
      if (!handleId) return;
      void engine.liveMibs.scan.status(handleId).then((status) => {
        if (!status || status.handleId !== handleId || handleRef.current !== handleId) return;
        setScan(status);
      });
    }, 500);
    return () => clearInterval(timer);
  }, [engine, scan]);

  const startScan = useCallback(async () => {
    if (startingRequestRef.current !== null) return;
    if (settingsAgentId !== selectedAgentId) {
      setError('Loading settings for the selected agent.');
      return;
    }
    const target = targetForWorkspace();
    if (!target) {
      setError('Choose a saved agent or enter an ad-hoc target in Query first.');
      return;
    }
    if (!scope) {
      setError('Choose a MIB subtree, scalar, table, entry, or column first.');
      return;
    }
    const requestId = scanRequestSequence.current + 1;
    scanRequestSequence.current = requestId;
    startingRequestRef.current = requestId;
    setScanStarting(true);
    const previousHandle = handleRef.current;
    handleRef.current = null;
    setError(null);
    try {
      if (previousHandle) await engine.liveMibs.scan.cancel(previousHandle);
      if (scanRequestSequence.current !== requestId) return;
      await runLatestLiveMibScanRequest<LiveMibScanStatus>({
        requestId,
        isCurrent: (candidate) => scanRequestSequence.current === candidate,
        currentHandle: () => handleRef.current,
        start: () =>
          engine.liveMibs.scan.start({
            ...target,
            scopeOid: scope.oid,
            concurrency: settings.scanConcurrency,
            includeReadOnly: settings.showReadOnly,
            maxInstances: settings.maxInstances,
            preferredOids:
              settings.refreshMode === 'adaptive' ? visibleOidsRef.current : undefined,
          }),
        status: (handleId) => engine.liveMibs.scan.status(handleId),
        cancel: (handleId) => engine.liveMibs.scan.cancel(handleId),
        acceptHandle: (handleId) => {
          handleRef.current = handleId;
        },
        acceptStatus: setScan,
      });
    } catch (cause) {
      if (scanRequestSequence.current === requestId)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (startingRequestRef.current === requestId) {
        startingRequestRef.current = null;
        setScanStarting(false);
      }
    }
  }, [engine, scope, selectedAgentId, settings, settingsAgentId]);

  useEffect(() => {
    if (!scope || settingsAgentId !== selectedAgentId || settings.refreshMode === 'manual') return;
    void startScan();
    const timer = setInterval(() => {
      if (
        settings.pauseWhenHidden &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      )
        return;
      if (!handleRef.current || !['started', 'running'].includes(scan?.state ?? 'done'))
        void startScan();
    }, settings.refreshIntervalMs);
    return () => clearInterval(timer);
  }, [
    scope,
    settingsAgentId,
    selectedAgentId,
    settings.refreshMode,
    settings.refreshIntervalMs,
    settings.pauseWhenHidden,
    startScan,
    scan?.state,
  ]);

  useEffect(
    () => () => {
      if (handleRef.current) void engine.liveMibs.scan.cancel(handleRef.current);
    },
    [engine],
  );

  const treeRows = useMemo(() => {
    const all = flattenTree(treeCache, expanded);
    const query = treeSearch.trim().toLowerCase();
    return query
      ? all.filter(
          ({ node }) => node.name.toLowerCase().includes(query) || node.oid.includes(query),
        )
      : all;
  }, [expanded, treeCache, treeSearch]);
  const dataRows = useMemo(
    () =>
      [...rows.values()].sort((left, right) =>
        left.oid.localeCompare(right.oid, undefined, { numeric: true }),
      ),
    [rows],
  );
  const busy = scan?.state === 'started' || scan?.state === 'running';
  const resultsIncomplete =
    !!scan &&
    ['done', 'partial'].includes(scan.state) &&
    scan.count > dataRows.length;

  const toggleTreeNode = async (node: MibNodeSummary) => {
    if (node.hasChildren) {
      const opening = !expanded[node.oid];
      setExpanded((current) => ({ ...current, [node.oid]: opening }));
      if (opening && !treeCache[node.oid]) {
        const children = await engine.mibs.tree(node.oid);
        setTreeCache((current) => ({ ...current, [node.oid]: children }));
      }
    }
    const detail = await engine.mibs.node(node.oid, node.module);
    if (detail) setScope(detail);
  };

  const treePane = (
    <View
      style={[
        styles.treePane,
        mode === 'compact' ? styles.compactTreePane : null,
        { borderColor: t.border, backgroundColor: t.surface },
      ]}
    >
      <View style={styles.paneHeader}>
        <SectionTitle>MIB scope</SectionTitle>
        <Label tone="dim" size={10}>
          {treeRows.length} visible nodes
        </Label>
      </View>
      <Field
        label="Filter loaded tree"
        value={treeSearch}
        onChangeText={setTreeSearch}
        placeholder="Name or OID"
      />
      <FlatList
        data={treeRows}
        nestedScrollEnabled={mode === 'compact'}
        keyExtractor={({ node }) => `${node.module ?? ''}:${node.oid}`}
        renderItem={({ item: { node, depth } }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: scope?.oid === node.oid }}
            onPress={() => void toggleTreeNode(node)}
            style={({ pressed }) => [
              styles.treeRow,
              {
                paddingLeft: 10 + depth * 14,
                backgroundColor:
                  scope?.oid === node.oid ? t.accentSoft : pressed ? t.surfaceAlt : 'transparent',
              },
            ]}
          >
            <Text style={{ color: node.hasChildren ? t.accent : t.textDim, width: 16 }}>
              {node.hasChildren ? (expanded[node.oid] ? '⌄' : '›') : '·'}
            </Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: t.text, fontSize: 12 }} numberOfLines={1}>
                {node.name}
              </Text>
              <Mono size={9}>{node.oid}</Mono>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <EmptyState title="No MIB nodes" hint="Import or load a MIB in Browse." />
        }
      />
    </View>
  );

  const gridPane = (
    <View
      style={[
        styles.gridPane,
        mode === 'compact' ? styles.compactGridPane : null,
        { borderColor: t.border, backgroundColor: t.bg },
      ]}
    >
      <View style={[styles.gridToolbar, { borderBottomColor: t.border }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <SectionTitle>{scope ? scope.name : 'Live values'}</SectionTitle>
          <Label tone="dim" size={10}>
            {scope
              ? `${scope.oid} · ${dataRows.length} values · ${settings.scanConcurrency} scan ${settings.scanConcurrency === 1 ? 'worker' : 'workers'}`
              : 'Choose a scope from the tree'}
          </Label>
        </View>
        <Row style={styles.wrap}>
          <Pill
            text={(resultsIncomplete ? 'incomplete' : (scan?.state ?? 'idle')).toUpperCase()}
            color={
              scan?.state === 'error'
                ? t.error
                : resultsIncomplete
                  ? t.warn
                  : scan?.state === 'done'
                  ? t.ok
                  : busy
                    ? t.warn
                    : t.textDim
            }
          />
          <Button
            title={scanStarting ? 'Starting…' : busy ? 'Stop' : 'Refresh'}
            small
            disabled={scanStarting || settingsAgentId !== selectedAgentId}
            onPress={() =>
              busy && handleRef.current
                ? void engine.liveMibs.scan.cancel(handleRef.current)
                : void startScan()
            }
          />
        </Row>
      </View>
      {error ? (
        <View style={[styles.message, { backgroundColor: t.errorSoft }]}>
          <Label tone="error">{error}</Label>
        </View>
      ) : null}
      {scan?.errors.length ? (
        <View style={[styles.message, { backgroundColor: t.surfaceAlt }]}>
          <Label tone="warn">
            {scan.errors.length} scan task{scan.errors.length === 1 ? '' : 's'} failed. Successful
            values remain available.
          </Label>
        </View>
      ) : null}
      {resultsIncomplete ? (
        <View style={[styles.message, { backgroundColor: t.surfaceAlt }]}>
          <Label tone="warn">
            The connection missed {scan.count - dataRows.length} streamed value
            {scan.count - dataRows.length === 1 ? '' : 's'}. Refresh this scope to reconcile it.
          </Label>
        </View>
      ) : null}
      {busy && dataRows.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator color={t.accent} />
          <Label tone="dim">Scanning {scope?.name ?? 'scope'}…</Label>
        </View>
      ) : null}
      <LiveMibDocumentTree
        rows={dataRows}
        settings={settings}
        target={targetForWorkspace()}
        now={now}
        nestedScrollEnabled={mode === 'compact'}
        busy={busy}
        hasScope={!!scope}
        onViewableItemsChanged={onViewableItemsChanged}
      />
    </View>
  );

  return (
    <View style={styles.screen}>
      <WorkspaceHeader
        title="Live MIBs"
        subtitle="TREE-SCOPED · STREAMING · TYPE-AWARE · TRANSACTIONAL"
        actions={
          <Pill
            text={
              profiles.find(({ id }) => id === selectedAgentId)?.name ??
              (adHocHost ? 'AD HOC' : 'NO TARGET')
            }
            color={selectedAgentId || adHocHost ? t.ok : t.textDim}
          />
        }
      />
      <View style={[styles.agentBar, { borderBottomColor: t.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.agentStrip}
          contentContainerStyle={styles.agentStripContent}
        >
          {adHocHost ? (
            <Chip
              label="Ad hoc"
              active={!selectedAgentId}
              onPress={() => useAppStore.getState().selectAgentProfile(null)}
            />
          ) : null}
          {profiles.length === 0 && !adHocHost ? (
            <Label tone="dim" size={11}>
              No target configured. Create a saved agent here to start scanning.
            </Label>
          ) : null}
          {profiles.map((profile) => (
            <Chip
              key={profile.id}
              label={profile.name}
              active={selectedAgentId === profile.id}
              onPress={() => useAppStore.getState().selectAgentProfile(profile)}
            />
          ))}
        </ScrollView>
        <Button title="New profile" small variant="ghost" onPress={openProfileEditor} />
      </View>
      <View style={[styles.workspace, mode === 'compact' ? styles.compactWorkspace : null]}>
        {treePane}
        {gridPane}
      </View>
      <AgentProfileDialog
        visible={profileEditorOpen}
        editor={profileEditor}
        error={profileError}
        info={info}
        busy={profileBusy}
        title="Create Live MIB agent"
        subtitle="Save the target once, then switch agents from the Live MIB bar."
        submitTitle="Create and select"
        onEditorChange={setProfileEditor}
        onSubmit={() => void createProfile()}
        onClose={closeProfileEditor}
      />
    </View>
  );
}

function LiveMibDocumentTree({
  rows,
  settings,
  target,
  now,
  nestedScrollEnabled,
  busy,
  hasScope,
  onViewableItemsChanged,
}: {
  rows: LiveMibGridRow[];
  settings: LiveMibSettings;
  target: AgentTarget | null;
  now: number;
  nestedScrollEnabled: boolean;
  busy: boolean;
  hasScope: boolean;
  onViewableItemsChanged: ({
    viewableItems,
  }: {
    viewableItems: { item: LiveMibDocumentItem }[];
  }) => void;
}) {
  const t = useTheme();
  const [branchOverrides, setBranchOverrides] = useState<Map<string, boolean>>(() => new Map());
  const [cellStates, setCellStates] = useState<Map<string, LiveMibCellState>>(() => new Map());
  const requestSequences = useRef<Map<string, number>>(new Map());
  const updateCell = useCallback(
    (
      oid: string,
      initialValue: string,
      updater: (current: LiveMibCellState) => LiveMibCellState,
    ) =>
      setCellStates((current) => {
        const next = new Map(current);
        const previous = next.get(oid) ?? {
          confirmedValue: initialValue,
          draftValue: initialValue,
          phase: 'fresh',
          requestId: 0,
        };
        next.set(oid, updater(previous));
        return next;
      }),
    [],
  );
  const allocateRequestId = useCallback((oid: string) => {
    const requestId = (requestSequences.current.get(oid) ?? 0) + 1;
    requestSequences.current.set(oid, requestId);
    return requestId;
  }, []);
  const isCollapsed = useCallback(
    (id: string, depth: number, count: number) =>
      branchOverrides.get(id) ??
      (depth === 1 && count > settings.documentAutoCollapseThreshold),
    [branchOverrides, settings.documentAutoCollapseThreshold],
  );
  const items = useMemo(() => {
    const result: LiveMibDocumentItem[] = [];
    for (const module of buildLiveMibDocumentGroups(rows)) {
      result.push({
        kind: 'branch',
        id: module.id,
        label: module.name,
        count: module.objects.reduce((count, object) => count + object.rows.length, 0),
        depth: 0,
      });
      if (!isCollapsed(module.id, 0, module.objects.length)) {
        for (const object of module.objects) {
          result.push({
            kind: 'branch',
            id: object.id,
            label: object.name,
            count: object.rows.length,
            depth: 1,
          });
          if (!isCollapsed(object.id, 1, object.rows.length)) {
            for (const row of object.rows)
              result.push({
                kind: 'value',
                id: row.oid,
                depth: 2,
                propertyKey: liveMibInstanceKey(row),
                row,
              });
          }
          result.push({ kind: 'close', id: `${object.id}:close`, depth: 1 });
        }
      }
      result.push({ kind: 'close', id: `${module.id}:close`, depth: 0 });
    }
    return result;
  }, [isCollapsed, rows]);

  const toggle = (item: Extract<LiveMibDocumentItem, { kind: 'branch' }>) =>
    setBranchOverrides((current) => {
      const next = new Map(current);
      const currentValue =
        current.get(item.id) ??
        (item.depth === 1 && item.count > settings.documentAutoCollapseThreshold);
      next.set(item.id, !currentValue);
      return next;
    });

  return (
    <FlatList
      data={items}
      nestedScrollEnabled={nestedScrollEnabled}
      keyExtractor={({ id }) => id}
      contentContainerStyle={styles.documentTree}
      onViewableItemsChanged={onViewableItemsChanged}
      renderItem={({ item }) => {
        if (item.kind === 'branch') {
          const branchIsCollapsed = isCollapsed(item.id, item.depth, item.count);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: !branchIsCollapsed }}
              accessibilityLabel={`${branchIsCollapsed ? 'Expand' : 'Collapse'} ${item.label}, ${item.count} values`}
              onPress={() => toggle(item)}
              style={({ pressed }) => [
                styles.documentBranch,
                { marginLeft: item.depth * 18, backgroundColor: pressed ? t.surfaceAlt : undefined },
              ]}
            >
              <Text style={{ color: t.accent }}>{branchIsCollapsed ? '›' : '⌄'}</Text>
              <Text style={[styles.documentSyntax, { color: t.accent }]}>
                &quot;{item.label}&quot;
              </Text>
              <Text style={{ color: t.text }}>:{' {'}</Text>
              <Label tone="dim" size={9}>
                {item.count}
              </Label>
            </Pressable>
          );
        }
        if (item.kind === 'close')
          return (
            <Text
              style={[
                styles.documentSyntax,
                { marginLeft: item.depth * 18, color: t.textDim },
              ]}
            >
              {'}'}
            </Text>
          );
        return (
          <LiveMibRow
            row={item.row}
            propertyKey={item.propertyKey}
            depth={item.depth}
            cell={
              cellStates.get(item.row.oid) ?? {
                confirmedValue: String(item.row.value.value),
                draftValue: String(item.row.value.value),
                phase: 'fresh',
                requestId: 0,
              }
            }
            updateCell={updateCell}
            allocateRequestId={allocateRequestId}
            settings={settings}
            target={target}
            stale={now - item.row.updatedAt >= settings.staleAfterMs}
          />
        );
      }}
      ListEmptyComponent={
        !busy ? (
          <EmptyState
            title={hasScope ? 'No values loaded' : 'Choose a MIB scope'}
            hint={
              hasScope
                ? 'Refresh the scope or enable read-only objects in Settings.'
                : 'The selected subtree becomes a live, editable document tree.'
            }
          />
        ) : null
      }
    />
  );
}

function LiveMibRow({
  row,
  propertyKey,
  depth,
  cell,
  updateCell,
  allocateRequestId,
  settings,
  target,
  stale = false,
}: {
  row: LiveMibGridRow;
  propertyKey: string;
  depth: number;
  cell: LiveMibCellState;
  updateCell: (
    oid: string,
    initialValue: string,
    updater: (current: LiveMibCellState) => LiveMibCellState,
  ) => void;
  allocateRequestId: (oid: string) => number;
  settings: LiveMibSettings;
  target: AgentTarget | null;
  stale?: boolean;
}) {
  const engine = useEngine();
  const adapter = useFileImportAdapter();
  const t = useTheme();
  const confirmed = String(row.value.value);
  const confirmedDisplay = valueText(row.value, settings.preferFormattedValues);
  const setCell = useCallback(
    (updater: (current: LiveMibCellState) => LiveMibCellState) =>
      updateCell(row.oid, confirmed, updater),
    [confirmed, row.oid, updateCell],
  );
  const nextRequestId = useCallback(
    () => allocateRequestId(row.oid),
    [allocateRequestId, row.oid],
  );
  const [workflow, setWorkflow] = useState<LiveMibWorkflowStatus | null>(null);
  const [workflowCandidates, setWorkflowCandidates] = useState<LiveMibWorkflowCandidate[]>([]);
  const [workflowSetupOpen, setWorkflowSetupOpen] = useState(false);
  const [workflowAdapter, setWorkflowAdapter] =
    useState<LiveMibWorkflowCandidate['id']>('direct-binary');
  const [blockOid, setBlockOid] = useState(row.oid);
  const [chunkSize, setChunkSize] = useState('512');
  const [controlVarbinds, setControlVarbinds] = useState('[]');
  const [tftpBindAddress, setTftpBindAddress] = useState('0.0.0.0');
  const [tftpPort, setTftpPort] = useState('69');
  const writable = /read-write|read-create|write-only/i.test(row.metadata?.access ?? '');
  const editor = inferLiveMibEditor(row.metadata ?? {});
  const presentedEditor =
    editor === 'boolean' && settings.booleanEditor === 'select' ? 'select' : editor;
  const booleanValues = row.metadata?.enumValues
    ? getBooleanEnumValues(row.metadata.enumValues)
    : null;
  const editorLabel = `Edit ${row.metadata?.name ?? row.value.name ?? row.oid} instance ${propertyKey}`;
  const validationError =
    mibRangeError(row.metadata, cell.draftValue) ??
    mibSizeError(row.metadata, cell.draftValue) ??
    validateVarbindInput({
      oid: row.oid,
      type: inferWireType(row.metadata?.syntax),
      value: cell.draftValue,
    });

  useEffect(() => {
    let active = true;
    void engine.liveMibs.workflows
      .detect({
        syntax: row.metadata?.syntax,
        textualConventionChain: row.metadata?.textualConventionChain,
        module: row.metadata?.module,
        name: row.metadata?.name ?? row.value.name ?? row.oid,
      })
      .then((candidates) => {
        if (!active) return;
        setWorkflowCandidates(candidates);
        if (candidates[0]) setWorkflowAdapter(candidates[0].id);
      });
    return () => {
      active = false;
    };
  }, [engine, row.metadata, row.oid, row.value.name]);

  useEffect(() => {
    setCell((current) => mergeLiveCellRemote(current, confirmed));
  }, [confirmed, setCell]);

  const submit = useCallback(
    async (draftOverride?: string) => {
      if (!target || !writable || cell.phase === 'updating') return;
      const submittedValue = draftOverride ?? cell.draftValue;
      const submittedError =
        mibRangeError(row.metadata, submittedValue) ??
        mibSizeError(row.metadata, submittedValue) ??
        validateVarbindInput({
          oid: row.oid,
          type: inferWireType(row.metadata?.syntax),
          value: submittedValue,
        });
      if (submittedError) {
        setCell((current) => ({ ...current, phase: 'dirty', error: submittedError }));
        return;
      }
      const requestId = nextRequestId();
      setCell((current) => beginLiveCellWrite(current, requestId));
      try {
        const result = await engine.liveMibs.writeCell({
          ...target,
          varbind: {
            oid: row.oid,
            type: inferWireType(row.metadata?.syntax),
            value: submittedValue,
          },
          verify: settings.verifyWrites,
        });
        setCell((current) =>
          succeedLiveCellWrite(current, requestId, String(result.value.value)),
        );
      } catch (cause) {
        if (cause instanceof MibBeaconError && cause.code === 'TIMEOUT') {
          setCell((current) => markLiveCellUncertain(current, requestId, cause.message));
          try {
            const [reconciled] = await engine.ops.get({ ...target, oids: [row.oid] });
            if (reconciled && String(reconciled.value) === submittedValue) {
              setCell((current) => succeedLiveCellWrite(current, requestId, submittedValue));
            } else {
              setCell((current) =>
                failLiveCellWrite(
                  current,
                  requestId,
                  'The Set timed out and the device retained its previous value.',
                ),
              );
            }
          } catch {
            setCell((current) =>
              markLiveCellUncertain(
                current,
                requestId,
                'The Set timed out and the device value could not be reconciled.',
              ),
            );
          }
          return;
        }
        setCell((current) =>
          failLiveCellWrite(
            current,
            requestId,
            cause instanceof Error ? cause.message : String(cause),
          ),
        );
      }
    },
    [cell.draftValue, cell.phase, engine, nextRequestId, row, setCell, settings, target, writable],
  );

  useEffect(() => {
    if (settings.writeMode !== 'change' || cell.phase !== 'dirty') return;
    const timer = setTimeout(() => void submit(), settings.writeDebounceMs);
    return () => clearTimeout(timer);
  }, [cell.draftValue, cell.phase, settings.writeDebounceMs, settings.writeMode, submit]);

  const change = (draftValue: string) =>
    setCell((current) => ({ ...current, draftValue, phase: 'dirty', error: undefined }));
  const requestCommit = (draftOverride?: string) => {
    if (settings.writeMode === 'confirm') {
      setCell((current) => ({ ...current, phase: 'awaiting-confirmation' }));
    } else void submit(draftOverride);
  };

  const uploadBinary = async () => {
    if (!target) return;
    const acquired = await adapter.acquireFiles();
    if (acquired.status !== 'selected' || !acquired.files[0]) return;
    const file = acquired.files[0];
    let stagedId: string | null = null;
    try {
      if (
        row.metadata?.sizeRanges?.length &&
        !row.metadata.sizeRanges.some(
          ({ min, max }) => file.bytes.length >= min && file.bytes.length <= max,
        )
      )
        throw new Error(
          `File must satisfy the MIB size ${row.metadata.sizeRanges
            .map(({ min, max }) => `${min}..${max} bytes`)
            .join(' or ')}.`,
        );
      const staged = await engine.liveMibs.uploads.create({
        name: file.name,
        byteLength: file.bytes.length,
        agentId: useAppStore.getState().selectedAgentId ?? undefined,
      });
      stagedId = staged.id;
      for (let offset = 0; offset < file.bytes.length; offset += 64 * 1024) {
        const chunk = file.bytes.slice(offset, offset + 64 * 1024);
        await engine.liveMibs.uploads.append(staged.id, offset, bytesToBase64(chunk));
      }
      await engine.liveMibs.uploads.complete(staged.id);
      let workflowRequest: LiveMibWorkflowRequest;
      if (workflowAdapter === 'direct-binary') {
        workflowRequest = {
          ...target,
          adapterId: workflowAdapter,
          uploadId: staged.id,
          direct: {
            oid: row.oid,
            type: inferWireType(row.metadata?.syntax) === 'Opaque' ? 'Opaque' : 'OctetString',
          },
        };
      } else if (workflowAdapter === 'timed-block-stream') {
        workflowRequest = {
          ...target,
          adapterId: workflowAdapter,
          uploadId: staged.id,
          block: {
            blockOid,
            chunkSize: Number(chunkSize) || 512,
            type: inferWireType(row.metadata?.syntax) === 'Opaque' ? 'Opaque' : 'OctetString',
            eof: 'empty',
          },
        };
      } else {
        const parsed = JSON.parse(controlVarbinds) as LiveMibWorkflowRequest['controlVarbinds'];
        if (!Array.isArray(parsed) || parsed.length === 0)
          throw new Error('Cisco transfer control requires at least one control varbind.');
        workflowRequest = {
          ...target,
          adapterId: workflowAdapter,
          uploadId: staged.id,
          controlVarbinds: parsed,
          managedTransfer: {
            bindAddress: tftpBindAddress.trim() || '0.0.0.0',
            port: Number(tftpPort) || 69,
          },
        };
      }
      setWorkflowSetupOpen(false);
      const { handleId } = await engine.liveMibs.workflows.start(workflowRequest);
      let status = await engine.liveMibs.workflows.status(handleId);
      while (status && !['done', 'error', 'cancelled'].includes(status.state)) {
        setWorkflow(status);
        await new Promise((resolve) => setTimeout(resolve, 100));
        status = await engine.liveMibs.workflows.status(handleId);
      }
      setWorkflow(status);
      if (status?.state === 'done') setCell((current) => ({ ...current, phase: 'success' }));
      else if (status?.message)
        setCell((current) =>
          failLiveCellWrite(current, current.requestId, status?.message ?? 'File workflow failed'),
        );
    } catch (cause) {
      setCell((current) =>
        failLiveCellWrite(
          current,
          current.requestId,
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
    } finally {
      if (stagedId) await engine.liveMibs.uploads.dispose(stagedId).catch(() => undefined);
    }
  };

  const useRemoteValue = () => {
    if (cell.remoteValue === undefined) return;
    setCell((current) => ({
      confirmedValue: current.remoteValue!,
      draftValue: current.remoteValue!,
      phase: 'fresh',
      requestId: current.requestId,
    }));
  };

  return (
    <View
      style={[
        styles.documentValue,
        { marginLeft: depth * 18, borderBottomColor: t.border, backgroundColor: t.surface },
      ]}
    >
      <View style={styles.documentValueHeader}>
        <Row style={styles.wrap}>
          <Text style={[styles.documentSyntax, { color: t.accent }]}>
            &quot;{propertyKey}&quot;
          </Text>
          <Text style={{ color: t.text }}>:</Text>
          <Pill
            text={(row.metadata?.access ?? 'unknown').toUpperCase()}
            color={writable ? t.ok : t.textDim}
          />
          <Pill
            text={(stale && cell.phase === 'fresh' ? 'stale' : cell.phase)
              .replace('-', ' ')
              .toUpperCase()}
            color={
              cell.phase === 'error-reverted' || cell.phase === 'conflict'
                ? t.error
                : cell.phase === 'success'
                  ? t.ok
                  : cell.phase === 'updating'
                    ? t.warn
                    : t.textDim
            }
          />
        </Row>
        <Mono size={9}>{row.oid}</Mono>
        <Label tone="dim" size={9}>
          {row.metadata?.syntax ?? row.value.typeName} · updated{' '}
          {new Date(row.updatedAt).toLocaleTimeString()}
        </Label>
      </View>
      <View style={styles.valueEditor}>
        {!writable ? (
          <View style={[styles.readOnlyValue, { backgroundColor: t.surfaceAlt }]}>
            <Text style={{ color: t.text }}>{confirmedDisplay}</Text>
          </View>
        ) : presentedEditor === 'boolean' && row.metadata?.enumValues ? (
          <Row style={styles.booleanEditor}>
            <ThemedSwitch
              accessibilityLabel={editorLabel}
              value={booleanValues ? cell.draftValue === booleanValues.on : false}
              onValueChange={(enabled) => {
                if (!booleanValues) return;
                const value = enabled ? booleanValues.on : booleanValues.off;
                change(value);
              }}
              disabled={cell.phase === 'updating'}
            />
            <Label>{cell.draftValue}</Label>
          </Row>
        ) : presentedEditor === 'select' && row.metadata?.enumValues ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Row>
              {Object.entries(row.metadata.enumValues).map(([label, value]) => (
                <Chip
                  key={label}
                  label={`${label} (${value})`}
                  active={cell.draftValue === String(value)}
                  onPress={() => {
                    change(String(value));
                  }}
                />
              ))}
            </Row>
          </ScrollView>
        ) : presentedEditor === 'bits' && row.metadata?.enumValues ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Row>
              {Object.entries(row.metadata.enumValues).map(([label, position]) => (
                <Chip
                  key={label}
                  label={label}
                  active={bitIsSelected(cell.draftValue, position)}
                  onPress={() => change(toggleBitHex(cell.draftValue, position))}
                />
              ))}
            </Row>
          </ScrollView>
        ) : (
          <Field
            accessibilityLabel={editorLabel}
            label={
              editor === 'number'
                ? 'Numeric value'
                : editor === 'ip'
                  ? 'IP address'
                  : editor === 'oid'
                    ? 'Object identifier'
                    : 'Value'
            }
            value={cell.draftValue}
            onChangeText={change}
            placeholder={
              editor === 'ip' ? '192.0.2.1' : editor === 'oid' ? '1.3.6.1.4.1…' : undefined
            }
            onBlur={() => {
              if (settings.writeMode === 'blur' && cell.phase === 'dirty') requestCommit();
            }}
            editable={cell.phase !== 'updating'}
          />
        )}
        <Row style={styles.wrap}>
          {settings.writeMode !== 'change' && cell.phase === 'dirty' ? (
            <Button
              title={settings.writeMode === 'confirm' ? 'Apply' : 'Save'}
              small
              onPress={requestCommit}
            />
          ) : null}
          {cell.phase === 'conflict' ? (
            <>
              <Button title="Use device" small variant="ghost" onPress={useRemoteValue} />
              <Button title="Reapply draft" small onPress={() => requestCommit()} />
            </>
          ) : null}
          {editor === 'binary' || workflowCandidates.length > 0 ? (
            <Button
              title={workflow ? `${workflow.sentBytes}/${workflow.totalBytes} B` : 'File workflow'}
              small
              variant="ghost"
              onPress={() => setWorkflowSetupOpen(true)}
            />
          ) : null}
        </Row>
        {cell.error ? (
          <Label tone="error" size={10}>
            {cell.error} Previous value restored.
          </Label>
        ) : null}
        {!cell.error && validationError ? (
          <Label tone="error" size={10}>
            {validationError}
          </Label>
        ) : null}
      </View>
      <Dialog
        visible={cell.phase === 'awaiting-confirmation'}
        title={`Apply ${row.metadata?.name ?? row.oid}?`}
        subtitle="The device will receive an SNMP Set immediately after confirmation."
        onRequestClose={() => {
          setCell((current) => ({ ...current, phase: 'dirty' }));
        }}
        footer={
          <Row style={styles.dialogActions}>
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => {
                setCell((current) => ({ ...current, phase: 'dirty' }));
              }}
            />
            <Button title="Apply Set" onPress={() => void submit()} />
          </Row>
        }
      >
        <Label tone="dim">Confirmed value</Label>
        <Mono>{cell.confirmedValue}</Mono>
        <Label tone="dim">New value</Label>
        <Mono>{cell.draftValue}</Mono>
      </Dialog>
      <Dialog
        visible={workflowSetupOpen}
        title={`File workflow · ${row.metadata?.name ?? row.oid}`}
        subtitle="The file is staged privately, size-checked, and disposed after success or failure."
        onRequestClose={() => setWorkflowSetupOpen(false)}
        footer={
          <Row style={styles.dialogActions}>
            <Button title="Cancel" variant="ghost" onPress={() => setWorkflowSetupOpen(false)} />
            <Button title="Choose file & start" onPress={() => void uploadBinary()} />
          </Row>
        }
      >
        <ScrollView style={styles.workflowDialog}>
          <Label tone="dim">Adapter</Label>
          <Row style={styles.wrap}>
            {workflowCandidates.map((candidate) => (
              <Chip
                key={candidate.id}
                label={candidate.name}
                active={workflowAdapter === candidate.id}
                onPress={() => setWorkflowAdapter(candidate.id)}
              />
            ))}
          </Row>
          {workflowAdapter === 'timed-block-stream' ? (
            <>
              <Field label="Block OID" value={blockOid} onChangeText={setBlockOid} />
              <Field label="Chunk bytes" value={chunkSize} onChangeText={setChunkSize} />
              <Label tone="warn" size={10}>
                Vendor credential/start/finish sequences require an explicit adapter mapping.
              </Label>
            </>
          ) : null}
          {workflowAdapter === 'cisco-transfer-control' ? (
            <>
              <Field
                label="TFTP bind address"
                value={tftpBindAddress}
                onChangeText={setTftpBindAddress}
              />
              <Field label="TFTP port" value={tftpPort} onChangeText={setTftpPort} />
              <Field
                label="Control varbinds JSON"
                value={controlVarbinds}
                onChangeText={setControlVarbinds}
                placeholder='[{"oid":"…","type":"Integer","value":"4"}]'
              />
              <Label tone="warn" size={10}>
                Use the loaded Cisco MIB row index and include protocol, server address, file name,
                and RowStatus control objects. Managed transfers must be enabled in Settings.
              </Label>
            </>
          ) : null}
        </ScrollView>
      </Dialog>
    </View>
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    const value = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    result += alphabet[(value >> 18) & 63];
    result += alphabet[(value >> 12) & 63];
    result += b === undefined ? '=' : alphabet[(value >> 6) & 63];
    result += c === undefined ? '=' : alphabet[value & 63];
  }
  return result;
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0 },
  agentBar: {
    width: '100%',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderBottomWidth: 1,
    paddingRight: 12,
  },
  agentStrip: { flex: 1, flexBasis: 0, minWidth: 0 },
  agentStripContent: {
    paddingLeft: 12,
    paddingVertical: 7,
    gap: 6,
    alignItems: 'center',
  },
  workspace: { flex: 1, minHeight: 0, flexDirection: 'row', gap: 8, padding: 8 },
  compactWorkspace: { flexDirection: 'column' },
  treePane: { width: 300, minHeight: 180, borderWidth: 1, borderRadius: 10, padding: 8, gap: 8 },
  compactTreePane: { width: '100%', height: 180, minHeight: 0, flexShrink: 0 },
  paneHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  treeRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 6 },
  gridPane: {
    flex: 1,
    minWidth: 0,
    minHeight: 240,
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  compactGridPane: { flex: 1, minHeight: 0 },
  gridToolbar: {
    minHeight: 58,
    padding: 10,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  documentTree: { padding: 8, gap: 2 },
  documentBranch: {
    minHeight: 32,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 5,
  },
  documentSyntax: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700' },
  documentValue: { borderBottomWidth: 1, padding: 8, gap: 7 },
  documentValueHeader: { gap: 3 },
  loading: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  message: { margin: 8, padding: 8, borderRadius: 8 },
  workflowDialog: { maxHeight: 420 },
  valueEditor: { minWidth: 0, gap: 6 },
  readOnlyValue: { minHeight: 40, borderRadius: 7, padding: 10, justifyContent: 'center' },
  booleanEditor: { minHeight: 42 },
  wrap: { flexWrap: 'wrap' },
  dialogActions: { flex: 1, justifyContent: 'flex-end' },
});
