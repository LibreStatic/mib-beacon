import { useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { Card, SectionTitle, Field, Button, Label, EmptyState, Row, Mono, useTheme } from '@omc/ui';
import type { TrapRecord } from '@omc/core/client';
import { useEngine } from '../engine-context';
import { useAppStore } from '../store';
import { toggleReceiver } from '../actions';

export function TrapsScreen() {
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
    <View style={styles.container}>
      <Card style={styles.card}>
        <SectionTitle>Trap receiver</SectionTitle>
        <Row>
          <Field label="Listen port" value={port} onChangeText={setPort} keyboardType="number-pad" editable={!receiver.running} />
          <View style={{ justifyContent: 'flex-end', flex: 1 }}>
            <Button
              title={receiver.running ? `Stop (:${receiver.port})` : 'Start receiver'}
              variant={receiver.running ? 'danger' : 'primary'}
              onPress={() => void onToggle()}
            />
          </View>
        </Row>
        {err ? <Label tone="error" size={12}>{err}</Label> : null}
        <Label tone="dim" size={11}>
          Ports below 1024 (e.g. 162) need elevated privileges; 1162 works unprivileged.
        </Label>
      </Card>

      {records.length > 0 ? (
        <Row style={styles.listHead}>
          <Text style={{ color: t.textDim, fontSize: 12 }}>{records.length} received</Text>
          <Pressable onPress={() => useAppStore.getState().clearTraps()}>
            <Text style={{ color: t.accent, fontSize: 12, fontWeight: '600' }}>Clear</Text>
          </Pressable>
        </Row>
      ) : null}

      <FlatList
        data={records}
        keyExtractor={(r) => r.id}
        contentContainerStyle={records.length === 0 ? { flex: 1 } : undefined}
        ListEmptyComponent={
          <EmptyState
            title={receiver.running ? 'Listening for traps…' : 'No traps received'}
            hint="Start the receiver, then send a test trap to this host."
          />
        }
        renderItem={({ item }) => <TrapRow rec={item} />}
      />
    </View>
  );
}

function TrapRow({ rec }: { rec: TrapRecord }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const time = new Date(rec.receivedAt).toLocaleTimeString();
  return (
    <Pressable onPress={() => setOpen((o) => !o)} style={[styles.trapRow, { borderBottomColor: t.border }]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={{ color: t.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>
          {rec.trapName ?? rec.trapOid ?? 'trap'}
        </Text>
        <Text style={{ color: t.textDim, fontSize: 11 }}>{time}</Text>
      </Row>
      <Row style={{ justifyContent: 'space-between', marginTop: 2 }}>
        <Mono dim size={11}>
          {rec.sourceAddress}:{rec.sourcePort}
        </Mono>
        <Text style={{ color: t.textDim, fontSize: 11 }}>{rec.varbinds.length} vb {open ? '▾' : '▸'}</Text>
      </Row>
      {open ? (
        <View style={styles.vbs}>
          {rec.varbinds.map((vb, i) => (
            <View key={i} style={{ marginTop: 4 }}>
              <Mono size={11}>{vb.name ?? vb.oid}</Mono>
              <Text style={{ color: t.text, fontSize: 12 }}>{vb.isError ? vb.errorText : String(vb.value)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  card: { marginBottom: 12 },
  listHead: { justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 6 },
  trapRow: { paddingVertical: 10, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  vbs: { marginTop: 6, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#4f8ef7' },
});
