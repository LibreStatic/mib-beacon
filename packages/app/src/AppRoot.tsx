import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '@omc/ui';
import type { DecodedVarbind, EngineEvent, EngineInfo, TrapRecord } from '@omc/core/client';
import { useEngine } from './engine-context';
import { useAppStore, type Tab } from './store';
import { loadChildren, refreshModules } from './actions';
import { BrowseScreen } from './screens/BrowseScreen';
import { QueryScreen } from './screens/QueryScreen';
import { TrapsScreen } from './screens/TrapsScreen';
import { MibsScreen } from './screens/MibsScreen';

const TABS: { key: Tab; glyph: string; label: string }[] = [
  { key: 'browse', glyph: '⌬', label: 'Browse' },
  { key: 'query', glyph: '⇄', label: 'Query' },
  { key: 'traps', glyph: '⚑', label: 'Traps' },
  { key: 'mibs', glyph: '▤', label: 'MIBs' },
];

export function AppRoot() {
  const engine = useEngine();
  const t = useTheme();
  const tab = useAppStore((s) => s.tab);
  const setTab = useAppStore((s) => s.setTab);
  const trapCount = useAppStore((s) => s.records.length);
  const [info, setInfo] = useState<EngineInfo | null>(null);

  useEffect(() => {
    engine.system.info().then(setInfo).catch(() => setInfo(null));
    void refreshModules(engine);
    void loadChildren(engine, '');

    const store = useAppStore.getState;

    const offOps = engine.events.subscribe('ops', (e: EngineEvent) => {
      const s = store();
      if (e.handleId !== s.running) return;
      if (e.kind === 'batch') {
        const batch = e.payload as DecodedVarbind[];
        s.appendResults(batch);
        const st = store().stats;
        s.setStats({ count: st.count + batch.length, batches: st.batches + 1, ms: Date.now() - s.walkStart });
      } else if (e.kind === 'done') {
        const p = e.payload as { count?: number };
        const st = store().stats;
        s.setStats({ count: p.count ?? st.count, batches: st.batches, ms: Date.now() - s.walkStart });
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

    return () => {
      offOps();
      offTraps();
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
        {tab === 'traps' ? <TrapsScreen /> : null}
        {tab === 'mibs' ? <MibsScreen /> : null}
      </View>

      <View style={[styles.tabbar, { backgroundColor: t.surface, borderTopColor: t.border }]}>
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
                <Text style={[styles.tabGlyph, { color: active ? t.accent : t.textDim }]}>{item.glyph}</Text>
                {item.key === 'traps' && trapCount > 0 ? (
                  <View style={[styles.badge, { backgroundColor: t.accent }]}>
                    <Text style={styles.badgeText}>{trapCount > 99 ? '99+' : trapCount}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.tabLabel, { color: active ? t.accent : t.textDim }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1 },
  title: { fontSize: 18, fontWeight: '800' },
  sub: { fontSize: 11, marginTop: 2 },
  body: { flex: 1 },
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
});
