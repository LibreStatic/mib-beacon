import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, Share, ScrollView } from 'react-native';
import {
  Card,
  SectionTitle,
  Field,
  Button,
  Chip,
  Label,
  EmptyState,
  Row,
  Mono,
  Pill,
  useTheme,
} from '@mibbeacon/ui';
import type {
  AuthProtocol,
  EngineAPI,
  EngineInfo,
  PrivProtocol,
  SecurityLevel,
  SnmpVersion,
  TrapRecord,
  TrapQuery,
  TrapSavedFilter,
  TrapV3UserProfile,
  TrapRule,
  TrapSendPreset,
} from '@mibbeacon/core/client';
import { validateVarbindInput } from '@mibbeacon/core/client';
import { useEngine } from '../engine-context';
import { useAppStore, type AgentForm, type NotificationHistoryItem } from '../store';
import {
  markTrapRead,
  deleteTrap,
  refreshTrapRecords,
  repeatNotification,
  sendNotification,
  toggleReceiver,
} from '../actions';
import { VarbindEditor } from '../components/VarbindEditor';
import { OidLookupPanel } from '../components/OidLookupPanel';
import { SplitWorkspace } from '../components/SplitWorkspace';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { useResponsiveLayout } from '../responsive-context';
import { serializeTraps, trapToNotificationPayload } from '../trap-export';
import { SwipeActionRow } from '../components/SwipeActionRow';

const VERSIONS: SnmpVersion[] = ['v1', 'v2c', 'v3'];
const LEVELS: SecurityLevel[] = ['noAuthNoPriv', 'authNoPriv', 'authPriv'];
const AUTHS: AuthProtocol[] = ['md5', 'sha', 'sha256', 'sha512'];
const PRIVS: PrivProtocol[] = ['des', 'aes', 'aes256b', 'aes256r'];

export function TrapsScreen({ info }: { info: EngineInfo | null }) {
  const t = useTheme();
  const { supportsSplitView } = useResponsiveLayout();
  const mode = useAppStore((s) => s.trapMode);
  return (
    <View style={styles.root}>
      {supportsSplitView ? (
        <WorkspaceHeader
          title="Notification console"
          subtitle="CAPTURE · INSPECT · CRAFT · REPLAY SNMP NOTIFICATIONS"
          actions={<Pill text={mode === 'receive' ? 'RECEIVER' : 'SENDER'} color={t.accent} />}
        />
      ) : null}
      <View style={[styles.modeBar, { backgroundColor: t.surface, borderBottomColor: t.border }]}>
        {!supportsSplitView ? (
          <View>
            <Text style={[styles.consoleTitle, { color: t.text }]}>Notification console</Text>
            <Text style={{ color: t.textDim, fontSize: 10 }}>CAPTURE / CRAFT / REPLAY</Text>
          </View>
        ) : (
          <Label tone="dim" size={10}>
            WORKSPACE MODE
          </Label>
        )}
        <Row>
          <Chip
            label="Receive"
            active={mode === 'receive'}
            onPress={() => useAppStore.getState().setTrapMode('receive')}
          />
          <Chip
            label="Send"
            active={mode === 'send'}
            onPress={() => useAppStore.getState().setTrapMode('send')}
          />
        </Row>
      </View>
      {mode === 'receive' ? <ReceiveWorkspace /> : <SendWorkspace info={info} />}
    </View>
  );
}

