import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Platform,
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  ScrollView,
} from 'react-native';
import { Button, Card, Label, SectionTitle, ThemeProvider, useTheme } from '@mibbeacon/ui';
import type {
  DecodedVarbind,
  EngineEvent,
  EngineInfo,
  PacketTraceEvent,
  PacketTraceServiceStatus,
  TrapRecord,
} from '@mibbeacon/core/client';
import { useEngine } from './engine-context';
import { useAppStore, type Tab } from './store';
import {
  handleResolverEvent,
  loadChildren,
  refreshModules,
  refreshResolverState,
  refreshAgentProfiles,
  refreshAgentGroups,
  openGlobalCatalogObject,
  respondResolverConsent,
} from './actions';
import { BrowseScreen } from './screens/BrowseScreen';
import { QueryScreen } from './screens/QueryScreen';
import { TrapsScreen } from './screens/TrapsScreen';
import { MibsScreen } from './screens/MibsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AgentsScreen } from './screens/AgentsScreen';
import { ToolsScreen } from './screens/ToolsScreen';
import { ResponsiveLayoutProvider, useResponsiveLayout } from './responsive-context';
import { getNavigationTabs, type NavigationTab } from './navigation';
import { routeForTab, tabFromUrl } from './routes';
import { SHORTCUTS, subscribeCommandPaletteShortcut } from './browser-shortcuts';
import { FileImportReviewModal } from './components/FileImportFlow';
import { CommandPalette } from './components/CommandPalette';
import { MibBeaconMark } from './components/MibBeaconMark';
import { PacketActivityLights, PacketConsole } from './components/PacketConsole';
import { MOBILE_PACKET_CONSOLE_COLLAPSED_SIZE } from './packet-console';
import {
  createInitialFileSelection,
  stageAcquiredFileImport,
  type RawSelectedFile,
} from './file-import';
import {
  applyPaletteCommandEffect,
  createBrowserPaletteHistoryStorage,
  getPaletteCommands,
  type PaletteCommand,
  type PaletteHistoryStorage,
} from './command-palette';

export interface HostUpdateStatus {
  phase:
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error';
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  message?: string;
}

export interface HostUpdateAdapter {
  get(): Promise<{ preferences: { automaticChecks: boolean }; status: HostUpdateStatus } | null>;
  setAutomaticChecks(enabled: boolean): ReturnType<HostUpdateAdapter['get']>;
  check(): Promise<HostUpdateStatus | null>;
  download(): Promise<HostUpdateStatus | null>;
  install(): Promise<void>;
  onStatus(listener: (status: HostUpdateStatus) => void): () => void;
}

export interface AppHostAdapter {
  canOpenWindow: boolean;
  newWindow: () => void;
  setWindowTitle?: (title: string) => void;
  updates?: HostUpdateAdapter;
  subscribeOpenFiles?: (listener: (files: RawSelectedFile[]) => void) => () => void;
  savePacketCapture?: (capture: PacketCaptureExportReader) => Promise<void>;
}

export interface PacketCaptureExportReader {
  fileName: string;
  byteLength: number;
  readChunk(offset: number): Promise<{ base64: string; nextOffset: number; done: boolean }>;
}

export function AppRoot({
  host,
  paletteHistoryStorage,
}: {
  host?: AppHostAdapter;
  paletteHistoryStorage?: PaletteHistoryStorage;
}) {
  return (
    <ResponsiveLayoutProvider>
      <ThemedAppRoot host={host} paletteHistoryStorage={paletteHistoryStorage} />
    </ResponsiveLayoutProvider>
  );
}

function ThemedAppRoot({
  host,
  paletteHistoryStorage,
}: {
  host?: AppHostAdapter;
  paletteHistoryStorage?: PaletteHistoryStorage;
}) {
  const { mode } = useResponsiveLayout();
  const themeMode = useAppStore((state) => state.themeMode);
  const densityMode = useAppStore((state) => state.densityMode);
  const density =
    densityMode === 'auto' ? (mode === 'expanded' ? 'compact' : 'comfortable') : densityMode;
  return (
    <ThemeProvider mode={themeMode} density={density}>
      <ResponsiveAppRoot host={host} paletteHistoryStorage={paletteHistoryStorage} />
    </ThemeProvider>
  );
}

