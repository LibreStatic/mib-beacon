import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import type {
  DiscoveryResult,
  PollSample,
  PollChart,
  PollSeries,
  PollWatch,
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
  useTheme,
} from '@mibbeacon/ui';
import { useEngine } from '../engine-context';
import { useAppStore } from '../store';
import { refreshAgentProfiles } from '../actions';
import { ToolLineChart, ToolSparkline } from '../components/ToolLineChart';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { useResponsiveLayout } from '../responsive-context';

interface PingSummary {
  transmitted: number;
  received: number;
  lossPercent: number;
  minMs?: number;
  avgMs?: number;
  maxMs?: number;
}

type ToolSection = 'graphs' | 'watches' | 'discovery' | 'compare' | 'ports' | 'reachability';
const SECTIONS: { key: ToolSection; label: string }[] = [
  { key: 'graphs', label: 'Graphs' },
  { key: 'watches', label: 'Watches' },
  { key: 'discovery', label: 'Discovery' },
  { key: 'compare', label: 'Compare' },
  { key: 'ports', label: 'Ports' },
  { key: 'reachability', label: 'Ping / trace' },
];
const COLORS = [
  '#4f8ef7',
  '#25b99a',
  '#f59e0b',
  '#e35d6a',
  '#9b6cff',
  '#22a6d5',
  '#d96bc0',
  '#8fa63f',
];

