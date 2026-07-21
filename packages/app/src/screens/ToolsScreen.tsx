import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, ScrollView, Share, StyleSheet, View } from 'react-native';
import type {
  AgentProfile,
  DiscoveryResult,
  EngineInfo,
  PollSample,
  PollSeries,
  PortViewRow,
  WalkDiffRow,
  WalkSnapshotSummary,
} from '@mibbeacon/core/client';
import {
  Button,
  Card,
  Chip,
  Field,
  Label,
  Mono,
  Pill,
  Row,
  SectionTitle,
  Text,
  useTheme,
} from '@mibbeacon/ui';
import { useEngine, useEngineOwnership } from '../engine-context';
import { useAppStore } from '../store';
import { refreshAgentProfiles, saveAgentProfile } from '../actions';
import { AgentProfileDialog } from '../components/AgentProfileDialog';
import { ToolLineChart, ToolSparkline, type ChartPngExport } from '../components/ToolLineChart';
import { agentPersistentCollectionsController } from '../agent-persistent-collections';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { AgentCollectionRecovery } from '../components/AgentCollectionRecovery';
import { useResponsiveLayout } from '../responsive-context';
import { engineStartArbitration } from '../engine-start-arbitration';
import {
  agentDraftFromEditor,
  EMPTY_AGENT_EDITOR,
  type AgentEditorState,
} from '../agent-profile-form';
import {
  toolsCollectionStatusText,
  toolsPersistentCollectionsController,
} from '../tools-persistent-collections';
import { ToolsRefreshCoordinator } from '../tools-refresh-coordinator';
import { patternPersistentCollectionsController } from '../pattern-persistent-collections';

interface PingSummary {
  transmitted: number;
  received: number;
  lossPercent: number;
  minMs?: number;
  avgMs?: number;
  maxMs?: number;
}

