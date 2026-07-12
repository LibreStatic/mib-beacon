import { useRef } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import {
  Card,
  SectionTitle,
  Field,
  Button,
  Chip,
  Pill,
  Mono,
  Label,
  EmptyState,
  Row,
  useTheme,
} from '@omc/ui';
import { validateVarbindInput } from '@omc/core/client';
import type {
  AuthProtocol,
  DecodedVarbind,
  EngineInfo,
  PrivProtocol,
  SecurityLevel,
  SnmpVersion,
} from '@omc/core/client';
import { useEngine } from '../engine-context';
import { useAppStore, type QueryOperation } from '../store';
import { runGet, runGetNext, runSet, runWalk, stopWalk, resolveOidHint } from '../actions';
import { VarbindEditor } from '../components/VarbindEditor';
import { OidLookupPanel } from '../components/OidLookupPanel';

const VERSIONS: SnmpVersion[] = ['v1', 'v2c', 'v3'];
const LEVELS: SecurityLevel[] = ['noAuthNoPriv', 'authNoPriv', 'authPriv'];
const AUTHS: AuthProtocol[] = ['md5', 'sha', 'sha256', 'sha512'];
const PRIVS: PrivProtocol[] = ['des', 'aes', 'aes256b', 'aes256r'];
const OPERATIONS: { key: QueryOperation; label: string }[] = [
  { key: 'get', label: 'Get' },
  { key: 'getNext', label: 'Get Next' },
  { key: 'walk', label: 'Walk' },
  { key: 'set', label: 'Set' },
];

export function QueryScreen({ info }: { info: EngineInfo | null }) {
  const engine = useEngine();
  const t = useTheme();
  const oid = useAppStore((s) => s.oid);
  const oidName = useAppStore((s) => s.oidName);
  const results = useAppStore((s) => s.results);
  const running = useAppStore((s) => s.running);
  const stats = useAppStore((s) => s.stats);
  const error = useAppStore((s) => s.queryError);
  const operation = useAppStore((s) => s.queryOperation);
  const setDraft = useAppStore((s) => s.setDraft);
  const review = useAppStore((s) => s.setReview);
  const setValidationError = validateVarbindInput(setDraft);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    else if (operation === 'walk') void runWalk(engine);
    else useAppStore.getState().setSetReview(true);
  };

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
              <VarbindEditor
                value={setDraft}
                onChange={(patch) => {
                  useAppStore.getState().updateSetDraft(patch);
                  if (patch.oid !== undefined) onOid(patch.oid);
                }}
              />
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

            {operation === 'set' && review ? (
              <View style={[styles.review, { borderColor: t.warn, backgroundColor: t.surfaceAlt }]}>
                <Label tone="warn" size={11}>
                  WRITE CONFIRMATION
                </Label>
                <Mono size={12}>{setDraft.oid}</Mono>
                <Text style={{ color: t.text, fontSize: 13 }}>
                  {setDraft.type} → {setDraft.value || '∅'}
                </Text>
                <Label tone="dim" size={11}>
                  This changes state on the remote agent and cannot be undone automatically.
                </Label>
                <Row>
                  <Button title="Send Set" small onPress={() => void runSet(engine)} />
                  <Button
                    title="Cancel"
                    small
                    variant="ghost"
                    onPress={() => useAppStore.getState().setSetReview(false)}
                  />
                </Row>
              </View>
            ) : null}
          </Card>

          <View style={styles.resultsHead}>
            <SectionTitle>Results</SectionTitle>
            <Text style={{ color: t.textDim, fontSize: 12 }}>
              {stats.count} varbinds · {stats.batches} batches · {stats.ms} ms
              {running ? ' · running…' : ''}
            </Text>
          </View>
          {error ? (
            <View style={styles.error}>
              <Label tone="error">{error}</Label>
            </View>
          ) : null}
          {results.length === 0 && !error ? (
            <EmptyState title="No results yet" hint="Choose an operation, agent, and OID." />
          ) : null}
        </>
      }
      renderItem={({ item }) => <VarbindRow vb={item} />}
      ListFooterComponent={<View style={{ height: 20 }} />}
    />
  );
}

function AgentCard({ info }: { info: EngineInfo | null }) {
  const agent = useAppStore((s) => s.agent);
  const setAgent = useAppStore.getState().setAgent;
  const setV3 = useAppStore.getState().setV3;
  const desOff = info != null && !info.ciphers.des;
  return (
    <Card style={styles.card}>
      <SectionTitle>Agent</SectionTitle>
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
    </Card>
  );
}

function VarbindRow({ vb }: { vb: DecodedVarbind }) {
  const t = useTheme();
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
      </View>
      {!vb.name ? <View style={styles.lookup}><OidLookupPanel oid={vb.oid} compact /></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { padding: 12 },
  card: { marginBottom: 12 },
  wrap: { flexWrap: 'wrap' },
  stack: { gap: 8 },
  targetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  review: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 7 },
  resultsHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
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
});
