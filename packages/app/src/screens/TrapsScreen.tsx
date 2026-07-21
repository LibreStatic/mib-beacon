import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { View, Pressable, FlatList, StyleSheet, Share, ScrollView } from 'react-native';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Label,
  Mono,
  Pill,
  Row,
  SectionTitle,
  Text,
  useTheme,
} from '@mibbeacon/ui';
import type {
  AuthProtocol,
  EngineInfo,
  PrivProtocol,
  SecurityLevel,
  TrapRecord,
  TrapQuery,
} from '@mibbeacon/core/client';
import { useEngine, useEngineOwnership } from '../engine-context';
import { clearTrapCapture } from '../engine-manual-actions';
import { useAppStore, type NotificationHistoryItem } from '../store';
import {
  markTrapRead,
  deleteTrap,
  refreshTrapRecords,
  repeatNotification,
  toggleReceiver,
} from '../actions';
import { OidLookupPanel } from '../components/OidLookupPanel';
import { TrapComposerDialog } from '../components/TrapComposerDialog';
import { ContainerAwareSplitWorkspace } from '../components/SplitWorkspace';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { useResponsiveLayout } from '../responsive-context';
import { TRAP_SPLIT_MINIMUMS } from '../responsive-layout';
import { serializeTraps, trapToNotificationPayload } from '../trap-export';
import { SwipeActionRow } from '../components/SwipeActionRow';
import {
  trapCollectionStatusText,
  trapPersistentCollectionsController,
  type TrapPersistentCollectionsController,
  type TrapPersistentCollectionsSnapshot,
} from '../trap-persistent-collections';
import { buildTrapV3UserDraft, type TrapCredentialIntent } from '../trap-v3-user-draft';

const LEVELS: SecurityLevel[] = ['noAuthNoPriv', 'authNoPriv', 'authPriv'];
const AUTHS: AuthProtocol[] = ['md5', 'sha', 'sha256', 'sha512'];
const PRIVS: PrivProtocol[] = ['des', 'aes', 'aes256b', 'aes256r'];

export function TrapsScreen({ info }: { info: EngineInfo | null }) {
  const engine = useEngine();
  const ownsEngine = useEngineOwnership();
  const t = useTheme();
  const { supportsSplitView } = useResponsiveLayout();
  const mode = useAppStore((s) => s.trapMode);
  const controller = useMemo(
    () => trapPersistentCollectionsController(engine, ownsEngine),
    [engine, ownsEngine],
  );
  const collection = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.snapshot(),
    () => controller.snapshot(),
  );
  useEffect(() => {
    controller.activate();
    void controller.load().catch(() => undefined);
  }, [controller]);
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
      {mode === 'receive' ? (
        <ReceiveWorkspace controller={controller} collection={collection} />
      ) : (
        <SendWorkspace controller={controller} collection={collection} />
      )}
      <TrapComposerDialog info={info} />
    </View>
  );
}