type ToolSection = 'graphs' | 'watches' | 'discovery' | 'compare' | 'ports' | 'reachability';
type TargetSetupSection = Extract<ToolSection, 'graphs' | 'compare' | 'ports'>;
const SECTIONS: { key: ToolSection; label: string }[] = [
  { key: 'graphs', label: 'Graphs' },
  { key: 'watches', label: 'Watches' },
  { key: 'discovery', label: 'Discovery' },
  { key: 'compare', label: 'Compare' },
  { key: 'ports', label: 'Ports' },
  { key: 'reachability', label: 'Ping / trace' },
];
export function ToolsScreen({
  info,
  shareChartPng,
}: {
  info: EngineInfo | null;
  shareChartPng?: (capture: ChartPngExport) => Promise<void>;
}) {
  const engine = useEngine();
  const ownsEngine = useEngineOwnership();
  const t = useTheme();
  const { supportsSplitView } = useResponsiveLayout();
  const agents = useAppStore((state) => state.agentProfiles);
  const patternTraceColor = useAppStore((state) => state.patternTraceColor);
  const [section, setSection] = useState<ToolSection>('graphs');
  const persistent = useMemo(
    () => toolsPersistentCollectionsController(engine, ownsEngine),
    [engine, ownsEngine],
  );
  const refreshCoordinator = useMemo(() => new ToolsRefreshCoordinator(), []);
  const subscribePersistent = useCallback(
    (listener: () => void) => persistent.subscribe(listener),
    [persistent],
  );
  const persistentSnapshot = useSyncExternalStore(
    subscribePersistent,
    () => persistent.snapshot(),
    () => persistent.snapshot(),
  );
  const agentCollections = useMemo(
    () => agentPersistentCollectionsController(engine, ownsEngine),
    [engine, ownsEngine],
  );
  const agentCollectionSnapshot = useSyncExternalStore(
    agentCollections.subscribe,
    agentCollections.snapshot,
    agentCollections.snapshot,
  );
  const agentCollectionsBlocked = ['error-reverted', 'uncertain', 'conflict'].includes(
    agentCollectionSnapshot.phase,
  );
  const series = persistentSnapshot.polls;
  const watches = persistentSnapshot.watches;
  const charts = persistentSnapshot.charts;
  const patterns = useMemo(
    () => patternPersistentCollectionsController(engine, ownsEngine),
    [engine, ownsEngine],
  );
  const patternSnapshot = useSyncExternalStore(
    patterns.subscribe.bind(patterns),
    patterns.snapshot.bind(patterns),
    patterns.snapshot.bind(patterns),
  );
  const patternSessions = patternSnapshot.sessions;
  const patternEvents = patternSnapshot.events;
  const runningPattern = patternSessions.find((session) => session.status === 'running');
  const patternHandle = runningPattern?.operationHandleId ?? null;
  const patternStopping =
    patternSnapshot.phase === 'updating' && patternSnapshot.active === 'pattern:cancel';
  const patternBlocked =
    patternSnapshot.readiness.phase !== 'ready' ||
    ['error-reverted', 'uncertain', 'conflict'].includes(patternSnapshot.phase);
  const [samples, setSamples] = useState<Record<string, PollSample[]>>({});
  const [hiddenPatternSessionIds, setHiddenPatternSessionIds] = useState<string[]>([]);
  const [activeChartId, setActiveChartId] = useState<string | null>(null);
  const [patternMode, setPatternMode] = useState<'active' | 'passive'>('active');
  const [patternName, setPatternName] = useState('Pattern trace');
  const [patternCadence, setPatternCadence] = useState('500');
  const [patternDuration, setPatternDuration] = useState('60000');
  const [patternStart, setPatternStart] = useState(() =>
    new Date(Date.now() - 60_000).toISOString(),
  );
  const [patternEnd, setPatternEnd] = useState(() => new Date().toISOString());
  const [error, setError] = useState<string | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<string[]>([]);
  const [seriesName, setSeriesName] = useState('New series');
  const [seriesAgent, setSeriesAgent] = useState('');
  const [seriesOid, setSeriesOid] = useState('1.3.6.1.2.1.1.3.0');
  const [interval, setIntervalText] = useState('5000');
  const [mode, setMode] = useState<PollSeries['mode']>('raw');
  const [targetSetupSection, setTargetSetupSection] = useState<TargetSetupSection | null>(null);
  const [targetEditor, setTargetEditor] = useState<AgentEditorState>(EMPTY_AGENT_EDITOR);
  const [targetBusy, setTargetBusy] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [watchName, setWatchName] = useState('Watch');
  const [watchSeries, setWatchSeries] = useState('');
  const [operator, setOperator] = useState<'>' | '<' | '==' | '!='>('>');
  const [threshold, setThreshold] = useState('0');
  const [thresholdMode, setThresholdMode] = useState<'value' | 'raw'>('value');
  const [target, setTarget] = useState('192.0.2.0/24');
  const [credentialIds, setCredentialIds] = useState<string[]>([]);
  const [communities, setCommunities] = useState('');
  const [discoveryPrePing, setDiscoveryPrePing] = useState(false);
  const [discoveryHandle, setDiscoveryHandle] = useState<string | null>(null);
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveryResult[]>([]);
  const [discoveryProgress, setDiscoveryProgress] = useState('Idle');
  const discoverySaveSequence = useRef(0);
  const [savingDiscovery, setSavingDiscovery] = useState<{
    id: number;
    ip: string;
    engine: typeof engine;
  } | null>(null);
  const activeDiscoverySave = savingDiscovery?.engine === engine ? savingDiscovery : null;
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [compareOid, setCompareOid] = useState('1.3.6.1.2.1');
  const [diffRows, setDiffRows] = useState<WalkDiffRow[]>([]);
  const [compareHandle, setCompareHandle] = useState<string | null>(null);
  const [differencesOnly, setDifferencesOnly] = useState(true);
  const [walkA, setWalkA] = useState('');
  const [walkB, setWalkB] = useState('');
  const [snapshots, setSnapshots] = useState<WalkSnapshotSummary[]>([]);
  const [snapshotA, setSnapshotA] = useState('');
  const [snapshotB, setSnapshotB] = useState('');
  const [portAgent, setPortAgent] = useState('');
  const [ports, setPorts] = useState<PortViewRow[]>([]);
  const [portHandle, setPortHandle] = useState<string | null>(null);
  const [portFilter, setPortFilter] = useState<'all' | 'up' | 'down'>('all');
  const [portSort, setPortSort] = useState<'index' | 'name' | 'speed'>('index');
  const [portDetail, setPortDetail] = useState<string | null>(null);
  const [reachKind, setReachKind] = useState<'ping' | 'traceroute'>('ping');
  const [reachTarget, setReachTarget] = useState('127.0.0.1');
  const [reachCount, setReachCount] = useState('4');
  const [reachInterval, setReachInterval] = useState('1000');
  const [reachHandle, setReachHandle] = useState<string | null>(null);
  const [reachLines, setReachLines] = useState<string[]>([]);
  const [reachSummary, setReachSummary] = useState<PingSummary | null>(null);
  const acceptedHandles = useRef<
    Partial<Record<'discovery' | 'compare' | 'ports' | 'reach', string>>
  >({});

  useEffect(
    () => () => {
      const handles = acceptedHandles.current;
      if (handles.discovery)
        void engine.tools.discovery.cancel(handles.discovery).catch(() => undefined);
      if (handles.compare) void engine.tools.compare.cancel(handles.compare).catch(() => undefined);
      if (handles.ports) void engine.tools.ports.cancel(handles.ports).catch(() => undefined);
      if (handles.reach)
        void engine.tools.reachability.cancel(handles.reach).catch(() => undefined);
    },
    [engine],
  );

  const report = useCallback(
    (value: unknown) => {
      if (ownsEngine()) setError(value instanceof Error ? value.message : String(value));
    },
    [ownsEngine],
  );
  const runToolStart = useCallback(
    async (
      resource: string,
      start: () => Promise<{ handleId: string }>,
      cancel: (handleId: string) => Promise<unknown>,
      accept: (handleId: string) => void,
    ) => {
      const claim = engineStartArbitration.begin(engine, resource);
      try {
        const { handleId } = await start();
        await engineStartArbitration.accept(claim, handleId, ownsEngine, cancel, accept);
      } catch (caught) {
        if (engineStartArbitration.isCurrent(claim, ownsEngine)) report(caught);
      }
    },
    [engine, ownsEngine, report],
  );
  const openTargetSetup = (next: TargetSetupSection) => {
    if (targetSetupSection !== next) setTargetEditor(EMPTY_AGENT_EDITOR);
    setTargetError(null);
    setTargetSetupSection(next);
  };
  const cancelTargetSetup = () => {
    setTargetSetupSection(null);
    setTargetEditor(EMPTY_AGENT_EDITOR);
    setTargetError(null);
  };
  const createTarget = async () => {
    if (!ownsEngine()) return;
    if (!targetSetupSection || targetBusy || agentCollectionsBlocked) return;
    setTargetBusy(true);
    setTargetError(null);
    try {
      const { profile: created } = await saveAgentProfile(
        engine,
        null,
        agentDraftFromEditor(targetEditor),
        ownsEngine,
      );
      if (!ownsEngine()) return;
      await refreshAgentProfiles(engine, ownsEngine);
      if (!ownsEngine()) return;
      if (targetSetupSection === 'graphs') setSeriesAgent(created.id);
      if (targetSetupSection === 'ports') setPortAgent(created.id);
      if (targetSetupSection === 'compare') {
        if (!compareA) setCompareA(created.id);
        else setCompareB(created.id);
      }
      useAppStore.getState().pushToast({ tone: 'success', message: 'Target added' });
      cancelTargetSetup();
    } catch (caught) {
      if (!ownsEngine()) return;
      setTargetEditor((current) => ({ ...current, community: '', authKey: '', privKey: '' }));
      const message = caught instanceof Error ? caught.message : String(caught);
      setTargetError(message);
      useAppStore.getState().pushToast({ tone: 'error', message });
    } finally {
      if (ownsEngine()) setTargetBusy(false);
    }
  };
  const refresh = useCallback(async () => {
    await refreshCoordinator.run(
      async (isCurrent) => {
        const [collections, nextSnapshots] = await Promise.all([
          persistent.refresh('refresh', isCurrent),
          engine.ops.snapshots.list(),
        ]);
        const ids = [
          ...new Set([
            ...(selectedSeries.length
              ? selectedSeries
              : collections.polls.slice(0, 1).map((item) => item.id)),
            ...collections.watches.map((watch) => watch.seriesId),
          ]),
        ];
        await patterns.refresh(isCurrent);
        const nextSamples = Object.fromEntries(
          await Promise.all(
            ids.map(async (id) => [id, await engine.tools.polls.samples(id)] as const),
          ),
        );
        return {
          ids,
          nextSnapshots,
          nextSamples,
        };
      },
      ownsEngine,
      ({ ids, nextSnapshots, nextSamples }) => {
        setSnapshots(nextSnapshots);
        if (!selectedSeries.length && ids.length) setSelectedSeries(ids);
        setSamples(nextSamples);
      },
    );
  }, [engine, ownsEngine, patterns, persistent, refreshCoordinator, selectedSeries]);

  useEffect(() => {
    persistent.activate();
    patterns.activate();
    refreshCoordinator.activate();
    void refresh().catch(report);
    const off = engine.events.subscribe('tools', (event) => {
      if (!ownsEngine()) return;
      if (event.kind === 'sample' || event.kind === 'watch-alert' || event.kind === 'poll-error')
        void refresh().catch(report);
      if (event.handleId === patternHandle) {
        if (event.kind === 'pattern-event') refreshCoordinator.invalidate();
        if (['done', 'error', 'pattern-finished'].includes(event.kind)) {
          void refresh().catch(report);
        }
      }
      if (event.handleId === discoveryHandle) {
        if (event.kind === 'discovery-result')
          setDiscoveryResults((current) => [...current, event.payload as DiscoveryResult]);
        if (event.kind === 'discovery-progress') {
          const value = event.payload as { completed: number; total: number; found: number };
          setDiscoveryProgress(`${value.completed}/${value.total} · ${value.found} found`);
        }
        if (['done', 'cancelled', 'error'].includes(event.kind)) setDiscoveryHandle(null);
      }
      if (event.handleId === reachHandle) {
        if (event.kind === 'reachability-line')
          setReachLines((current) => [
            ...current.slice(-199),
            (event.payload as { line: string }).line,
          ]);
        if (event.kind === 'done') {
          setReachSummary((event.payload as { summary?: PingSummary }).summary ?? null);
        }
        if (['done', 'cancelled', 'error'].includes(event.kind)) setReachHandle(null);
      }
      if (event.handleId === compareHandle) {
        if (event.kind === 'compare-result') setDiffRows(event.payload as WalkDiffRow[]);
        if (['done', 'cancelled', 'error'].includes(event.kind)) setCompareHandle(null);
      }
      if (event.handleId === portHandle) {
        if (event.kind === 'ports-result') setPorts(event.payload as PortViewRow[]);
        if (['done', 'cancelled', 'error'].includes(event.kind)) setPortHandle(null);
      }
    });
    return () => {
      refreshCoordinator.dispose();
      off();
    };
  }, [
    engine,
    ownsEngine,
    discoveryHandle,
    reachHandle,
    compareHandle,
    portHandle,
    patternHandle,
    persistent,
    patterns,
    refreshCoordinator,
    refresh,
    report,
  ]);

  const chartSeries = useMemo(
    () =>
      selectedSeries.flatMap((id, index) => {
        const item = series.find((candidate) => candidate.id === id);
        return item
          ? [
              {
                id,
                name: item.name,
                color: t.chart.series[index % t.chart.series.length]!,
                samples: samples[id] ?? [],
              },
            ]
          : [];
      }),
    [samples, selectedSeries, series, t.chart.series],
  );
  const chartPatterns = useMemo(
    () =>
      patternSessions.filter((session) =>
        session.seriesIds.some((seriesId) => selectedSeries.includes(seriesId)),
      ),
    [patternSessions, selectedSeries],
  );
  const startPattern = async () => {
    if (!ownsEngine()) return;
    if (!selectedSeries.length || patternHandle) return;
    try {
      if (patternMode === 'active') {
        await patterns.start(
          {
            name: patternName,
            seriesIds: selectedSeries,
            cadenceMs: Number(patternCadence),
            durationMs: Number(patternDuration),
            color: patternTraceColor,
            chartId: activeChartId ?? undefined,
          },
          ownsEngine,
        );
      } else {
        const startAt = Date.parse(patternStart);
        const endAt = Date.parse(patternEnd);
        await patterns.annotate(
          {
            name: patternName,
            seriesIds: selectedSeries,
            cadenceMs: Number(patternCadence),
            startAt,
            endAt,
            color: patternTraceColor,
            chartId: activeChartId ?? undefined,
          },
          ownsEngine,
        );
      }
    } catch (caught) {
      if (ownsEngine()) report(caught);
    }
  };
  const stopPattern = () => {
    if (!patternHandle || patternStopping) return;
    void patterns.cancel(patternHandle, ownsEngine).catch(report);
  };
  const visiblePorts = useMemo(
    () =>
      [...ports]
        .filter((port) =>
          portFilter === 'all'
            ? true
            : portFilter === 'up'
              ? port.operStatus === 1
              : port.operStatus !== 1,
        )
        .sort((a, b) =>
          portSort === 'name'
            ? a.name.localeCompare(b.name)
            : portSort === 'speed'
              ? (b.speedBitsPerSecond ?? -1) - (a.speedBitsPerSecond ?? -1)
              : Number(a.index) - Number(b.index),
        ),
    [ports, portFilter, portSort],
  );
  const persistentBlocked =
    persistentSnapshot.readiness.phase !== 'ready' ||
    ['error-reverted', 'uncertain', 'conflict'].includes(persistentSnapshot.phase);

  const choose = (current: string[], value: string, cap = Infinity) =>
    current.includes(value)
      ? current.filter((id) => id !== value)
      : [...current, value].slice(-cap);
  const communityForDiscoveryResult = (credentialLabel: string) => {
    const match = /^Community #(\d+)$/.exec(credentialLabel);
    return match
      ? communities
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)[Number(match[1]) - 1]
      : undefined;
  };

  return (
    <View style={styles.root}>
      {supportsSplitView ? (
        <WorkspaceHeader
          title="Tools suite"
          subtitle="POLLS · GRAPHS · WATCHES · DISCOVERY · DIFF · PORTS · REACHABILITY"
        />
      ) : null}
      <AgentCollectionRecovery engine={engine} owns={ownsEngine} />
      <View style={[styles.tabs, styles.tabContent, { borderBottomColor: t.border }]}>
        {SECTIONS.map((item) => (
          <Chip
            key={item.key}
            label={item.label}
            active={section === item.key}
            onPress={() => setSection(item.key)}
          />
        ))}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <Card>
            <Label tone="error">{error}</Label>
            <Button title="Dismiss" small variant="ghost" onPress={() => setError(null)} />
          </Card>
        ) : null}
        {persistentSnapshot.readiness.phase !== 'ready' ||
        persistentSnapshot.phase !== 'confirmed' ? (
          <Card>
            <Row style={styles.between}>
              <View style={{ flex: 1 }}>
                <SectionTitle>Saved tools state</SectionTitle>
                <Label
                  tone={
                    ['error-reverted', 'uncertain', 'conflict'].includes(
                      persistentSnapshot.phase,
                    ) || persistentSnapshot.readiness.phase === 'error'
                      ? 'error'
                      : 'dim'
                  }
                >
                  {toolsCollectionStatusText(persistentSnapshot)}
                </Label>
              </View>
              {persistentSnapshot.phase === 'error-reverted' ? (
                <>
                  <Button
                    title="Retry"
                    small
                    onPress={() => void persistent.retryFailed().catch(report)}
                  />
                  <Button
                    title="Acknowledge"
                    small
                    variant="ghost"
                    onPress={() => persistent.acknowledge()}
                  />
                </>
              ) : null}
              {persistentSnapshot.readiness.phase === 'error' ? (
                <Button
                  title="Retry load"
                  small
                  onPress={() => void persistent.load().catch(report)}
                />
              ) : null}
              {['uncertain', 'conflict'].includes(persistentSnapshot.phase) ? (
                <Button
                  title="Reconcile"
                  small
                  onPress={() => void persistent.reconcile().catch(report)}
                />
              ) : null}
            </Row>
          </Card>
        ) : null}
        {section === 'graphs' ? (
          <>
            <ToolTargetSelector
              agents={agents}
              description="Graphs query a saved SNMP agent. Select the device that should receive this poll."
              emptyTitle="Start a graph"
              onAddTarget={() => openTargetSetup('graphs')}
              onToggle={(id) => setSeriesAgent(id)}
              selected={[seriesAgent]}
              title="1. Choose where to poll"
            />
            <Card>
              <SectionTitle>2. Configure the series</SectionTitle>
              {seriesAgent ? (
                <>
                  <Row style={styles.wrap}>
                    <Field label="Name" value={seriesName} onChangeText={setSeriesName} />
                    <Field label="Numeric OID" value={seriesOid} onChangeText={setSeriesOid} />
                    <Field
                      label="Interval ms"
                      value={interval}
                      onChangeText={setIntervalText}
                      keyboardType="numeric"
                    />
                  </Row>
                  <Row style={styles.wrap}>
                    {(['raw', 'delta', 'rate-per-sec'] as const).map((value) => (
                      <Chip
                        key={value}
                        label={value}
                        active={mode === value}
                        onPress={() => setMode(value)}
                      />
                    ))}
                  </Row>
                  <Button
                    title="Create series"
                    disabled={persistentBlocked}
                    onPress={() =>
                      void persistent
                        .createPoll(
                          {
                            name: seriesName,
                            agentId: seriesAgent,
                            oid: seriesOid,
                            intervalMs: Number(interval),
                            mode,
                          },
                          ownsEngine,
                        )
                        .catch(report)
                    }
                  />
                </>
              ) : (
                <Label tone="dim">
                  Choose a poll target above to configure the OID, interval, and mode.
                </Label>
              )}
            </Card>
            <Card>
              <Row style={styles.between}>
                <View style={{ flex: 1 }}>
                  <SectionTitle>3. Pattern Tracer</SectionTitle>
                  <Label tone="dim" size={10}>
                    Mark repeated requests over the graph and overlay measured response time. Active
                    runs use fixed cadence; history mode adds markers without sending traffic.
                  </Label>
                </View>
                {patternHandle ? (
                  <Pill text={patternStopping ? 'STOPPING' : 'RUNNING'} color={t.warn} />
                ) : null}
              </Row>
              <Row style={styles.wrap}>
                <Chip
                  label="Active test"
                  active={patternMode === 'active'}
                  onPress={() => setPatternMode('active')}
                />
                <Chip
                  label="Annotate history"
                  active={patternMode === 'passive'}
                  onPress={() => setPatternMode('passive')}
                />
              </Row>
              <Row style={styles.wrap}>
                <Field label="Name" value={patternName} onChangeText={setPatternName} />
                <Field
                  label="Cadence ms"
                  value={patternCadence}
                  onChangeText={setPatternCadence}
                  keyboardType="numeric"
                />
                {patternMode === 'active' ? (
                  <Field
                    label="Duration ms"
                    value={patternDuration}
                    onChangeText={setPatternDuration}
                    keyboardType="numeric"
                  />
                ) : (
                  <>
                    <Field
                      label="Start ISO time"
                      value={patternStart}
                      onChangeText={setPatternStart}
                    />
                    <Field label="End ISO time" value={patternEnd} onChangeText={setPatternEnd} />
                  </>
                )}
              </Row>
              <Row style={styles.wrap}>
                <Button
                  title={patternMode === 'active' ? 'Start pattern' : 'Annotate history'}
                  small
                  disabled={!selectedSeries.length || Boolean(patternHandle) || patternBlocked}
                  onPress={() => void startPattern()}
                />
                {patternHandle ? (
                  <Button
                    title={patternStopping ? 'Stopping…' : 'Stop'}
                    small
                    variant="danger"
                    disabled={patternStopping || patternBlocked}
                    onPress={stopPattern}
                  />
                ) : null}
                <Label tone="dim" size={10}>
                  Marker color: {patternTraceColor}
                </Label>
              </Row>
              {patternSnapshot.phase !== 'confirmed' ? (
                <Label
                  tone={
                    ['error-reverted', 'uncertain', 'conflict'].includes(patternSnapshot.phase)
                      ? 'error'
                      : 'dim'
                  }
                  size={10}
                >
                  {patternSnapshot.phase === 'queued'
                    ? `${patternSnapshot.queued} pattern change(s) queued`
                    : patternSnapshot.phase === 'updating'
                      ? `Updating ${patternSnapshot.active ?? 'patterns'}…`
                      : (patternSnapshot.error ?? `Pattern persistence ${patternSnapshot.phase}`)}
                </Label>
              ) : null}
              {patternSnapshot.readiness.phase === 'error' ? (
                <Button
                  title="Retry pattern load"
                  small
                  variant="ghost"
                  onPress={() => void patterns.load().catch(report)}
                />
              ) : patternSnapshot.phase === 'uncertain' ? (
                <Button
                  title="Reconcile pattern state"
                  small
                  variant="ghost"
                  onPress={() => void patterns.reconcile().catch(report)}
                />
              ) : ['error-reverted', 'conflict'].includes(patternSnapshot.phase) ? (
                <Button
                  title="Acknowledge pattern error"
                  small
                  variant="ghost"
                  onPress={() => patterns.acknowledge()}
                />
              ) : null}
              {chartPatterns.length ? (
                <Row style={styles.patternSessionList}>
                  {chartPatterns.map((session) => (
                    <Row key={session.id} style={styles.patternSessionRow}>
                      <View style={[styles.patternColorDot, { backgroundColor: session.color }]} />
                      <Label size={10}>
                        {session.name} · {session.mode} · {session.successCount}/{session.hitCount}{' '}
                        successful
                      </Label>
                      <Button
                        title="Delete"
                        small
                        variant="danger"
                        disabled={patternBlocked}
                        onPress={() => void patterns.remove(session.id, ownsEngine).catch(report)}
                      />
                    </Row>
                  ))}
                </Row>
              ) : null}
            </Card>
            <Card>
              {charts.length ? (
                <Row style={styles.wrap}>
                  {charts.map((chart) => (
                    <Chip
                      key={chart.id}
                      label={chart.name}
                      active={chart.seriesIds.every((id) => selectedSeries.includes(id))}
                      onPress={() => {
                        setActiveChartId(chart.id);
                        setSelectedSeries(chart.seriesIds);
                        setHiddenPatternSessionIds(chart.hiddenPatternSessionIds ?? []);
                      }}
                    />
                  ))}
                </Row>
              ) : null}
              <Row style={styles.wrap}>
                {series.map((item) => (
                  <Chip
                    key={item.id}
                    label={`${item.name}${item.errorCount >= 3 ? ' · degraded' : ''}`}
                    active={selectedSeries.includes(item.id)}
                    onPress={() => setSelectedSeries((current) => choose(current, item.id, 8))}
                  />
                ))}
              </Row>
              {chartSeries.length ? (
                <ToolLineChart
                  series={chartSeries}
                  patternSessions={chartPatterns}
                  patternEvents={patternEvents}
                  hiddenPatternSessionIds={hiddenPatternSessionIds}
                  sharePng={shareChartPng}
                  onTogglePatternSession={(sessionId) =>
                    setHiddenPatternSessionIds((current) =>
                      current.includes(sessionId)
                        ? current.filter((id) => id !== sessionId)
                        : [...current, sessionId],
                    )
                  }
                />
              ) : (
                <Label tone="dim">Create and select up to eight series.</Label>
              )}
              <Row style={styles.wrap}>
                <Button
                  title="Sample now"
                  small
                  onPress={() =>
                    void engine.tools.polls.sampleNow(selectedSeries).then(refresh).catch(report)
                  }
                />
                <Button
                  title="Save chart"
                  small
                  variant="ghost"
                  disabled={!selectedSeries.length || persistentBlocked}
                  onPress={() =>
                    void persistent
                      .saveChart(
                        {
                          id: activeChartId ?? undefined,
                          name:
                            charts.find((chart) => chart.id === activeChartId)?.name ??
                            `Chart ${new Date().toLocaleTimeString()}`,
                          seriesIds: selectedSeries,
                          hiddenPatternSessionIds,
                        },
                        ownsEngine,
                      )
                      .catch(report)
                  }
                />
              </Row>
            </Card>
            {series.map((item) => (
              <Card key={item.id}>
                <Row style={styles.between}>
                  <View>
                    <Text style={{ color: t.text, fontWeight: '800' }}>{item.name}</Text>
                    <Mono dim size={9}>
                      {item.oid} · {item.mode} · {item.intervalMs} ms
                    </Mono>
                  </View>
                  <Pill
                    text={item.paused ? 'PAUSED' : item.errorCount >= 3 ? 'DEGRADED' : 'ACTIVE'}
                    color={item.errorCount >= 3 ? t.error : item.paused ? t.textDim : t.ok}
                  />
                </Row>
                {item.lastError ? (
                  <Label tone="error" size={10}>
                    {item.lastError}
                  </Label>
                ) : null}
                {persistent.statusFor(`poll:update:${item.id}`) ||
                persistent.statusFor(`poll:remove:${item.id}`) ? (
                  <Label tone="dim" size={10}>
                    {persistent.statusFor(`poll:update:${item.id}`) ??
                      persistent.statusFor(`poll:remove:${item.id}`)}
                  </Label>
                ) : null}
                <Row style={styles.wrap}>
                  <Button
                    title={item.paused ? 'Resume' : 'Pause'}
                    small
                    variant="ghost"
                    disabled={persistentBlocked}
                    onPress={() =>
                      void persistent
                        .updatePoll(item.id, { paused: !item.paused }, ownsEngine)
                        .catch(report)
                    }
                  />
                  {(['raw', 'delta', 'rate-per-sec'] as const).map((value) => (
                    <Chip
                      key={value}
                      label={value}
                      active={item.mode === value}
                      disabled={persistentBlocked}
                      onPress={() =>
                        void persistent
                          .updatePoll(item.id, { mode: value }, ownsEngine)
                          .catch(report)
                      }
                    />
                  ))}
                  <Button
                    title="CSV"
                    small
                    variant="ghost"
                    onPress={() =>
                      void engine.tools.polls
                        .exportCsv(item.id)
                        .then((csv) => {
                          if (!ownsEngine()) return;
                          if (Platform.OS === 'web' && typeof document !== 'undefined') {
                            const url = URL.createObjectURL(
                              new Blob([csv], { type: 'text/csv;charset=utf-8' }),
                            );
                            const anchor = document.createElement('a');
                            anchor.href = url;
                            anchor.download = `${item.name}.csv`;
                            anchor.click();
                            setTimeout(() => URL.revokeObjectURL(url), 10_000);
                            return;
                          }
                          return Share.share({ message: csv, title: `${item.name}.csv` });
                        })
                        .catch(report)
                    }
                  />
                  <Button
                    title="Delete"
                    small
                    variant="danger"
                    disabled={persistentBlocked}
                    onPress={() => void persistent.removePoll(item.id, ownsEngine).catch(report)}
                  />
                </Row>
              </Card>
            ))}
          </>
        ) : null}
        {section === 'watches' ? (
          <>
            <Card>
              <SectionTitle>Create watch</SectionTitle>
              <Row style={styles.wrap}>
                {series.map((item) => (
                  <Chip
                    key={item.id}
                    label={item.name}
                    active={watchSeries === item.id}
                    onPress={() => setWatchSeries(item.id)}
                  />
                ))}
              </Row>
              <Row style={styles.wrap}>
                <Field label="Name" value={watchName} onChangeText={setWatchName} />
                <Field
                  label="Threshold"
                  value={threshold}
                  onChangeText={setThreshold}
                  keyboardType="numeric"
                />
              </Row>
              <Row style={styles.wrap}>
                {(['>', '<', '==', '!='] as const).map((value) => (
                  <Chip
                    key={value}
                    label={value}
                    active={operator === value}
                    onPress={() => setOperator(value)}
                  />
                ))}
                {(['value', 'raw'] as const).map((value) => (
                  <Chip
                    key={value}
                    label={value === 'value' ? 'Derived/rate' : 'Raw'}
                    active={thresholdMode === value}
                    onPress={() => setThresholdMode(value)}
                  />
                ))}
              </Row>
              <Button
                title="Save watch"
                disabled={!watchSeries || persistentBlocked}
                onPress={() =>
                  void persistent
                    .saveWatch(
                      {
                        seriesId: watchSeries,
                        name: watchName,
                        operator,
                        threshold: Number(threshold),
                        thresholdMode,
                      },
                      ownsEngine,
                    )
                    .catch(report)
                }
              />
            </Card>
            <View style={styles.grid}>
              {watches.map((watch) => (
                <Card
                  key={watch.id}
                  style={[styles.watchCard, watch.breaching ? { borderColor: t.error } : null]}
                >
                  <Row style={styles.between}>
                    <SectionTitle>{watch.name}</SectionTitle>
                    <Pill
                      text={watch.breaching ? 'BREACH' : 'OK'}
                      color={watch.breaching ? t.error : t.ok}
                    />
                  </Row>
                  <Mono size={18}>{watch.current?.value ?? watch.current?.rawValue ?? '—'}</Mono>
                  <ToolSparkline
                    samples={samples[watch.seriesId] ?? []}
                    color={watch.breaching ? t.error : t.accent}
                  />
                  {watch.stats ? (
                    <Label tone="dim" size={10}>
                      min {watch.stats.min} · max {watch.stats.max} · avg{' '}
                      {watch.stats.avg.toFixed(2)}
                    </Label>
                  ) : null}
                  <Label tone="dim" size={9}>
                    last change{' '}
                    {watch.lastChangeAt ? new Date(watch.lastChangeAt).toLocaleString() : 'unknown'}
                  </Label>
                  {persistent.statusFor(`watch:remove:${watch.id}`) ? (
                    <Label tone="dim" size={10}>
                      {persistent.statusFor(`watch:remove:${watch.id}`)}
                    </Label>
                  ) : null}
                  <Button
                    title="Delete"
                    small
                    variant="ghost"
                    disabled={persistentBlocked}
                    onPress={() => void persistent.removeWatch(watch.id, ownsEngine).catch(report)}
                  />
                </Card>
              ))}
            </View>
          </>
        ) : null}
        {section === 'discovery' ? (
          <>
            <Card>
              <SectionTitle>SNMP subnet discovery</SectionTitle>
              <Field label="CIDR or inclusive range" value={target} onChangeText={setTarget} />
              <Field
                label="Ad-hoc v2c communities (comma-separated, never emitted)"
                value={communities}
                onChangeText={setCommunities}
                secureTextEntry
              />
              <Label tone="dim" size={10}>
                Mobile defaults to at most 254 hosts to protect battery and local networks.
              </Label>
              {Platform.OS === 'web' ? (
                <Chip
                  label="Desktop ICMP pre-ping"
                  active={discoveryPrePing}
                  onPress={() => setDiscoveryPrePing((value) => !value)}
                />
              ) : null}
              <AgentChips
                agents={agents}
                selected={credentialIds}
                onToggle={(id) => setCredentialIds((current) => choose(current, id))}
              />
              <Row>
                <Button
                  title={discoveryHandle ? 'Running…' : 'Start'}
                  disabled={
                    Boolean(discoveryHandle) || (!credentialIds.length && !communities.trim())
                  }
                  onPress={() => {
                    setDiscoveryResults([]);
                    const adhoc = communities
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean);
                    void runToolStart(
                      'tools-discovery',
                      () =>
                        engine.tools.discovery.start({
                          target,
                          credentials: [
                            ...credentialIds.map((agentId) => ({
                              agentId,
                              label: agents.find((agent) => agent.id === agentId)?.name ?? agentId,
                            })),
                            ...adhoc.map((community, index) => ({
                              community,
                              label: `Community #${index + 1}`,
                            })),
                          ],
                          prePing: discoveryPrePing,
                        }),
                      (id) => engine.tools.discovery.cancel(id),
                      (handleId) => {
                        acceptedHandles.current.discovery = handleId;
                        setDiscoveryHandle(handleId);
                        setDiscoveryProgress('Starting…');
                      },
                    );
                  }}
                />
                <Button
                  title="Cancel"
                  variant="ghost"
                  disabled={!discoveryHandle}
                  onPress={() =>
                    discoveryHandle &&
                    void engine.tools.discovery.cancel(discoveryHandle).catch(() => undefined)
                  }
                />
              </Row>
              <Label tone="dim">{discoveryProgress}</Label>
            </Card>
            {discoveryResults.map((result) => (
              <Card key={`${result.ip}-${result.credentialLabel}`}>
                <Row style={styles.between}>
                  <View>
                    <SectionTitle>{result.sysName ?? result.ip}</SectionTitle>
                    <Mono dim size={10}>
                      {result.ip} · {result.version} · {result.credentialLabel} · {result.latencyMs}{' '}
                      ms
                    </Mono>
                  </View>
                  <Pill text="SNMP" color={t.ok} />
                </Row>
                <Label size={10}>
                  {result.sysDescr?.slice(0, 220) ?? result.sysObjectId ?? 'Responded'}
                </Label>
                <Row>
                  <Button
                    title="Save agent"
                    small
                    loading={activeDiscoverySave?.ip === result.ip}
                    loadingTitle="Saving…"
                    disabled={
                      activeDiscoverySave !== null ||
                      agentCollectionsBlocked ||
                      (/^Community #\d+$/.test(result.credentialLabel) &&
                        !communityForDiscoveryResult(result.credentialLabel))
                    }
                    onPress={() => {
                      const match = /^Community #(\d+)$/.exec(result.credentialLabel);
                      const community = communityForDiscoveryResult(result.credentialLabel);
                      if (match && !community) {
                        report(new Error('Re-enter the discovery community before saving.'));
                        return;
                      }
                      const saveId = ++discoverySaveSequence.current;
                      setSavingDiscovery({ id: saveId, ip: result.ip, engine });
                      void agentCollections
                        .saveDiscoveredProfile(
                          {
                            ip: result.ip,
                            name: result.sysName,
                            credentialAgentId: result.credentialAgentId,
                            community,
                          },
                          ownsEngine,
                        )
                        .then(() => refreshAgentProfiles(engine, ownsEngine))
                        .catch((caught) => {
                          if (!ownsEngine()) return;
                          setCommunities('');
                          report(caught);
                        })
                        .finally(() => {
                          if (!ownsEngine()) return;
                          setSavingDiscovery((current) =>
                            current?.id === saveId ? null : current,
                          );
                        });
                    }}
                  />
                  <Button
                    title="Open Query"
                    small
                    variant="ghost"
                    onPress={() => {
                      const state = useAppStore.getState();
                      state.selectAgentProfile(null);
                      state.setAgent({ host: result.ip });
                      state.setTab('query');
                    }}
                  />
                </Row>
              </Card>
            ))}
          </>
        ) : null}
        {section === 'compare' ? (
          <>
            <ToolTargetSelector
              agents={agents}
              description="Compare needs two saved SNMP agents. Choose A, then B."
              emptyTitle="Start a comparison"
              onAddTarget={() => openTargetSetup('compare')}
              onToggle={(id) => {
                if (id === compareA) setCompareA('');
                else if (id === compareB) setCompareB('');
                else if (!compareA) setCompareA(id);
                else setCompareB(id);
              }}
              selected={[compareA, compareB].filter(Boolean)}
              title="1. Choose two poll targets"
            />
            <Card>
              <SectionTitle>2. Configure live comparison</SectionTitle>
              {compareA && compareB ? (
                <>
                  <Field label="Subtree OID" value={compareOid} onChangeText={setCompareOid} />
                  <Row>
                    <Button
                      title={compareHandle ? 'Comparing…' : 'Compare live walks'}
                      disabled={Boolean(compareHandle)}
                      onPress={() =>
                        void runToolStart(
                          'tools-compare',
                          () =>
                            engine.tools.compare.start({
                              agentAId: compareA,
                              agentBId: compareB,
                              baseOid: compareOid,
                            }),
                          (id) => engine.tools.compare.cancel(id),
                          (id) => {
                            acceptedHandles.current.compare = id;
                            setCompareHandle(id);
                          },
                        )
                      }
                    />
                    <Button
                      title="Cancel"
                      variant="ghost"
                      disabled={!compareHandle}
                      onPress={() =>
                        compareHandle &&
                        void engine.tools.compare.cancel(compareHandle).catch(() => undefined)
                      }
                    />
                  </Row>
                </>
              ) : (
                <Label tone="dim">Choose two poll targets above to compare live SNMP walks.</Label>
              )}
            </Card>
            <Card>
              <SectionTitle>Saved snapshot diff</SectionTitle>
              <Row style={styles.wrap}>
                {snapshots.map((snapshot) => (
                  <Chip
                    key={snapshot.id}
                    label={snapshot.name}
                    active={snapshot.id === snapshotA || snapshot.id === snapshotB}
                    onPress={() => {
                      if (snapshot.id === snapshotA) setSnapshotA('');
                      else if (snapshot.id === snapshotB) setSnapshotB('');
                      else if (!snapshotA) setSnapshotA(snapshot.id);
                      else setSnapshotB(snapshot.id);
                    }}
                  />
                ))}
              </Row>
              <Button
                title="Compare snapshots"
                disabled={!snapshotA || !snapshotB}
                onPress={() =>
                  void engine.tools.compare
                    .snapshots(snapshotA, snapshotB)
                    .then(setDiffRows)
                    .catch(report)
                }
              />
            </Card>
            <Card>
              <SectionTitle>Offline snmpwalk diff</SectionTitle>
              <Field
                label="Walk A (-On numeric output)"
                value={walkA}
                onChangeText={setWalkA}
                multiline
              />
              <Field
                label="Walk B (-On numeric output)"
                value={walkB}
                onChangeText={setWalkB}
                multiline
              />
              <Button
                title="Parse & diff"
                onPress={() =>
                  void engine.tools.compare
                    .text(walkA, walkB)
                    .then((rows) => ownsEngine() && setDiffRows(rows))
                    .catch((caught) => ownsEngine() && report(caught))
                }
              />
            </Card>
            <DiffTable
              rows={diffRows}
              differencesOnly={differencesOnly}
              onToggle={() => setDifferencesOnly((value) => !value)}
            />
          </>
        ) : null}
        {section === 'ports' ? (
          <>
            <ToolTargetSelector
              agents={agents}
              description="Choose the saved SNMP agent whose interfaces you want to inspect."
              emptyTitle="Start a port view"
              onAddTarget={() => openTargetSetup('ports')}
              onToggle={setPortAgent}
              selected={[portAgent]}
              title="1. Choose a port target"
            />
            <Card>
              <SectionTitle>2. Load interface data</SectionTitle>
              {portAgent ? (
                <>
                  <Row>
                    <Button
                      title={portHandle ? 'Loading…' : 'Load ifTable / ifXTable'}
                      disabled={Boolean(portHandle)}
                      onPress={() =>
                        void runToolStart(
                          'tools-ports',
                          () => engine.tools.ports.start(portAgent),
                          (id) => engine.tools.ports.cancel(id),
                          (id) => {
                            acceptedHandles.current.ports = id;
                            setPortHandle(id);
                          },
                        )
                      }
                    />
                    <Button
                      title="Cancel"
                      variant="ghost"
                      disabled={!portHandle}
                      onPress={() =>
                        portHandle &&
                        void engine.tools.ports.cancel(portHandle).catch(() => undefined)
                      }
                    />
                  </Row>
                  <Row style={styles.wrap}>
                    {(['all', 'up', 'down'] as const).map((value) => (
                      <Chip
                        key={value}
                        label={`Status: ${value}`}
                        active={portFilter === value}
                        onPress={() => setPortFilter(value)}
                      />
                    ))}
                    {(['index', 'name', 'speed'] as const).map((value) => (
                      <Chip
                        key={value}
                        label={`Sort: ${value}`}
                        active={portSort === value}
                        onPress={() => setPortSort(value)}
                      />
                    ))}
                  </Row>
                </>
              ) : (
                <Label tone="dim">Choose a port target above to load its interface table.</Label>
              )}
            </Card>
            {visiblePorts.map((port) => (
              <Card key={port.index}>
                <Row style={styles.between}>
                  <View>
                    <SectionTitle>{port.name}</SectionTitle>
                    <Label tone="dim" size={10}>
                      index {port.index}
                      {port.alias ? ` · ${port.alias}` : ''}
                    </Label>
                  </View>
                  <Row>
                    <Pill
                      text={`ADMIN ${port.adminStatus === 1 ? 'UP' : port.adminStatus === 2 ? 'DOWN' : '?'}`}
                      color={
                        port.adminStatus === 1
                          ? t.semantic.status.up
                          : port.adminStatus === 2
                            ? t.semantic.status.down
                            : t.semantic.status.unknown
                      }
                    />
                    <Pill
                      text={`OPER ${port.operStatus === 1 ? 'UP' : port.operStatus === 2 ? 'DOWN' : '?'}`}
                      color={
                        port.operStatus === 1
                          ? t.semantic.status.up
                          : port.operStatus === 2
                            ? t.semantic.status.down
                            : t.semantic.status.unknown
                      }
                    />
                  </Row>
                </Row>
                <Label size={10}>
                  admin{' '}
                  {port.adminStatus === 1 ? 'up' : port.adminStatus === 2 ? 'down' : 'unknown'} ·{' '}
                  speed{' '}
                  {port.speedBitsPerSecond
                    ? `${port.speedBitsPerSecond} bps`
                    : 'unknown · absolute bps remains available'}{' '}
                  · {port.highCapacity ? 'HC counters' : '32-bit fallback'}
                </Label>
                <Mono dim size={9}>
                  in {port.inBitsPerSecond ?? port.inOctets ?? '—'}{' '}
                  {port.inBitsPerSecond === undefined ? 'octets' : 'bps'}
                  {port.inUtilizationPercent === undefined
                    ? ''
                    : ` · ${port.inUtilizationPercent.toFixed(2)}%`}{' '}
                  · out {port.outBitsPerSecond ?? port.outOctets ?? '—'}{' '}
                  {port.outBitsPerSecond === undefined ? 'octets' : 'bps'}
                  {port.outUtilizationPercent === undefined
                    ? ''
                    : ` · ${port.outUtilizationPercent.toFixed(2)}%`}{' '}
                  · error rate {port.inErrorRate ?? '—'}/{port.outErrorRate ?? '—'}
                </Mono>
                <Row>
                  <Button
                    title={portDetail === port.index ? 'Hide details' : 'Details'}
                    small
                    variant="ghost"
                    onPress={() =>
                      setPortDetail((value) => (value === port.index ? null : port.index))
                    }
                  />
                  <Button
                    title="Monitor & graph"
                    small
                    onPress={() =>
                      void engine.tools.ports
                        .monitor(portAgent, port.index, port.highCapacity)
                        .then(async (created) => {
                          setSelectedSeries(created.slice(0, 2).map((item) => item.id));
                          setPortDetail(port.index);
                          await refresh();
                        })
                        .catch(report)
                    }
                  />
                </Row>
                {portDetail === port.index ? (
                  <View>
                    {series
                      .filter(
                        (item) =>
                          item.agentId === portAgent && item.name.startsWith(`if${port.index} `),
                      )
                      .map((item, index) => (
                        <View key={item.id}>
                          <Label tone="dim" size={9}>
                            {item.name}
                          </Label>
                          <ToolSparkline
                            samples={samples[item.id] ?? []}
                            color={t.chart.series[index % t.chart.series.length]!}
                          />
                        </View>
                      ))}
                  </View>
                ) : null}
              </Card>
            ))}
          </>
        ) : null}
        {section === 'reachability' ? (
          <Card>
            <SectionTitle>Desktop reachability</SectionTitle>
            <Row>
              {(['ping', 'traceroute'] as const).map((value) => (
                <Chip
                  key={value}
                  label={value}
                  active={reachKind === value}
                  onPress={() => setReachKind(value)}
                />
              ))}
            </Row>
            <Field label="Host or address" value={reachTarget} onChangeText={setReachTarget} />
            {reachKind === 'ping' ? (
              <Row>
                <Field label="Count (1–20)" value={reachCount} onChangeText={setReachCount} />
                <Field
                  label="Interval ms (Unix)"
                  value={reachInterval}
                  onChangeText={setReachInterval}
                />
              </Row>
            ) : null}
            <Label tone="dim" size={10}>
              {Platform.OS === 'web'
                ? 'Desktop host command output streams below. Windows ping uses its native fixed interval.'
                : 'ICMP/traceroute require the desktop host; mobile uses SNMP discovery.'}
            </Label>
            <Row>
              <Button
                title={reachHandle ? 'Running…' : 'Run'}
                disabled={Boolean(reachHandle)}
                onPress={() => {
                  setReachLines([]);
                  setReachSummary(null);
                  void runToolStart(
                    'tools-reachability',
                    () =>
                      engine.tools.reachability.start({
                        kind: reachKind,
                        target: reachTarget,
                        count: Number(reachCount),
                        intervalMs: Number(reachInterval),
                      }),
                    (id) => engine.tools.reachability.cancel(id),
                    (id) => {
                      acceptedHandles.current.reach = id;
                      setReachHandle(id);
                    },
                  );
                }}
              />
              <Button
                title="Cancel"
                variant="ghost"
                disabled={!reachHandle}
                onPress={() =>
                  reachHandle &&
                  void engine.tools.reachability.cancel(reachHandle).catch(() => undefined)
                }
              />
            </Row>
            {reachSummary ? (
              <Card>
                <SectionTitle>Ping statistics</SectionTitle>
                <Label>
                  {reachSummary.received}/{reachSummary.transmitted} received ·{' '}
                  {reachSummary.lossPercent}% loss
                  {reachSummary.avgMs === undefined
                    ? ''
                    : ` · min/avg/max ${reachSummary.minMs}/${reachSummary.avgMs}/${reachSummary.maxMs} ms`}
                </Label>
              </Card>
            ) : null}
            <View style={[styles.console, { backgroundColor: t.bg }]}>
              {reachLines.map((line, index) => (
                <Mono key={`${index}-${line}`} size={9}>
                  {line}
                </Mono>
              ))}
            </View>
          </Card>
        ) : null}
      </ScrollView>
      <AgentProfileDialog
        visible={targetSetupSection !== null}
        editor={targetEditor}
        error={targetError}
        info={info}
        busy={targetBusy || agentCollectionsBlocked}
        title="Add an SNMP target"
        subtitle="Enter the SNMP target, credentials, and optional v3 security settings."
        submitTitle={
          targetSetupSection === 'compare' ? 'Save and add target' : 'Save and use target'
        }
        onEditorChange={setTargetEditor}
        onSubmit={() => void createTarget()}
        onClose={cancelTargetSetup}
      />
    </View>
  );
}

