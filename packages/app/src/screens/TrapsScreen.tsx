import { useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
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
  EngineInfo,
  PrivProtocol,
  SecurityLevel,
  SnmpVersion,
  TrapRecord,
} from '@mibbeacon/core/client';
import { validateVarbindInput } from '@mibbeacon/core/client';
import { useEngine } from '../engine-context';
import { useAppStore, type AgentForm, type NotificationHistoryItem } from '../store';
import { repeatNotification, sendNotification, toggleReceiver } from '../actions';
import { VarbindEditor } from '../components/VarbindEditor';
import { OidLookupPanel } from '../components/OidLookupPanel';
import { SplitWorkspace } from '../components/SplitWorkspace';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { useResponsiveLayout } from '../responsive-context';

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

function ReceiveWorkspace() {
  const engine = useEngine();
  const t = useTheme();
  const { supportsSplitView } = useResponsiveLayout();
  const receiver = useAppStore((s) => s.receiver);
  const records = useAppStore((s) => s.records);
  const [port, setPort] = useState('1162');
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const onToggle = async () => {
    setErr(null);
    try {
      await toggleReceiver(engine, port);
    } catch (e) {
      const x = e as { message?: string; hint?: string };
      setErr(`${x.message ?? String(e)}${x.hint ? ' — ' + x.hint : ''}`);
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
      {err ? (
        <Label tone="error" size={12}>
          {err}
        </Label>
      ) : null}
      <Label tone="dim" size={11}>
        Ports below 1024 need elevated privileges; 1162 works unprivileged.
      </Label>
    </Card>
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
            <View style={styles.captureControls}>{receiverCard}</View>
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
                <Pressable onPress={() => useAppStore.getState().clearTraps()}>
                  <Text style={{ color: t.accent, fontSize: 11, fontWeight: '700' }}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
            <FlatList
              style={styles.captureList}
              data={records}
              keyExtractor={(record) => record.id}
              ListEmptyComponent={
                <EmptyState
                  title={receiver.running ? 'Listening for traps…' : 'No traps received'}
                  hint="Start the receiver, then send a test notification to this host."
                />
              }
              renderItem={({ item }) => (
                <TrapSummaryRow
                  rec={item}
                  selected={item.id === selected?.id}
                  onPress={() => setSelectedId(item.id)}
                />
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
      keyExtractor={(record) => record.id}
      ListHeaderComponent={
        <>
          {receiverCard}
          {records.length ? (
            <Row style={styles.listHead}>
              <Text style={{ color: t.textDim, fontSize: 12 }}>{records.length} received</Text>
              <Pressable onPress={() => useAppStore.getState().clearTraps()}>
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
      accessibilityState={{ selected }}
      style={[
        styles.trapSummaryRow,
        { backgroundColor: selected ? t.accentSoft : 'transparent', borderBottomColor: t.border },
      ]}
    >
      <Row style={{ justifyContent: 'space-between' }}>
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
        <Pill text={`${rec.varbinds.length} VB`} />
      </Row>
    </Pressable>
  );
}

function TrapDetail({ rec }: { rec: TrapRecord }) {
  const t = useTheme();
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
  const [trapName, setTrapName] = useState<string | null>(null);
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
  const payloadError = form.varbinds.map(validateVarbindInput).find(Boolean) ?? null;
  const formValidationError = trapOidError ?? uptimeError ?? agentAddressError ?? payloadError;
  const desOff = info != null && !info.ciphers.des;

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
                <Field
                  label="v1 agent address"
                  value={form.agentAddress}
                  onChangeText={(agentAddress) => update({ agentAddress })}
                />
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
          {item.request.target.host}:{item.request.target.port ?? 162}
        </Text>
      </View>
      <Button title="Send again" small variant="ghost" disabled={busy} onPress={onRepeat} />
    </View>
  );
}

function TrapRow({ rec }: { rec: TrapRecord }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      onPress={() => setOpen((value) => !value)}
      style={[styles.trapRow, { borderBottomColor: t.border }]}
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
  captureControls: { padding: 12, paddingBottom: 0 },
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
