import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { Button, Card, Label, SectionTitle, useTheme } from '@omc/ui';
import type { DecodedVarbind, EngineEvent, EngineInfo, TrapRecord } from '@omc/core/client';
import { useEngine } from './engine-context';
import { useAppStore, type Tab } from './store';
import {
  handleResolverEvent,
  loadChildren,
  refreshModules,
  refreshResolverState,
  respondResolverConsent,
} from './actions';
import { BrowseScreen } from './screens/BrowseScreen';
import { QueryScreen } from './screens/QueryScreen';
import { TrapsScreen } from './screens/TrapsScreen';
import { MibsScreen } from './screens/MibsScreen';
import { SettingsScreen } from './screens/SettingsScreen';

const TABS: { key: Tab; glyph: string; label: string }[] = [
  { key: 'browse', glyph: '⌬', label: 'Browse' },
  { key: 'query', glyph: '⇄', label: 'Query' },
  { key: 'traps', glyph: '⚑', label: 'Traps' },
  { key: 'mibs', glyph: '▤', label: 'MIBs' },
  { key: 'settings', glyph: '⚙', label: 'Settings' },
];

export function AppRoot() {
  const engine = useEngine();
  const t = useTheme();
  const tab = useAppStore((s) => s.tab);
  const setTab = useAppStore((s) => s.setTab);
  const trapCount = useAppStore((s) => s.records.length);
  const consent = useAppStore((s) => s.consent);
  const [info, setInfo] = useState<EngineInfo | null>(null);

  useEffect(() => {
    const store = useAppStore.getState;
    engine.system
      .info()
      .then(setInfo)
      .catch(() => setInfo(null));
    void refreshModules(engine);
    void loadChildren(engine, '');
    void refreshResolverState(engine).catch((error: unknown) =>
      store().setResolverError(error instanceof Error ? error.message : String(error)),
    );

    const offOps = engine.events.subscribe('ops', (e: EngineEvent) => {
      const s = store();
      if (e.handleId !== s.running) return;
      if (e.kind === 'batch') {
        const batch = e.payload as DecodedVarbind[];
        s.appendResults(batch);
        const st = store().stats;
        s.setStats({
          count: st.count + batch.length,
          batches: st.batches + 1,
          ms: Date.now() - s.walkStart,
        });
      } else if (e.kind === 'done') {
        const p = e.payload as { count?: number };
        const st = store().stats;
        s.setStats({
          count: p.count ?? st.count,
          batches: st.batches,
          ms: Date.now() - s.walkStart,
        });
        s.setRunning(null);
      } else if (e.kind === 'error') {
        const p = e.payload as { message?: string; code?: string };
        if (p.code !== 'CANCELLED') s.setQueryError(p.message ?? p.code ?? 'walk failed');
        s.setRunning(null);
      }
    });

    const offTraps = engine.events.subscribe('traps', (e: EngineEvent) => {
      if (e.kind === 'trap') store().addTrap(e.payload as TrapRecord);
    });

    const offResolver = engine.events.subscribe('resolver', (e: EngineEvent) => {
      void handleResolverEvent(engine, e);
    });

    return () => {
      offOps();
      offTraps();
      offResolver();
    };
  }, [engine]);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Text style={[styles.title, { color: t.text }]}>Open MIB Catalog</Text>
        {info ? (
          <Text style={[styles.sub, { color: t.textDim }]}>
            {info.platform} · net-snmp {info.netSnmpVersion}
          </Text>
        ) : null}
      </View>

      <View style={styles.body}>
        {tab === 'browse' ? <BrowseScreen /> : null}
        {tab === 'query' ? <QueryScreen info={info} /> : null}
        {tab === 'traps' ? <TrapsScreen info={info} /> : null}
        {tab === 'mibs' ? <MibsScreen /> : null}
        {tab === 'settings' ? <SettingsScreen /> : null}
      </View>

      <ResolverConsentModal
        visible={Boolean(consent)}
        missingModules={consent?.missingModules ?? []}
        sourceHosts={consent?.sourceHosts ?? []}
        onRespond={(allow, askAgain) => void respondResolverConsent(engine, allow, askAgain)}
      />

      <View
        nativeID="app-bottom-navigation"
        style={[styles.tabbar, { backgroundColor: t.surface, borderTopColor: t.border }]}
      >
        {TABS.map((item) => {
          const active = item.key === tab;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              style={styles.tab}
            >
              <View>
                <Text style={[styles.tabGlyph, { color: active ? t.accent : t.textDim }]}>
                  {item.glyph}
                </Text>
                {item.key === 'traps' && trapCount > 0 ? (
                  <View style={[styles.badge, { backgroundColor: t.accent }]}>
                    <Text style={styles.badgeText}>{trapCount > 99 ? '99+' : trapCount}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.tabLabel, { color: active ? t.accent : t.textDim }]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ResolverConsentModal({
  visible,
  missingModules,
  sourceHosts,
  onRespond,
}: {
  visible: boolean;
  missingModules: string[];
  sourceHosts: string[];
  onRespond: (allow: boolean, askAgain: boolean) => void;
}) {
  const t = useTheme();
  const [askAgain, setAskAgain] = useState(true);
  useEffect(() => {
    if (visible) setAskAgain(true);
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onRespond(false, true)}>
      <View style={styles.modalBackdrop}>
        <Card style={styles.modalCard}>
          <SectionTitle>External MIB lookup</SectionTitle>
          <Text style={[styles.modalTitle, { color: t.text }]}>Search configured external sources?</Text>
          <Label tone="dim" size={12}>
            Local parsing found missing definitions. Open MIB Catalog can contact the enabled hosts
            below. Valid modules are cached on the engine host (the LAN server when using the web app).
            These sources are configured for lookup; they are not inherently trusted or endorsed.
          </Label>
          {missingModules.length ? (
            <ScrollView style={styles.modalList}>
              {missingModules.map((module) => (
                <Text key={module} style={[styles.modalCode, { color: t.mono }]}>• {module}</Text>
              ))}
            </ScrollView>
          ) : null}
          {sourceHosts.length ? (
            <Label tone="dim" size={11}>Hosts: {sourceHosts.join(', ')}</Label>
          ) : null}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: askAgain }}
            onPress={() => setAskAgain((value) => !value)}
            style={styles.checkboxRow}
          >
            <View style={[styles.checkbox, { borderColor: t.border, backgroundColor: askAgain ? t.accent : 'transparent' }]}>
              <Text style={{ color: t.accentText, fontWeight: '900' }}>{askAgain ? '✓' : ''}</Text>
            </View>
            <Text style={{ color: t.text, fontSize: 13 }}>Ask me again next time</Text>
          </Pressable>
          {!askAgain ? <Label tone="warn" size={11}>External access will be remembered until revoked in Settings.</Label> : null}
          <View style={styles.modalActions}>
            <Button title="Cancel" variant="ghost" onPress={() => onRespond(false, askAgain)} />
            <Button title="Continue" onPress={() => onRespond(true, askAgain)} />
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1 },
  title: { fontSize: 18, fontWeight: '800' },
  sub: { fontSize: 11, marginTop: 2 },
  body: { flex: 1, minHeight: 0 },
  tabbar: { flexDirection: 'row', borderTopWidth: 1, paddingBottom: 6, paddingTop: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 },
  tabGlyph: { fontSize: 20, lineHeight: 24 },
  tabLabel: { fontSize: 11, fontWeight: '600' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -12,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 9, 16, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: { width: '100%', maxWidth: 520, maxHeight: '85%' },
  modalTitle: { fontSize: 19, fontWeight: '800' },
  modalList: { maxHeight: 150 },
  modalCode: { fontFamily: 'monospace', fontSize: 12, paddingVertical: 2 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 6 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