function ToolTargetSelector({
  agents,
  description,
  emptyTitle,
  onAddTarget,
  onToggle,
  selected,
  title,
}: {
  agents: AgentProfile[];
  description: string;
  emptyTitle: string;
  onAddTarget: () => void;
  onToggle: (id: string) => void;
  selected: string[];
  title: string;
}) {
  const selectedProfiles = selected.flatMap((id) => {
    const profile = agents.find((candidate) => candidate.id === id);
    return profile ? [profile] : [];
  });
  const hasTargets = agents.length > 0;
  return (
    <Card>
      <Row style={styles.between}>
        <View style={styles.targetCopy}>
          <SectionTitle>{hasTargets ? title : emptyTitle}</SectionTitle>
          <Label tone="dim" size={10}>
            {hasTargets
              ? description
              : 'Add a saved SNMP target here, then select it to begin using this utility.'}
          </Label>
        </View>
        {hasTargets ? (
          <Button title="Add target" small variant="ghost" onPress={onAddTarget} />
        ) : null}
      </Row>
      {hasTargets ? (
        <>
          <AgentChips agents={agents} selected={selected} onToggle={onToggle} />
          <Row style={styles.wrap}>
            <Button
              title="Manage profiles"
              small
              variant="ghost"
              onPress={() => useAppStore.getState().setTab('agents')}
            />
          </Row>
        </>
      ) : (
        <Button title="Add an SNMP target" onPress={onAddTarget} />
      )}
      {selectedProfiles.map((profile) => (
        <Mono key={profile.id} dim size={10}>
          Polling: {profile.name} — {profile.host}:{profile.port} · SNMP {profile.version}
        </Mono>
      ))}
    </Card>
  );
}

