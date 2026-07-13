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
import { ResponsiveLayoutProvider, useResponsiveLayout } from './responsive-context';

const TABS: { key: Tab; glyph: string; label: string }[] = [
  { key: 'browse', glyph: '⌬', label: 'Browse' },
  { key: 'query', glyph: '⇄', label: 'Query' },
  { key: 'traps', glyph: '⚑', label: 'Traps' },
  { key: 'mibs', glyph: '▤', label: 'MIBs' },
  { key: 'settings', glyph: '⚙', label: 'Settings' },
];

export interface AppHostAdapter {
  canOpenWindow: boolean;
  newWindow: () => void;
  setWindowTitle?: (title: string) => void;
}

export function AppRoot({ host }: { host?: AppHostAdapter }) {
  return (
    <ResponsiveLayoutProvider>
      <ResponsiveAppRoot host={host} />
    </ResponsiveLayoutProvider>
  );
}

function ResponsiveAppRoot({ host }: { host?: AppHostAdapter }) {
  const engine = useEngine();
  const t = useTheme();
  const { mode } = useResponsiveLayout();
  const tab = useAppStore((s) => s.tab);
  const setTab = useAppStore((s) => s.setTab);
  const trapCount = useAppStore((s) => s.records.length);
  const consent = useAppStore((s) => s.consent);
  const [info, setInfo] = useState<EngineInfo | null>(null);

  useEffect(() => {
    const label = TABS.find((item) => item.key === tab)?.label ?? 'Open MIB Catalog';
    host?.setWindowTitle?.(`${label} — Open MIB Catalog`);
  }, [host, tab]);

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
    void engine.traps.status().then((status) =>
      store().setReceiver({
        running: status.running,
        ...(status.port ? { port: status.port } : {}),
      }),
    );
    void engine.traps.list().then((records) => {
      store().clearTraps();
      for (const record of [...records].reverse()) store().addTrap(record);
    });

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
      else if (e.kind === 'status') {
        const status = e.payload as { running: boolean; port?: number };
        store().setReceiver({
          running: status.running,
          ...(status.port ? { port: status.port } : {}),
        });
      } else if (e.kind === 'cleared') store().clearTraps();
    });

    const offResolver = engine.events.subscribe('resolver', (e: EngineEvent) => {
      void handleResolverEvent(engine, e).then(async () => {
        if (!['done', 'partial', 'error', 'cancelled', 'expired'].includes(e.kind)) return;
        await Promise.all([refreshModules(engine), refreshResolverState(engine)]);
        store().clearChildrenCache();
        await loadChildren(engine, '');
      });
    });

    const offTools = engine.events.subscribe('tools', (e: EngineEvent) => {
      if (e.kind === 'resolver-changed') {
        void refreshResolverState(engine);
      } else if (e.kind === 'catalog-changed') {
        void refreshModules(engine).then(async () => {
          store().clearChildrenCache();
          await loadChildren(engine, '');
        });
      }
    });

    return () => {
      offOps();
      offTraps();
      offResolver();
      offTools();
    };
  }, [engine]);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {mode === 'compact' ? (
        <View style={[styles.header, { borderBottomColor: t.border }]}>
          <Text style={[styles.title, { color: t.text }]}>Open MIB Catalog</Text>
          {info ? (
            <Text style={[styles.sub, { color: t.textDim }]}>
              {info.platform} · net-snmp {info.netSnmpVersion}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.workbench}>
        {mode !== 'compact' ? (
          <AppNavigation
            expanded={mode === 'expanded'}
            tab={tab}
            trapCount={trapCount}
            info={info}
            onSelect={setTab}
            onNewWindow={host?.canOpenWindow ? host.newWindow : undefined}
          />
        ) : null}
        <View style={styles.body}>
          {tab === 'browse' ? <BrowseScreen /> : null}
          {tab === 'query' ? <QueryScreen info={info} /> : null}
          {tab === 'traps' ? <TrapsScreen info={info} /> : null}
          {tab === 'mibs' ? <MibsScreen /> : null}
          {tab === 'settings' ? <SettingsScreen /> : null}
        </View>
      </View>

      <ResolverConsentModal
        visible={Boolean(consent)}
        missingModules={consent?.missingModules ?? []}
        sourceHosts={consent?.sourceHosts ?? []}
        onRespond={(allow, askAgain) => void respondResolverConsent(engine, allow, askAgain)}
      />

      {mode === 'compact' ? (
        <BottomNavigation tab={tab} trapCount={trapCount} onSelect={setTab} />
      ) : null}
    </View>
  );
}

function NavigationItem({
  item,
  active,
  expanded,
  badgeCount,
  onPress,
}: {
  item: (typeof TABS)[number];
  active: boolean;
  expanded: boolean;
  badgeCount?: number;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.navItem,
        expanded ? styles.navItemExpanded : styles.navItemRail,
        {
          backgroundColor: active ? t.accentSoft : pressed ? t.surfaceAlt : 'transparent',
          borderColor: active ? t.accent : 'transparent',
        },
      ]}
    >
      <View style={styles.navGlyphWrap}>
        <Text style={[styles.navGlyph, { color: active ? t.accent : t.textDim }]}>
          {item.glyph}
        </Text>
        {badgeCount ? (
          <View style={[styles.badge, { backgroundColor: t.accent }]}>
            <Text style={styles.badgeText}>{badgeCount > 99 ? '99+' : badgeCount}</Text>
          </View>
        ) : null}
      </View>
      {expanded ? (
        <Text style={[styles.navLabel, { color: active ? t.text : t.textDim }]}>{item.label}</Text>
      ) : null}
    </Pressable>
  );
}

