import { useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Label,
  Mono,
  Pill,
  SectionTitle,
  useTheme,
} from '@mibbeacon/ui';
import type { ModuleInfo } from '@mibbeacon/core/client';
import { useEngine } from '../engine-context';
import { useAppStore } from '../store';
import {
  cancelImport,
  clearModuleFocus,
  importPastedText,
  importUrl,
  selectModuleInPlace,
  unloadModule,
} from '../actions';
import { FileImportFlow } from './FileImportFlow';
import { moduleCatalogSummary } from '../node-metadata';

export function MibCatalogPane() {
  const engine = useEngine();
  const t = useTheme();
  const modules = useAppStore((state) => state.modules);
  const focused = useAppStore((state) => state.moduleFocus?.module.name ?? null);
  const userCount = modules.filter((module) => !module.isBase).length;
  return (
    <View style={styles.pane}>
      <View style={[styles.header, { backgroundColor: t.surface, borderBottomColor: t.border }]}>
        <View style={styles.headerCopy}>
          <SectionTitle>Loaded MIBs</SectionTitle>
          <Label tone="dim" size={10}>
            {userCount} user · {modules.length - userCount} base
          </Label>
        </View>
        <Button
          title="Import"
          small
          onPress={() => useAppStore.getState().setBrowserImportOpen(true)}
        />
      </View>
      <FlatList
        data={modules}
        keyExtractor={(module) => module.name}
        ListHeaderComponent={
          <ModuleChoice
            name="All loaded MIBs"
            count={modules.reduce((total, module) => total + module.objectCount, 0)}
            selected={!focused}
            onPress={() => void clearModuleFocus(engine)}
          />
        }
        ListEmptyComponent={<EmptyState title="No MIBs loaded" />}
        renderItem={({ item }) => <ModuleItem module={item} selected={focused === item.name} />}
      />
    </View>
  );
}

function ModuleItem({ module, selected }: { module: ModuleInfo; selected: boolean }) {
  const engine = useEngine();
  const t = useTheme();
  return (
    <View style={[styles.moduleRow, { borderBottomColor: t.border }]}>
      <ModuleChoice
        name={module.name}
        count={module.objectCount}
        detail={moduleCatalogSummary(module)}
        selected={selected}
        onPress={() => void selectModuleInPlace(engine, module.name)}
      />
      {!module.isBase ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Unload ${module.name}`}
          onPress={() => void unloadModule(engine, module.name)}
          style={styles.unload}
        >
          <Text style={{ color: t.error, fontWeight: '800' }}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ModuleChoice({
  name,
  count,
  detail,
  selected,
  onPress,
}: {
  name: string;
  count: number;
  detail?: string | null;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Focus ${name}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.moduleChoice,
        { backgroundColor: selected || pressed ? t.accentSoft : 'transparent' },
      ]}
    >
      <View style={[styles.moduleMark, { borderColor: selected ? t.accent : t.kind.module }]}>
        <Text style={{ color: selected ? t.accent : t.kind.module, fontWeight: '900' }}>M</Text>
      </View>
      <View style={styles.moduleCopy}>
        <Text style={{ color: t.text, fontWeight: '700' }} numberOfLines={1}>
          {name}
        </Text>
        <Mono dim size={9}>
          {count} definitions
        </Mono>
        {detail ? (
          <Label tone="dim" size={9}>
            {detail}
          </Label>
        ) : null}
      </View>
    </Pressable>
  );
}

export function MibModuleStrip() {
  const engine = useEngine();
  const t = useTheme();
  const modules = useAppStore((state) => state.modules);
  const focused = useAppStore((state) => state.moduleFocus?.module.name ?? null);
  return (
    <View style={[styles.strip, { backgroundColor: t.surface, borderBottomColor: t.border }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stripContent}
      >
        <PillButton
          label="All MIBs"
          active={!focused}
          onPress={() => void clearModuleFocus(engine)}
        />
        {modules.map((module) => (
          <PillButton
            key={module.name}
            label={module.name}
            active={focused === module.name}
            onPress={() => void selectModuleInPlace(engine, module.name)}
          />
        ))}
      </ScrollView>
      <Button
        title="Import"
        small
        onPress={() => useAppStore.getState().setBrowserImportOpen(true)}
      />
    </View>
  );
}

function PillButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.pillButton,
        {
          borderColor: active ? t.accent : t.border,
          backgroundColor: active ? t.accentSoft : t.bg,
        },
      ]}
    >
      <Text style={{ color: active ? t.accent : t.textDim, fontSize: 11, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function MibImportModal() {
  const engine = useEngine();
  const t = useTheme();
  const open = useAppStore((state) => state.browserImportOpen);
  const busy = useAppStore((state) => state.importBusy);
  const status = useAppStore((state) => state.importStatus);
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState('');
  const close = () => useAppStore.getState().setBrowserImportOpen(false);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.modalBackdrop}>
        <Card style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View>
              <SectionTitle>Import MIB</SectionTitle>
              <Label tone="dim" size={11}>
                Add files, fetch a URL, or paste SMI text.
              </Label>
            </View>
            <Button title="Close" small variant="ghost" onPress={close} />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
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
            <Field label="Or paste MIB text" value={paste} onChangeText={setPaste} multiline />
            <Button
              title={busy ? 'Working…' : 'Import pasted text'}
              small
              variant="ghost"
              disabled={busy || !paste.trim()}
              onPress={() => void importPastedText(engine, 'pasted.mib', paste)}
            />
            {status ? (
              <View
                style={[styles.status, { borderColor: t.border, backgroundColor: t.surfaceAlt }]}
              >
                <Pill text={status.state} color={status.state === 'error' ? t.error : t.accent} />
                {status.loadedModules.length ? (
                  <Label tone="ok">Loaded: {status.loadedModules.join(', ')}</Label>
                ) : null}
                {status.failures.map((failure, index) => (
                  <Label key={`${failure.module}-${index}`} tone="error">
                    {failure.module ? `${failure.module}: ` : ''}
                    {failure.message}
                  </Label>
                ))}
                {busy ? (
                  <Button
                    title="Cancel"
                    small
                    variant="danger"
                    onPress={() => void cancelImport(engine)}
                  />
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1, minWidth: 0, minHeight: 0 },
  header: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerCopy: { flex: 1, gap: 2 },
  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  moduleChoice: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  moduleMark: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleCopy: { flex: 1, minWidth: 0, gap: 2 },
  unload: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  strip: {
    minHeight: 52,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 9,
  },
  stripContent: { alignItems: 'center', gap: 6, paddingVertical: 7 },
  pillButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 9, 16, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: { width: '100%', maxWidth: 680, maxHeight: '90%' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  modalContent: { gap: 10, paddingTop: 12, paddingBottom: 6 },
  status: { borderWidth: 1, borderRadius: 9, padding: 10, gap: 7 },
});