function AgentChips({
  agents,
  selected,
  onToggle,
}: {
  agents: ReturnType<typeof useAppStore.getState>['agentProfiles'];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <Row style={styles.wrap}>
      {agents.map((agent) => (
        <Chip
          key={agent.id}
          label={agent.name}
          active={selected.includes(agent.id)}
          onPress={() => onToggle(agent.id)}
        />
      ))}
    </Row>
  );
}

function DiffTable({
  rows,
  differencesOnly,
  onToggle,
}: {
  rows: WalkDiffRow[];
  differencesOnly: boolean;
  onToggle: () => void;
}) {
  const t = useTheme();
  const visible = differencesOnly ? rows.filter((row) => row.status !== 'equal') : rows;
  return (
    <Card>
      <Row style={styles.between}>
        <SectionTitle>Aligned diff · {visible.length} rows</SectionTitle>
        <Row>
          <Chip label="Differences only" active={differencesOnly} onPress={onToggle} />
          <Button
            title="CSV"
            small
            variant="ghost"
            onPress={() =>
              void Share.share({
                title: 'walk-diff.csv',
                message: [
                  'oid,name,status,value_a,value_b',
                  ...visible.map((row) =>
                    [row.oid, row.name ?? '', row.status, row.valueA ?? '', row.valueB ?? '']
                      .map((value) => `"${value.replaceAll('"', '""')}"`)
                      .join(','),
                  ),
                ].join('\n'),
              })
            }
          />
        </Row>
      </Row>
      {visible.slice(0, 5_000).map((row) => (
        <View key={row.oid} style={[styles.diffRow, { borderBottomColor: t.border }]}>
          <Pill
            text={row.status}
            color={
              row.status === 'equal'
                ? t.semantic.diff.equal
                : row.status === 'different'
                  ? t.semantic.diff.changed
                  : row.status === 'only-a'
                    ? t.semantic.diff.removed
                    : t.semantic.diff.added
            }
          />
          <Mono size={9}>{row.name ?? row.oid}</Mono>
          <Label size={10}>
            A: {row.valueA ?? '—'} · B: {row.valueB ?? '—'}
          </Label>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0 },
  tabs: { flexGrow: 0, borderBottomWidth: 1 },
  tabContent: { flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 6 },
  content: {
    padding: 12,
    gap: 10,
    paddingBottom: 48,
    maxWidth: 1100,
    width: '100%',
    alignSelf: 'center',
  },
  wrap: { flexWrap: 'wrap' },
  between: { justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  patternSessionList: { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
  patternSessionRow: { alignItems: 'center', gap: 6 },
  patternColorDot: { width: 9, height: 9, borderRadius: 5 },
  targetCopy: { flex: 1, minWidth: 0, gap: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  watchCard: { minWidth: 230, flexGrow: 1, borderWidth: 1 },
  console: { minHeight: 180, maxHeight: 420, padding: 10, borderRadius: 8 },
  diffRow: { paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, gap: 3 },
});
