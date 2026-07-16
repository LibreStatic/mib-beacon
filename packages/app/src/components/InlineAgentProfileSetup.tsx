import { StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Chip,
  Field,
  Label,
  Row,
  SectionTitle,
} from '@mibbeacon/ui';
import type {
  AuthProtocol,
  EngineInfo,
  PrivProtocol,
  SecurityLevel,
  SnmpVersion,
} from '@mibbeacon/core/client';
import type { AgentEditorState } from '../agent-profile-form';

const VERSIONS: SnmpVersion[] = ['v1', 'v2c', 'v3'];
const LEVELS: SecurityLevel[] = ['noAuthNoPriv', 'authNoPriv', 'authPriv'];
const AUTHS: AuthProtocol[] = ['md5', 'sha', 'sha224', 'sha256', 'sha384', 'sha512'];
const PRIVS: PrivProtocol[] = ['des', 'aes', 'aes256b', 'aes256r'];

interface InlineAgentProfileSetupProps {
  editor: AgentEditorState;
  error?: string | null;
  editing?: boolean;
  info: EngineInfo | null;
  busy?: boolean;
  onCancel?: () => void;
  onEditorChange: (next: AgentEditorState) => void;
  onSubmit: () => void;
  submitTitle?: string;
  subtitle?: string;
  title?: string;
}

export function InlineAgentProfileSetup({
  editor,
  error = null,
  editing = false,
  info,
  busy = false,
  onCancel,
  onEditorChange,
  onSubmit,
  submitTitle = editing ? 'Save changes' : 'Create profile',
  subtitle,
  title = editing ? 'Edit profile' : 'Add profile',
}: InlineAgentProfileSetupProps) {
  const update = <K extends keyof AgentEditorState>(key: K, value: AgentEditorState[K]) =>
    onEditorChange({ ...editor, [key]: value });

  return (
    <Card style={styles.card}>
      <SectionTitle>{title}</SectionTitle>
      {subtitle ? <Label tone="dim" size={11}>{subtitle}</Label> : null}
      <Row>
        <Field label="Name" value={editor.name} onChangeText={(value) => update('name', value)} />
        <Field label="Host" value={editor.host} onChangeText={(value) => update('host', value)} />
      </Row>
      <Row>
        <Field label="Port" keyboardType="number-pad" value={editor.port} onChangeText={(value) => update('port', value)} />
        <Field label="Timeout ms" keyboardType="number-pad" value={editor.timeoutMs} onChangeText={(value) => update('timeoutMs', value)} />
        <Field label="Retries" keyboardType="number-pad" value={editor.retries} onChangeText={(value) => update('retries', value)} />
      </Row>
      <Row style={styles.wrap}>
        {(['udp4', 'udp6'] as const).map((transport) => (
          <Chip key={transport} label={transport} active={editor.transport === transport} onPress={() => update('transport', transport)} />
        ))}
        {VERSIONS.map((version) => (
          <Chip key={version} label={version} active={editor.version === version} onPress={() => update('version', version)} />
        ))}
      </Row>
      <Row>
        <Field label="GetBulk non-repeaters" keyboardType="number-pad" value={editor.getBulkNonRepeaters} onChangeText={(value) => update('getBulkNonRepeaters', value)} />
        <Field label="GetBulk max repetitions" keyboardType="number-pad" value={editor.getBulkMaxRepetitions} onChangeText={(value) => update('getBulkMaxRepetitions', value)} />
      </Row>
      {editor.version !== 'v3' ? (
        <Field
          label={editing ? 'Community (blank keeps saved value)' : 'Community'}
          value={editor.community}
          onChangeText={(value) => update('community', value)}
          secureTextEntry
        />
      ) : (
        <View style={styles.stack}>
          <Field label="User" value={editor.user} onChangeText={(value) => update('user', value)} />
          <Row style={styles.wrap}>
            {LEVELS.map((level) => (
              <Chip key={level} label={level} active={editor.level === level} onPress={() => update('level', level)} />
            ))}
          </Row>
          {editor.level !== 'noAuthNoPriv' ? (
            <>
              <Label tone="dim" size={11}>Authentication protocol</Label>
              <Row style={styles.wrap}>
                {AUTHS.map((protocol) => (
                  <Chip key={protocol} label={protocol} active={editor.authProtocol === protocol} onPress={() => update('authProtocol', protocol)} />
                ))}
              </Row>
              <Field label={editing ? 'Auth password (blank keeps saved value)' : 'Auth password'} value={editor.authKey} onChangeText={(value) => update('authKey', value)} secureTextEntry />
            </>
          ) : null}
          {editor.level === 'authPriv' ? (
            <>
              <Label tone="dim" size={11}>Privacy protocol</Label>
              <Row style={styles.wrap}>
                {PRIVS.map((protocol) => {
                  const unavailable =
                    (protocol === 'des' && info && !info.ciphers.des) ||
                    (protocol === 'aes' && info && !info.ciphers.aes128) ||
                    (protocol.startsWith('aes256') && info && !info.ciphers.aes256);
                  return (
                    <Chip
                      key={protocol}
                      label={unavailable ? `${protocol} (unavailable)` : protocol}
                      active={editor.privProtocol === protocol}
                      onPress={unavailable ? undefined : () => update('privProtocol', protocol)}
                    />
                  );
                })}
              </Row>
              <Field label={editing ? 'Privacy password (blank keeps saved value)' : 'Privacy password'} value={editor.privKey} onChangeText={(value) => update('privKey', value)} secureTextEntry />
            </>
          ) : null}
          <Row>
            <Field label="Context name" value={editor.context} onChangeText={(value) => update('context', value)} />
            <Field label="Context engine id" value={editor.contextEngineId} onChangeText={(value) => update('contextEngineId', value)} />
          </Row>
        </View>
      )}
      <Label tone="dim" size={11}>Passwords are write-only and stored through the platform encrypted secret store.</Label>
      {error ? <Label tone="error">{error}</Label> : null}
      <Row>
        <Button title={submitTitle} disabled={busy} onPress={onSubmit} />
        {onCancel ? <Button title="Cancel" variant="ghost" onPress={onCancel} /> : null}
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 14 },
  stack: { gap: 8 },
  wrap: { flexWrap: 'wrap' },
});
