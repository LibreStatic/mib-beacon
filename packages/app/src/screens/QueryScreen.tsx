import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  FlatList,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
} from 'react-native';
import { Button, Card, Chip, Dialog, EmptyState, Field, Label, Mono, Pill, Row, SectionTitle, Skeleton, Text, useTheme } from '@mibbeacon/ui';
import { inferWireType, validateVarbindInput } from '@mibbeacon/core/client';
import type {
  AuthProtocol,
  DecodedVarbind,
  EngineInfo,
  OperationBookmark,
  PrivProtocol,
  SecurityLevel,
  SnmpVersion,
  WalkSnapshotSummary,
  MibNodeDetail,
} from '@mibbeacon/core/client';
import { useEngine } from '../engine-context';
import { useAppStore, type QueryOperation } from '../store';
import { canUseBrowserEventTarget, queryShortcut } from '../browser-shortcuts';
import { queryResultTabAccessibilityLabel, queryResultTabPresentation } from '../query-tabs';
import {
  runGet,
  runGetBulk,
  runGetNext,
  runSet,
  runWalk,
  stopWalk,
  resolveOidHint,
  prepareSetReview,
  openTableView,
  runTableView,
  buildAgentTarget,
} from '../actions';
import { VarbindEditor } from '../components/VarbindEditor';
import { OidLookupPanel } from '../components/OidLookupPanel';
import { SplitWorkspace } from '../components/SplitWorkspace';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { useResponsiveLayout } from '../responsive-context';
import { shouldUseEmbeddedQuerySplit } from '../responsive-layout';
import { serializeQueryResults, type ResultExportFormat } from '../result-export';
import {
  canOpenResultTable,
  copyResultText,
  resolveResultNode,
} from '../query-result-actions';
import {
  buildTableRows,
  encodeTableIndex,
  TABLE_ROW_HEIGHT,
  tableViewportHeight,
} from '../table-view';

const VERSIONS: SnmpVersion[] = ['v1', 'v2c', 'v3'];
const LEVELS: SecurityLevel[] = ['noAuthNoPriv', 'authNoPriv', 'authPriv'];
const AUTHS: AuthProtocol[] = ['md5', 'sha', 'sha256', 'sha512'];
const PRIVS: PrivProtocol[] = ['des', 'aes', 'aes256b', 'aes256r'];
const OPERATIONS: { key: QueryOperation; label: string }[] = [
  { key: 'get', label: 'Get' },
  { key: 'getNext', label: 'Get Next' },
  { key: 'getBulk', label: 'Get Bulk' },
  { key: 'walk', label: 'Walk' },
  { key: 'set', label: 'Set' },
];

