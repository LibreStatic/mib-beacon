import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
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
  AgentTarget,
  DecodedVarbind,
  LiveMibScanStatus,
  LiveMibSettings,
  LiveMibWorkflowCandidate,
  LiveMibWorkflowRequest,
  LiveMibWorkflowStatus,
  MibNodeDetail,
  MibNodeSummary,
  TableIndexDescriptor,
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
  mergeLiveMibRows,
  valueText,
  type LiveMibGridRow,
} from '../live-mibs-grid';
import { useFileImportAdapter } from '../file-import-context';
import { bitIsSelected, mibRangeError, mibSizeError, toggleBitHex } from '../mib-set-editor';
import { buildTableRows, type TableViewColumn } from '../table-view';

type TreeCache = Record<string, MibNodeSummary[]>;

interface TreeRow {
  node: MibNodeSummary;
  depth: number;
}

interface LiveTableDescriptor {
  columns: TableViewColumn[];
  indexes: TableIndexDescriptor[];
}

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

export function LiveMibsScreen() {
  const engine = useEngine();
  const t = useTheme();
  const { mode } = useResponsiveLayout();
  const profiles = useAppStore((state) => state.agentProfiles);
  const selectedAgentId = useAppStore((state) => state.selectedAgentId);
  const requestedScopeOid = useAppStore((state) => state.liveMibScopeOid);
  const [settings, setSettings] = useState<LiveMibSettings>(DEFAULT_LIVE_MIB_SETTINGS);
  const [treeCache, setTreeCache] = useState<TreeCache>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [scope, setScope] = useState<MibNodeDetail | null>(null);
  const [tableDescriptor, setTableDescriptor] = useState<LiveTableDescriptor | null>(null);
  const [treeSearch, setTreeSearch] = useState('');
  const [rows, setRows] = useState<Map<string, LiveMibGridRow>>(new Map());
  const [scan, setScan] = useState<LiveMibScanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const handleRef = useRef<string | null>(null);
  const visibleOidsRef = useRef<string[]>([]);
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: { item: LiveMibGridRow }[] }) => {
      visibleOidsRef.current = viewableItems.map(({ item }) => item.oid).filter(Boolean);
    },
  ).current;

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
    if (!scope || !['table', 'entry', 'column'].includes(scope.kind)) {
      setTableDescriptor(null);
      return;
    }
    let active = true;
    void (async () => {
      let entry = scope;
      if (scope.kind === 'table') {
        const child = (await engine.mibs.tree(scope.oid)).find(({ kind }) => kind === 'entry');
        if (!child) return null;
        entry = (await engine.mibs.node(child.oid, child.module)) ?? scope;
      } else if (scope.kind === 'column') {
        const parentOid = scope.oid.split('.').slice(0, -1).join('.');
        entry = (await engine.mibs.node(parentOid, scope.module)) ?? scope;
      }
      if (entry.kind !== 'entry') return null;
      const summaries = (await engine.mibs.tree(entry.oid)).filter(({ kind }) => kind === 'column');
      const details = await Promise.all(
        summaries.map((column) => engine.mibs.node(column.oid, column.module)),
      );
      const indexDetails = await Promise.all(
        (entry.indexes ?? []).map((name) => engine.mibs.node(name, entry.module)),
      );
      return {
        columns: summaries.map((column, index) => ({
          oid: column.oid,
          name: column.name,
          access: details[index]?.access,
          syntax: details[index]?.syntax,
        })),
        indexes: (entry.indexes ?? []).map((name, index) => ({
          name,
          syntax: indexDetails[index]?.syntax ?? 'INTEGER',
          implied: entry.impliedIndexes?.includes(name),
          displayHint: indexDetails[index]?.displayHint,
        })),
      } satisfies LiveTableDescriptor;
    })().then((descriptor) => {
      if (active) setTableDescriptor(descriptor);
    });
    return () => {
      active = false;
    };
  }, [engine, scope]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      engine.liveMibs.settings.get(),
      selectedAgentId ? engine.liveMibs.agentOverrides.get(selectedAgentId) : Promise.resolve(null),
    ]).then(([globalSettings, overrides]) => {
      if (active) setSettings(resolveLiveMibSettings(globalSettings, overrides));
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
        if (!status || status.handleId !== handleId) return;
        setScan(status);
      });
    }, 500);
    return () => clearInterval(timer);
  }, [engine, scan]);

  const startScan = useCallback(async () => {
    const target = targetForWorkspace();
    if (!target) {
      setError('Choose a saved agent or enter an ad-hoc target in Query first.');
      return;
    }
    if (!scope) {
      setError('Choose a MIB subtree, scalar, table, entry, or column first.');
      return;
    }
    if (handleRef.current) await engine.liveMibs.scan.cancel(handleRef.current);
    setError(null);
    try {
      const { handleId } = await engine.liveMibs.scan.start({
        ...target,
        scopeOid: scope.oid,
        concurrency: settings.scanConcurrency,
        includeReadOnly: settings.showReadOnly,
        maxInstances: settings.maxInstances,
        preferredOids: settings.refreshMode === 'adaptive' ? visibleOidsRef.current : undefined,
      });
      handleRef.current = handleId;
      const status = await engine.liveMibs.scan.status(handleId);
      if (status) setScan(status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [engine, scope, settings]);

  useEffect(() => {
    setRows(new Map());
    visibleOidsRef.current = [];
  }, [scope?.oid]);

  useEffect(() => {
    if (!scope || settings.refreshMode === 'manual') return;
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
            title={busy ? 'Stop' : 'Refresh'}
            small
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
      {tableDescriptor && dataRows.length > 0 ? (
        <LiveMibPivot
          rows={dataRows}
          descriptor={tableDescriptor}
          settings={settings}
          target={targetForWorkspace()}
          now={now}
        />
      ) : (
        <FlatList
          data={dataRows}
          nestedScrollEnabled={mode === 'compact'}
          keyExtractor={({ oid }) => oid}
          contentContainerStyle={styles.gridList}
          renderItem={({ item }) => (
            <LiveMibRow
              row={item}
              settings={settings}
              target={targetForWorkspace()}
              stale={now - item.updatedAt >= settings.staleAfterMs}
            />
          )}
          onViewableItemsChanged={onViewableItemsChanged}
          ListEmptyComponent={
            !busy ? (
              <EmptyState
                title={scope ? 'No values loaded' : 'Choose a MIB scope'}
                hint={
                  scope
                    ? 'Refresh the scope or enable read-only objects in Settings.'
                    : 'The selected subtree becomes a live, editable data grid.'
                }
              />
            ) : null
          }
        />
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <WorkspaceHeader
        title="Live MIBs"
        subtitle="TREE-SCOPED · STREAMING · TYPE-AWARE · TRANSACTIONAL"
        actions={
          <Pill
            text={profiles.find(({ id }) => id === selectedAgentId)?.name ?? 'AD HOC'}
            color={selectedAgentId ? t.ok : t.textDim}
          />
        }
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.agentStrip, { borderBottomColor: t.border }]}
        contentContainerStyle={styles.agentStripContent}
      >
        {profiles.map((profile) => (
          <Chip
            key={profile.id}
            label={profile.name}
            active={selectedAgentId === profile.id}
            onPress={() => useAppStore.getState().selectAgentProfile(profile)}
          />
        ))}
      </ScrollView>
      {mode === 'compact' ? (
        <ScrollView
          style={styles.compactWorkspaceScroll}
          contentContainerStyle={styles.compactWorkspaceContent}
          nestedScrollEnabled
        >
          {treePane}
          {gridPane}
        </ScrollView>
      ) : (
        <View style={styles.workspace}>
          {treePane}
          {gridPane}
        </View>
      )}
    </View>
  );
}

function LiveMibPivot({
  rows,
  descriptor,
  settings,
  target,
  now,
}: {
  rows: LiveMibGridRow[];
  descriptor: LiveTableDescriptor;
  settings: LiveMibSettings;
  target: AgentTarget | null;
  now: number;
}) {
  const t = useTheme();
  const byOid = new Map(rows.map((row) => [row.oid, row]));
  const tableRows = buildTableRows(
    rows.map(({ value }) => value),
    descriptor.columns,
    descriptor.indexes,
  );
  return (
    <ScrollView horizontal contentContainerStyle={styles.pivotScroll}>
      <View style={styles.pivotTable}>
        <Row style={[styles.pivotHeader, { borderBottomColor: t.border }]}>
          <Text style={[styles.pivotIndex, { color: t.textDim }]}>Index</Text>
          {descriptor.columns.map((column) => (
            <Text key={column.oid} style={[styles.pivotColumnHeader, { color: t.textDim }]}>
              {column.name}
            </Text>
          ))}
        </Row>
        <FlatList
          data={tableRows}
          keyExtractor={({ key }) => key}
          renderItem={({ item }) => (
            <Row style={[styles.pivotRow, { borderBottomColor: t.border }]}>
              <View style={styles.pivotIndex}>
                <Mono size={10}>
                  {item.indexes.map(({ formatted }) => formatted).join(' / ') || item.key}
                </Mono>
              </View>
              {descriptor.columns.map((column) => {
                const cell = item.cells[column.oid];
                const source = cell ? byOid.get(cell.oid) : undefined;
                return (
                  <View key={column.oid} style={styles.pivotCell}>
                    {source ? (
                      <LiveMibRow
                        row={source}
                        settings={settings}
                        target={target}
                        compact
                        stale={now - source.updatedAt >= settings.staleAfterMs}
                      />
                    ) : (
                      <Label tone="dim">—</Label>
                    )}
                  </View>
                );
              })}
            </Row>
          )}
        />
      </View>
    </ScrollView>
  );
}

function LiveMibRow({
  row,
  settings,
  target,
  compact = false,
  stale = false,
}: {
  row: LiveMibGridRow;
  settings: LiveMibSettings;
  target: AgentTarget | null;
  compact?: boolean;
  stale?: boolean;
}) {
  const engine = useEngine();
  const adapter = useFileImportAdapter();
  const t = useTheme();
  const confirmed = String(row.value.value);
  const confirmedDisplay = valueText(row.value, settings.preferFormattedValues);
  const [cell, setCell] = useState<LiveMibCellState>({
    confirmedValue: confirmed,
    draftValue: confirmed,
    phase: 'fresh',
    requestId: 0,
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
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
  const requestSequence = useRef(0);
  const writable = /read-write|read-create|write-only/i.test(row.metadata?.access ?? '');
  const editor = inferLiveMibEditor(row.metadata ?? {});
  const presentedEditor =
    editor === 'boolean' && settings.booleanEditor === 'select' ? 'select' : editor;
  const booleanValues = row.metadata?.enumValues
    ? getBooleanEnumValues(row.metadata.enumValues)
    : null;
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
  }, [confirmed]);

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
      const requestId = ++requestSequence.current;
      setConfirmOpen(false);
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
    [cell.draftValue, cell.phase, engine, row, settings, target, writable],
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
      setConfirmOpen(true);
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
    <Card style={[styles.valueRow, compact ? styles.compactValueRow : null]}>
      <View style={[styles.valueIdentity, compact ? styles.compactValueIdentity : null]}>
        <Row style={styles.wrap}>
          <Text style={{ color: t.text, fontWeight: '700', fontSize: 12 }}>
            {row.value.name ?? row.metadata?.name ?? row.oid}
          </Text>
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
              accessibilityLabel={`Edit ${row.metadata.name}`}
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
        visible={confirmOpen}
        title={`Apply ${row.metadata?.name ?? row.oid}?`}
        subtitle="The device will receive an SNMP Set immediately after confirmation."
        onRequestClose={() => {
          setConfirmOpen(false);
          setCell((current) => ({ ...current, phase: 'dirty' }));
        }}
        footer={
          <Row style={styles.dialogActions}>
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => {
                setConfirmOpen(false);
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
    </Card>
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
  agentStrip: { flexGrow: 0, borderBottomWidth: 1 },
  agentStripContent: { paddingHorizontal: 12, paddingVertical: 7, gap: 6 },
  workspace: { flex: 1, minHeight: 0, flexDirection: 'row', gap: 8, padding: 8 },
  compactWorkspaceScroll: { flex: 1, minHeight: 0 },
  compactWorkspaceContent: { flexGrow: 1, gap: 8, padding: 8 },
  treePane: { width: 300, minHeight: 180, borderWidth: 1, borderRadius: 10, padding: 8, gap: 8 },
  compactTreePane: { width: '100%', height: 260 },
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
  compactGridPane: { flexGrow: 0, flexShrink: 0, height: 420 },
  gridToolbar: {
    minHeight: 58,
    padding: 10,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  gridList: { padding: 8, gap: 7 },
  pivotScroll: { padding: 8 },
  pivotTable: { minWidth: 600 },
  pivotHeader: { minHeight: 38, borderBottomWidth: 1 },
  pivotRow: { alignItems: 'stretch', borderBottomWidth: 1 },
  pivotIndex: { width: 150, padding: 8 },
  pivotColumnHeader: { width: 260, padding: 8, fontSize: 10, fontWeight: '800' },
  pivotCell: { width: 260, padding: 4 },
  loading: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  message: { margin: 8, padding: 8, borderRadius: 8 },
  workflowDialog: { maxHeight: 420 },
  valueRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: 10 },
  valueIdentity: { flex: 1.2, minWidth: 180, gap: 3 },
  compactValueRow: { padding: 6, gap: 6 },
  compactValueIdentity: { display: 'none' },
  valueEditor: { flex: 1, minWidth: 180, gap: 6 },
  readOnlyValue: { minHeight: 40, borderRadius: 7, padding: 10, justifyContent: 'center' },
  booleanEditor: { minHeight: 42 },
  wrap: { flexWrap: 'wrap' },
  dialogActions: { flex: 1, justifyContent: 'flex-end' },
});
