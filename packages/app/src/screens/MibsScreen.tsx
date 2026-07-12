import { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import {
  Card,
  SectionTitle,
  Field,
  Button,
  Pill,
  Label,
  EmptyState,
  Mono,
  useTheme,
} from '@omc/ui';
import type { ModuleInfo } from '@omc/core/client';
import { useEngine } from '../engine-context';
import { useAppStore } from '../store';
import { cancelImport, focusModule, importPastedText, importUrl, unloadModule } from '../actions';
import { FileImportFlow } from '../components/FileImportFlow';

export function MibsScreen() {
  const engine = useEngine();
  const t = useTheme();
  const modules = useAppStore((s) => s.modules);
  const busy = useAppStore((s) => s.importBusy);
  const lastImport = useAppStore((s) => s.lastImport);
  const importStatus = useAppStore((s) => s.importStatus);
  const progress = useAppStore((s) => s.importProgress);
  const completed = useAppStore((s) => s.importCompleted);
  const total = useAppStore((s) => s.importTotal);
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState('');
  const submittedPaste = useRef(false);
  const userCount = modules.filter((m) => !m.isBase).length;

  useEffect(() => {
    if (submittedPaste.current && importStatus?.state === 'done') {
      setPaste('');
      submittedPaste.current = false;
    }
    if (importStatus && ['partial', 'error', 'cancelled', 'expired'].includes(importStatus.state)) {
      submittedPaste.current = false;
    }
  }, [importStatus]);

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={modules}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(m) => m.name}
      ListEmptyComponent={<EmptyState title="No modules" />}
      ListHeaderComponent={
        <>
          <Card style={styles.card}>
            <View style={styles.eyebrowRow}>
              <SectionTitle>Import MIB</SectionTitle>
              <Pill text="handled by engine" color={t.ok} />
            </View>
            <FileImportFlow busy={busy} />
            <Field
              label="From URL"
              placeholder="https://…/IF-MIB.txt"
              value={url}
              onChangeText={setUrl}
            />
            <Button
              title={busy ? 'Working…' : 'Fetch & import'}
              small
              disabled={busy || !url.trim()}
              onPress={() => void importUrl(engine, url)}
            />
            <Label tone="dim" size={11}>
              Pasted text is sent only to the connected engine for parsing. URL imports and enabled
              resolver sources make network requests from that engine (the LAN server in the web app).
            </Label>
            <Field label="Or paste MIB text" value={paste} onChangeText={setPaste} multiline />
            <Button
              title={busy ? 'Working…' : 'Import pasted text'}
              small
              variant="ghost"
              disabled={busy || !paste.trim()}
              onPress={() => {
                submittedPaste.current = true;
                void importPastedText(engine, 'pasted.mib', paste);
              }}
            />
            {busy || importStatus ? (
              <View style={[styles.progressPanel, { borderColor: t.border, backgroundColor: t.surfaceAlt }]}>
                <View style={styles.eyebrowRow}>
                  <Label tone={importStatus?.state === 'error' ? 'error' : 'dim'} size={11}>
                    {busy ? importStatus?.state ?? 'starting resolver' : importStatus?.state ?? 'finished'}
                  </Label>
                  {total > 0 ? <Pill text={`${completed}/${total}`} color={t.accent} /> : null}
                </View>
                {progress.slice(-6).map((item) => (
                  <View key={item.id} style={styles.progressRow}>
                    <Pill text={item.kind.replaceAll('-', ' ')} />
                    <Mono dim size={10} numberOfLines={1}>
                      {[item.module, item.sourceId, item.location ?? item.message]
                        .filter(Boolean)
                        .join(' · ')}
                    </Mono>
                  </View>
                ))}
                {importStatus?.loadedModules.length ? (
                  <Label tone="ok" size={11}>
                    Resolved: {importStatus.loadedModules.join(', ')}
                  </Label>
                ) : null}
                {importStatus?.failures.map((failure, index) => (
                  <Label key={`${failure.module}-${index}`} tone="error" size={11}>
                    {failure.module ? `${failure.module}: ` : ''}{failure.message}
                  </Label>
                ))}
                {busy ? (
                  <Button title="Cancel resolution" small variant="danger" onPress={() => void cancelImport(engine)} />
                ) : null}
              </View>
            ) : null}
            {lastImport ? (
              <View style={styles.importResult}>
                {lastImport.loaded.length ? (
                  <Label tone="ok" size={12}>
                    Loaded: {lastImport.loaded.join(', ')}
                  </Label>
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
            <View>
              <SectionTitle>Loaded modules</SectionTitle>
              <Text style={{ color: t.textDim, fontSize: 12 }}>
                {modules.length} total · {userCount} user
              </Text>
            </View>
            <Label tone="dim" size={11}>
              Tap a module to isolate its OID graph
            </Label>
          </View>
        </>
      }
      renderItem={({ item }) => <ModuleRow mod={item} />}
      ListFooterComponent={<View style={{ height: 20 }} />}
    />
  );
}

function ModuleRow({ mod }: { mod: ModuleInfo }) {
  const engine = useEngine();
  const t = useTheme();
  return (
    <View style={[styles.modRow, { borderBottomColor: t.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${mod.name} tree`}
        onPress={() => void focusModule(engine, mod.name)}
        style={({ pressed }) => [
          styles.openArea,
          { backgroundColor: pressed ? t.accentSoft : 'transparent' },
        ]}
      >
        <View style={[styles.moduleMark, { borderColor: mod.isBase ? t.textDim : t.kind.module }]}>
          <Text
            style={{
              color: mod.isBase ? t.textDim : t.kind.module,
              fontWeight: '900',
              fontSize: 11,
            }}
          >
            M
          </Text>
        </View>
        <View style={styles.moduleText}>
          <Text style={{ color: t.text, fontWeight: '700' }}>{mod.name}</Text>
          <Mono dim size={10}>
            {mod.objectCount} objects · open focused tree
          </Mono>
        </View>
        <Text style={{ color: t.accent, fontSize: 18 }}>›</Text>
      </Pressable>
      {mod.isBase ? (
        <Pill text="base" />
      ) : (
        <Button
          title="Unload"
          small
          variant="danger"
          onPress={() => void unloadModule(engine, mod.name)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { padding: 12 },
  card: { marginBottom: 18 },
  eyebrowRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  importResult: { marginTop: 4, gap: 2 },
  progressPanel: { borderWidth: 1, borderRadius: 9, padding: 9, gap: 6 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  listHead: { gap: 3, marginBottom: 8 },
  modRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 58,
    paddingRight: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  openArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 6,
  },
  moduleMark: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleText: { flex: 1, gap: 3 },
});