function ResponsiveAppRoot({
  host,
  paletteHistoryStorage,
}: {
  host?: AppHostAdapter;
  paletteHistoryStorage?: PaletteHistoryStorage;
}) {
  const engine = useEngine();
  const t = useTheme();
  const { mode } = useResponsiveLayout();
  const tab = useAppStore((s) => s.tab);
  const setTab = useAppStore((s) => s.setTab);
  const tabs = getNavigationTabs(mode);
  const activeTab: Tab = mode !== 'compact' && tab === 'mibs' ? 'browse' : tab;
  const trapCount = useAppStore((s) => s.unreadTrapCount);
  const consent = useAppStore((s) => s.consent);
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [browseSearchFocusRequest, setBrowseSearchFocusRequest] = useState(0);
  const resolvedPaletteStorage = useMemo(
    () => paletteHistoryStorage ?? createBrowserPaletteHistoryStorage(),
    [paletteHistoryStorage],
  );
  const paletteCommands = useMemo(
    () => getPaletteCommands(tabs, Boolean(host?.canOpenWindow)),
    [host?.canOpenWindow, tabs],
  );
  const selectTab = useCallback(
    (next: Tab) => {
      setTab(next);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.history.replaceState(null, '', routeForTab(next));
      }
    },
    [setTab],
  );

  useEffect(() => {
    const apply = (url: string | null) => {
      const next = url ? tabFromUrl(url) : null;
      if (next) setTab(next);
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const sync = () => apply(window.location.href);
      sync();
      window.addEventListener('hashchange', sync);
      window.addEventListener('popstate', sync);
      return () => {
        window.removeEventListener('hashchange', sync);
        window.removeEventListener('popstate', sync);
      };
    }
    void Linking.getInitialURL().then(apply);
    const subscription = Linking.addEventListener('url', ({ url }) => apply(url));
    return () => subscription.remove();
  }, [setTab]);

  useEffect(() => {
    if (!host?.subscribeOpenFiles) return;
    return host.subscribeOpenFiles((files) => {
      void (async () => {
        const state = useAppStore.getState();
        try {
          const review = await stageAcquiredFileImport(
            { status: 'selected', files },
            state.modules,
            (module) => engine.mibs.replacementGroup(module),
          );
          state.setFileImportDraft({
            review,
            selected: [...createInitialFileSelection(review)],
            replacements: [],
            handleId: null,
            visible: true,
          });
          state.setTab('browse');
          if (Platform.OS === 'web' && typeof window !== 'undefined') {
            window.history.replaceState(null, '', routeForTab('browse'));
          }
        } catch (cause) {
          console.error('OS_OPEN_FILE_REVIEW_FAILED', cause);
          state.setResolverError(
            `Could not review the file opened by the operating system: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      })();
    });
  }, [engine, host]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    return subscribeCommandPaletteShortcut(window, !host, () => {
      setShortcutsOpen(false);
      setPaletteOpen((open) => !open);
    });
  }, [host]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (event.key === 'Escape' && shortcutsOpen) setShortcutsOpen(false);
      else if (event.key === '?' && !editable && !paletteOpen) {
        event.preventDefault();
        setShortcutsOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen, shortcutsOpen]);

  const executePaletteCommand = useCallback(
    (command: PaletteCommand) => {
      const state = useAppStore.getState();
      applyPaletteCommandEffect(command.effect, {
        navigate: selectTab,
        focusBrowseSearch: () => setBrowseSearchFocusRequest((request) => request + 1),
        importMib: () => state.setBrowserImportOpen(true),
        showShortcuts: () => setShortcutsOpen(true),
        newWindow: host?.canOpenWindow ? host.newWindow : undefined,
        prepareQuery: state.setQueryOperation,
        openTraps: state.setTrapMode,
      });
    },
    [host, selectTab],
  );

  const openPaletteOid = useCallback(
    async (oid: string) => {
      await openGlobalCatalogObject(engine, oid);
      selectTab('browse');
    },
    [engine, selectTab],
  );

  useEffect(() => {
    const label = tabs.find((item) => item.key === activeTab)?.label ?? 'MIB Beacon';
    host?.setWindowTitle?.(`${label} — MIB Beacon`);
  }, [activeTab, host, tabs]);

  useEffect(() => {
    const store = useAppStore.getState;
    engine.system
      .info()
      .then(setInfo)
      .catch(() => setInfo(null));
    void refreshModules(engine);
    void refreshAgentProfiles(engine);
    void refreshAgentGroups(engine);
    void loadChildren(engine, '');
    void refreshResolverState(engine).catch((error: unknown) =>
      store().setResolverError(error instanceof Error ? error.message : String(error)),
    );
    void engine.traps.status().then((status) =>
      store().setReceiver({
        running: status.running,
        ...(status.port ? { port: status.port } : {}),
        count: status.count,
        drops: status.drops,
        ...(status.transports ? { transports: status.transports } : {}),
      }),
    );
    void engine.traps.list().then((records) => {
      store().setTrapRecords(records);
    });
    void Promise.all([engine.packets.history(), engine.packets.status()]).then(
      ([packets, status]) => {
        store().setPacketEvents(packets);
        store().setPacketStatus(status);
      },
    );

    const offOps = engine.events.subscribe('ops', (e: EngineEvent) => {
      const s = store();
      if (e.handleId !== s.running) return;
      if (e.kind === 'pdu') {
        s.appendOperationPdu(e.payload);
      } else if (e.kind === 'agent-status') {
        const status = e.payload as {
          agentId: string;
          state: string;
          count?: number;
          error?: { message?: string; code?: string };
        };
        s.setAgentOperationStatus(status.agentId, {
          state: status.state,
          ...(status.count === undefined ? {} : { count: status.count }),
          ...(status.error ? { message: status.error.message ?? status.error.code } : {}),
        });
      } else if (e.kind === 'batch') {
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
        s.saveQueryResultTab(
          `${s.queryGroupMode ? (s.agentGroups.find((group) => group.id === s.selectedAgentGroupId)?.name ?? 'Group') : s.selectedAgentId ? (s.agentProfiles.find((profile) => profile.id === s.selectedAgentId)?.name ?? 'Agent') : s.agent.host || 'Ad hoc'} · ${s.queryOperation} · ${s.oid}`,
        );
        s.setRunning(null);
      } else if (e.kind === 'error') {
        const p = e.payload as { message?: string; code?: string };
        if (p.code !== 'CANCELLED') s.setQueryError(p.message ?? p.code ?? 'walk failed');
        s.setRunning(null);
      }
    });

    const offTraps = engine.events.subscribe('traps', (e: EngineEvent) => {
      if (e.kind === 'trap') {
        store().addTrap(e.payload as TrapRecord);
        void engine.traps.status().then((status) =>
          store().setReceiver({
            running: status.running,
            ...(status.port ? { port: status.port } : {}),
            count: status.count,
            drops: status.drops,
            ...(status.transports ? { transports: status.transports } : {}),
          }),
        );
      } else if (e.kind === 'rule-notification') showTrapRuleNotification(e.payload);
      else if (e.kind === 'status') {
        const status = e.payload as {
          running: boolean;
          port?: number;
          count?: number;
          drops?: number;
          transports?: ('udp4' | 'udp6')[];
        };
        store().setReceiver({
          running: status.running,
          ...(status.port ? { port: status.port } : {}),
          ...(status.count === undefined ? {} : { count: status.count }),
          ...(status.drops === undefined ? {} : { drops: status.drops }),
          ...(status.transports ? { transports: status.transports } : {}),
        });
      } else if (e.kind === 'removed') {
        for (const id of (e.payload as { ids?: string[] }).ids ?? []) store().removeTrap(id);
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
      if (e.kind === 'watch-alert') {
        showWatchNotification(e.payload);
      } else if (e.kind === 'resolver-changed') {
        void refreshResolverState(engine);
      } else if (e.kind === 'catalog-changed') {
        void refreshModules(engine).then(async () => {
          store().clearChildrenCache();
          await loadChildren(engine, '');
        });
      }
    });

    const offPackets = engine.events.subscribe('packets', (e: EngineEvent) => {
      if (e.kind === 'packet') store().addPacketEvent(e.payload as PacketTraceEvent);
      else if (e.kind === 'status' || e.kind === 'persistence-warning') {
        store().setPacketStatus(e.payload as PacketTraceServiceStatus);
      } else if (e.kind === 'cleared') store().clearPacketEvents();
    });

    return () => {
      offOps();
      offTraps();
      offResolver();
      offTools();
      offPackets();
    };
  }, [engine]);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {mode === 'compact' ? (
        <View style={[styles.header, { borderBottomColor: t.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: t.text }]}>MIB Beacon</Text>
            {info ? (
              <Text style={[styles.sub, { color: t.textDim }]}>
                {info.platform} · net-snmp {info.netSnmpVersion}
              </Text>
            ) : null}
          </View>
          <MobileHeaderAction
            glyph="⌘"
            label="Open command palette"
            hint="Search commands and loaded MIB objects"
            onPress={() => setPaletteOpen(true)}
          />
          <MobileHeaderAction
            glyph="?"
            label="Keyboard shortcuts"
            onPress={() => setShortcutsOpen(true)}
          />
        </View>
      ) : null}

      <View style={styles.workbench}>
        {mode !== 'compact' ? (
          <AppNavigation
            expanded={mode === 'expanded'}
            tabs={tabs}
            tab={activeTab}
            trapCount={trapCount}
            info={info}
            onSelect={selectTab}
            onNewWindow={host?.canOpenWindow ? host.newWindow : undefined}
            onCommands={() => setPaletteOpen(true)}
            onShortcuts={() => setShortcutsOpen(true)}
          />
        ) : null}
        <View style={[styles.body, mode === 'compact' ? styles.mobileBody : null]}>
          {activeTab === 'browse' ? (
            <BrowseScreen info={info} unified focusSearchRequest={browseSearchFocusRequest} />
          ) : null}
          {activeTab === 'query' ? <QueryScreen info={info} /> : null}
          {activeTab === 'agents' ? <AgentsScreen info={info} /> : null}
          {activeTab === 'traps' ? <TrapsScreen info={info} /> : null}
          {activeTab === 'tools' ? <ToolsScreen /> : null}
          {activeTab === 'mibs' ? <MibsScreen /> : null}
          {activeTab === 'settings' ? <SettingsScreen host={host} /> : null}
          <PacketConsole host={host} />
        </View>
      </View>

      <FileImportReviewModal />

      <ResolverConsentModal
        visible={Boolean(consent)}
        missingModules={consent?.missingModules ?? []}
        sourceHosts={consent?.sourceHosts ?? []}
        onRespond={(allow, askAgain) => void respondResolverConsent(engine, allow, askAgain)}
      />

      <ShortcutOverlay visible={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <CommandPalette
        visible={paletteOpen}
        commands={paletteCommands}
        historyStorage={resolvedPaletteStorage}
        shortcutHint={host ? 'Ctrl/Cmd + Shift + P' : 'Ctrl/Cmd + Shift + Space'}
        onClose={() => setPaletteOpen(false)}
        onExecute={executePaletteCommand}
        onOpenOid={openPaletteOid}
      />

      {mode === 'compact' ? (
        <BottomNavigation tabs={tabs} tab={activeTab} trapCount={trapCount} onSelect={selectTab} />
      ) : null}
    </View>
  );
}

function showTrapRuleNotification(payload: unknown): void {
  const value = payload as {
    record?: TrapRecord;
    rules?: { name: string }[];
  };
  const NotificationApi = (
    globalThis as unknown as {
      Notification?: {
        permission: 'default' | 'granted' | 'denied';
        requestPermission(): Promise<'default' | 'granted' | 'denied'>;
        new (title: string, options?: { body?: string }): unknown;
      };
    }
  ).Notification;
  if (!NotificationApi || !value.record) return;
  const display = () =>
    new NotificationApi(value.record?.trapName ?? value.record?.trapOid ?? 'SNMP notification', {
      body: `${value.record?.sourceAddress ?? 'unknown source'} · ${value.rules?.map(({ name }) => name).join(', ') ?? 'matched rule'}`,
    });
  if (NotificationApi.permission === 'granted') display();
  else if (NotificationApi.permission === 'default') {
    void NotificationApi.requestPermission().then((permission) => {
      if (permission === 'granted') display();
    });
  }
}

function showWatchNotification(payload: unknown): void {
  const value = payload as { name?: string; value?: number; operator?: string; threshold?: number };
  const NotificationApi = (
    globalThis as unknown as {
      Notification?: {
        permission?: string;
        new (title: string, options?: { body?: string }): unknown;
      };
    }
  ).Notification;
  if (!NotificationApi || NotificationApi.permission !== 'granted') return;
  new NotificationApi(`Watch threshold: ${value.name ?? 'MIB Beacon'}`, {
    body: `${value.value ?? 'value'} ${value.operator ?? ''} ${value.threshold ?? ''}`.trim(),
  });
}

function NavigationItem({
  item,
  active,
  expanded,
  badgeCount,
  onPress,
}: {
  item: NavigationTab;
  active: boolean;
  expanded: boolean;
  badgeCount?: number;
  onPress: () => void;
}) {
  const t = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: active }}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
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
      {!expanded && hovered ? (
        <View style={[styles.navTooltip, { backgroundColor: t.surfaceAlt, borderColor: t.border }]}>
          <Text style={[styles.navTooltipText, { color: t.text }]}>{item.label}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function AppNavigation({
  tabs,
  expanded,
  tab,
  trapCount,
  info,
  onSelect,
  onNewWindow,
  onCommands,
  onShortcuts,
}: {
  tabs: NavigationTab[];
  expanded: boolean;
  tab: Tab;
  trapCount: number;
  info: EngineInfo | null;
  onSelect: (tab: Tab) => void;
  onNewWindow?: () => void;
  onCommands: () => void;
  onShortcuts: () => void;
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
      <MibBeaconMark size={38} />
      {expanded ? (
        <View style={styles.brandCopy}>
          <Text style={[styles.brandTitle, { color: t.text }]}>MIB Beacon</Text>
          <Text style={[styles.brandKicker, { color: t.textDim }]}>NETWORK WORKBENCH</Text>
        </View>
      ) : null}
      <View style={styles.navItems}>
        {tabs.map((item) => (
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
        <View style={styles.packetLightsDesktop}>
          <PacketActivityLights compact={!expanded} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Command palette"
          onPress={onCommands}
          style={({ pressed }) => [
            styles.newWindow,
            expanded ? styles.navItemExpanded : styles.navItemRail,
            { backgroundColor: pressed ? t.surfaceAlt : 'transparent', borderColor: t.border },
          ]}
        >
          <Text style={[styles.newWindowGlyph, { color: t.accent }]}>⌘</Text>
          {expanded ? <Text style={[styles.navLabel, { color: t.text }]}>Commands</Text> : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Keyboard shortcuts"
          onPress={onShortcuts}
          style={({ pressed }) => [
            styles.newWindow,
            expanded ? styles.navItemExpanded : styles.navItemRail,
            { backgroundColor: pressed ? t.surfaceAlt : 'transparent', borderColor: t.border },
          ]}
        >
          <Text style={[styles.newWindowGlyph, { color: t.accent }]}>?</Text>
          {expanded ? <Text style={[styles.navLabel, { color: t.text }]}>Shortcuts</Text> : null}
        </Pressable>
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

function MobileHeaderAction({
  glyph,
  label,
  hint,
  onPress,
}: {
  glyph: string;
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.mobileHeaderAction,
        {
          backgroundColor: pressed ? t.accentSoft : 'transparent',
          borderColor: t.border,
        },
      ]}
    >
      <Text style={[styles.mobileHeaderActionGlyph, { color: t.accent }]}>{glyph}</Text>
    </Pressable>
  );
}

function ShortcutOverlay({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Card style={styles.shortcutCard}>
          <View style={styles.shortcutHead}>
            <SectionTitle>Keyboard shortcuts</SectionTitle>
            <Button title="Close" small variant="ghost" onPress={onClose} />
          </View>
          <ScrollView>
            {SHORTCUTS.map(([key, description]) => (
              <View key={key} style={[styles.shortcutRow, { borderBottomColor: t.border }]}>
                <Text style={[styles.shortcutKey, { color: t.mono }]}>{key}</Text>
                <Text style={[styles.shortcutDescription, { color: t.text }]}>{description}</Text>
              </View>
            ))}
          </ScrollView>
        </Card>
      </View>
    </Modal>
  );
}

function BottomNavigation({
  tabs,
  tab,
  trapCount,
  onSelect,
}: {
  tabs: NavigationTab[];
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
      {tabs.map((item) => {
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
            Local parsing found missing definitions. MIB Beacon can contact the enabled hosts below.
            Valid modules are cached on the engine host (the LAN server when using the web app).
            These sources are configured for lookup; they are not inherently trusted or endorsed.
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
            accessibilityLabel="Ask me again before external MIB lookup"
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
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: '800' },
  sub: { fontSize: 11, marginTop: 2 },
  mobileHeaderAction: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileHeaderActionGlyph: { fontSize: 18, fontWeight: '800' },
  body: { flex: 1, minHeight: 0 },
  mobileBody: { paddingTop: MOBILE_PACKET_CONSOLE_COLLAPSED_SIZE },
  sidebar: { borderRightWidth: 1, paddingVertical: 14, alignItems: 'center', zIndex: 1 },
  sidebarExpanded: { width: 220, paddingHorizontal: 10 },
  sidebarRail: { width: 64, paddingHorizontal: 7 },
  brandCopy: { alignSelf: 'stretch', marginTop: 10, marginBottom: 14, paddingHorizontal: 5 },
  brandTitle: { fontSize: 15, fontWeight: '800' },
  brandKicker: { fontSize: 8, fontWeight: '800', letterSpacing: 1.15, marginTop: 2 },
  navItems: { flex: 1, alignSelf: 'stretch', gap: 5, marginTop: 14 },
  navItem: { minHeight: 46, borderWidth: 1, flexDirection: 'row', alignItems: 'center' },
  navItemExpanded: { borderRadius: 9, paddingHorizontal: 12, gap: 11 },
  navItemRail: { borderRadius: 10, justifyContent: 'center', paddingHorizontal: 0 },
  navGlyphWrap: { width: 26, alignItems: 'center' },
  navGlyph: { fontSize: 20, lineHeight: 24, fontWeight: '700' },
  navTooltip: {
    position: 'absolute',
    left: 56,
    minHeight: 36,
    minWidth: 96,
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  navTooltipText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  navLabel: { fontSize: 13, fontWeight: '700' },
  sidebarFooter: { alignSelf: 'stretch', gap: 8 },
  packetLightsDesktop: { minHeight: 22, alignItems: 'center', justifyContent: 'center' },
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
  shortcutCard: { width: '92%', maxWidth: 620, maxHeight: '82%' },
  shortcutHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shortcutRow: {
    minHeight: 46,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 7,
  },
  shortcutKey: { width: 135, fontFamily: 'monospace', fontWeight: '800', fontSize: 12 },
  shortcutDescription: { flex: 1, fontSize: 13 },
});