export function ToolsScreen() {
  const engine = useEngine();
  const t = useTheme();
  const { supportsSplitView } = useResponsiveLayout();
  const agents = useAppStore((state) => state.agentProfiles);
  const [section, setSection] = useState<ToolSection>('graphs');
  const [series, setSeries] = useState<PollSeries[]>([]);
  const [watches, setWatches] = useState<PollWatch[]>([]);
  const [charts, setCharts] = useState<PollChart[]>([]);
  const [samples, setSamples] = useState<Record<string, PollSample[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<string[]>([]);
  const [seriesName, setSeriesName] = useState('New series');
  const [seriesAgent, setSeriesAgent] = useState('');
  const [seriesOid, setSeriesOid] = useState('1.3.6.1.2.1.1.3.0');
  const [interval, setIntervalText] = useState('5000');
  const [mode, setMode] = useState<PollSeries['mode']>('raw');
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

  const report = useCallback(
    (value: unknown) => setError(value instanceof Error ? value.message : String(value)),
    [],
  );
  const refresh = useCallback(async () => {
    const [nextSeries, nextWatches, nextCharts, nextSnapshots] = await Promise.all([
      engine.tools.polls.list(),
      engine.tools.watches.list(),
      engine.tools.charts.list(),
      engine.ops.snapshots.list(),
    ]);
    setSeries(nextSeries);
    setWatches(nextWatches);
    setCharts(nextCharts);
    setSnapshots(nextSnapshots);
    const ids = [
      ...new Set([
        ...(selectedSeries.length ? selectedSeries : nextSeries.slice(0, 1).map((item) => item.id)),
        ...nextWatches.map((watch) => watch.seriesId),
      ]),
    ];
    if (!selectedSeries.length && ids.length) setSelectedSeries(ids);
    setSamples(
      Object.fromEntries(
        await Promise.all(
          ids.map(async (id) => [id, await engine.tools.polls.samples(id)] as const),
        ),
      ),
    );
  }, [engine, selectedSeries]);

  useEffect(() => {
    void refresh().catch(report);
    const off = engine.events.subscribe('tools', (event) => {
      if (event.kind === 'sample' || event.kind === 'watch-alert' || event.kind === 'poll-error')
        void refresh();
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
    return off;
  }, [engine, discoveryHandle, reachHandle, compareHandle, portHandle, refresh, report]);

  const chartSeries = useMemo(
    () =>
      selectedSeries.flatMap((id, index) => {
        const item = series.find((candidate) => candidate.id === id);
        return item
          ? [
              {
                id,
                name: item.name,
                color: COLORS[index % COLORS.length]!,
                samples: samples[id] ?? [],
              },
            ]
          : [];
      }),
    [samples, selectedSeries, series],
  );
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

  const choose = (current: string[], value: string, cap = Infinity) =>
    current.includes(value)
      ? current.filter((id) => id !== value)
      : [...current, value].slice(-cap);

  return (
    <View style={styles.root}>
      {supportsSplitView ? (
        <WorkspaceHeader
          title="Tools suite"
          subtitle="POLLS · GRAPHS · WATCHES · DISCOVERY · DIFF · PORTS · REACHABILITY"
        />
      ) : null}
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
        {section === 'graphs' ? (
          <>
            <Card>
              <SectionTitle>Poll series</SectionTitle>
              <AgentChips
                agents={agents}
                selected={[seriesAgent]}
                onToggle={(id) => setSeriesAgent(id)}
              />
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
                disabled={!seriesAgent}
                onPress={() =>
                  void engine.tools.polls
                    .create({
                      name: seriesName,
                      agentId: seriesAgent,
                      oid: seriesOid,
                      intervalMs: Number(interval),
                      mode,
                    })
                    .then(refresh)
                    .catch(report)
                }
              />
            </Card>
            <Card>
              {charts.length ? (
                <Row style={styles.wrap}>
                  {charts.map((chart) => (
                    <Chip
                      key={chart.id}
                      label={chart.name}
                      active={chart.seriesIds.every((id) => selectedSeries.includes(id))}
                      onPress={() => setSelectedSeries(chart.seriesIds)}
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
                <ToolLineChart series={chartSeries} />
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
                  disabled={!selectedSeries.length}
                  onPress={() =>
                    void engine.tools.charts
                      .save({
                        name: `Chart ${new Date().toLocaleTimeString()}`,
                        seriesIds: selectedSeries,
                      })
                      .then(refresh)
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
                <Row style={styles.wrap}>
                  <Button
                    title={item.paused ? 'Resume' : 'Pause'}
                    small
                    variant="ghost"
                    onPress={() =>
                      void engine.tools.polls
                        .update(item.id, { paused: !item.paused })
                        .then(refresh)
                        .catch(report)
                    }
                  />
                  {(['raw', 'delta', 'rate-per-sec'] as const).map((value) => (
                    <Chip
                      key={value}
                      label={value}
                      active={item.mode === value}
                      onPress={() =>
                        void engine.tools.polls
                          .update(item.id, { mode: value })
                          .then(refresh)
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
                        .then((csv) => Share.share({ message: csv, title: `${item.name}.csv` }))
                        .catch(report)
                    }
                  />
                  <Button
                    title="Delete"
                    small
                    variant="danger"
                    onPress={() =>
                      void engine.tools.polls.remove(item.id).then(refresh).catch(report)
                    }
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
                disabled={!watchSeries}
                onPress={() =>
                  void engine.tools.watches
                    .save({
                      seriesId: watchSeries,
                      name: watchName,
                      operator,
                      threshold: Number(threshold),
                      thresholdMode,
                    })
                    .then(refresh)
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
                  <Button
                    title="Delete"
                    small
                    variant="ghost"
                    onPress={() =>
                      void engine.tools.watches.remove(watch.id).then(refresh).catch(report)
                    }
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
                    void engine.tools.discovery
                      .start({
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
                      })
                      .then(({ handleId }) => {
                        setDiscoveryHandle(handleId);
                        setDiscoveryProgress('Starting…');
                      })
                      .catch(report);
                  }}
                />
                <Button
                  title="Cancel"
                  variant="ghost"
                  disabled={!discoveryHandle}
                  onPress={() =>
                    discoveryHandle && void engine.tools.discovery.cancel(discoveryHandle)
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
                    onPress={() => {
                      const match = /^Community #(\d+)$/.exec(result.credentialLabel);
                      const community = match
                        ? communities
                            .split(',')
                            .map((value) => value.trim())
                            .filter(Boolean)[Number(match[1]) - 1]
                        : undefined;
                      void engine.tools.discovery
                        .saveAgent({
                          ip: result.ip,
                          name: result.sysName,
                          credentialAgentId: result.credentialAgentId,
                          community,
                        })
                        .then(() => refreshAgentProfiles(engine))
                        .catch(report);
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
            <Card>
              <SectionTitle>Live device compare</SectionTitle>
              <Label tone="dim" size={10}>
                Choose A, then B.
              </Label>
              <AgentChips
                agents={agents}
                selected={[compareA, compareB].filter(Boolean)}
                onToggle={(id) => {
                  if (id === compareA) setCompareA('');
                  else if (id === compareB) setCompareB('');
                  else if (!compareA) setCompareA(id);
                  else setCompareB(id);
                }}
              />
              <Field label="Subtree OID" value={compareOid} onChangeText={setCompareOid} />
              <Row>
                <Button
                  title={compareHandle ? 'Comparing…' : 'Compare live walks'}
                  disabled={!compareA || !compareB || Boolean(compareHandle)}
                  onPress={() =>
                    void engine.tools.compare
                      .start({ agentAId: compareA, agentBId: compareB, baseOid: compareOid })
                      .then(({ handleId }) => setCompareHandle(handleId))
                      .catch(report)
                  }
                />
                <Button
                  title="Cancel"
                  variant="ghost"
                  disabled={!compareHandle}
                  onPress={() => compareHandle && void engine.tools.compare.cancel(compareHandle)}
                />
              </Row>
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
                  void engine.tools.compare.text(walkA, walkB).then(setDiffRows).catch(report)
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
            <Card>
              <SectionTitle>Interface port view</SectionTitle>
              <AgentChips agents={agents} selected={[portAgent]} onToggle={setPortAgent} />
              <Row>
                <Button
                  title={portHandle ? 'Loading…' : 'Load ifTable / ifXTable'}
                  disabled={!portAgent || Boolean(portHandle)}
                  onPress={() =>
                    void engine.tools.ports
                      .start(portAgent)
                      .then(({ handleId }) => setPortHandle(handleId))
                      .catch(report)
                  }
                />
                <Button
                  title="Cancel"
                  variant="ghost"
                  disabled={!portHandle}
                  onPress={() => portHandle && void engine.tools.ports.cancel(portHandle)}
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
                            color={COLORS[index % COLORS.length]!}
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
                  void engine.tools.reachability
                    .start({
                      kind: reachKind,
                      target: reachTarget,
                      count: Number(reachCount),
                      intervalMs: Number(reachInterval),
                    })
                    .then(({ handleId }) => setReachHandle(handleId))
                    .catch(report);
                }}
              />
              <Button
                title="Cancel"
                variant="ghost"
                disabled={!reachHandle}
                onPress={() => reachHandle && void engine.tools.reachability.cancel(reachHandle)}
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
    </View>
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  watchCard: { minWidth: 230, flexGrow: 1, borderWidth: 1 },
  console: { minHeight: 180, maxHeight: 420, padding: 10, borderRadius: 8 },
  diffRow: { paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, gap: 3 },
});