export function QueryScreen({
  info,
  embedded = false,
}: {
  info: EngineInfo | null;
  embedded?: boolean;
}) {
  const engine = useEngine();
  const t = useTheme();
  const { supportsSplitView } = useResponsiveLayout();
  const oid = useAppStore((s) => s.oid);
  const oidName = useAppStore((s) => s.oidName);
  const results = useAppStore((s) => s.results);
  const running = useAppStore((s) => s.running);
  const stats = useAppStore((s) => s.stats);
  const error = useAppStore((s) => s.queryError);
  const operation = useAppStore((s) => s.queryOperation);
  const setDraft = useAppStore((s) => s.setDraft);
  const setStaging = useAppStore((s) => s.setStaging);
  const setPreviousValues = useAppStore((s) => s.setPreviousValues);
  const review = useAppStore((s) => s.setReview);
  const queryTabs = useAppStore((s) => s.queryTabs);
  const activeQueryTabId = useAppStore((s) => s.activeQueryTabId);
  const selectedNode = useAppStore((s) => s.selected);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const agentOperationStatuses = useAppStore((s) => s.agentOperationStatuses);
  const operationPduLog = useAppStore((s) => s.operationPduLog);
  const rawPduOpen = useAppStore((s) => s.rawPduOpen);
  const tableView = useAppStore((s) => s.tableView);
  const setValidationError = (setStaging.length > 0 ? setStaging : [setDraft])
    .map(validateVarbindInput)
    .find(Boolean);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bookmarks, setBookmarks] = useState<OperationBookmark[]>([]);
  const [snapshots, setSnapshots] = useState<WalkSnapshotSummary[]>([]);
  const [bookmarkName, setBookmarkName] = useState('');
  const [snapshotName, setSnapshotName] = useState('');
  const [sending, setSending] = useState(false);
  const submitSet = async () => {
    setSending(true);
    try {
      await runSet(engine);
    } finally {
      setSending(false);
    }
  };

  const refreshArtifacts = useCallback(async () => {
    const [nextBookmarks, nextSnapshots] = await Promise.all([
      engine.ops.bookmarks.list(),
      engine.ops.snapshots.list(),
    ]);
    setBookmarks(nextBookmarks);
    setSnapshots(nextSnapshots);
  }, [engine]);

  useEffect(() => {
    void refreshArtifacts();
  }, [refreshArtifacts]);

  const onOid = (value: string) => {
    const s = useAppStore.getState();
    s.setOid(value);
    s.setOidName(null);
    if (operation === 'set') s.updateSetDraft({ oid: value });
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void resolveOidHint(engine, value), 250);
  };

  const run = () => {
    if (operation === 'get') void runGet(engine);
    else if (operation === 'getNext') void runGetNext(engine);
    else if (operation === 'getBulk') void runGetBulk(engine);
    else if (operation === 'walk') void runWalk(engine);
    else void prepareSetReview(engine);
  };

  useEffect(() => {
    if (typeof window === 'undefined' || !canUseBrowserEventTarget(window)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
      const editableTarget =
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');
      const shortcut = queryShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        editableTarget,
      });
      if (!shortcut) return;
      event.preventDefault();
      const state = useAppStore.getState();
      if (shortcut === 'stop') void stopWalk(engine);
      else {
        if (shortcut !== 'repeat') state.setQueryOperation(shortcut);
        if (shortcut === 'get') void runGet(engine);
        else if (shortcut === 'getNext') void runGetNext(engine);
        else if (shortcut === 'getBulk') void runGetBulk(engine);
        else if (shortcut === 'walk') void runWalk(engine);
        else if (shortcut === 'set') void prepareSetReview(engine);
        else if (state.queryOperation === 'get') void runGet(engine);
        else if (state.queryOperation === 'getNext') void runGetNext(engine);
        else if (state.queryOperation === 'getBulk') void runGetBulk(engine);
        else if (state.queryOperation === 'walk') void runWalk(engine);
        else void prepareSetReview(engine);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine]);

  useEffect(() => {
    if (!tableView?.pollMs) return;
    const timer = setInterval(() => {
      if (!useAppStore.getState().running) void runTableView(engine);
    }, tableView.pollMs);
    return () => clearInterval(timer);
  }, [engine, tableView?.pollMs]);

  const operationCard = (
    <Card style={styles.card}>
      <View style={styles.targetHead}>
        <SectionTitle>Operation</SectionTitle>
        {oidName ? <Pill text={oidName} color={t.accent} /> : null}
      </View>
      <Row style={styles.wrap}>
        {OPERATIONS.map((item) => (
          <Chip
            key={item.key}
            label={item.label}
            active={operation === item.key}
            onPress={() => {
              const s = useAppStore.getState();
              s.setQueryOperation(item.key);
              if (item.key === 'set') {
                s.updateSetDraft({ oid });
                void resolveOidHint(engine, oid);
              }
            }}
          />
        ))}
      </Row>
      <Field label="OID" value={oid} onChangeText={onOid} placeholder="1.3.6.1.2.1.1.1.0" />
      {oidName ? (
        <Label tone="dim" size={12}>
          Resolved as <Text style={{ color: t.accent }}>{oidName}</Text>
        </Label>
      ) : null}
      {operation === 'set' ? (
        <View style={styles.stack}>
          <VarbindEditor
            value={setDraft}
            metadata={selectedNode}
            onChange={(patch) => {
              useAppStore.getState().updateSetDraft(patch);
              if (patch.oid !== undefined) onOid(patch.oid);
            }}
          />
          <Button
            title="Add varbind to request"
            small
            variant="ghost"
            disabled={Boolean(validateVarbindInput(setDraft))}
            onPress={() => useAppStore.getState().addSetDraftToStaging()}
          />
          {setStaging.map((varbind, index) => (
            <VarbindEditor
              key={`${index}-${varbind.oid}`}
              compact
              value={varbind}
              metadata={
                selectedNode?.oid && varbind.oid.startsWith(selectedNode.oid) ? selectedNode : null
              }
              onChange={(patch) => useAppStore.getState().updateStagedVarbind(index, patch)}
              onRemove={() => useAppStore.getState().removeStagedVarbind(index)}
            />
          ))}
          {setStaging.length > 0 ? (
            <Label tone="dim" size={11}>
              {setStaging.length} staged varbinds will be sent in one atomic Set PDU.
            </Label>
          ) : null}
        </View>
      ) : null}
      {operation === 'walk' && running ? (
        <Button title="Stop walk" variant="danger" onPress={() => void stopWalk(engine)} />
      ) : (
        <Button
          title={
            operation === 'set'
              ? 'Review Set request'
              : `Run ${OPERATIONS.find((x) => x.key === operation)?.label}`
          }
          onPress={run}
          disabled={!!running || (operation === 'set' && !!setValidationError)}
        />
      )}
      {selectedNode && ['table', 'entry', 'column'].includes(selectedNode.kind) ? (
        <Button
          title={`Open ${selectedNode.name} in Table View`}
          variant="ghost"
          onPress={() => void openTableView(engine, selectedNode)}
        />
      ) : null}
      <Dialog
        visible={operation === 'set' && review}
        onRequestClose={() => useAppStore.getState().setSetReview(false)}
        title="Confirm Set request"
        subtitle="Review the staged writes before sending."
        headerAccessory={<Pill text="WRITE" color={t.warn} />}
        maxWidth={560}
        footer={
          <>
            <Button
              title="Cancel"
              small
              variant="ghost"
              disabled={sending}
              onPress={() => useAppStore.getState().setSetReview(false)}
            />
            <Button
              title="Send Set"
              small
              loading={sending}
              loadingTitle="Sending…"
              onPress={() => void submitSet()}
            />
          </>
        }
      >
        {(setStaging.length > 0 ? setStaging : [setDraft]).map((varbind, index) => (
          <View key={`${index}-${varbind.oid}`} style={styles.stack}>
            <Mono size={12}>{varbind.oid}</Mono>
            <Text style={{ color: t.text, fontSize: 13 }}>
              {setPreviousValues[index]
                ? `${setPreviousValues[index]!.formattedValue ?? setPreviousValues[index]!.value} → `
                : 'Current value unavailable → '}
              {varbind.value || '∅'} ({varbind.type})
            </Text>
          </View>
        ))}
        <Label tone="dim" size={11}>
          This changes state on the remote agent and cannot be undone automatically.
        </Label>
      </Dialog>
    </Card>
  );

  const exportResults = async (format: ResultExportFormat) => {
    const text = serializeQueryResults(results, format);
    if (typeof document !== 'undefined') {
      const url = URL.createObjectURL(
        new Blob([text], { type: format === 'csv' ? 'text/csv' : 'application/json' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `mibbeacon-results.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } else {
      await Share.share({ message: text, title: `MIB Beacon results (${format.toUpperCase()})` });
    }
  };

  const artifactsCard = (
    <Card style={styles.card}>
      <SectionTitle>Saved work</SectionTitle>
      <Label tone="dim" size={11}>
        Bookmarks rerun a saved-agent target. Snapshots preserve the current result set privately.
      </Label>
      <Row>
        <Field label="Bookmark name" value={bookmarkName} onChangeText={setBookmarkName} />
        <Button
          title="Save bookmark"
          small
          disabled={!bookmarkName.trim() || !selectedAgentId}
          onPress={() => {
            const state = useAppStore.getState();
            if (!state.selectedAgentId) return;
            void engine.ops.bookmarks
              .create({
                name: bookmarkName,
                agentId: state.selectedAgentId,
                oid: state.oid,
                operation: state.queryOperation,
              })
              .then(async () => {
                setBookmarkName('');
                await refreshArtifacts();
              });
          }}
        />
      </Row>
      <Row style={styles.wrap}>
        {bookmarks.map((bookmark) => (
          <View key={bookmark.id} style={styles.savedItem}>
            <Button
              title={`Run ${bookmark.name}`}
              small
              variant="ghost"
              onPress={() => {
                const profile = useAppStore
                  .getState()
                  .agentProfiles.find((item) => item.id === bookmark.agentId);
                if (!profile) return;
                const state = useAppStore.getState();
                state.selectAgentProfile(profile);
                state.setOid(bookmark.oid);
                state.setQueryOperation(bookmark.operation);
                if (bookmark.operation === 'get') void runGet(engine);
                else if (bookmark.operation === 'getNext') void runGetNext(engine);
                else if (bookmark.operation === 'getBulk') void runGetBulk(engine);
                else if (bookmark.operation === 'walk') void runWalk(engine);
                else void prepareSetReview(engine);
              }}
            />
            <Button
              title="×"
              small
              variant="ghost"
              onPress={() => void engine.ops.bookmarks.delete(bookmark.id).then(refreshArtifacts)}
            />
          </View>
        ))}
      </Row>
      <Row>
        <Field label="Snapshot name" value={snapshotName} onChangeText={setSnapshotName} />
        <Button
          title="Save snapshot"
          small
          disabled={!snapshotName.trim() || results.length === 0}
          onPress={() => {
            const state = useAppStore.getState();
            const agentName = state.selectedAgentId
              ? (state.agentProfiles.find((item) => item.id === state.selectedAgentId)?.name ??
                'Agent')
              : state.agent.host || 'Ad hoc';
            void engine.ops.snapshots
              .create({
                name: snapshotName,
                agentName,
                baseOid: state.oid,
                results: state.results,
              })
              .then(async () => {
                setSnapshotName('');
                await refreshArtifacts();
              });
          }}
        />
      </Row>
      <Row style={styles.wrap}>
        {snapshots.map((snapshot) => (
          <View key={snapshot.id} style={styles.savedItem}>
            <Button
              title={`Open ${snapshot.name} (${snapshot.resultCount})`}
              small
              variant="ghost"
              onPress={() =>
                void engine.ops.snapshots.get(snapshot.id).then((loaded) => {
                  if (!loaded) return;
                  const state = useAppStore.getState();
                  state.setResults(loaded.results);
                  state.setStats({ count: loaded.results.length, batches: 1, ms: 0 });
                  state.saveQueryResultTab(`${loaded.agentName} · snapshot · ${loaded.baseOid}`);
                })
              }
            />
            <Button
              title="×"
              small
              variant="ghost"
              onPress={() => void engine.ops.snapshots.delete(snapshot.id).then(refreshArtifacts)}
            />
          </View>
        ))}
      </Row>
    </Card>
  );

  const resultsHeader = (
    <>
      {queryTabs.length > 0 ? (
        <View style={[styles.resultTabs, { borderBottomColor: t.border }]}>
          <View style={styles.resultTabList}>
            {queryTabs.map((tab) => {
              const presentation = queryResultTabPresentation(tab, activeQueryTabId);
              return (
                <View
                  key={tab.id}
                  style={[
                    styles.resultTab,
                    {
                      backgroundColor: presentation.selected ? t.accentSoft : t.surfaceAlt,
                      borderColor: presentation.selected ? t.accent : t.border,
                    },
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={presentation.pinLabel}
                    accessibilityState={{ selected: presentation.pinned }}
                    onPress={() => useAppStore.getState().toggleQueryResultTabPin(tab.id)}
                    style={({ pressed }) => [
                      styles.resultTabPin,
                      { borderRightColor: t.border },
                      presentation.pinned || pressed ? { backgroundColor: t.accentSoft } : null,
                    ]}
                  >
                    <Text style={styles.resultTabPinIcon}>{presentation.pinIcon}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityLabel={queryResultTabAccessibilityLabel(tab)}
                    accessibilityState={{ selected: presentation.selected }}
                    onPress={() => useAppStore.getState().selectQueryResultTab(tab.id)}
                    style={({ pressed }) => [
                      styles.resultTabSelect,
                      pressed ? { backgroundColor: t.accentSoft } : null,
                    ]}
                  >
                    <Text numberOfLines={1} style={[styles.resultTabTitle, { color: t.text }]}>
                      {tab.title}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={presentation.closeLabel}
                    accessibilityState={{ disabled: presentation.closeDisabled }}
                    disabled={presentation.closeDisabled}
                    onPress={() => useAppStore.getState().closeQueryResultTab(tab.id)}
                    style={({ pressed }) => [
                      styles.resultTabAction,
                      styles.resultTabClose,
                      { borderLeftColor: t.border },
                      presentation.closeDisabled ? styles.resultTabActionDisabled : null,
                      pressed ? { backgroundColor: t.accentSoft } : null,
                    ]}
                  >
                    <Text style={[styles.resultTabCloseText, { color: t.semantic.status.down }]}>
                      ×
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
      <View style={[styles.resultsHead, !supportsSplitView ? styles.resultsHeadCompact : null]}>
        <SectionTitle>Results</SectionTitle>
        <Row style={[styles.wrap, !supportsSplitView ? styles.resultsActionsCompact : null]}>
          <Text style={{ color: t.textDim, fontSize: 12 }}>
            {stats.count} varbinds · {stats.batches} batches · {stats.ms} ms
            {running ? ' · running…' : ''}
          </Text>
          {results.length > 0 ? (
            <>
              <Button title="CSV" small variant="ghost" onPress={() => void exportResults('csv')} />
              <Button
                title="JSON"
                small
                variant="ghost"
                onPress={() => void exportResults('json')}
              />
            </>
          ) : null}
          {operationPduLog.length > 0 ? (
            <Button
              title={rawPduOpen ? 'Hide PDU log' : `PDU log (${operationPduLog.length})`}
              small
              variant="ghost"
              onPress={() => useAppStore.getState().setRawPduOpen(!rawPduOpen)}
            />
          ) : null}
        </Row>
      </View>
      {Object.keys(agentOperationStatuses).length > 0 ? (
        <Row style={styles.wrap}>
          {Object.entries(agentOperationStatuses).map(([agentId, status]) => {
            const profile = useAppStore
              .getState()
              .agentProfiles.find((item) => item.id === agentId);
            const color =
              status.state === 'done' ? t.ok : status.state === 'error' ? t.error : t.warn;
            return (
              <Pill
                key={agentId}
                text={`${profile?.name ?? agentId}: ${status.state}${status.count === undefined ? '' : ` (${status.count})`}${status.message ? ` · ${status.message}` : ''}`}
                color={color}
              />
            );
          })}
        </Row>
      ) : null}
      {rawPduOpen && operationPduLog.length > 0 ? (
        <View style={[styles.pduLog, { borderColor: t.border, backgroundColor: t.surfaceAlt }]}>
          <Label tone="dim" size={11}>
            DECODED REQUEST/RESPONSE PDU LOG · CREDENTIALS REDACTED
          </Label>
          <ScrollView horizontal style={styles.pduLogScroll}>
            <Mono size={10}>{JSON.stringify(operationPduLog, null, 2)}</Mono>
          </ScrollView>
        </View>
      ) : null}
      {error ? (
        <View style={styles.error}>
          <Label tone="error">{error}</Label>
        </View>
      ) : null}
      {results.length === 0 && !error ? (
        running ? (
          <View style={styles.resultSkeleton} accessibilityLabel="Waiting for results">
            {[0, 1, 2, 3].map((row) => (
              <View key={row} style={styles.resultSkeletonRow}>
                <Skeleton width="55%" height={12} />
                <Skeleton width="30%" height={12} />
              </View>
            ))}
          </View>
        ) : (
          <EmptyState title="No results yet" hint="Choose an operation, agent, and OID." />
        )
      ) : null}
    </>
  );

  const resultContent = tableView ? (
    <TableViewResult />
  ) : (
    <FlatList
      style={styles.resultList}
      contentContainerStyle={styles.resultListContent}
      data={results}
      keyExtractor={(vb, i) => vb.oid + '#' + i}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => <VarbindRow vb={item} />}
    />
  );

  if (shouldUseEmbeddedQuerySplit(embedded, supportsSplitView)) {
    return (
      <View style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: t.bg }}>
        <SplitWorkspace
          workspace="operationConsole"
          accessibilityLabel="Resize SNMP operation console panes"
          minPrimary={340}
          minSecondary={360}
          primary={
            <ScrollView
              style={styles.consoleConfig}
              contentContainerStyle={styles.consoleConfigContent}
            >
              <AgentCard info={info} />
              {operationCard}
              {artifactsCard}
            </ScrollView>
          }
          secondary={
            <View style={styles.consoleResults}>
              <View
                style={[
                  styles.resultsToolbar,
                  { backgroundColor: t.surface, borderBottomColor: t.border },
                ]}
              >
                {resultsHeader}
              </View>
              {resultContent}
            </View>
          }
        />
      </View>
    );
  }

  if (supportsSplitView) {
    return (
      <View style={styles.workspace}>
        <WorkspaceHeader
          title="SNMP query"
          subtitle="CONFIGURE AN AGENT · RUN AN OPERATION · INSPECT VARBINDS"
          actions={
            running ? (
              <Pill text="OPERATION RUNNING" color={t.ok} />
            ) : (
              <Pill text={operation.toUpperCase()} color={t.accent} />
            )
          }
        />
        <SplitWorkspace
          workspace="query"
          minPrimary={340}
          minSecondary={420}
          primary={
            <ScrollView
              style={styles.configuration}
              contentContainerStyle={styles.configurationContent}
            >
              <AgentCard info={info} />
              {operationCard}
              {artifactsCard}
            </ScrollView>
          }
          secondary={
            <View style={styles.resultsPane}>
              <View
                style={[
                  styles.resultsToolbar,
                  { backgroundColor: t.surface, borderBottomColor: t.border },
                ]}
              >
                {resultsHeader}
              </View>
              {resultContent}
            </View>
          }
        />
      </View>
    );
  }

  if (tableView) {
    return (
      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
        <AgentCard info={info} />
        {operationCard}
        {artifactsCard}
        {resultsHeader}
        <TableViewResult />
      </ScrollView>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={results}
      keyExtractor={(vb, i) => vb.oid + '#' + i}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <>
          <AgentCard info={info} />
          {operationCard}
          {artifactsCard}
          {resultsHeader}
        </>
      }
      renderItem={({ item }) => <VarbindRow vb={item} />}
      ListFooterComponent={<View style={{ height: 20 }} />}
    />
  );
}

function AgentCard({ info }: { info: EngineInfo | null }) {
  const agent = useAppStore((s) => s.agent);
  const profiles = useAppStore((s) => s.agentProfiles);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const groups = useAppStore((s) => s.agentGroups);
  const selectedGroupId = useAppStore((s) => s.selectedAgentGroupId);
  const groupMode = useAppStore((s) => s.queryGroupMode);
  const setAgent = useAppStore.getState().setAgent;
  const setV3 = useAppStore.getState().setV3;
  const desOff = info != null && !info.ciphers.des;
  return (
    <Card style={styles.card}>
      <View style={styles.targetHead}>
        <SectionTitle>Agent</SectionTitle>
        <Button
          title="Manage profiles"
          small
          variant="ghost"
          onPress={() => useAppStore.getState().setTab('agents')}
        />
      </View>
      <Label tone="dim" size={11}>
        Quick pick · last-used profiles appear first
      </Label>
      <Row style={styles.wrap}>
        <Chip
          label="Single agent"
          active={!groupMode}
          onPress={() => useAppStore.getState().setQueryGroupMode(false)}
        />
        <Chip
          label="Agent group"
          active={groupMode}
          onPress={() => useAppStore.getState().setQueryGroupMode(true)}
        />
      </Row>
      {groupMode ? (
        <>
          <Row style={styles.wrap}>
            {groups.map((group) => (
              <Chip
                key={group.id}
                label={`${group.name} (${group.agentIds.length})`}
                active={selectedGroupId === group.id}
                onPress={() => useAppStore.getState().selectAgentGroup(group.id)}
              />
            ))}
          </Row>
          {groups.length === 0 ? (
            <Label tone="dim">Create an agent group in Manage profiles first.</Label>
          ) : null}
        </>
      ) : (
        <>
          <Row style={styles.wrap}>
            <Chip
              label="Ad hoc"
              active={!selectedAgentId}
              onPress={() => useAppStore.getState().selectAgentProfile(null)}
            />
            {profiles.map((profile) => (
              <Chip
                key={profile.id}
                label={profile.name}
                active={selectedAgentId === profile.id}
                onPress={() => useAppStore.getState().selectAgentProfile(profile)}
              />
            ))}
          </Row>
          {selectedAgentId ? (
            <Label tone="dim" size={11}>
              Saved credentials stay inside the engine. Editing any field switches to ad-hoc mode.
            </Label>
          ) : null}
          <Row>
            <Field
              label="Host"
              placeholder="10.0.2.2"
              value={agent.host}
              onChangeText={(host) => setAgent({ host })}
            />
            <View style={{ width: 88 }}>
              <Field
                label="Port"
                value={agent.port}
                onChangeText={(port) => setAgent({ port })}
                keyboardType="number-pad"
              />
            </View>
          </Row>
          <Row>
            {VERSIONS.map((version) => (
              <Chip
                key={version}
                label={version}
                active={agent.version === version}
                onPress={() => setAgent({ version })}
              />
            ))}
          </Row>
          <Row style={styles.wrap}>
            {(['udp4', 'udp6'] as const).map((transport) => (
              <Chip
                key={transport}
                label={transport}
                active={agent.transport === transport}
                onPress={() => setAgent({ transport })}
              />
            ))}
          </Row>
          {agent.version !== 'v3' ? (
            <Field
              label="Community"
              value={agent.community}
              onChangeText={(community) => setAgent({ community })}
            />
          ) : (
            <View style={styles.stack}>
              <Field label="User" value={agent.v3.user} onChangeText={(user) => setV3({ user })} />
              <Label tone="dim" size={11}>
                Security level
              </Label>
              <Row style={styles.wrap}>
                {LEVELS.map((level) => (
                  <Chip
                    key={level}
                    label={level}
                    active={agent.v3.level === level}
                    onPress={() => setV3({ level })}
                  />
                ))}
              </Row>
              {agent.v3.level !== 'noAuthNoPriv' ? (
                <>
                  <Row style={styles.wrap}>
                    {AUTHS.map((authProtocol) => (
                      <Chip
                        key={authProtocol}
                        label={authProtocol}
                        active={agent.v3.authProtocol === authProtocol}
                        onPress={() => setV3({ authProtocol })}
                      />
                    ))}
                  </Row>
                  <Field
                    label="Auth key"
                    value={agent.v3.authKey}
                    onChangeText={(authKey) => setV3({ authKey })}
                    secureTextEntry
                  />
                </>
              ) : null}
              {agent.v3.level === 'authPriv' ? (
                <>
                  <Row style={styles.wrap}>
                    {PRIVS.map((privProtocol) => {
                      const disabled = privProtocol === 'des' && desOff;
                      return (
                        <Chip
                          key={privProtocol}
                          label={disabled ? 'des (n/a)' : privProtocol}
                          active={agent.v3.privProtocol === privProtocol}
                          onPress={disabled ? undefined : () => setV3({ privProtocol })}
                        />
                      );
                    })}
                  </Row>
                  <Field
                    label="Privacy key"
                    value={agent.v3.privKey}
                    onChangeText={(privKey) => setV3({ privKey })}
                    secureTextEntry
                  />
                </>
              ) : null}
            </View>
          )}
        </>
      )}
    </Card>
  );
}

function TableViewResult() {
  const engine = useEngine();
  const t = useTheme();
  const view = useAppStore((state) => state.tableView);
  const results = useAppStore((state) => state.results);
  const running = useAppStore((state) => state.running);
  const groupMode = useAppStore((state) => state.queryGroupMode);
  const [newIndexValues, setNewIndexValues] = useState<string[]>([]);
  const [rowMessage, setRowMessage] = useState<string | null>(null);
  const previousCells = useRef(new Map<string, string>());
  const [changedCells, setChangedCells] = useState<Set<string>>(new Set());
  useEffect(() => {
    const next = new Map(results.map((item) => [item.oid, String(item.rawValue ?? item.value)]));
    const changed = new Set<string>();
    if (previousCells.current.size > 0) {
      for (const [oid, value] of next) {
        if (previousCells.current.has(oid) && previousCells.current.get(oid) !== value)
          changed.add(oid);
      }
    }
    previousCells.current = next;
    setChangedCells(changed);
    if (changed.size === 0) return;
    const timer = setTimeout(() => setChangedCells(new Set()), 1_200);
    return () => clearTimeout(timer);
  }, [results]);
  if (!view) return null;
  const columns = view.columns.filter((column) => view.selectedColumnOids.includes(column.oid));
  const rows = buildTableRows(results, columns, view.indexes);
  const rowStatusColumn = view.columns.find((column) =>
    /rowstatus|entrystatus/i.test(`${column.name} ${column.syntax ?? ''}`),
  );
  const editCell = (oid: string, value: string | number, syntax?: string) => {
    const state = useAppStore.getState();
    state.setQueryOperation('set');
    state.updateSetDraft({ oid, type: inferWireType(syntax), value: String(value) });
    state.setTableView(null);
  };
  const exportTable = () => {
    const header = ['Index', ...columns.map(({ name }) => name)].join(',');
    const body = rows.map((row) =>
      [
        row.indexes.map(({ formatted }) => formatted).join(' / ') || row.key,
        ...columns.map(({ oid }) =>
          String(row.cells[oid]?.formattedValue ?? row.cells[oid]?.value ?? ''),
        ),
      ]
        .map((value) => `"${value.replace(/"/g, '""')}"`)
        .join(','),
    );
    void Share.share({ message: [header, ...body].join('\n'), title: `${view.name}.csv` });
  };
  const gridWidth = 170 * (1 + columns.length + (rowStatusColumn && !groupMode ? 1 : 0));
  const renderGridRow = ({ item: row }: { item: (typeof rows)[number] }) => (
    <Row style={[styles.tableRow, { borderBottomColor: t.border, width: gridWidth }]}>
      <View style={styles.tableCell}>
        <Mono size={11}>
          {row.indexes.map(({ formatted }) => formatted).join(' / ') || row.key}
        </Mono>
      </View>
      {columns.map((column) => {
        const cell = row.cells[column.oid];
        return (
          <View
            key={column.oid}
            style={[
              styles.tableCell,
              cell && changedCells.has(cell.oid) ? { backgroundColor: t.accentSoft } : null,
            ]}
          >
            <Text style={{ color: t.text }}>
              {cell ? String(cell.formattedValue ?? cell.value) : '—'}
            </Text>
            {cell ? (
              <Row>
                {/write|create/i.test(column.access ?? '') ? (
                  <Button
                    title="Set"
                    small
                    variant="ghost"
                    onPress={() => editCell(cell.oid, cell.rawValue ?? cell.value, column.syntax)}
                  />
                ) : null}
                {isNumericVarbind(cell) &&
                (cell.agentId || useAppStore.getState().selectedAgentId) ? (
                  <Button
                    title="Graph"
                    small
                    variant="ghost"
                    onPress={() => void graphVarbind(engine, cell)}
                  />
                ) : null}
              </Row>
            ) : null}
          </View>
        );
      })}
      {rowStatusColumn && !groupMode ? (
        <View style={styles.tableCell}>
          <Button
            title="Delete row"
            small
            variant="danger"
            onPress={() => {
              const state = useAppStore.getState();
              const target = buildAgentTarget(state.agent, state.selectedAgentId);
              void engine.ops
                .deleteTableRow({
                  ...target,
                  rowStatusOid: `${rowStatusColumn.oid}.${row.key.split('|').at(-1)}`,
                })
                .then(() => runTableView(engine));
            }}
          />
        </View>
      ) : null}
    </Row>
  );
  return (
    <View style={[styles.tableView, { borderColor: t.border }]}>
      <View style={styles.headingRow}>
        <View>
          <SectionTitle>Table View · {view.name}</SectionTitle>
          <Label tone="dim" size={11}>
            {rows.length} rows · {columns.length} columns
          </Label>
        </View>
        <Row style={styles.wrap}>
          <Button
            title="Refresh"
            small
            onPress={() => void runTableView(engine)}
            disabled={Boolean(running)}
          />
          <Button
            title={view.rotate ? 'Grid' : 'Rotate'}
            small
            variant="ghost"
            onPress={() => useAppStore.getState().setTableViewRotate(!view.rotate)}
          />
          <Button title="CSV" small variant="ghost" onPress={exportTable} />
          <Button
            title="Close"
            small
            variant="ghost"
            onPress={() => useAppStore.getState().setTableView(null)}
          />
        </Row>
      </View>
      <Row style={styles.wrap}>
        <Label tone="dim" size={11}>
          Poll
        </Label>
        {[0, 2_000, 5_000, 15_000].map((pollMs) => (
          <Chip
            key={pollMs}
            label={pollMs ? `${pollMs / 1000}s` : 'Off'}
            active={view.pollMs === pollMs}
            onPress={() => useAppStore.getState().setTableViewPollMs(pollMs)}
          />
        ))}
      </Row>
      {rowStatusColumn && !groupMode ? (
        <View style={[styles.rowWizard, { borderColor: t.border }]}>
          <Label tone="dim" size={11}>
            CREATE ROW · {rowStatusColumn.name}
          </Label>
          <Row style={styles.wrap}>
            {view.indexes.map((descriptor, index) => (
              <Field
                key={descriptor.name}
                label={`${descriptor.name} (${descriptor.syntax})`}
                value={newIndexValues[index] ?? ''}
                onChangeText={(value) =>
                  setNewIndexValues((current) => {
                    const next = [...current];
                    next[index] = value;
                    return next;
                  })
                }
              />
            ))}
          </Row>
          <Button
            title="Create row"
            small
            onPress={() => {
              try {
                const suffix = encodeTableIndex(newIndexValues, view.indexes);
                const state = useAppStore.getState();
                const target = buildAgentTarget(state.agent, state.selectedAgentId);
                const requiredColumns = state.setStaging.map((varbind) => ({
                  ...varbind,
                  oid:
                    varbind.oid.startsWith(`${view.entryOid}.`) &&
                    !varbind.oid.endsWith(`.${suffix}`)
                      ? `${varbind.oid}.${suffix}`
                      : varbind.oid,
                }));
                void engine.ops
                  .createTableRow({
                    ...target,
                    rowStatusOid: `${rowStatusColumn.oid}.${suffix}`,
                    requiredColumns,
                  })
                  .then(async (result) => {
                    setRowMessage(`Row created with ${result.mode}.`);
                    await runTableView(engine);
                  })
                  .catch((error: unknown) =>
                    setRowMessage(error instanceof Error ? error.message : String(error)),
                  );
              } catch (error) {
                setRowMessage(error instanceof Error ? error.message : String(error));
              }
            }}
          />
          {rowMessage ? <Label tone="dim">{rowMessage}</Label> : null}
        </View>
      ) : null}
      <Row style={styles.wrap}>
        {view.columns.map((column) => (
          <Chip
            key={column.oid}
            label={column.name}
            active={view.selectedColumnOids.includes(column.oid)}
            onPress={() => {
              const selected = view.selectedColumnOids.includes(column.oid)
                ? view.selectedColumnOids.filter((oid) => oid !== column.oid)
                : [...view.selectedColumnOids, column.oid];
              useAppStore.getState().setTableViewColumns(selected.length ? selected : [column.oid]);
            }}
          />
        ))}
      </Row>
      <ScrollView horizontal>
        <View>
          {!view.rotate ? (
            <>
              <Row style={[styles.tableRow, { borderBottomColor: t.border, width: gridWidth }]}>
                <Text style={[styles.tableHeaderCell, { color: t.textDim }]}>Index</Text>
                {columns.map((column) => (
                  <Text key={column.oid} style={[styles.tableHeaderCell, { color: t.textDim }]}>
                    {column.name}
                  </Text>
                ))}
                {rowStatusColumn && !groupMode ? (
                  <Text style={[styles.tableHeaderCell, { color: t.textDim }]}>Row actions</Text>
                ) : null}
              </Row>
              <FlatList
                style={{ width: gridWidth, height: tableViewportHeight(rows.length) }}
                data={rows}
                keyExtractor={(row) => row.key}
                renderItem={renderGridRow}
                getItemLayout={(_, index) => ({
                  length: TABLE_ROW_HEIGHT,
                  offset: TABLE_ROW_HEIGHT * index,
                  index,
                })}
                initialNumToRender={12}
                maxToRenderPerBatch={20}
                windowSize={7}
                nestedScrollEnabled
                removeClippedSubviews
              />
            </>
          ) : (
            columns.map((column) => (
              <Row key={column.oid} style={[styles.tableRow, { borderBottomColor: t.border }]}>
                <Text style={[styles.tableHeaderCell, { color: t.textDim }]}>{column.name}</Text>
                {rows.map((row) => (
                  <View key={row.key} style={styles.tableCell}>
                    <Label tone="dim" size={10}>
                      {row.indexes.map(({ formatted }) => formatted).join(' / ') || row.key}
                    </Label>
                    <Text style={{ color: t.text }}>
                      {String(
                        row.cells[column.oid]?.formattedValue ??
                          row.cells[column.oid]?.value ??
                          '—',
                      )}
                    </Text>
                  </View>
                ))}
              </Row>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function VarbindRow({ vb }: { vb: DecodedVarbind }) {
  const engine = useEngine();
  const t = useTheme();
  const [resolvedNode, setResolvedNode] = useState<MibNodeDetail | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setResolvedNode(undefined);
    void resolveResultNode(engine.mibs, vb.oid)
      .then((node) => {
        if (active) setResolvedNode(node);
      })
      .catch(() => {
        if (active) setResolvedNode(null);
      });
    return () => {
      active = false;
    };
  }, [engine, vb.oid]);

  const loadNode = () =>
    resolvedNode === undefined ? resolveResultNode(engine.mibs, vb.oid) : Promise.resolve(resolvedNode);

  return (
    <View style={[styles.vbRow, { borderBottomColor: t.border }]}>
      <View style={styles.vbSummary}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Mono size={13}>{vb.name ?? vb.oid}</Mono>
          {vb.name ? (
            <Mono dim size={10}>
              {vb.oid}
            </Mono>
          ) : null}
          <Text style={{ color: vb.isError ? t.error : t.text, fontSize: 13, marginTop: 2 }}>
            {vb.isError ? vb.errorText : String(vb.value)}
          </Text>
        </View>
        <Pill text={vb.typeName} />
        {vb.agentName ? <Pill text={vb.agentName} color={t.accent} /> : null}
      </View>
      {!vb.name ? (
        <View style={styles.lookup}>
          <OidLookupPanel oid={vb.oid} compact />
        </View>
      ) : null}
      <Row style={styles.wrap}>
        <Button
          title="Get again"
          small
          variant="ghost"
          onPress={() => {
            const state = useAppStore.getState();
            state.setOid(vb.oid);
            state.setQueryOperation('get');
            void runGet(engine);
          }}
        />
        <Button
          title="Set…"
          small
          variant="ghost"
          onPress={() => {
            void loadNode()
              .then((node) => {
                const state = useAppStore.getState();
                if (node && !/write|create/i.test(node.access ?? '')) {
                  state.setQueryError(`${node.name} is not writable according to the loaded MIB.`);
                  return;
                }
                state.setOid(vb.oid);
                state.setQueryOperation('set');
                state.updateSetDraft({
                  oid: vb.oid,
                  type: inferWireType(node?.syntax),
                  value: String(vb.rawValue ?? vb.value),
                });
              })
              .catch((nodeError) =>
                useAppStore
                  .getState()
                  .setQueryError(nodeError instanceof Error ? nodeError.message : String(nodeError)),
              );
          }}
        />
        <Button
          title="Inspect"
          small
          variant="ghost"
          onPress={() => {
            void loadNode()
              .then((node) => {
                if (!node) {
                  useAppStore
                    .getState()
                    .setQueryError(`No loaded MIB definition matches ${vb.oid}.`);
                  return;
                }
                const state = useAppStore.getState();
                state.setSelected(node);
                state.setTab('browse');
              })
              .catch((nodeError) =>
                useAppStore
                  .getState()
                  .setQueryError(nodeError instanceof Error ? nodeError.message : String(nodeError)),
              );
          }}
        />
        {canOpenResultTable(resolvedNode) ? (
          <Button
            title="Open table"
            small
            variant="ghost"
            onPress={() => {
              void openTableView(engine, resolvedNode!).catch((error) =>
                useAppStore
                  .getState()
                  .setQueryError(error instanceof Error ? error.message : String(error)),
              );
            }}
          />
        ) : null}
        {isNumericVarbind(vb) && (vb.agentId || useAppStore.getState().selectedAgentId) ? (
          <Button
            title="Graph"
            small
            variant="ghost"
            onPress={() => void graphVarbind(engine, vb)}
          />
        ) : null}
        <Button
          title={copied ? 'Copied' : 'Copy row'}
          small
          variant="ghost"
          onPress={() => {
            const text = `${vb.name ?? vb.oid}\t${vb.formattedValue ?? vb.value}\t${vb.typeName}`;
            const action =
              typeof document !== 'undefined'
                ? copyResultText(text)
                : Share.share({ message: text, title: 'MIB Beacon result row' }).then(() => undefined);
            void action
              .then(() => setCopied(true))
              .catch((copyError) =>
                useAppStore
                  .getState()
                  .setQueryError(copyError instanceof Error ? copyError.message : String(copyError)),
              );
          }}
        />
      </Row>
    </View>
  );
}

function isNumericVarbind(value: DecodedVarbind): boolean {
  return (
    /Integer|Counter|Gauge|TimeTicks|Unsigned|Float|Double/i.test(value.typeName) &&
    Number.isFinite(Number(value.rawValue ?? value.value))
  );
}

async function graphVarbind(
  engine: ReturnType<typeof useEngine>,
  value: DecodedVarbind,
): Promise<void> {
  const state = useAppStore.getState();
  const agentId = value.agentId ?? state.selectedAgentId;
  if (!agentId) {
    state.setQueryError('Save or select an agent before creating a persistent graph series.');
    return;
  }
  try {
    await engine.tools.polls.create({
      name: value.name ?? value.oid,
      agentId,
      oid: value.oid,
      intervalMs: 5_000,
      mode: /Counter/i.test(value.typeName) ? 'rate-per-sec' : 'raw',
      counterBits: /64/.test(value.typeName) ? 64 : 32,
    });
    state.setTab('tools');
  } catch (error) {
    state.setQueryError(error instanceof Error ? error.message : String(error));
  }
}

const styles = StyleSheet.create({
  consoleConfig: { flex: 1 },
  consoleConfigContent: { padding: 10, paddingBottom: 18 },
  consoleResults: { flex: 1, minWidth: 0, minHeight: 0 },
  workspace: { flex: 1, minWidth: 0, minHeight: 0 },
  configuration: { flex: 1 },
  configurationContent: { padding: 14, paddingBottom: 28 },
  resultsPane: { flex: 1, minWidth: 0, minHeight: 0 },
  resultsToolbar: { paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1 },
  resultList: { flex: 1 },
  resultListContent: { paddingHorizontal: 16, paddingBottom: 24 },
  resultSkeleton: { paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  resultSkeletonRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  list: { flex: 1 },
  content: { padding: 12 },
  card: { marginBottom: 12 },
  wrap: { flexWrap: 'wrap' },
  stack: { gap: 8 },
  targetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultsHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  resultsHeadCompact: { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
  resultsActionsCompact: { width: '100%' },
  resultTabs: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
    marginBottom: 8,
    gap: 6,
  },
  resultTabList: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 6 },
  resultTab: {
    flexDirection: 'row',
    alignItems: 'stretch',
    maxWidth: '100%',
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  resultTabSelect: {
    minWidth: 112,
    maxWidth: 260,
    minHeight: 42,
    flexShrink: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  resultTabTitle: { fontSize: 12, fontWeight: '700' },
  resultTabPin: {
    width: 38,
    minHeight: 42,
    borderRightWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultTabPinIcon: { fontSize: 14, lineHeight: 18 },
  resultTabAction: {
    minWidth: 36,
    minHeight: 42,
    borderLeftWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  resultTabClose: { minWidth: 36, paddingHorizontal: 6 },
  resultTabCloseText: { fontSize: 18, fontWeight: '800', lineHeight: 20 },
  resultTabActionDisabled: { opacity: 0.38 },
  error: { marginBottom: 8 },
  vbRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  vbSummary: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' },
  lookup: { width: '100%' },
  savedItem: { flexDirection: 'row', alignItems: 'center' },
  pduLog: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    maxHeight: 260,
    marginBottom: 8,
  },
  pduLogScroll: { width: '100%', maxWidth: '100%' },
  tableView: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 10, margin: 10 },
  headingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  tableRow: { alignItems: 'stretch', borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 48 },
  tableHeaderCell: { width: 170, padding: 8, fontSize: 11, fontWeight: '800' },
  tableCell: { width: 170, padding: 8, justifyContent: 'center', gap: 4 },
  rowWizard: { borderWidth: 1, borderRadius: 8, padding: 8, gap: 8 },
});