function TrapCaptureTools({
  engine,
  records,
  query,
  setQuery,
  applyQuery,
  filterName,
  setFilterName,
  savedFilters,
  v3Users,
  rules,
  refreshArtifacts,
}: {
  engine: EngineAPI;
  records: TrapRecord[];
  query: TrapQuery;
  setQuery: (query: TrapQuery) => void;
  applyQuery: (query?: TrapQuery) => Promise<void>;
  filterName: string;
  setFilterName: (name: string) => void;
  savedFilters: TrapSavedFilter[];
  v3Users: TrapV3UserProfile[];
  rules: TrapRule[];
  refreshArtifacts: () => Promise<void>;
}) {
  const [userName, setUserName] = useState('');
  const [userLevel, setUserLevel] = useState<SecurityLevel>('noAuthNoPriv');
  const [authProtocol, setAuthProtocol] = useState<AuthProtocol>('sha');
  const [authKey, setAuthKey] = useState('');
  const [privProtocol, setPrivProtocol] = useState<PrivProtocol>('aes');
  const [privKey, setPrivKey] = useState('');
  const [ruleName, setRuleName] = useState('');
  const [ruleOid, setRuleOid] = useState('*');
  const [ruleSources, setRuleSources] = useState('');
  const [ruleText, setRuleText] = useState('');
  const [ruleSeverity, setRuleSeverity] = useState<'info' | 'warning' | 'critical'>('warning');
  const [ruleColor, setRuleColor] = useState('#f59e0b');
  const [ruleNotify, setRuleNotify] = useState(false);
  const updateQuery = (patch: Partial<TrapQuery>) => setQuery({ ...query, ...patch });
  const share = (format: 'csv' | 'json') =>
    void Share.share({
      message: serializeTraps(records, format),
      title: `mibbeacon-traps.${format}`,
    });
  return (
    <View style={styles.captureToolStack}>
      <Card style={styles.card}>
        <SectionTitle>Persisted filters & export</SectionTitle>
        <Row style={styles.wrap}>
          <Field
            label="Source IP/prefix"
            value={query.source ?? ''}
            onChangeText={(source) => updateQuery({ source: source || undefined })}
          />
          <Field
            label="Trap OID/name"
            value={query.trap ?? ''}
            onChangeText={(trap) => updateQuery({ trap: trap || undefined })}
          />
          <Field
            label="Varbind contains"
            value={query.text ?? ''}
            onChangeText={(text) => updateQuery({ text: text || undefined })}
          />
        </Row>
        <Row style={styles.wrap}>
          <Chip
            label="Any version"
            active={query.version === undefined}
            onPress={() => updateQuery({ version: undefined })}
          />
          {[
            { label: 'v1', value: 0 },
            { label: 'v2c', value: 1 },
            { label: 'v3', value: 3 },
          ].map(({ label, value }) => (
            <Chip
              key={value}
              label={label}
              active={query.version === value}
              onPress={() => updateQuery({ version: value })}
            />
          ))}
          <Chip
            label="Unread only"
            active={query.unread === true}
            onPress={() => updateQuery({ unread: query.unread ? undefined : true })}
          />
          <Chip
            label="Last hour"
            active={query.from !== undefined && Date.now() - query.from < 3_700_000}
            onPress={() => updateQuery({ from: Date.now() - 3_600_000, to: undefined })}
          />
          <Chip
            label="Last 24h"
            active={query.from !== undefined && Date.now() - query.from >= 3_700_000}
            onPress={() => updateQuery({ from: Date.now() - 86_400_000, to: undefined })}
          />
        </Row>
        <Row style={styles.wrap}>
          <Button title="Apply" small onPress={() => void applyQuery()} />
          <Button title="Reset" small variant="ghost" onPress={() => void applyQuery({})} />
          <Button title="CSV" small variant="ghost" onPress={() => share('csv')} />
          <Button title="JSON" small variant="ghost" onPress={() => share('json')} />
        </Row>
        <Row style={styles.wrap}>
          <Field label="Saved filter name" value={filterName} onChangeText={setFilterName} />
          <Button
            title="Save filter"
            small
            disabled={!filterName.trim()}
            onPress={() =>
              void engine.traps.savedFilters.save(filterName, query).then(async () => {
                setFilterName('');
                await refreshArtifacts();
              })
            }
          />
        </Row>
        {savedFilters.map((filter) => (
          <Row key={filter.id} style={styles.savedToolRow}>
            <Chip
              label={filter.name}
              active={false}
              onPress={() => void applyQuery(filter.query)}
            />
            <Button
              title="×"
              small
              variant="ghost"
              onPress={() =>
                void engine.traps.savedFilters.remove(filter.id).then(refreshArtifacts)
              }
            />
          </Row>
        ))}
      </Card>

      <Card style={styles.card}>
        <SectionTitle>SNMPv3 trap users</SectionTitle>
        <Field label="User name" value={userName} onChangeText={setUserName} />
        <Row style={styles.wrap}>
          {LEVELS.map((level) => (
            <Chip
              key={level}
              label={level}
              active={userLevel === level}
              onPress={() => setUserLevel(level)}
            />
          ))}
        </Row>
        {userLevel !== 'noAuthNoPriv' ? (
          <>
            <Row style={styles.wrap}>
              {AUTHS.map((protocol) => (
                <Chip
                  key={protocol}
                  label={protocol}
                  active={authProtocol === protocol}
                  onPress={() => setAuthProtocol(protocol)}
                />
              ))}
            </Row>
            <Field
              label="Auth key (write-only)"
              value={authKey}
              secureTextEntry
              onChangeText={setAuthKey}
            />
          </>
        ) : null}
        {userLevel === 'authPriv' ? (
          <>
            <Row style={styles.wrap}>
              {PRIVS.map((protocol) => (
                <Chip
                  key={protocol}
                  label={protocol}
                  active={privProtocol === protocol}
                  onPress={() => setPrivProtocol(protocol)}
                />
              ))}
            </Row>
            <Field
              label="Privacy key (write-only)"
              value={privKey}
              secureTextEntry
              onChangeText={setPrivKey}
            />
          </>
        ) : null}
        <Button
          title="Save v3 user"
          small
          disabled={!userName.trim()}
          onPress={() =>
            void engine.traps.v3Users
              .upsert({
                name: userName,
                level: userLevel,
                ...(userLevel === 'noAuthNoPriv'
                  ? {}
                  : { authProtocol, ...(authKey ? { authKey } : {}) }),
                ...(userLevel === 'authPriv'
                  ? { privProtocol, ...(privKey ? { privKey } : {}) }
                  : {}),
              })
              .then(async () => {
                setAuthKey('');
                setPrivKey('');
                await refreshArtifacts();
              })
          }
        />
        {v3Users.map((user) => (
          <Row key={user.name} style={styles.savedToolRow}>
            <Label>
              {user.name} · {user.level} · auth {user.hasAuthKey ? 'stored' : 'none'} · priv{' '}
              {user.hasPrivKey ? 'stored' : 'none'}
            </Label>
            <Button
              title="Delete"
              small
              variant="danger"
              onPress={() => void engine.traps.v3Users.remove(user.name).then(refreshArtifacts)}
            />
          </Row>
        ))}
      </Card>

      <Card style={styles.card}>
        <SectionTitle>Severity & notification rules</SectionTitle>
        <Field label="Rule name" value={ruleName} onChangeText={setRuleName} />
        <Field label="Trap OID glob" value={ruleOid} onChangeText={setRuleOid} />
        <Field
          label="Source prefixes (comma-separated)"
          value={ruleSources}
          onChangeText={setRuleSources}
        />
        <Field label="Varbind substring" value={ruleText} onChangeText={setRuleText} />
        <Row style={styles.wrap}>
          {(['info', 'warning', 'critical'] as const).map((severity) => (
            <Chip
              key={severity}
              label={severity}
              active={ruleSeverity === severity}
              onPress={() => setRuleSeverity(severity)}
            />
          ))}
          <Chip
            label="OS notification"
            active={ruleNotify}
            onPress={() => setRuleNotify(!ruleNotify)}
          />
        </Row>
        <Field label="Color" value={ruleColor} onChangeText={setRuleColor} />
        <Button
          title="Create rule"
          small
          disabled={!ruleName.trim()}
          onPress={() =>
            void engine.traps.rules
              .create({
                name: ruleName,
                enabled: true,
                priority: rules.length * 10 + 10,
                condition: {
                  ...(ruleOid.trim() ? { trapOidGlob: ruleOid.trim() } : {}),
                  ...(ruleSources.trim()
                    ? {
                        sourcePrefixes: ruleSources
                          .split(',')
                          .map((value) => value.trim())
                          .filter(Boolean),
                      }
                    : {}),
                  ...(ruleText.trim() ? { varbindSubstrings: [ruleText.trim()] } : {}),
                },
                actions: { severity: ruleSeverity, color: ruleColor, notify: ruleNotify },
              })
              .then(async () => {
                setRuleName('');
                await refreshArtifacts();
              })
          }
        />
        {rules.map((rule) => (
          <Row key={rule.id} style={styles.savedToolRow}>
            <Chip
              label={`${rule.priority} · ${rule.name}`}
              active={rule.enabled}
              onPress={() =>
                void engine.traps.rules
                  .update(rule.id, { enabled: !rule.enabled })
                  .then(refreshArtifacts)
              }
            />
            <Button
              title="Delete"
              small
              variant="danger"
              onPress={() => void engine.traps.rules.remove(rule.id).then(refreshArtifacts)}
            />
          </Row>
        ))}
        <Label tone="dim" size={10}>
          Sound, command execution, and forwarding are post-v1 actions and intentionally disabled.
        </Label>
      </Card>
    </View>
  );
}