function AppNavigation({
  expanded,
  tab,
  trapCount,
  info,
  onSelect,
  onNewWindow,
}: {
  expanded: boolean;
  tab: Tab;
  trapCount: number;
  info: EngineInfo | null;
  onSelect: (tab: Tab) => void;
  onNewWindow?: () => void;
}) {
  const t = useTheme();
  return (
    <View
      nativeID={expanded ? 'app-sidebar-navigation' : 'app-rail-navigation'}
      style={[
        styles.sidebar,
        expanded ? styles.sidebarExpanded : styles.sidebarRail,
        { backgroundColor: t.surface, borderRightColor: t.border },
      ]}
    >
      <View style={[styles.brandMark, { backgroundColor: t.accentSoft, borderColor: t.accent }]}>
        <Text style={[styles.brandGlyph, { color: t.accent }]}>OM</Text>
      </View>
      {expanded ? (
        <View style={styles.brandCopy}>
          <Text style={[styles.brandTitle, { color: t.text }]}>Open MIB Catalog</Text>
          <Text style={[styles.brandKicker, { color: t.textDim }]}>NETWORK WORKBENCH</Text>
        </View>
      ) : null}
      <View style={styles.navItems}>
        {TABS.map((item) => (
          <NavigationItem
            key={item.key}
            item={item}
            active={item.key === tab}
            expanded={expanded}
            badgeCount={item.key === 'traps' ? trapCount : undefined}
            onPress={() => onSelect(item.key)}
          />
        ))}
      </View>
      <View style={styles.sidebarFooter}>
        {onNewWindow ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New window"
            onPress={onNewWindow}
            style={({ pressed }) => [
              styles.newWindow,
              expanded ? styles.navItemExpanded : styles.navItemRail,
              { backgroundColor: pressed ? t.surfaceAlt : 'transparent', borderColor: t.border },
            ]}
          >
            <Text style={[styles.newWindowGlyph, { color: t.accent }]}>＋</Text>
            {expanded ? <Text style={[styles.navLabel, { color: t.text }]}>New window</Text> : null}
          </Pressable>
        ) : null}
        {expanded && info ? (
          <View style={[styles.engineStatus, { borderTopColor: t.border }]}>
            <View style={[styles.statusDot, { backgroundColor: t.ok }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.engineTitle, { color: t.text }]}>Engine ready</Text>
              <Text style={[styles.engineMeta, { color: t.textDim }]} numberOfLines={1}>
                {info.platform} · net-snmp {info.netSnmpVersion}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function BottomNavigation({
  tab,
  trapCount,
  onSelect,
}: {
  tab: Tab;
  trapCount: number;
  onSelect: (tab: Tab) => void;
}) {
  const t = useTheme();
  return (
    <View
      nativeID="app-bottom-navigation"
      style={[styles.tabbar, { backgroundColor: t.surface, borderTopColor: t.border }]}
    >
      {TABS.map((item) => {
        const active = item.key === tab;
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => onRespond(false, true)}
    >
      <View style={styles.modalBackdrop}>
        <Card style={styles.modalCard}>
          <SectionTitle>External MIB lookup</SectionTitle>
          <Text style={[styles.modalTitle, { color: t.text }]}>
            Search configured external sources?
          </Text>
          <Label tone="dim" size={12}>
            Local parsing found missing definitions. Open MIB Catalog can contact the enabled hosts
            below. Valid modules are cached on the engine host (the LAN server when using the web
            app). These sources are configured for lookup; they are not inherently trusted or
            endorsed.
          </Label>
          {missingModules.length ? (
            <ScrollView style={styles.modalList}>
              {missingModules.map((module) => (
                <Text key={module} style={[styles.modalCode, { color: t.mono }]}>
                  • {module}
                </Text>
              ))}
            </ScrollView>
          ) : null}
          {sourceHosts.length ? (
            <Label tone="dim" size={11}>
              Hosts: {sourceHosts.join(', ')}
            </Label>
          ) : null}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: askAgain }}
            onPress={() => setAskAgain((value) => !value)}
            style={styles.checkboxRow}
          >
            <View
              style={[
                styles.checkbox,
                { borderColor: t.border, backgroundColor: askAgain ? t.accent : 'transparent' },
              ]}
            >
              <Text style={{ color: t.accentText, fontWeight: '900' }}>{askAgain ? '✓' : ''}</Text>
            </View>
            <Text style={{ color: t.text, fontSize: 13 }}>Ask me again next time</Text>
          </Pressable>
          {!askAgain ? (
            <Label tone="warn" size={11}>
              External access will be remembered until revoked in Settings.
            </Label>
          ) : null}
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
  workbench: { flex: 1, minHeight: 0, flexDirection: 'row' },
  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1 },
  title: { fontSize: 18, fontWeight: '800' },
  sub: { fontSize: 11, marginTop: 2 },
  body: { flex: 1, minHeight: 0 },
  sidebar: { borderRightWidth: 1, paddingVertical: 14, alignItems: 'center' },
  sidebarExpanded: { width: 220, paddingHorizontal: 10 },
  sidebarRail: { width: 64, paddingHorizontal: 7 },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandGlyph: { fontSize: 12, fontWeight: '900', letterSpacing: -0.5 },
  brandCopy: { alignSelf: 'stretch', marginTop: 10, marginBottom: 14, paddingHorizontal: 5 },
  brandTitle: { fontSize: 15, fontWeight: '800' },
  brandKicker: { fontSize: 8, fontWeight: '800', letterSpacing: 1.15, marginTop: 2 },
  navItems: { flex: 1, alignSelf: 'stretch', gap: 5, marginTop: 14 },
  navItem: { minHeight: 46, borderWidth: 1, flexDirection: 'row', alignItems: 'center' },
  navItemExpanded: { borderRadius: 9, paddingHorizontal: 12, gap: 11 },
  navItemRail: { borderRadius: 10, justifyContent: 'center', paddingHorizontal: 0 },
  navGlyphWrap: { width: 26, alignItems: 'center' },
  navGlyph: { fontSize: 20, lineHeight: 24, fontWeight: '700' },
  navLabel: { fontSize: 13, fontWeight: '700' },
  sidebarFooter: { alignSelf: 'stretch', gap: 8 },
  newWindow: { minHeight: 42, borderWidth: 1, flexDirection: 'row', alignItems: 'center' },
  newWindowGlyph: { width: 26, textAlign: 'center', fontSize: 20, fontWeight: '700' },
  engineStatus: {
    borderTopWidth: 1,
    paddingHorizontal: 5,
    paddingTop: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  engineTitle: { fontSize: 10, fontWeight: '700' },
  engineMeta: { fontSize: 9, marginTop: 1 },
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
