import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Button,
  Chip,
  Dialog,
  Field,
  Label,
  Pill,
  Row,
  SectionTitle,
  useTheme,
} from '@mibbeacon/ui';
import type {
  AuthProtocol,
  EngineInfo,
  PrivProtocol,
  SecurityLevel,
  SnmpVersion,
} from '@mibbeacon/core/client';
import { validateVarbindInput } from '@mibbeacon/core/client';
import { useEngine } from '../engine-context';
import { useAppStore, type AgentForm } from '../store';
import { sendNotification } from '../actions';
import { VarbindEditor } from './VarbindEditor';

const VERSIONS: SnmpVersion[] = ['v1', 'v2c', 'v3'];
const LEVELS: SecurityLevel[] = ['noAuthNoPriv', 'authNoPriv', 'authPriv'];
const AUTHS: AuthProtocol[] = ['md5', 'sha', 'sha256', 'sha512'];
const PRIVS: PrivProtocol[] = ['des', 'aes', 'aes256b', 'aes256r'];

/**
 * Trap/inform composer presented as an overlay dialog so the send history
 * stays in place behind it. Opened via the store (`trapComposerOpen`) so
 * Browse prefills and trap replays can launch it directly.
 */
export function TrapComposerDialog({ info }: { info: EngineInfo | null }) {
  const engine = useEngine();
  const t = useTheme();
  const open = useAppStore((s) => s.trapComposerOpen);
  const form = useAppStore((s) => s.notification);
  const busy = useAppStore((s) => s.sendBusy);
  const error = useAppStore((s) => s.sendError);
  const agentProfiles = useAppStore((s) => s.agentProfiles);
  const notificationAgentId = useAppStore((s) => s.notificationAgentId);
  const [trapName, setTrapName] = useState<string | null>(null);
  const update = useAppStore.getState().updateNotification;
  const setVarbinds = useAppStore.getState().setNotificationVarbinds;
  const setTarget = (patch: Partial<AgentForm>) => update({ target: { ...form.target, ...patch } });
  const setV3 = (patch: Partial<AgentForm['v3']>) =>
    setTarget({ v3: { ...form.target.v3, ...patch } });
  const close = () => useAppStore.getState().setTrapComposerOpen(false);

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

  useEffect(() => {
    let active = true;
    if (!open || trapOidError) {
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
  }, [engine, form.trapOid, open, trapOidError]);

  const send = async () => {
    await sendNotification(engine);
    if (!useAppStore.getState().sendError) close();
  };

  return (
    <Dialog
      visible={open}
      onRequestClose={close}
      title="Compose notification"
      subtitle="Destination, envelope, and payload for a trap or inform."
      dismissable={!busy}
      footer={
        <>
          {error || formValidationError ? (
            <View style={styles.footerMessages}>
              {error ? <Label tone="error">{error}</Label> : null}
              {formValidationError ? <Label tone="error">{formValidationError}</Label> : null}
            </View>
          ) : null}
          <Button title="Cancel" variant="ghost" onPress={close} />
          <Button
            title={busy ? 'Transmitting…' : `Send ${form.kind}`}
            disabled={busy || !!formValidationError}
            onPress={() => void send()}
          />
        </>
      }
    >
      <View style={styles.group}>
        <View style={styles.groupTitle}>
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
      </View>

      <View style={styles.group}>
        <SectionTitle>Notification envelope</SectionTitle>
        <Row>
          <Chip label="Trap" active={form.kind === 'trap'} onPress={() => update({ kind: 'trap' })} />
          <Chip
            label={form.target.version === 'v1' ? 'Inform · v2+' : 'Inform'}
            active={form.kind === 'inform'}
            onPress={form.target.version === 'v1' ? undefined : () => update({ kind: 'inform' })}
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
          Tip: open a NOTIFICATION-TYPE node in Browse and choose “Send this trap” to prefill its
          OID and OBJECTS payload.
        </Label>
      </View>

      <View style={styles.group}>
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
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8, marginBottom: 10 },
  groupTitle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  payloadHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  payloadList: { gap: 8 },
  footerMessages: { flexBasis: '100%', flexShrink: 1, gap: 2 },
  wrap: { flexWrap: 'wrap' },
});