function ReceiveWorkspace() {
  const engine = useEngine();
  const t = useTheme();
  const { supportsSplitView } = useResponsiveLayout();
  const receiver = useAppStore((s) => s.receiver);
  const records = useAppStore((s) => s.records);
  const [port, setPort] = useState('');
  const [transport, setTransport] = useState<'dual' | 'udp4' | 'udp6'>('dual');
  const [labMode, setLabMode] = useState(true);
  const [communities, setCommunities] = useState('public');
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState<TrapQuery>({});
  const [filterName, setFilterName] = useState('');
  const [savedFilters, setSavedFilters] = useState<TrapSavedFilter[]>([]);
  const [v3Users, setV3Users] = useState<TrapV3UserProfile[]>([]);
  const [rules, setRules] = useState<TrapRule[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const refreshArtifacts = useCallback(async () => {
    const [nextFilters, nextUsers, nextRules] = await Promise.all([
      engine.traps.savedFilters.list(),
      engine.traps.v3Users.list(),
      engine.traps.rules.list(),
    ]);
    setSavedFilters(nextFilters);
    setV3Users(nextUsers);
    setRules(nextRules);
  }, [engine]);
  useEffect(() => {
    void refreshArtifacts();
  }, [refreshArtifacts]);
  const onToggle = async () => {
    setErr(null);
    try {
      await toggleReceiver(engine, port, {
        transport,
        disableAuthorization: labMode,
        communities: communities
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      });
    } catch (e) {
      const x = e as { message?: string; hint?: string };
      setErr(`${x.message ?? String(e)}${x.hint ? ' — ' + x.hint : ''}`);
    }
  };
  const clearCapture = async () => {
    await engine.traps.clear();
    useAppStore.getState().clearTraps();
    setSelectedId(null);
  };
  const applyQuery = async (next = query) => {
    setQuery(next);
    await refreshTrapRecords(engine, next);
  };
  const selectRecord = (record: TrapRecord) => {
    setSelectedId(record.id);
    if (!record.readAt) void markTrapRead(engine, record.id);
  };
  const refreshRecords = async () => {
    setRefreshing(true);
    try {
      await refreshTrapRecords(engine, query);
    } finally {
      setRefreshing(false);
    }
  };
  const receiverCard = (
    <Card style={styles.card}>
      <View style={styles.cardTitle}>
        <SectionTitle>Trap receiver</SectionTitle>
        <Pill
          text={receiver.running ? 'LIVE' : 'OFFLINE'}
          color={receiver.running ? t.ok : t.textDim}
        />
      </View>
      <Row>
        <Field
          label="Listen port"
          value={port}
          onChangeText={setPort}
          keyboardType="number-pad"
          editable={!receiver.running}
        />
        <View style={{ justifyContent: 'flex-end', flex: 1 }}>
          <Button
            title={receiver.running ? `Stop (:${receiver.port})` : 'Start receiver'}
            variant={receiver.running ? 'danger' : 'primary'}
            onPress={() => void onToggle()}
          />
        </View>
      </Row>
      <Row style={styles.wrap}>
        {(['dual', 'udp4', 'udp6'] as const).map((value) => (
          <Chip
            key={value}
            label={value}
            active={transport === value}
            onPress={() => setTransport(value)}
          />
        ))}
        <Chip label="Lab accept-all" active={labMode} onPress={() => setLabMode(!labMode)} />
      </Row>
      {!labMode ? (
        <Field
          label="Allowed communities (comma-separated)"
          value={communities}
          onChangeText={setCommunities}
        />
      ) : null}
      {err ? (
        <Label tone="error" size={12}>
          {err}
        </Label>
      ) : null}
      <Label tone="dim" size={11}>
        Leave blank for desktop 162 → 1162 fallback. Bound {receiver.transports?.join(' + ') || '—'}{' '}
        · {receiver.count ?? records.length} stored · {receiver.drops ?? 0} dropped/undecodable.
      </Label>
    </Card>
  );
  const toolsCard = (
    <TrapCaptureTools
      engine={engine}
      records={records}
      query={query}
      setQuery={setQuery}
      applyQuery={applyQuery}
      filterName={filterName}
      setFilterName={setFilterName}
      savedFilters={savedFilters}
      v3Users={v3Users}
      rules={rules}
      refreshArtifacts={refreshArtifacts}
    />
  );

  if (supportsSplitView) {
    const selected = records.find((record) => record.id === selectedId) ?? null;
    return (
      <SplitWorkspace
        workspace="traps"
        minPrimary={340}
        minSecondary={400}
        primary={
          <View style={styles.capturePane}>
            <ScrollView
              style={styles.captureToolsScroll}
              contentContainerStyle={styles.captureControls}
            >
              {receiverCard}
              {toolsCard}
            </ScrollView>
            <View
              style={[
                styles.captureHead,
                { backgroundColor: t.surface, borderBottomColor: t.border },
              ]}
            >
              <View>
                <SectionTitle>Captured notifications</SectionTitle>
                <Label tone="dim" size={10}>
                  {records.length} in this session
                </Label>
              </View>
              {records.length ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear captured traps"
                  onPress={() => void clearCapture()}
                  style={styles.clearAction}
                >
                  <Text style={{ color: t.accent, fontSize: 11, fontWeight: '700' }}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
            <FlatList
              style={styles.captureList}
              data={records}
              refreshing={refreshing}
              onRefresh={() => void refreshRecords()}
              keyExtractor={(record) => record.id}
              ListEmptyComponent={
                <EmptyState
                  title={receiver.running ? 'Listening for traps…' : 'No traps received'}
                  hint="Start the receiver, then send a test notification to this host."
                />
              }
              renderItem={({ item }) => (
                <SwipeActionRow
                  accessibilityLabel={item.trapName ?? item.trapOid ?? 'trap'}
                  leftLabel="Delete"
                  rightLabel={item.readAt ? 'Unread' : 'Read'}
                  onSwipeLeft={() => void deleteTrap(engine, item.id)}
                  onSwipeRight={() => void markTrapRead(engine, item.id, !item.readAt)}
                >
                  <TrapSummaryRow
                    rec={item}
                    selected={item.id === selected?.id}
                    onPress={() => selectRecord(item)}
                  />
                </SwipeActionRow>
              )}
            />
          </View>
        }
        secondary={selected ? <TrapDetail rec={selected} /> : <TrapInspectorEmpty />}
      />
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={records}
      refreshing={refreshing}
      onRefresh={() => void refreshRecords()}
      keyExtractor={(record) => record.id}
      ListHeaderComponent={
        <>
          {receiverCard}
          {toolsCard}
          {records.length ? (
            <Row style={styles.listHead}>
              <Text style={{ color: t.textDim, fontSize: 12 }}>{records.length} received</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear captured traps"
                onPress={() => void clearCapture()}
                style={styles.clearAction}
              >
                <Text style={{ color: t.accent, fontSize: 12, fontWeight: '700' }}>
                  Clear capture
                </Text>
              </Pressable>
            </Row>
          ) : null}
          {!records.length ? (
            <EmptyState
              title={receiver.running ? 'Listening for traps…' : 'No traps received'}
              hint="Start the receiver, then send a test notification to this host."
            />
          ) : null}
        </>
      }
      renderItem={({ item }) => <TrapRow rec={item} />}
      ListFooterComponent={<View style={{ height: 20 }} />}
    />
  );
}

function TrapInspectorEmpty() {
  const t = useTheme();
  return (
    <View style={[styles.trapInspectorEmpty, { backgroundColor: t.bg }]}>
      <Text style={[styles.trapInspectorGlyph, { color: t.kind.notification }]}>⚑</Text>
      <Text style={[styles.trapInspectorTitle, { color: t.text }]}>Select a notification</Text>
      <Text style={[styles.trapInspectorHint, { color: t.textDim }]}>
        Source, timestamps, decoded OIDs, and varbind values remain visible here while capture
        continues.
      </Text>
    </View>
  );
}

function TrapSummaryRow({
  rec,
  selected,
  onPress,
}: {
  rec: TrapRecord;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Inspect ${rec.trapName ?? rec.trapOid ?? 'trap'} from ${rec.sourceAddress}`}
      accessibilityState={{ selected }}
      style={[
        styles.trapSummaryRow,
        { backgroundColor: selected ? t.accentSoft : 'transparent', borderBottomColor: t.border },
      ]}
    >
      <Row style={{ justifyContent: 'space-between' }}>
        {!rec.readAt ? <Text style={{ color: rec.color ?? t.accent }}>●</Text> : null}
        <Text style={{ color: t.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
          {rec.trapName ?? rec.trapOid ?? 'trap'}
        </Text>
        <Text style={{ color: t.textDim, fontSize: 10 }}>
          {new Date(rec.receivedAt).toLocaleTimeString()}
        </Text>
      </Row>
      <Row style={{ justifyContent: 'space-between', marginTop: 3 }}>
        <Mono dim size={10}>
          {rec.sourceAddress}:{rec.sourcePort}
        </Mono>
        <Row>
          <Pill
            text={
              rec.version === 0
                ? 'v1'
                : rec.version === 3
                  ? 'v3'
                  : rec.version === 1
                    ? 'v2c'
                    : 'raw'
            }
          />
          {rec.severity ? (
            <Pill
              text={rec.severity}
              color={
                rec.color ??
                (rec.severity === 'critical'
                  ? t.semantic.severity.critical
                  : rec.severity === 'warning'
                    ? t.semantic.severity.warning
                    : t.semantic.severity.info)
              }
            />
          ) : null}
          <Pill text={`${rec.varbinds.length} VB`} />
        </Row>
      </Row>
    </Pressable>
  );
}

function TrapDetail({ rec }: { rec: TrapRecord }) {
  const t = useTheme();
  const engine = useEngine();
  const replay = () => {
    const payload = trapToNotificationPayload(rec);
    const state = useAppStore.getState();
    state.updateNotification({
      kind: payload.kind,
      trapOid: payload.trapOid,
      upTime: payload.upTime === undefined ? '' : String(payload.upTime),
      varbinds: payload.varbinds,
    });
    state.setTrapMode('send');
  };
  return (
    <View style={[styles.trapDetail, { backgroundColor: t.bg }]}>
      <View
        style={[styles.trapDetailHead, { backgroundColor: t.surface, borderBottomColor: t.border }]}
      >
        <View style={{ flex: 1 }}>
          <SectionTitle>Notification inspector</SectionTitle>
          <Text style={[styles.trapDetailTitle, { color: t.text }]} numberOfLines={1}>
            {rec.trapName ?? rec.trapOid ?? 'trap'}
          </Text>
        </View>
        <Pill text={new Date(rec.receivedAt).toLocaleTimeString()} color={t.ok} />
        <Button title="Replay" small variant="ghost" onPress={replay} />
        <Button
          title="JSON"
          small
          variant="ghost"
          onPress={() =>
            void Share.share({ message: serializeTraps([rec], 'json'), title: 'trap.json' })
          }
        />
        <Button
          title="Text"
          small
          variant="ghost"
          onPress={() =>
            void Share.share({ message: serializeTraps([rec], 'text'), title: 'trap.txt' })
          }
        />
        <Button
          title={rec.readAt ? 'Unread' : 'Read'}
          small
          variant="ghost"
          onPress={() => void markTrapRead(engine, rec.id, !rec.readAt)}
        />
      </View>
      <FlatList
        contentContainerStyle={styles.trapDetailContent}
        data={rec.varbinds}
        keyExtractor={(vb, index) => `${vb.oid}-${index}`}
        ListHeaderComponent={
          <View style={styles.trapMeta}>
            <Label tone="dim" size={10}>
              SOURCE
            </Label>
            <Mono size={12}>
              {rec.sourceAddress}:{rec.sourcePort}
            </Mono>
            {rec.trapOid ? (
              <Mono dim size={11}>
                {rec.trapOid}
              </Mono>
            ) : null}
            {rec.trapOid && !rec.trapName ? <OidLookupPanel oid={rec.trapOid} compact /> : null}
            {rec.trapDescription ? (
              <Text style={{ color: t.textDim }}>{rec.trapDescription}</Text>
            ) : null}
            {rec.severity ? (
              <Pill
                text={rec.severity.toUpperCase()}
                color={
                  rec.color ??
                  (rec.severity === 'critical'
                    ? t.semantic.severity.critical
                    : rec.severity === 'warning'
                      ? t.semantic.severity.warning
                      : t.semantic.severity.info)
                }
              />
            ) : null}
            {rec.parseError ? <Label tone="error">{rec.parseError}</Label> : null}
            {rec.missingObjects?.length ? (
              <Label tone="error">Missing OBJECTS: {rec.missingObjects.join(', ')}</Label>
            ) : null}
            {rec.extraObjects?.length ? (
              <Label tone="dim">Extra varbinds: {rec.extraObjects.join(', ')}</Label>
            ) : null}
            {rec.rawPduHex ? (
              <View>
                <Label tone="dim" size={10}>
                  RAW PDU HEX
                </Label>
                <Mono dim size={9}>
                  {rec.rawPduHex}
                </Mono>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.trapVarbind, { borderTopColor: t.border }]}>
            <Mono size={11}>{item.name ?? item.oid}</Mono>
            {item.name ? (
              <Mono dim size={9}>
                {item.oid}
              </Mono>
            ) : null}
            <Text style={{ color: item.isError ? t.error : t.text, fontSize: 12, marginTop: 3 }}>
              {item.isError ? item.errorText : String(item.value)}
            </Text>
            {!item.name ? <OidLookupPanel oid={item.oid} compact /> : null}
          </View>
        )}
      />
    </View>
  );
}

function SendWorkspace({ info }: { info: EngineInfo | null }) {
  const engine = useEngine();
  const t = useTheme();
  const { supportsSplitView } = useResponsiveLayout();
  const form = useAppStore((s) => s.notification);
  const busy = useAppStore((s) => s.sendBusy);
  const error = useAppStore((s) => s.sendError);
  const history = useAppStore((s) => s.sendHistory);
  const agentProfiles = useAppStore((s) => s.agentProfiles);
  const notificationAgentId = useAppStore((s) => s.notificationAgentId);
  const [trapName, setTrapName] = useState<string | null>(null);
  const [presets, setPresets] = useState<TrapSendPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const update = useAppStore.getState().updateNotification;
  const setVarbinds = useAppStore.getState().setNotificationVarbinds;
  const setTarget = (patch: Partial<AgentForm>) => update({ target: { ...form.target, ...patch } });
  const setV3 = (patch: Partial<AgentForm['v3']>) =>
    setTarget({ v3: { ...form.target.v3, ...patch } });
  const trapOidError = /^\d+(?:\.\d+)+$/.test(form.trapOid.trim())
    ? null
    : 'Trap OID must be a complete numeric OID.';
  const uptimeError =
    form.upTime.trim() &&
    (!/^\d+$/.test(form.upTime.trim()) || BigInt(form.upTime.trim()) > 4_294_967_295n)
      ? 'sysUpTime must be an unsigned 32-bit integer.'
      : null;
  const agentAddressError =
    form.target.version === 'v1' && form.agentAddress.trim()
      ? (() => {
          const parts = form.agentAddress.trim().split('.');
          return parts.length !== 4 ||
            parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)
            ? 'v1 agent address must be a valid IPv4 address.'
            : null;
        })()
      : null;
  const v1EnvelopeError =
    form.target.version === 'v1' &&
    (!/^\d+(?:\.\d+)+$/.test(form.v1Enterprise.trim()) ||
      !/^\d$/.test(form.v1Generic) ||
      Number(form.v1Generic) > 6 ||
      !/^\d+$/.test(form.v1Specific))
      ? 'v1 enterprise must be an OID; generic must be 0–6; specific must be non-negative.'
      : null;
  const payloadError = form.varbinds.map(validateVarbindInput).find(Boolean) ?? null;
  const formValidationError =
    trapOidError ?? uptimeError ?? agentAddressError ?? v1EnvelopeError ?? payloadError;
  const desOff = info != null && !info.ciphers.des;

  const refreshPresets = useCallback(() => engine.traps.presets.list().then(setPresets), [engine]);
  useEffect(() => {
    void refreshPresets();
  }, [refreshPresets]);

  useEffect(() => {
    let active = true;
    if (trapOidError) {
      setTrapName(null);
      return () => {
        active = false;
      };
    }
    void engine.mibs
      .resolve(form.trapOid.trim())
      .then((resolved) => {
        if (active) setTrapName(resolved?.name ?? null);
      })
      .catch(() => {
        if (active) setTrapName(null);
      });
    return () => {
      active = false;
    };
  }, [engine, form.trapOid, trapOidError]);

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={[styles.content, supportsSplitView ? styles.sendDesktopContent : null]}
      data={history}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <>
          <View style={supportsSplitView ? styles.sendTopGrid : undefined}>
            <Card style={[styles.card, supportsSplitView ? styles.sendGridCard : undefined]}>
              <View style={styles.cardTitle}>
                <SectionTitle>Destination</SectionTitle>
                <Pill text="UDP" color={t.accent} />
              </View>
              <Row style={styles.wrap}>
                <Chip
                  label="Ad hoc"
                  active={!notificationAgentId}
                  onPress={() => useAppStore.getState().setNotificationAgentId(null)}
                />
                {agentProfiles.map((profile) => (
                  <Chip
                    key={profile.id}
                    label={profile.name}
                    active={notificationAgentId === profile.id}
                    onPress={() => useAppStore.getState().setNotificationAgentId(profile.id)}
                  />
                ))}
              </Row>
              {notificationAgentId ? (
                <Label tone="ok">
                  Credentials are resolved inside the engine from the saved agent profile.
                </Label>
              ) : (
                <Row>
                  <Field
                    label="Host"
                    value={form.target.host}
                    placeholder="192.0.2.10"
                    onChangeText={(host) => setTarget({ host })}
                  />
                  <View style={{ width: 88 }}>
                    <Field
                      label="Port"
                      value={form.target.port}
                      keyboardType="number-pad"
                      onChangeText={(port) => setTarget({ port })}
                    />
                  </View>
                </Row>
              )}
              {!notificationAgentId ? (
                <>
                  <Row>
                    {VERSIONS.map((version) => (
                      <Chip
                        key={version}
                        label={version}
                        active={form.target.version === version}
                        onPress={() => {
                          setTarget({ version });
                          if (version === 'v1' && form.kind === 'inform') update({ kind: 'trap' });
                        }}
                      />
                    ))}
                  </Row>
                  {form.target.version !== 'v3' ? (
                    <Field
                      label="Community"
                      value={form.target.community}
                      onChangeText={(community) => setTarget({ community })}
                    />
                  ) : (
                    <>
                      <Field
                        label="User"
                        value={form.target.v3.user}
                        onChangeText={(user) => setV3({ user })}
                      />
                      <Row style={styles.wrap}>
                        {LEVELS.map((level) => (
                          <Chip
                            key={level}
                            label={level}
                            active={form.target.v3.level === level}
                            onPress={() => setV3({ level })}
                          />
                        ))}
                      </Row>
                      {form.target.v3.level !== 'noAuthNoPriv' ? (
                        <>
                          <Row style={styles.wrap}>
                            {AUTHS.map((authProtocol) => (
                              <Chip
                                key={authProtocol}
                                label={authProtocol}
                                active={form.target.v3.authProtocol === authProtocol}
                                onPress={() => setV3({ authProtocol })}
                              />
                            ))}
                          </Row>
                          <Field
                            label="Auth key"
                            secureTextEntry
                            value={form.target.v3.authKey}
                            onChangeText={(authKey) => setV3({ authKey })}
                          />
                        </>
                      ) : null}
                      {form.target.v3.level === 'authPriv' ? (
                        <>
                          <Row style={styles.wrap}>
                            {PRIVS.map((privProtocol) => {
                              const disabled = privProtocol === 'des' && desOff;
                              return (
                                <Chip
                                  key={privProtocol}
                                  label={disabled ? 'des (n/a)' : privProtocol}
                                  active={form.target.v3.privProtocol === privProtocol}
                                  onPress={disabled ? undefined : () => setV3({ privProtocol })}
                                />
                              );
                            })}
                          </Row>
                          <Field
                            label="Privacy key"
                            secureTextEntry
                            value={form.target.v3.privKey}
                            onChangeText={(privKey) => setV3({ privKey })}
                          />
                        </>
                      ) : null}
                    </>
                  )}
                </>
              ) : null}
            </Card>

            <Card style={[styles.card, supportsSplitView ? styles.sendGridCard : undefined]}>
              <SectionTitle>Notification envelope</SectionTitle>
              <Row>
                <Chip
                  label="Trap"
                  active={form.kind === 'trap'}
                  onPress={() => update({ kind: 'trap' })}
                />
                <Chip
                  label={form.target.version === 'v1' ? 'Inform · v2+' : 'Inform'}
                  active={form.kind === 'inform'}
                  onPress={
                    form.target.version === 'v1' ? undefined : () => update({ kind: 'inform' })
                  }
                />
              </Row>
              <Field
                label="Trap OID"
                value={form.trapOid}
                onChangeText={(trapOid) => update({ trapOid })}
                placeholder="1.3.6.1.6.3.1.1.5.3"
              />
              {trapName ? (
                <Label tone="ok" size={11}>
                  Resolved as {trapName}
                </Label>
              ) : null}
              <Row>
                <Field
                  label="sysUpTime ticks (optional)"
                  value={form.upTime}
                  keyboardType="number-pad"
                  onChangeText={(upTime) => update({ upTime })}
                />
                {form.target.version === 'v1' ? (
                  <>
                    <Field
                      label="v1 agent address"
                      value={form.agentAddress}
                      onChangeText={(agentAddress) => update({ agentAddress })}
                    />
                    <Field
                      label="v1 enterprise OID"
                      value={form.v1Enterprise}
                      onChangeText={(v1Enterprise) => update({ v1Enterprise })}
                    />
                    <Field
                      label="v1 generic (0–6)"
                      value={form.v1Generic}
                      keyboardType="number-pad"
                      onChangeText={(v1Generic) => update({ v1Generic })}
                    />
                    <Field
                      label="v1 specific"
                      value={form.v1Specific}
                      keyboardType="number-pad"
                      onChangeText={(v1Specific) => update({ v1Specific })}
                    />
                  </>
                ) : null}
              </Row>
              <Label tone="dim" size={11}>
                Tip: open a NOTIFICATION-TYPE node in Browse and choose “Send this trap” to prefill
                its OID and OBJECTS payload.
              </Label>
            </Card>
          </View>

          <View style={styles.payloadHead}>
            <View>
              <SectionTitle>Payload varbinds</SectionTitle>
              <Text style={{ color: t.textDim, fontSize: 11 }}>
                {form.varbinds.length} custom fields
              </Text>
            </View>
            <Button
              title="Add varbind"
              small
              variant="ghost"
              onPress={() =>
                setVarbinds([...form.varbinds, { oid: '', type: 'OctetString', value: '' }])
              }
            />
          </View>
          <View style={styles.payloadList}>
            {form.varbinds.map((varbind, index) => (
              <VarbindEditor
                key={index}
                compact
                value={varbind}
                onChange={(patch) =>
                  setVarbinds(
                    form.varbinds.map((item, i) => (i === index ? { ...item, ...patch } : item)),
                  )
                }
                onRemove={() => setVarbinds(form.varbinds.filter((_item, i) => i !== index))}
              />
            ))}
          </View>
          {error ? <Label tone="error">{error}</Label> : null}
          {formValidationError ? <Label tone="error">{formValidationError}</Label> : null}
          <Button
            title={busy ? 'Transmitting…' : `Send ${form.kind}`}
            disabled={busy || !!formValidationError}
            onPress={() => void sendNotification(engine)}
          />
          <Card style={styles.card}>
            <SectionTitle>Saved sender presets</SectionTitle>
            <Row style={styles.wrap}>
              <Field label="Preset name" value={presetName} onChangeText={setPresetName} />
              <Button
                title="Save preset"
                small
                disabled={!presetName.trim() || !notificationAgentId}
                onPress={() =>
                  void engine.traps.presets
                    .save(presetName, notificationAgentId!, {
                      kind: form.kind,
                      trapOid: form.trapOid,
                      varbinds: form.varbinds,
                      ...(form.upTime.trim() ? { upTime: Number(form.upTime) } : {}),
                      ...(form.agentAddress.trim()
                        ? { agentAddress: form.agentAddress.trim() }
                        : {}),
                      ...(form.target.version === 'v1'
                        ? {
                            v1Enterprise: form.v1Enterprise,
                            v1Generic: Number(form.v1Generic),
                            v1Specific: Number(form.v1Specific),
                          }
                        : {}),
                    })
                    .then(async () => {
                      setPresetName('');
                      await refreshPresets();
                    })
                }
              />
            </Row>
            {!notificationAgentId ? (
              <Label tone="dim">
                Choose a saved agent before saving; credentials are never stored in presets.
              </Label>
            ) : null}
            {presets.map((preset) => (
              <Row key={preset.id} style={styles.savedToolRow}>
                <Chip
                  label={preset.name}
                  active={false}
                  onPress={() => {
                    useAppStore.getState().setNotificationAgentId(preset.agentId);
                    useAppStore.getState().updateNotification({
                      kind: preset.payload.kind,
                      trapOid: preset.payload.trapOid,
                      varbinds: preset.payload.varbinds,
                      upTime:
                        preset.payload.upTime === undefined ? '' : String(preset.payload.upTime),
                      agentAddress: preset.payload.agentAddress ?? '',
                      v1Enterprise: preset.payload.v1Enterprise ?? '1.3.6.1.4.1',
                      v1Generic: String(preset.payload.v1Generic ?? 6),
                      v1Specific: String(preset.payload.v1Specific ?? 0),
                    });
                  }}
                />
                <Button
                  title="Delete"
                  small
                  variant="danger"
                  onPress={() => void engine.traps.presets.remove(preset.id).then(refreshPresets)}
                />
              </Row>
            ))}
          </Card>
          <View style={styles.historyHead}>
            <SectionTitle>Send history</SectionTitle>
            <Label tone="dim" size={11}>
              session only
            </Label>
          </View>
          {!history.length ? (
            <EmptyState title="No notifications sent" hint="Craft a trap or inform above." />
          ) : null}
        </>
      }
      renderItem={({ item }) => (
        <HistoryRow
          item={item}
          busy={busy}
          onRepeat={() => void repeatNotification(engine, item.request)}
        />
      )}
      ListFooterComponent={<View style={{ height: 20 }} />}
    />
  );
}

function HistoryRow({
  item,
  busy,
  onRepeat,
}: {
  item: NotificationHistoryItem;
  busy: boolean;
  onRepeat: () => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.historyRow, { borderBottomColor: t.border }]}>
      <View style={{ flex: 1 }}>
        <Row>
          <Pill text={item.request.kind} color={item.error ? t.error : t.ok} />
          <Mono size={11}>{item.request.trapOid}</Mono>
        </Row>
        <Text style={{ color: item.error ? t.error : t.textDim, fontSize: 11, marginTop: 4 }}>
          {item.error ?? (item.result?.acknowledged ? 'acknowledged' : 'sent')} ·{' '}
          {'agentId' in item.request
            ? `saved agent ${item.request.agentId}`
            : `${item.request.target.host}:${item.request.target.port ?? 162}`}
        </Text>
      </View>
      <Button title="Send again" small variant="ghost" disabled={busy} onPress={onRepeat} />
    </View>
  );
}

function TrapRow({ rec }: { rec: TrapRecord }) {
  const t = useTheme();
  const engine = useEngine();
  const [open, setOpen] = useState(false);
  return (
    <SwipeActionRow
      accessibilityLabel={rec.trapName ?? rec.trapOid ?? 'trap'}
      leftLabel="Delete"
      rightLabel={rec.readAt ? 'Unread' : 'Read'}
      onSwipeLeft={() => void deleteTrap(engine, rec.id)}
      onSwipeRight={() => void markTrapRead(engine, rec.id, !rec.readAt)}
    >
      <Pressable
        onPress={() => {
          setOpen((value) => !value);
          if (!rec.readAt) void markTrapRead(engine, rec.id);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${open ? 'Collapse' : 'Expand'} ${rec.trapName ?? rec.trapOid ?? 'trap'}`}
        accessibilityState={{ expanded: open }}
        style={[styles.trapRow, { borderBottomColor: t.border, backgroundColor: t.bg }]}
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ color: t.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
            {rec.trapName ?? rec.trapOid ?? 'trap'}
          </Text>
          <Text style={{ color: t.textDim, fontSize: 11 }}>
            {new Date(rec.receivedAt).toLocaleTimeString()}
          </Text>
        </Row>
        <Row style={{ justifyContent: 'space-between', marginTop: 2 }}>
          <Mono dim size={11}>
            {rec.sourceAddress}:{rec.sourcePort}
          </Mono>
          <Text style={{ color: t.textDim, fontSize: 11 }}>
            {rec.varbinds.length} vb {open ? '▾' : '▸'}
          </Text>
        </Row>
        {open ? (
          <View style={styles.vbs}>
            <Row style={styles.wrap}>
              <Button
                title="Replay"
                small
                variant="ghost"
                onPress={() => {
                  const payload = trapToNotificationPayload(rec);
                  const state = useAppStore.getState();
                  state.updateNotification({
                    kind: payload.kind,
                    trapOid: payload.trapOid,
                    upTime: payload.upTime === undefined ? '' : String(payload.upTime),
                    varbinds: payload.varbinds,
                  });
                  state.setTrapMode('send');
                }}
              />
              <Button
                title="Copy JSON"
                small
                variant="ghost"
                onPress={() => void Share.share({ message: serializeTraps([rec], 'json') })}
              />
            </Row>
            {rec.parseError ? <Label tone="error">{rec.parseError}</Label> : null}
            {rec.rawPduHex ? (
              <Mono dim size={9}>
                {rec.rawPduHex}
              </Mono>
            ) : null}
            {rec.trapOid && !rec.trapName ? <OidLookupPanel oid={rec.trapOid} compact /> : null}
            {rec.varbinds.map((vb, i) => (
              <View key={i} style={{ marginTop: 4 }}>
                <Mono size={11}>{vb.name ?? vb.oid}</Mono>
                <Text style={{ color: t.text, fontSize: 12 }}>
                  {vb.isError ? vb.errorText : String(vb.value)}
                </Text>
                {!vb.name ? <OidLookupPanel oid={vb.oid} compact /> : null}
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
    </SwipeActionRow>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  modeBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  consoleTitle: { fontSize: 14, fontWeight: '800' },
  clearAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1 },
  content: { padding: 12 },
  sendDesktopContent: { width: '100%', maxWidth: 980, alignSelf: 'center', padding: 18 },
  sendTopGrid: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  sendGridCard: { flex: 1, minWidth: 0 },
  card: { marginBottom: 12 },
  cardTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wrap: { flexWrap: 'wrap' },
  listHead: { justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 6 },
  payloadHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  payloadList: { gap: 8, marginBottom: 10 },
  historyHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 6,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trapRow: {
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  vbs: { marginTop: 6, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#4f8ef7' },
  capturePane: { flex: 1, minWidth: 0, minHeight: 0 },
  captureToolsScroll: { maxHeight: 440 },
  captureControls: { padding: 12, paddingBottom: 0 },
  captureToolStack: { gap: 8 },
  savedToolRow: { justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  captureHead: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  captureList: { flex: 1 },
  trapSummaryRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trapInspectorEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36 },
  trapInspectorGlyph: { fontSize: 40, marginBottom: 12 },
  trapInspectorTitle: { fontSize: 17, fontWeight: '800' },
  trapInspectorHint: {
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 360,
    textAlign: 'center',
    marginTop: 7,
  },
  trapDetail: { flex: 1, minWidth: 0, minHeight: 0 },
  trapDetailHead: {
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  trapDetailTitle: { fontSize: 16, fontWeight: '800', marginTop: 3 },
  trapDetailContent: { padding: 16, paddingBottom: 30 },
  trapMeta: { gap: 5, marginBottom: 14 },
  trapVarbind: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
});
