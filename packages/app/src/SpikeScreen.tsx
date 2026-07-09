import { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { Section, Field, Button, Mono, Label, useTheme } from '@omc/ui';
import type { EngineInfo, AgentSpec, EngineEvent, DecodedVarbind, TrapRecord } from '@omc/core';
import { useEngine } from './engine-context.js';
import { useSpikeStore } from './store.js';

/**
 * The feasibility-spike screen (docs/plans/02 T4). Shared verbatim by desktop
 * (Electron + react-native-web) and mobile (Expo). Exercises a v2c/v3 Get, a
 * streaming walk, and the trap receiver through the injected EngineAPI.
 */
export function SpikeScreen() {
  const engine = useEngine();
  const t = useTheme();
  const store = useSpikeStore();

  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('1611');
  const [community, setCommunity] = useState('public');
  const [oid, setOid] = useState('1.3.6.1.2.1.1.1.0');
  const [trapPort, setTrapPort] = useState('1162');
  const [info, setInfo] = useState<EngineInfo | null>(null);

  const walkStart = useRef(0);

  useEffect(() => {
    engine.system.info().then(setInfo).catch(() => setInfo(null));

    const offTraps = engine.events.subscribe('traps', (e: EngineEvent) => {
      if (e.kind === 'trap') store.addTrap(e.payload as TrapRecord);
    });
    const offOps = engine.events.subscribe('ops', (e: EngineEvent) => {
      if (e.kind === 'batch') {
        const batch = e.payload as DecodedVarbind[];
        const w = useSpikeStore.getState().walk;
        store.setWalk({ count: w.count + batch.length, batches: w.batches + 1, ms: Date.now() - walkStart.current });
      } else if (e.kind === 'done') {
        store.setWalk({ running: false, ms: Date.now() - walkStart.current });
      } else if (e.kind === 'error') {
        store.setWalk({ running: false });
      }
    });
    return () => {
      offTraps();
      offOps();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  const agent = (): AgentSpec => ({
    host,
    port: Number(port),
    version: 'v2c',
    community,
  });

  async function doGet() {
    store.setBusy(true);
    store.setResults(null, null);
    try {
      const vbs = await engine.ops.get({ agent: agent(), oids: [oid] });
      store.setResults(vbs);
    } catch (e) {
      const err = e as { message?: string; hint?: string };
      store.setResults(null, `${err.message ?? String(e)}${err.hint ? ' — ' + err.hint : ''}`);
    } finally {
      store.setBusy(false);
    }
  }

  async function doWalk() {
    store.setWalk({ running: true, count: 0, batches: 0, ms: 0 });
    walkStart.current = Date.now();
    try {
      await engine.ops.startWalk({ agent: agent(), baseOid: '1.3.6.1.2.1' });
    } catch {
      store.setWalk({ running: false });
    }
  }

  async function toggleReceiver() {
    if (store.receiver.running) {
      await engine.traps.stopReceiver();
      store.setReceiver({ running: false });
    } else {
      const status = await engine.traps.startReceiver({
        port: Number(trapPort),
        disableAuthorization: true,
        communities: [community],
      });
      store.setReceiver({ running: status.running, port: status.port });
    }
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.h1, { color: t.text }]}>Open MIB Catalog — Spike</Text>
      {info && (
        <Text style={[styles.sub, { color: t.textDim }]}>
          {info.platform} · net-snmp {info.netSnmpVersion} · ciphers: DES {info.ciphers.des ? '✓' : '✗'} · AES-128{' '}
          {info.ciphers.aes128 ? '✓' : '✗'} · AES-256 {info.ciphers.aes256 ? '✓' : '✗'}
        </Text>
      )}

      <Section title="Agent">
        <Field label="Host" value={host} onChangeText={setHost} />
        <Field label="Port" value={port} onChangeText={setPort} keyboardType="number-pad" />
        <Field label="Community" value={community} onChangeText={setCommunity} />
        <Field label="OID" value={oid} onChangeText={setOid} />
        <View style={styles.row}>
          <Button title={store.busy ? 'Getting…' : 'Get'} onPress={doGet} disabled={store.busy} />
          <Button title={store.walk.running ? 'Walking…' : 'Walk 1.3.6.1.2.1'} onPress={doWalk} disabled={store.walk.running} />
        </View>
      </Section>

      <Section title="Get result">
        {store.getError ? (
          <Label tone="error">{store.getError}</Label>
        ) : store.results ? (
          store.results.map((vb, i) => (
            <Mono key={i}>
              {vb.oid} = [{vb.typeName}] {vb.isError ? vb.errorText : String(vb.value)}
            </Mono>
          ))
        ) : (
          <Label tone="dim">No result yet.</Label>
        )}
      </Section>

      <Section title="Walk progress">
        <Label tone={store.walk.running ? undefined : 'ok'}>
          {store.walk.count} varbinds · {store.walk.batches} batches · {store.walk.ms} ms
          {store.walk.running ? ' (running…)' : store.walk.count > 0 ? ' (done)' : ''}
        </Label>
      </Section>

      <Section title="Trap receiver">
        <Field label="Listen port" value={trapPort} onChangeText={setTrapPort} keyboardType="number-pad" />
        <View style={styles.row}>
          <Button
            title={store.receiver.running ? `Stop (:${store.receiver.port})` : 'Start receiver'}
            onPress={toggleReceiver}
            tone={store.receiver.running ? 'error' : 'accent'}
          />
          <Button title="Clear" onPress={() => store.clearTraps()} />
        </View>
        {store.traps.length === 0 ? (
          <Label tone="dim">No traps received.</Label>
        ) : (
          store.traps.slice(0, 20).map((trap) => (
            <Mono key={trap.id}>
              {new Date(trap.receivedAt).toLocaleTimeString()} · {trap.sourceAddress} · {trap.varbinds.length} vb
              {trap.trapOid ? ` · ${trap.trapOid}` : ''}
            </Mono>
          ))
        )}
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 4, maxWidth: 720, width: '100%', alignSelf: 'center' },
  h1: { fontSize: 20, fontWeight: '700', marginBottom: 2 },
  sub: { fontSize: 12, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 8, marginTop: 4 },
});
