import { useRef } from 'react';
import { View, Text, FlatList, ScrollView, StyleSheet } from 'react-native';
import { Card, SectionTitle, Field, Button, Chip, Pill, Mono, Label, EmptyState, Row, useTheme } from '@omc/ui';
import type {
  AuthProtocol,
  DecodedVarbind,
  EngineInfo,
  PrivProtocol,
  SecurityLevel,
  SnmpVersion,
} from '@omc/core/client';
import { useEngine } from '../engine-context';
import { useAppStore } from '../store';
import { runGet, runGetNext, runWalk, stopWalk, resolveOidHint } from '../actions';

const VERSIONS: SnmpVersion[] = ['v1', 'v2c', 'v3'];
const LEVELS: SecurityLevel[] = ['noAuthNoPriv', 'authNoPriv', 'authPriv'];
const AUTHS: AuthProtocol[] = ['md5', 'sha', 'sha256', 'sha512'];
const PRIVS: PrivProtocol[] = ['des', 'aes', 'aes256b', 'aes256r'];

export function QueryScreen({ info }: { info: EngineInfo | null }) {
  const engine = useEngine();
  const t = useTheme();
  const agent = useAppStore((s) => s.agent);
  const oid = useAppStore((s) => s.oid);
  const oidName = useAppStore((s) => s.oidName);
  const results = useAppStore((s) => s.results);
  const running = useAppStore((s) => s.running);
  const stats = useAppStore((s) => s.stats);
  const error = useAppStore((s) => s.queryError);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setAgent = useAppStore.getState().setAgent;
  const setV3 = useAppStore.getState().setV3;

  const onOid = (v: string) => {
    useAppStore.getState().setOid(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void resolveOidHint(engine, v), 250);
  };

  const desOff = info != null && !info.ciphers.des;

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Card style={styles.card}>
        <SectionTitle>Agent</SectionTitle>
        <Row>
          <Field label="Host" placeholder="10.0.2.2" value={agent.host} onChangeText={(v) => setAgent({ host: v })} />
          <View style={{ width: 88 }}>
            <Field label="Port" value={agent.port} onChangeText={(v) => setAgent({ port: v })} keyboardType="number-pad" />
          </View>
        </Row>
        <Row>
          {VERSIONS.map((v) => (
            <Chip key={v} label={v} active={agent.version === v} onPress={() => setAgent({ version: v })} />
          ))}
        </Row>

        {agent.version !== 'v3' ? (
          <Field label="Community" value={agent.community} onChangeText={(v) => setAgent({ community: v })} />
        ) : (
          <View style={{ gap: 8 }}>
            <Field label="User" value={agent.v3.user} onChangeText={(v) => setV3({ user: v })} />
            <Text style={styles.tag}>Security level</Text>
            <Row style={styles.wrap}>
              {LEVELS.map((l) => (
                <Chip key={l} label={l} active={agent.v3.level === l} onPress={() => setV3({ level: l })} />
              ))}
            </Row>
            {agent.v3.level !== 'noAuthNoPriv' ? (
              <>
                <Text style={styles.tag}>Auth</Text>
                <Row style={styles.wrap}>
                  {AUTHS.map((a) => (
                    <Chip key={a} label={a} active={agent.v3.authProtocol === a} onPress={() => setV3({ authProtocol: a })} />
                  ))}
                </Row>
                <Field label="Auth key" value={agent.v3.authKey} onChangeText={(v) => setV3({ authKey: v })} secureTextEntry />
              </>
            ) : null}
            {agent.v3.level === 'authPriv' ? (
              <>
                <Text style={styles.tag}>Privacy</Text>
                <Row style={styles.wrap}>
                  {PRIVS.map((p) => {
                    const disabled = p === 'des' && desOff;
                    return (
                      <Chip
                        key={p}
                        label={disabled ? `${p} (n/a)` : p}
                        active={agent.v3.privProtocol === p}
                        onPress={disabled ? undefined : () => setV3({ privProtocol: p })}
                      />
                    );
                  })}
                </Row>
                {desOff ? <Label tone="dim" size={11}>DES is unavailable on this host&apos;s crypto.</Label> : null}
                <Field label="Privacy key" value={agent.v3.privKey} onChangeText={(v) => setV3({ privKey: v })} secureTextEntry />
              </>
            ) : null}
          </View>
        )}
      </Card>

      <Card style={styles.card}>
        <SectionTitle>Target</SectionTitle>
        <Field label="OID" value={oid} onChangeText={onOid} placeholder="1.3.6.1.2.1.1.1.0" />
        {oidName ? <Label tone="dim" size={12}>→ <Text style={{ color: t.accent }}>{oidName}</Text></Label> : null}
        <Row style={{ marginTop: 4 }}>
          <Button title="Get" small onPress={() => void runGet(engine)} disabled={!!running} />
          <Button title="Next" small variant="ghost" onPress={() => void runGetNext(engine)} disabled={!!running} />
          {running ? (
            <Button title="Stop" small variant="danger" onPress={() => void stopWalk(engine)} />
          ) : (
            <Button title="Walk" small variant="ghost" onPress={() => void runWalk(engine)} />
          )}
        </Row>
      </Card>

      <View style={styles.resultsHead}>
        <SectionTitle>Results</SectionTitle>
        <Text style={{ color: t.textDim, fontSize: 12 }}>
          {stats.count} varbinds · {stats.batches} batches · {stats.ms} ms
          {running ? ' · running…' : ''}
        </Text>
      </View>
      {error ? (
        <View style={styles.card}>
          <Label tone="error">{error}</Label>
        </View>
      ) : null}
      {results.length === 0 && !error ? (
        <EmptyState title="No results yet" hint="Enter an agent and OID, then Get or Walk." />
      ) : (
        <FlatList
          data={results}
          scrollEnabled={false}
          keyExtractor={(vb, i) => vb.oid + '#' + i}
          renderItem={({ item }) => <VarbindRow vb={item} />}
        />
      )}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

function VarbindRow({ vb }: { vb: DecodedVarbind }) {
  const t = useTheme();
  return (
    <View style={[styles.vbRow, { borderBottomColor: t.border }]}>
      <View style={{ flex: 1 }}>
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  card: { marginBottom: 12 },
  wrap: { flexWrap: 'wrap' },
  tag: { fontSize: 11, fontWeight: '700', opacity: 0.7, color: '#8b96a8' },
  resultsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  vbRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
