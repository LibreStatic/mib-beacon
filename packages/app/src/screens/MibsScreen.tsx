import { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView, StyleSheet } from 'react-native';
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
} from '@mibbeacon/ui';
import type { ModuleInfo } from '@mibbeacon/core/client';
import { useEngine } from '../engine-context';
import { useAppStore } from '../store';
import { focusModule, importPastedText, importUrl, unloadModule } from '../actions';
import { FileImportFlow } from '../components/FileImportFlow';
import { ImportProgressPanel } from '../components/ImportProgressPanel';
import { MibImportModal } from '../components/MibCatalogControls';
import { SplitWorkspace } from '../components/SplitWorkspace';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { useResponsiveLayout } from '../responsive-context';

export function MibsScreen() {
  const engine = useEngine();
  const t = useTheme();
  const { supportsSplitView } = useResponsiveLayout();
  const modules = useAppStore((s) => s.modules);
  const busy = useAppStore((s) => s.importBusy);
  const lastImport = useAppStore((s) => s.lastImport);
  const importStatus = useAppStore((s) => s.importStatus);
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState('');
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
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

  const importCard = (
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
      <ImportProgressPanel />
    </Card>
  );

  if (supportsSplitView) {
    const selected = modules.find((module) => module.name === selectedModule) ?? null;
    return (
      <View style={styles.workspace}>
        <WorkspaceHeader
          title="MIB catalog"
          subtitle="LOAD MODULES · REVIEW DEPENDENCIES · OPEN A FOCUSED OID TREE"
          actions={<Pill text={`${modules.length} LOADED`} color={t.kind.module} />}
        />
        <SplitWorkspace
          workspace="mibs"
          minPrimary={300}
          minSecondary={420}
          primary={
            <View style={styles.modulePane}>
              <View
                style={[
                  styles.modulePaneHead,
                  { backgroundColor: t.surface, borderBottomColor: t.border },
                ]}
              >
                <SectionTitle>Loaded modules</SectionTitle>
                <Label tone="dim" size={10}>
                  {userCount} user · {modules.length - userCount} base
                </Label>
              </View>
              <FlatList
                data={modules}
                keyExtractor={(module) => module.name}
                ListEmptyComponent={<EmptyState title="No modules" />}
                renderItem={({ item }) => (
                  <ModuleRow
                    mod={item}
                    selected={item.name === selected?.name}
                    onSelect={() => setSelectedModule(item.name)}
                  />
                )}
              />
            </View>
          }
          secondary={
            <ScrollView style={styles.importPane} contentContainerStyle={styles.importPaneContent}>
              {selected ? (
                <Card style={styles.selectedModuleCard}>
                  <View style={styles.eyebrowRow}>
                    <SectionTitle>Selected module</SectionTitle>
                    <Pill
                      text={selected.isBase ? 'base' : 'user'}
                      color={selected.isBase ? t.textDim : t.kind.module}
                    />
                  </View>
                  <Text style={[styles.selectedModuleName, { color: t.text }]}>
                    {selected.name}
                  </Text>
                  <Mono dim size={11}>
                    {selected.objectCount} definitions indexed in the catalog
                  </Mono>
                  <View style={styles.moduleActions}>
                    <Button
                      title="Open focused tree"
                      small
                      onPress={() => void focusModule(engine, selected.name)}
                    />
                    {!selected.isBase ? (
                      <Button
                        title="Unload"
                        small
                        variant="danger"
                        onPress={() => void unloadModule(engine, selected.name)}
                      />
                    ) : null}
                  </View>
                </Card>
              ) : null}
              {importCard}
            </ScrollView>
          }
        />
      </View>
    );
  }

  const compactStatus = busy
    ? `Import ${importStatus?.state ?? 'running'}…`
    : importStatus
      ? `Last import: ${importStatus.state}`
      : lastImport
        ? `Last import: ${lastImport.loaded.length} loaded${lastImport.errors.length ? ` · ${lastImport.errors.length} failed` : ''}`
        : null;
  return (
    <View style={styles.list}>
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
              <Label tone="dim" size={11}>
                Add files, fetch a URL, or paste SMI text in the import dialog.
              </Label>
              <Button
                title={busy ? 'View import progress…' : 'Import MIBs'}
                small
                onPress={() => useAppStore.getState().setBrowserImportOpen(true)}
              />
              {compactStatus ? (
                <Label tone={importStatus?.state === 'error' ? 'error' : 'dim'} size={11}>
                  {compactStatus}
                </Label>
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
      <MibImportModal />
    </View>
  );
}

function ModuleRow({
  mod,
  selected,
  onSelect,
}: {
  mod: ModuleInfo;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const engine = useEngine();
  const t = useTheme();
  return (
    <View style={[styles.modRow, { borderBottomColor: t.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${mod.name} tree`}
        accessibilityState={{ selected: Boolean(selected) }}
        onPress={onSelect ?? (() => void focusModule(engine, mod.name))}
        style={({ pressed }) => [
          styles.openArea,
          { backgroundColor: selected || pressed ? t.accentSoft : 'transparent' },
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
  workspace: { flex: 1, minWidth: 0, minHeight: 0 },
  modulePane: { flex: 1, minWidth: 0, minHeight: 0 },
  modulePaneHead: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, gap: 3 },
  importPane: { flex: 1 },
  importPaneContent: { padding: 14, paddingBottom: 30 },
  selectedModuleCard: { marginBottom: 12 },
  selectedModuleName: { fontSize: 19, fontWeight: '800' },
  moduleActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
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
