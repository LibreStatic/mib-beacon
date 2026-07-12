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
} from '@omc/ui';
import type {
  AuthProtocol,
  EngineInfo,
  PrivProtocol,
  SecurityLevel,
  SnmpVersion,
  TrapRecord,
} from '@omc/core/client';
import { validateVarbindInput } from '@omc/core/client';
import { useEngine } from '../engine-context';
import { useAppStore, type AgentForm, type NotificationHistoryItem } from '../store';
import { repeatNotification, sendNotification, toggleReceiver } from '../actions';
import { VarbindEditor } from '../components/VarbindEditor';
import { OidLookupPanel } from '../components/OidLookupPanel';

const VERSIONS: SnmpVersion[] = ['v1', 'v2c', 'v3'];
const LEVELS: SecurityLevel[] = ['noAuthNoPriv', 'authNoPriv', 'authPriv'];
const AUTHS: AuthProtocol[] = ['md5', 'sha', 'sha256', 'sha512'];
const PRIVS: PrivProtocol[] = ['des', 'aes', 'aes256b', 'aes256r'];

export function TrapsScreen({ info }: { info: EngineInfo | null }) {
  const t = useTheme();
  const mode = useAppStore((s) => s.trapMode);
  return (
    <View style={styles.root}>
      <View style={[styles.modeBar, { backgroundColor: t.surface, borderBottomColor: t.border }]}>
        <View>
          <Text style={[styles.consoleTitle, { color: t.text }]}>Notification console</Text>
          <Text style={{ color: t.textDim, fontSize: 10 }}>CAPTURE / CRAFT / REPLAY</Text>
        </View>
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
  const receiver = useAppStore((s) => s.receiver);
  const records = useAppStore((s) => s.records);
  const [port, setPort] = useState('1162');
  const [err, setErr] = useState<string | null>(null);
  const onToggle = async () => {
    setErr(null);
    try {
      await toggleReceiver(engine, port);
    } catch (e) {
      const x = e as { message?: string; hint?: string };
      setErr(`${x.message ?? String(e)}${x.hint ? ' — ' + x.hint : ''}`);
    }
  };
  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={records}
      keyExtractor={(record) => record.id}
      ListHeaderComponent={
        <>
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

function SendWorkspace({ info }: { info: EngineInfo | null }) {
  const engine = useEngine();
  const t = useTheme();
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
      contentContainerStyle={styles.content}
      data={history}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <>
          <Card style={styles.card}>
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

          <Card style={styles.card}>
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
});
