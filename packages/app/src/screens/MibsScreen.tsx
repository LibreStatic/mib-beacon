import { useState } from 'react';
import { View, Text, FlatList, ScrollView, StyleSheet } from 'react-native';
import { Card, SectionTitle, Field, Button, Pill, Label, EmptyState, useTheme } from '@omc/ui';
import type { ModuleInfo } from '@omc/core/client';
import { useEngine } from '../engine-context';
import { useAppStore } from '../store';
import { importPastedText, importUrl, unloadModule } from '../actions';

export function MibsScreen() {
  const engine = useEngine();
  const t = useTheme();
  const modules = useAppStore((s) => s.modules);
  const busy = useAppStore((s) => s.importBusy);
  const lastImport = useAppStore((s) => s.lastImport);
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState('');

  const userCount = modules.filter((m) => !m.isBase).length;

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Card style={styles.card}>
        <SectionTitle>Import MIB</SectionTitle>
        <Field label="From URL" placeholder="https://…/IF-MIB.txt" value={url} onChangeText={setUrl} />
        <Button
          title={busy ? 'Working…' : 'Fetch & import'}
          small
          disabled={busy || !url.trim()}
          onPress={() => void importUrl(engine, url)}
        />
        <View style={{ height: 8 }} />
        <Field label="Or paste MIB text" value={paste} onChangeText={setPaste} multiline />
        <Button
          title={busy ? 'Working…' : 'Import pasted text'}
          small
          variant="ghost"
          disabled={busy || !paste.trim()}
          onPress={() => void importPastedText(engine, 'pasted.mib', paste).then(() => setPaste(''))}
        />
        {lastImport ? (
          <View style={styles.importResult}>
            {lastImport.loaded.length > 0 ? (
              <Label tone="ok" size={12}>Loaded: {lastImport.loaded.join(', ')}</Label>
            ) : null}
            {lastImport.errors.map((e, i) => (
              <Label key={i} tone="error" size={12}>
                {e.name}: {e.message}
              </Label>
            ))}
          </View>
        ) : null}
      </Card>

      <View style={styles.listHead}>
        <SectionTitle>Loaded modules</SectionTitle>
        <Text style={{ color: t.textDim, fontSize: 12 }}>
          {modules.length} total · {userCount} user
        </Text>
      </View>
      <FlatList
        data={modules}
        scrollEnabled={false}
        keyExtractor={(m) => m.name}
        ListEmptyComponent={<EmptyState title="No modules" />}
        renderItem={({ item }) => <ModuleRow mod={item} />}
      />
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

function ModuleRow({ mod }: { mod: ModuleInfo }) {
  const engine = useEngine();
  const t = useTheme();
  return (
    <View style={[styles.modRow, { borderBottomColor: t.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontWeight: '600' }}>{mod.name}</Text>
        <Text style={{ color: t.textDim, fontSize: 11 }}>{mod.objectCount} objects</Text>
      </View>
      {mod.isBase ? (
        <Pill text="base" />
      ) : (
        <Button title="Unload" small variant="danger" onPress={() => void unloadModule(engine, mod.name)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  card: { marginBottom: 12 },
  importResult: { marginTop: 8, gap: 2 },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  modRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
});