function TrapCaptureTools({
  records,
  query,
  setQuery,
  applyQuery,
  filterName,
  setFilterName,
  savedFilters,
  v3Users,
  rules,
  controller,
  collection,
  ownsEngine,
}: {
  records: TrapRecord[];
  query: TrapQuery;
  setQuery: (query: TrapQuery) => void;
  applyQuery: (query?: TrapQuery) => Promise<void>;
  filterName: string;
  setFilterName: Dispatch<SetStateAction<string>>;
  savedFilters: TrapPersistentCollectionsSnapshot['savedFilters'];
  v3Users: TrapPersistentCollectionsSnapshot['v3Users'];
  rules: TrapPersistentCollectionsSnapshot['rules'];
  controller: TrapPersistentCollectionsController;
  collection: TrapPersistentCollectionsSnapshot;
  ownsEngine: () => boolean;
}) {
  const [userName, setUserName] = useState('');
  const [userLevel, setUserLevel] = useState<SecurityLevel>('noAuthNoPriv');
  const [authProtocol, setAuthProtocol] = useState<AuthProtocol>('sha');
  const [authKey, setAuthKey] = useState('');
  const [authIntent, setAuthIntent] = useState<TrapCredentialIntent>('retain');
  const [privProtocol, setPrivProtocol] = useState<PrivProtocol>('aes');
  const [privKey, setPrivKey] = useState('');
  const [privIntent, setPrivIntent] = useState<TrapCredentialIntent>('retain');
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [ruleOid, setRuleOid] = useState('*');
  const [ruleSources, setRuleSources] = useState('');
  const [ruleText, setRuleText] = useState('');
  const [ruleSeverity, setRuleSeverity] = useState<'info' | 'warning' | 'critical'>('warning');
  const [ruleColor, setRuleColor] = useState('#f59e0b');
  const [ruleNotify, setRuleNotify] = useState(false);
  const updateQuery = (patch: Partial<TrapQuery>) => setQuery({ ...query, ...patch });
  const blocked =
    collection.readiness.phase !== 'ready' ||
    ['error-reverted', 'uncertain', 'conflict'].includes(collection.phase);
  const selectedV3User = v3Users.find((user) => user.name === userName.trim());
  const credentialRequirementError =
    userLevel !== 'noAuthNoPriv' &&
    (authIntent === 'clear' || (authIntent === 'retain' && !selectedV3User?.hasAuthKey))
      ? 'This security level requires an authentication key; choose Replace.'
      : userLevel === 'authPriv' &&
          (privIntent === 'clear' || (privIntent === 'retain' && !selectedV3User?.hasPrivKey))
        ? 'This security level requires a privacy key; choose Replace.'
        : null;
  const share = (format: 'csv' | 'json') =>
    void Share.share({
      message: serializeTraps(records, format),
      title: `mibbeacon-traps.${format}`,
    }).catch(() => undefined);
  return (
    <View style={styles.captureToolStack}>
      <Card style={styles.card}>
        <Label
          tone={
            ['error-reverted', 'uncertain', 'conflict'].includes(collection.phase) ? 'error' : 'dim'
          }
        >
          {trapCollectionStatusText(collection)}
        </Label>
        {['error-reverted', 'conflict'].includes(collection.phase) ? (
          <Row style={styles.wrap}>
            {collection.phase === 'error-reverted' && collection.retryable ? (
              <Button
                title="Retry failed change"
                small
                onPress={() => void controller.retryFailed().catch(() => undefined)}
              />
            ) : null}
            <Button
              title="Acknowledge"
              small
              variant="ghost"
              onPress={() => controller.acknowledge()}
            />
            <Button
              title="Reconcile"
              small
              variant="ghost"
              onPress={() => void controller.reconcile().catch(() => undefined)}
            />
          </Row>
        ) : collection.phase === 'uncertain' ? (
          <Row style={styles.wrap}>
            <Button
              title="Reconcile with engine"
              small
              onPress={() => void controller.reconcile().catch(() => undefined)}
            />
            {collection.canAcknowledgeUncertainty ? (
              <Button
                title="Accept public state and re-enter keys"
                small
                variant="ghost"
                onPress={() => controller.acknowledgeUncertainty()}
              />
            ) : null}
          </Row>
        ) : collection.readiness.phase === 'error' ? (
          <Button
            title="Retry load"
            small
            onPress={() => void controller.load().catch(() => undefined)}
          />
        ) : null}
      </Card>
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
          <Button title="Apply" small onPress={() => void applyQuery().catch(() => undefined)} />
          <Button
            title="Reset"
            small
            variant="ghost"
            onPress={() => void applyQuery({}).catch(() => undefined)}
          />
          <Button title="CSV" small variant="ghost" onPress={() => share('csv')} />
          <Button title="JSON" small variant="ghost" onPress={() => share('json')} />
        </Row>
        <Row style={styles.wrap}>
          <Field label="Saved filter name" value={filterName} onChangeText={setFilterName} />
          <Button
            title="Save filter"
            small
            disabled={
              !filterName.trim() ||
              blocked ||
              Boolean(controller.statusFor(`filter:save:${filterName.trim()}`))
            }
            onPress={() => {
              const submittedName = filterName;
              void controller
                .saveFilter(submittedName, query, ownsEngine)
                .then(async () => {
                  if (ownsEngine())
                    setFilterName((current) => (current === submittedName ? '' : current));
                })
                .catch(() => undefined);
            }}
          />
        </Row>
        {savedFilters.map((filter) => (
          <Row key={filter.id} style={styles.savedToolRow}>
            <Chip
              label={filter.name}
              active={false}
              onPress={() => void applyQuery(filter.query).catch(() => undefined)}
            />
            {controller.statusFor(`filter:remove:${filter.id}`) ? (
              <Label tone="dim" size={10}>
                {controller.statusFor(`filter:remove:${filter.id}`)}
              </Label>
            ) : null}
            <Button
              title="×"
              small
              variant="ghost"
              disabled={blocked || Boolean(controller.statusFor(`filter:remove:${filter.id}`))}
              onPress={() =>
                void controller.removeFilter(filter.id, ownsEngine).catch(() => undefined)
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
              onPress={() => {
                setUserLevel(level);
                if (level === 'noAuthNoPriv' && authIntent === 'replace') setAuthIntent('retain');
                if (level !== 'authPriv' && privIntent === 'replace') setPrivIntent('retain');
              }}
            />
          ))}
        </Row>
        <Label tone="dim" size={10}>
          Authentication credential
        </Label>
        <Row style={styles.wrap}>
          {(['retain', 'replace', 'clear'] as const).map((intent) => (
            <Chip
              key={`auth-${intent}`}
              label={
                intent === 'retain' ? 'Retain stored' : intent === 'replace' ? 'Replace' : 'Clear'
              }
              active={authIntent === intent}
              disabled={intent === 'replace' && userLevel === 'noAuthNoPriv'}
              onPress={() => setAuthIntent(intent)}
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
            {authIntent === 'replace' ? (
              <Field
                label="Replacement auth key (write-only)"
                value={authKey}
                secureTextEntry
                onChangeText={setAuthKey}
              />
            ) : null}
          </>
        ) : null}
        <Label tone="dim" size={10}>
          Privacy credential
        </Label>
        <Row style={styles.wrap}>
          {(['retain', 'replace', 'clear'] as const).map((intent) => (
            <Chip
              key={`priv-${intent}`}
              label={
                intent === 'retain' ? 'Retain stored' : intent === 'replace' ? 'Replace' : 'Clear'
              }
              active={privIntent === intent}
              disabled={intent === 'replace' && userLevel !== 'authPriv'}
              onPress={() => setPrivIntent(intent)}
            />
          ))}
        </Row>
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
            {privIntent === 'replace' ? (
              <Field
                label="Replacement privacy key (write-only)"
                value={privKey}
                secureTextEntry
                onChangeText={setPrivKey}
              />
            ) : null}
          </>
        ) : null}
        {selectedV3User ? (
          <Label tone="dim" size={10}>
            Editing confirmed profile {selectedV3User.name}; stored keys remain write-only.
          </Label>
        ) : null}
        {credentialRequirementError ? (
          <Label tone="error">{credentialRequirementError}</Label>
        ) : null}
        {credentialError ? <Label tone="error">{credentialError}</Label> : null}
        <Button
          title="Save v3 user"
          small
          disabled={
            !userName.trim() ||
            blocked ||
            (userLevel !== 'noAuthNoPriv' && authIntent === 'replace' && !authKey.trim()) ||
            (userLevel === 'authPriv' && privIntent === 'replace' && !privKey.trim()) ||
            Boolean(credentialRequirementError) ||
            Boolean(controller.statusFor(`v3:upsert:${userName.trim()}`))
          }
          onPress={() => {
            setCredentialError(null);
            let draft: ReturnType<typeof buildTrapV3UserDraft>;
            try {
              draft = buildTrapV3UserDraft({
                name: userName,
                level: userLevel,
                authProtocol,
                privProtocol,
                authIntent,
                privIntent,
                authKey,
                privKey,
                hasAuthKey: selectedV3User?.hasAuthKey,
                hasPrivKey: selectedV3User?.hasPrivKey,
              });
            } catch (cause) {
              setCredentialError(cause instanceof Error ? cause.message : String(cause));
              return;
            }
            setAuthKey('');
            setPrivKey('');
            void controller.upsertV3User(draft, ownsEngine).catch(() => undefined);
          }}
        />
        {v3Users.map((user) => (
          <Row key={user.name} style={styles.savedToolRow}>
            <Chip
              label={`${user.name} · ${user.level} · auth ${user.hasAuthKey ? 'stored' : 'none'} · priv ${user.hasPrivKey ? 'stored' : 'none'}`}
              active={selectedV3User?.name === user.name}
              onPress={() => {
                setUserName(user.name);
                setUserLevel(user.level);
                if (user.authProtocol) setAuthProtocol(user.authProtocol);
                if (user.privProtocol) setPrivProtocol(user.privProtocol);
                setAuthIntent('retain');
                setPrivIntent('retain');
                setAuthKey('');
                setPrivKey('');
              }}
            />
            {controller.statusFor(`v3:remove:${user.name}`) ? (
              <Label tone="dim" size={10}>
                {controller.statusFor(`v3:remove:${user.name}`)}
              </Label>
            ) : null}
            <Button
              title="Delete"
              small
              variant="danger"
              disabled={blocked || Boolean(controller.statusFor(`v3:remove:${user.name}`))}
              onPress={() =>
                void controller.removeV3User(user.name, ownsEngine).catch(() => undefined)
              }
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
          disabled={
            !ruleName.trim() ||
            blocked ||
            Boolean(controller.statusFor(`rule:create:${ruleName.trim()}`))
          }
          onPress={() => {
            const submittedName = ruleName;
            void controller
              .createRule(
                {
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
                },
                ownsEngine,
              )
              .then(async () => {
                if (ownsEngine())
                  setRuleName((current) => (current === submittedName ? '' : current));
              })
              .catch(() => undefined);
          }}
        />
        {rules.map((rule) => (
          <Row key={rule.id} style={styles.savedToolRow}>
            <Chip
              label={`${rule.priority} · ${rule.name}`}
              active={rule.enabled}
              disabled={
                blocked ||
                Boolean(
                  controller.statusFor(`rule:update:${rule.id}`) ??
                  controller.statusFor(`rule:remove:${rule.id}`),
                )
              }
              onPress={() =>
                void controller
                  .updateRule(rule.id, { enabled: !rule.enabled }, ownsEngine)
                  .catch(() => undefined)
              }
            />
            {(controller.statusFor(`rule:update:${rule.id}`) ??
            controller.statusFor(`rule:remove:${rule.id}`)) ? (
              <Label tone="dim" size={10}>
                {controller.statusFor(`rule:update:${rule.id}`) ??
                  controller.statusFor(`rule:remove:${rule.id}`)}
              </Label>
            ) : null}
            <Button
              title="Delete"
              small
              variant="danger"
              disabled={
                blocked ||
                Boolean(
                  controller.statusFor(`rule:update:${rule.id}`) ??
                  controller.statusFor(`rule:remove:${rule.id}`),
                )
              }
              onPress={() => void controller.removeRule(rule.id, ownsEngine).catch(() => undefined)}
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

function ReceiveWorkspace({
  controller,
  collection,
}: {
  controller: TrapPersistentCollectionsController;
  collection: TrapPersistentCollectionsSnapshot;
}) {
  const engine = useEngine();
  const ownsEngine = useEngineOwnership();
  const t = useTheme();
  const { supportsSplitView } = useResponsiveLayout();
  const receiver = useAppStore((s) => s.receiver);
  const records = useAppStore((s) => s.records);
  const [port, setPort] = useState('');
  const [transport, setTransport] = useState<'dual' | 'udp4' | 'udp6'>('dual');
  const [labMode, setLabMode] = useState(true);
  const [communities, setCommunities] = useState('public');
  const [err, setErr] = useState<string | null>(null);
  const [receiverPending, setReceiverPending] = useState<'starting' | 'stopping' | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState<TrapQuery>({});
  const [filterName, setFilterName] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [pendingRecordIds, setPendingRecordIds] = useState<string[]>([]);
  const pendingRecordIdsRef = useRef(new Set<string>());
  const [clearPending, setClearPending] = useState(false);
  const clearPendingRef = useRef(false);
  const onToggle = async () => {
    if (receiverPending) return;
    setErr(null);
    setReceiverPending(receiver.running ? 'stopping' : 'starting');
    try {
      await toggleReceiver(
        engine,
        port,
        {
          transport,
          disableAuthorization: labMode,
          communities: communities
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        },
        ownsEngine,
      );
    } catch (e) {
      if (!ownsEngine()) return;
      const x = e as { message?: string; hint?: string };
      setErr(`${x.message ?? String(e)}${x.hint ? ' — ' + x.hint : ''}`);
    } finally {
      if (ownsEngine()) setReceiverPending(null);
    }
  };
  const clearCapture = async () => {
    if (pendingRecordIdsRef.current.size || clearPendingRef.current) return;
    clearPendingRef.current = true;
    setClearPending(true);
    try {
      await clearTrapCapture(engine, ownsEngine);
      if (ownsEngine()) setSelectedId(null);
    } finally {
      if (ownsEngine()) {
        clearPendingRef.current = false;
        setClearPending(false);
      }
    }
  };
  const runRecordMutation = async (id: string, operation: () => Promise<void>) => {
    if (clearPendingRef.current || pendingRecordIdsRef.current.has(id)) return;
    pendingRecordIdsRef.current.add(id);
    setPendingRecordIds((current) => [...current, id]);
    try {
      await operation();
    } finally {
      if (ownsEngine()) {
        pendingRecordIdsRef.current.delete(id);
        setPendingRecordIds((current) => current.filter((pendingId) => pendingId !== id));
      }
    }
  };
  const applyQuery = async (next = query) => {
    setQuery(next);
    await refreshTrapRecords(engine, next, ownsEngine);
  };
  const selectRecord = (record: TrapRecord) => {
    setSelectedId(record.id);
    if (!record.readAt)
      void runRecordMutation(record.id, () =>
        markTrapRead(engine, record.id, true, ownsEngine),
      ).catch(() => undefined);
  };
  const refreshRecords = async () => {
    setRefreshing(true);
    try {
      await refreshTrapRecords(engine, query, ownsEngine);
    } finally {
      if (ownsEngine()) setRefreshing(false);
    }
  };
  const receiverCard = (
    <Card style={styles.card}>
      <View style={styles.cardTitle}>
        <SectionTitle>Trap receiver</SectionTitle>
        <Pill
          text={
            receiverPending ? receiverPending.toUpperCase() : receiver.running ? 'LIVE' : 'OFFLINE'
          }
          color={receiverPending ? t.accent : receiver.running ? t.ok : t.textDim}
        />
      </View>
      <Row style={styles.receiverControls}>
        <Field
          label="Listen port"
          value={port}
          onChangeText={setPort}
          keyboardType="number-pad"
          editable={!receiver.running && !receiverPending}
        />
        <View style={styles.receiverAction}>
          <Button
            title={
              receiverPending === 'starting'
                ? 'Starting…'
                : receiverPending === 'stopping'
                  ? 'Stopping…'
                  : receiver.running
                    ? `Stop (:${receiver.port})`
                    : 'Start receiver'
            }
            variant={receiver.running ? 'danger' : 'primary'}
            disabled={Boolean(receiverPending)}
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
            disabled={Boolean(receiverPending)}
            onPress={() => setTransport(value)}
          />
        ))}
        <Chip
          label="Lab accept-all"
          active={labMode}
          disabled={Boolean(receiverPending)}
          onPress={() => setLabMode(!labMode)}
        />
      </Row>
      {!labMode ? (
        <Field
          label="Allowed communities (comma-separated)"
          value={communities}
          editable={!receiverPending}
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
      records={records}
      query={query}
      setQuery={setQuery}
      applyQuery={applyQuery}
      filterName={filterName}
      setFilterName={setFilterName}
      savedFilters={collection.savedFilters}
      v3Users={collection.v3Users}
      rules={collection.rules}
      controller={controller}
      collection={collection}
      ownsEngine={ownsEngine}
    />
  );

  const selected = records.find((record) => record.id === selectedId) ?? null;
  return (
    <ContainerAwareSplitWorkspace
      workspace="traps"
      {...TRAP_SPLIT_MINIMUMS}
      splitEnabled={supportsSplitView}
      preservePrimary
      stackOnFallback={Boolean(selected)}
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
                accessibilityLabel={
                  clearPending
                    ? 'Clearing captured traps'
                    : pendingRecordIds.length
                      ? 'Record action pending; clear is unavailable'
                      : 'Clear captured traps'
                }
                accessibilityState={{ disabled: clearPending || pendingRecordIds.length > 0 }}
                disabled={clearPending || pendingRecordIds.length > 0}
                onPress={() => void clearCapture().catch(() => undefined)}
                style={styles.clearAction}
              >
                <Text style={{ color: t.accent, fontSize: 11, fontWeight: '700' }}>
                  {clearPending
                    ? 'Clearing…'
                    : pendingRecordIds.length
                      ? 'Record action pending'
                      : 'Clear'}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <FlatList
            style={styles.captureList}
            data={records}
            refreshing={refreshing}
            onRefresh={() => void refreshRecords().catch(() => undefined)}
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
                disabled={clearPending || pendingRecordIds.includes(item.id)}
                onSwipeLeft={() =>
                  void runRecordMutation(item.id, () =>
                    deleteTrap(engine, item.id, ownsEngine),
                  ).catch(() => undefined)
                }
                onSwipeRight={() =>
                  void runRecordMutation(item.id, () =>
                    markTrapRead(engine, item.id, !item.readAt, ownsEngine),
                  ).catch(() => undefined)
                }
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
      secondary={
        selected ? (
          <TrapDetail
            rec={selected}
            disabled={clearPending}
            pending={pendingRecordIds.includes(selected.id)}
            onMark={(read) =>
              runRecordMutation(selected.id, () =>
                markTrapRead(engine, selected.id, read, ownsEngine),
              )
            }
          />
        ) : (
          <TrapInspectorEmpty />
        )
      }
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

function TrapDetail({
  rec,
  disabled,
  pending,
  onMark,
}: {
  rec: TrapRecord;
  disabled: boolean;
  pending: boolean;
  onMark: (read: boolean) => Promise<void>;
}) {
  const t = useTheme();
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
    state.setTrapComposerOpen(true);
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
            void Share.share({ message: serializeTraps([rec], 'json'), title: 'trap.json' }).catch(
              () => undefined,
            )
          }
        />
        <Button
          title="Text"
          small
          variant="ghost"
          onPress={() =>
            void Share.share({ message: serializeTraps([rec], 'text'), title: 'trap.txt' }).catch(
              () => undefined,
            )
          }
        />
        <Button
          title={pending ? 'Updating…' : rec.readAt ? 'Unread' : 'Read'}
          small
          variant="ghost"
          disabled={disabled || pending}
          onPress={() => void onMark(!rec.readAt).catch(() => undefined)}
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

function SendWorkspace({
  controller,
  collection,
}: {
  controller: TrapPersistentCollectionsController;
  collection: TrapPersistentCollectionsSnapshot;
}) {
  const engine = useEngine();
  const ownsEngine = useEngineOwnership();
  const t = useTheme();
  const { supportsSplitView } = useResponsiveLayout();
  const form = useAppStore((s) => s.notification);
  const busy = useAppStore((s) => s.sendBusy);
  const error = useAppStore((s) => s.sendError);
  const history = useAppStore((s) => s.sendHistory);
  const agentProfiles = useAppStore((s) => s.agentProfiles);
  const notificationAgentId = useAppStore((s) => s.notificationAgentId);
  const [presetName, setPresetName] = useState('');
  const openComposer = () => useAppStore.getState().setTrapComposerOpen(true);
  const destinationAgent = agentProfiles.find((profile) => profile.id === notificationAgentId);
  const destinationSummary = destinationAgent
    ? `Saved agent · ${destinationAgent.name}`
    : form.target.host.trim()
      ? `${form.target.host}:${form.target.port || '162'} · ${form.target.version}`
      : 'No destination yet';

  const blocked =
    collection.readiness.phase !== 'ready' ||
    ['error-reverted', 'uncertain', 'conflict'].includes(collection.phase);

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={[styles.content, supportsSplitView ? styles.sendDesktopContent : null]}
      data={history}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <>
          <Card style={styles.card}>
            <View style={styles.cardTitle}>
              <SectionTitle>Craft a notification</SectionTitle>
              <Pill text={form.kind.toUpperCase()} color={t.accent} />
            </View>
            <Label tone="dim" size={11}>
              {destinationSummary}
            </Label>
            <Mono dim size={11}>
              {form.trapOid || 'No trap OID yet'} · {form.varbinds.length} varbinds
            </Mono>
            <Row>
              <Button
                title={busy ? 'Transmitting…' : 'Compose trap'}
                disabled={busy}
                onPress={openComposer}
              />
            </Row>
            {error ? <Label tone="error">{error}</Label> : null}
          </Card>
          <Card style={styles.card}>
            <SectionTitle>Saved sender presets</SectionTitle>
            <Label
              tone={
                ['error-reverted', 'uncertain', 'conflict'].includes(collection.phase)
                  ? 'error'
                  : 'dim'
              }
            >
              {trapCollectionStatusText(collection)}
            </Label>
            {['error-reverted', 'conflict'].includes(collection.phase) ? (
              <Row style={styles.wrap}>
                {collection.phase === 'error-reverted' && collection.retryable ? (
                  <Button
                    title="Retry failed change"
                    small
                    onPress={() => void controller.retryFailed().catch(() => undefined)}
                  />
                ) : null}
                <Button
                  title="Acknowledge"
                  small
                  variant="ghost"
                  onPress={() => controller.acknowledge()}
                />
                <Button
                  title="Reconcile"
                  small
                  variant="ghost"
                  onPress={() => void controller.reconcile().catch(() => undefined)}
                />
              </Row>
            ) : collection.phase === 'uncertain' ? (
              <Row style={styles.wrap}>
                <Button
                  title="Reconcile with engine"
                  small
                  onPress={() => void controller.reconcile().catch(() => undefined)}
                />
                {collection.canAcknowledgeUncertainty ? (
                  <Button
                    title="Accept public state and re-enter keys"
                    small
                    variant="ghost"
                    onPress={() => controller.acknowledgeUncertainty()}
                  />
                ) : null}
              </Row>
            ) : collection.readiness.phase === 'error' ? (
              <Button
                title="Retry load"
                small
                onPress={() => void controller.load().catch(() => undefined)}
              />
            ) : null}
            <Row style={styles.wrap}>
              <Field label="Preset name" value={presetName} onChangeText={setPresetName} />
              <Button
                title="Save preset"
                small
                disabled={
                  !presetName.trim() ||
                  !notificationAgentId ||
                  blocked ||
                  Boolean(controller.statusFor(`preset:save:${presetName.trim()}`))
                }
                onPress={() => {
                  const submittedName = presetName;
                  void controller
                    .savePreset(
                      submittedName,
                      notificationAgentId!,
                      {
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
                      },
                      ownsEngine,
                    )
                    .then(async () => {
                      if (!ownsEngine()) return;
                      setPresetName((current) => (current === submittedName ? '' : current));
                    })
                    .catch(() => undefined);
                }}
              />
            </Row>
            {!notificationAgentId ? (
              <Label tone="dim">
                Choose a saved agent before saving; credentials are never stored in presets.
              </Label>
            ) : null}
            {collection.presets.map((preset) => (
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
                    useAppStore.getState().setTrapComposerOpen(true);
                  }}
                />
                {controller.statusFor(`preset:remove:${preset.id}`) ? (
                  <Label tone="dim" size={10}>
                    {controller.statusFor(`preset:remove:${preset.id}`)}
                  </Label>
                ) : null}
                <Button
                  title="Delete"
                  small
                  variant="danger"
                  disabled={blocked || Boolean(controller.statusFor(`preset:remove:${preset.id}`))}
                  onPress={() =>
                    void controller.removePreset(preset.id, ownsEngine).catch(() => undefined)
                  }
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
            <EmptyState
              title="No notifications sent"
              hint="Use “Compose trap” to craft a trap or inform."
            />
          ) : null}
        </>
      }
      renderItem={({ item }) => (
        <HistoryRow
          item={item}
          busy={busy}
          onRepeat={() => void repeatNotification(engine, item.request, ownsEngine)}
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
  receiverControls: { flexWrap: 'wrap' },
  receiverAction: {
    justifyContent: 'flex-end',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 120,
    minWidth: 120,
  },
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
  capturePane: { flex: 1, minWidth: 0, minHeight: 0 },
  captureToolsScroll: { maxHeight: '55%', flexShrink: 1 },
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
