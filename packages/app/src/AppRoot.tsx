import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  View,
  Pressable,
  StyleSheet,
  Modal,
  ScrollView,
} from 'react-native';
import {
  Button,
  CODE_OSS_DEFAULT_THEMES,
  Card,
  Dialog,
  Label,
  SafeAreaBottomInsetProvider,
  SectionTitle,
  Text,
  ThemeProvider,
  getCodeOssDefaultTheme,
  useTheme,
} from '@mibbeacon/ui';
import type { ThemeDescriptor } from '@mibbeacon/ui/theme-values';
import type {
  DecodedVarbind,
  EngineEvent,
  EngineInfo,
  PacketTraceEvent,
  PacketTraceServiceStatus,
  TrapRecord,
} from '@mibbeacon/core/client';
import { useEngine, useEngineOwnership } from './engine-context';
import { configureThemeStorage, useAppStore, type Tab } from './store';
import type { RawThemeImportFile } from './theme-import';
import type { ThemeStorageAdapter } from './theme-storage';
import {
  handleResolverEvent,
  loadChildren,
  refreshModules,
  refreshResolverState,
  refreshAgentProfiles,
  refreshAgentGroups,
  refreshTrapRecords,
  invalidateTrapRecordAuthority,
  refreshTrapReceiverStatus,
  refreshLoadedOidLookups,
  openGlobalCatalogObject,
  respondResolverConsent,
  disposeResolverSourceController,
  disposeResolverCacheClearController,
} from './actions';
import { BrowseScreen } from './screens/BrowseScreen';
import { QueryScreen } from './screens/QueryScreen';
import { TrapsScreen } from './screens/TrapsScreen';
import { MibsScreen } from './screens/MibsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AgentsScreen } from './screens/AgentsScreen';
import { ToolsScreen } from './screens/ToolsScreen';
import type { ChartPngExport } from './components/ToolLineChart';
import {
  disposeToolsPersistentCollectionsController,
  toolsPersistentCollectionsController,
} from './tools-persistent-collections';
import { disposeTrapPersistentCollectionsController } from './trap-persistent-collections';
import { disposeAgentPersistentCollectionsController } from './agent-persistent-collections';
import { disposeQueryArtifactCollectionsController } from './query-artifact-collections';
import { disposePatternPersistentCollectionsController } from './pattern-persistent-collections';
import { LiveMibsScreen } from './screens/LiveMibsScreen';
import { ResponsiveLayoutProvider, useResponsiveLayout } from './responsive-context';
import {
  getCompactBottomNavigationItems,
  getCompactOverflowTabs,
  getNavigationTabs,
  isCompactOverflowTab,
  type CompactNavigationItem,
  type NavigationTab,
} from './navigation';
import { routeForTab, tabFromUrl } from './routes';
import { SHORTCUTS, subscribeCommandPaletteShortcut } from './browser-shortcuts';
import { FileImportReviewModal } from './components/FileImportFlow';
import { CommandPalette } from './components/CommandPalette';
import type { CommandPaletteView } from './components/CommandPalette';
import { ToastHost } from './components/ToastHost';
import { MibBeaconMark } from './components/MibBeaconMark';
import { AppNavigation } from './components/AppNavigation';
import { PacketConsole } from './components/PacketConsole';
import { RegisteredQueryActions } from './components/RegisteredQueryActions';
import { RegisteredResolverCacheActions } from './components/RegisteredResolverCacheActions';
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
import { ActionRegistry, resolveActionPlatform, type AppAction } from './action-registry';
import {
  ActionRegistryProvider,
  useActionPlatform,
  useActionRegistry,
  useActionRegistrySnapshot,
  useRegisteredActions,
} from './action-registry-react';
import { acquireBrowserThemeFiles } from './theme-file-picker';
import { prepareThemeImports } from './theme-import';
import { PacketBootstrapCoordinator } from './packet-bootstrap-coordinator';
import { EngineEffectHarness } from './engine-effect-harness';
import { runEngineOwnedContinuation } from './engine-owned-continuation';
import { cleanupAcceptedEngineHandles } from './engine-start-arbitration';
import {
  createBrowserNotificationAdapter,
  notifyTrapRule,
  notifyWatchAlert,
  type HostNotificationAdapter,
} from './notification-delivery';

const TABBAR_BASE_PADDING = 6;

function authorizeActionConfirmation(action: AppAction): boolean | Promise<boolean> {
  const confirmation = action.confirmation;
  if (confirmation.kind === 'none') return true;
  const prompt = [confirmation.title, confirmation.description].filter(Boolean).join('\n\n');
  if (Platform.OS === 'web' && typeof globalThis.confirm === 'function') {
    return globalThis.confirm(prompt);
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      resolve(accepted);
    };
    Alert.alert(
      confirmation.title,
      confirmation.description,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => settle(false) },
        {
          text: 'Continue',
          style: confirmation.kind === 'destructive' ? 'destructive' : 'default',
          onPress: () => settle(true),
        },
      ],
      { cancelable: true, onDismiss: () => settle(false) },
    );
  });
}

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
  shareChartPng?: (capture: ChartPngExport) => Promise<void>;
  notifications?: HostNotificationAdapter;
  themeStorage?: ThemeStorageAdapter;
  pickThemeFiles?: () => Promise<RawThemeImportFile[]>;
}

export interface PacketCaptureExportReader {
  fileName: string;
  byteLength: number;
  readChunk(offset: number): Promise<{ base64: string; nextOffset: number; done: boolean }>;
}

export function AppRoot({
  host,
  paletteHistoryStorage,
  safeAreaBottomInset = 0,
}: {
  host?: AppHostAdapter;
  paletteHistoryStorage?: PaletteHistoryStorage;
  safeAreaBottomInset?: number;
}) {
  return (
    <ResponsiveLayoutProvider>
      <ThemedAppRoot
        host={host}
        paletteHistoryStorage={paletteHistoryStorage}
        safeAreaBottomInset={safeAreaBottomInset}
      />
    </ResponsiveLayoutProvider>
  );
}

function ThemedAppRoot({
  host,
  paletteHistoryStorage,
  safeAreaBottomInset,
}: {
  host?: AppHostAdapter;
  paletteHistoryStorage?: PaletteHistoryStorage;
  safeAreaBottomInset: number;
}) {
  const { mode } = useResponsiveLayout();
  const themeMode = useAppStore((state) => state.themeMode);
  const lightThemeId = useAppStore((state) => state.lightThemeId);
  const darkThemeId = useAppStore((state) => state.darkThemeId);
  const installedThemes = useAppStore((state) => state.installedThemes);
  const densityMode = useAppStore((state) => state.densityMode);
  const [previewTheme, setPreviewTheme] = useState<ThemeDescriptor | null>(null);
  const actionRegistry = useMemo(() => new ActionRegistry(), []);
  const actionPlatform = resolveActionPlatform(Platform.OS, Boolean(host));
  useEffect(() => {
    void configureThemeStorage(host?.themeStorage ?? paletteHistoryStorage);
  }, [host?.themeStorage, paletteHistoryStorage]);
  const density =
    densityMode === 'auto' ? (mode === 'expanded' ? 'compact' : 'comfortable') : densityMode;
  const lightTheme =
    (previewTheme?.scheme === 'light' ? previewTheme : undefined) ??
    getCodeOssDefaultTheme(lightThemeId) ??
    installedThemes.find(({ id, scheme }) => id === lightThemeId && scheme === 'light');
  const darkTheme =
    (previewTheme?.scheme === 'dark' ? previewTheme : undefined) ??
    getCodeOssDefaultTheme(darkThemeId) ??
    installedThemes.find(({ id, scheme }) => id === darkThemeId && scheme === 'dark');
  return (
    <SafeAreaBottomInsetProvider bottomInset={safeAreaBottomInset}>
      <ThemeProvider
        mode={previewTheme?.scheme ?? themeMode}
        density={density}
        lightTheme={lightTheme}
        darkTheme={darkTheme}
      >
        <ActionRegistryProvider registry={actionRegistry} platform={actionPlatform}>
          <ResponsiveAppRoot
            host={host}
            paletteHistoryStorage={paletteHistoryStorage}
            safeAreaBottomInset={safeAreaBottomInset}
            onPreviewTheme={setPreviewTheme}
            onClearThemePreview={() => setPreviewTheme(null)}
          />
        </ActionRegistryProvider>
      </ThemeProvider>
    </SafeAreaBottomInsetProvider>
  );
}

function ResponsiveAppRoot({
  host,
  paletteHistoryStorage,
  safeAreaBottomInset,
  onPreviewTheme,
  onClearThemePreview,
}: {
  host?: AppHostAdapter;
  paletteHistoryStorage?: PaletteHistoryStorage;
  safeAreaBottomInset: number;
  onPreviewTheme: (theme: ThemeDescriptor) => void;
  onClearThemePreview: () => void;
}) {
  const engine = useEngine();
  const ownsEngine = useEngineOwnership();
  const actionRegistry = useActionRegistry();
  const actionPlatform = useActionPlatform();
  const notificationAdapter = useMemo(
    () => host?.notifications ?? createBrowserNotificationAdapter(),
    [host?.notifications],
  );
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [paletteView, setPaletteView] = useState<CommandPaletteView>('commands');
  const installedThemes = useAppStore((state) => state.installedThemes);
  const lightThemeId = useAppStore((state) => state.lightThemeId);
  const darkThemeId = useAppStore((state) => state.darkThemeId);
  const openVsxThemeCatalogEnabled = useAppStore((state) => state.openVsxThemeCatalogEnabled);
  const availableThemes = useMemo(
    () => [...CODE_OSS_DEFAULT_THEMES, ...installedThemes],
    [installedThemes],
  );
  const [browseSearchFocusRequest, setBrowseSearchFocusRequest] = useState(0);
  const [agentProfileCreateRequest, setAgentProfileCreateRequest] = useState(0);
  const handleAgentProfileCreateRequest = useCallback(() => setAgentProfileCreateRequest(0), []);
  const resolvedPaletteStorage = useMemo(
    () => paletteHistoryStorage ?? createBrowserPaletteHistoryStorage(),
    [paletteHistoryStorage],
  );
  const legacyPaletteCommands = useMemo(
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
  const navigateToQuery = useCallback(() => selectTab('query'), [selectTab]);

  useEffect(() => {
    if (mode !== 'compact') setMoreOpen(false);
  }, [mode]);

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
      const state = useAppStore.getState();
      void runEngineOwnedContinuation(
        () =>
          stageAcquiredFileImport({ status: 'selected', files }, state.modules, (module) =>
            engine.mibs.replacementGroup(module),
          ),
        ownsEngine,
        (review) => {
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
        },
        (cause) => {
          console.error('OS_OPEN_FILE_REVIEW_FAILED', cause);
          state.setResolverError(
            `Could not review the file opened by the operating system: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        },
      );
    });
  }, [engine, host, ownsEngine]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    return subscribeCommandPaletteShortcut(window, !host, () => {
      setShortcutsOpen(false);
      setPaletteOpen((open) => {
        if (!open) setPaletteView('commands');
        else onClearThemePreview();
        return !open;
      });
    });
  }, [host, onClearThemePreview]);

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
      let keepOpen = false;
      applyPaletteCommandEffect(command.effect, {
        navigate: selectTab,
        focusBrowseSearch: () => setBrowseSearchFocusRequest((request) => request + 1),
        importMib: () => state.setBrowserImportOpen(true),
        openThemePicker: () => {
          keepOpen = true;
          setPaletteView('theme-picker');
        },
        openThemeCatalog: () => {
          keepOpen = true;
          setPaletteView('theme-catalog');
        },
        importTheme: () => {
          void (async () => {
            try {
              const files = await (host?.pickThemeFiles?.() ?? acquireBrowserThemeFiles());
              if (!files.length) return;
              const imported = prepareThemeImports(files);
              state.installThemes(imported.themes);
              state.pushToast({
                tone: imported.warnings.length ? 'warn' : 'success',
                message: `Installed ${imported.themes.length} color theme${imported.themes.length === 1 ? '' : 's'}${imported.warnings[0] ? ` · ${imported.warnings[0]}` : ''}`,
              });
            } catch (cause) {
              state.pushToast({
                tone: 'error',
                message: cause instanceof Error ? cause.message : String(cause),
              });
            }
          })();
        },
        createAgentProfile: () => setAgentProfileCreateRequest((request) => request + 1),
        showShortcuts: () => setShortcutsOpen(true),
        newWindow: host?.canOpenWindow ? host.newWindow : undefined,
        prepareQuery: state.setQueryOperation,
        openTraps: state.setTrapMode,
      });
      return keepOpen ? false : undefined;
    },
    [host, selectTab],
  );

  const staticActions = useMemo<AppAction[]>(
    () =>
      legacyPaletteCommands.map((command) => ({
        ...command,
        keyboard: { suitable: true },
        palette: { exposed: true },
        enabled: { value: true },
        confirmation: { kind: 'none' },
        platforms: ['web', 'desktop', 'native'] as const,
        execute: () => executePaletteCommand(command),
      })),
    [executePaletteCommand, legacyPaletteCommands],
  );
  useRegisteredActions(staticActions);
  const registeredActions = useActionRegistrySnapshot();
  const paletteCommands = useMemo(
    () =>
      registeredActions.filter(
        (action) => action.palette.exposed && action.platforms.includes(actionPlatform),
      ),
    [actionPlatform, registeredActions],
  );

  const executeRegisteredAction = useCallback(
    (action: AppAction) =>
      actionRegistry.execute(action.id, actionPlatform, authorizeActionConfirmation),
    [actionPlatform, actionRegistry],
  );
  const executeRegisteredActionById = useCallback(
    (actionId: string) =>
      actionRegistry.execute(actionId, actionPlatform, authorizeActionConfirmation),
    [actionPlatform, actionRegistry],
  );

  const commitTheme = useCallback(
    (theme: ThemeDescriptor) => {
      const state = useAppStore.getState();
      state.setThemeForScheme(theme.scheme, theme.id);
      state.setThemeMode(theme.scheme);
      onClearThemePreview();
    },
    [onClearThemePreview],
  );

  const closePalette = useCallback(() => {
    onClearThemePreview();
    setPaletteOpen(false);
    setPaletteView('commands');
  }, [onClearThemePreview]);

  const openPaletteOid = useCallback(
    async (oid: string) => {
      await openGlobalCatalogObject(engine, oid, ownsEngine);
      if (!ownsEngine()) return;
      selectTab('browse');
    },
    [engine, ownsEngine, selectTab],
  );

  useEffect(() => {
    const label = tabs.find((item) => item.key === activeTab)?.label ?? 'MIB Beacon';
    host?.setWindowTitle?.(`${label} — MIB Beacon`);
  }, [activeTab, host, tabs]);

  useEffect(() => {
    const store = useAppStore.getState;
    toolsPersistentCollectionsController(engine, ownsEngine);
    const lifetime = new EngineEffectHarness(ownsEngine);
    const ownsToken = (token: Parameters<EngineEffectHarness['owns']>[0]) => lifetime.owns(token);
    const applyToken = (token: Parameters<EngineEffectHarness['apply']>[0], mutation: () => void) =>
      lifetime.apply(token, mutation);
    const packetBootstrap = new PacketBootstrapCoordinator({
      setHistory: (events) => ownsEngine() && store().setPacketEvents(events),
      append: (event) => ownsEngine() && store().addPacketEvent(event),
      clear: () => ownsEngine() && store().clearPacketEvents(),
      setStatus: (status) => ownsEngine() && store().setPacketStatus(status),
      clearStatus: () => ownsEngine() && store().setPacketStatus(null),
    });
    packetBootstrap.cleared();
    packetBootstrap.clearStatus();
    store().resetEngineSessionTransientState();
    setInfo(null);
    store().setModules([]);
    store().setAgentProfiles([]);
    store().setAgentGroups([]);
    store().selectAgentProfile(null);
    store().selectAgentGroup(null);
    store().setResolverSettings(null);
    store().setResolverSources([]);
    store().setResolverCache(null);
    store().setResolverHistory([]);
    store().setResolverError(null);
    store().setTrapRecords([]);
    store().setReceiver({ running: false });
    store().clearChildrenCache();
    const offPackets = engine.events.subscribe('packets', (e: EngineEvent) => {
      if (!ownsEngine()) return;
      if (e.kind === 'packet') packetBootstrap.packet(e.payload as PacketTraceEvent);
      else if (e.kind === 'status' || e.kind === 'persistence-warning') {
        packetBootstrap.status(e.payload as PacketTraceServiceStatus);
      } else if (e.kind === 'cleared') packetBootstrap.cleared();
    });
    const offOps = engine.events.subscribe('ops', (e: EngineEvent) => {
      const token = lifetime.capture('ops');
      if (!ownsToken(token)) return;
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
      if (e.kind === 'trap' || e.kind === 'status') lifetime.invalidate('traps');
      if (e.kind === 'trap' || e.kind === 'removed' || e.kind === 'cleared') {
        lifetime.invalidate('trap-records');
        invalidateTrapRecordAuthority(engine);
      }
      const token = lifetime.capture('traps');
      const eventLifetime = lifetime.capture('trap-event-lifetime');
      if (!ownsToken(eventLifetime)) return;
      if (e.kind === 'trap') {
        store().addTrap(e.payload as TrapRecord);
        void lifetime.settle(
          token,
          () => engine.traps.status(),
          (status) => {
            if (!ownsEngine()) return;
            store().setReceiver({
              running: status.running,
              ...(status.port ? { port: status.port } : {}),
              count: status.count,
              drops: status.drops,
              ...(status.transports ? { transports: status.transports } : {}),
            });
          },
        );
      } else if (e.kind === 'rule-notification') {
        void notifyTrapRule(notificationAdapter, store().notificationPreferences, e.payload, () =>
          ownsToken(eventLifetime),
        ).catch(() => undefined);
      } else if (e.kind === 'status') {
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
      const terminal = ['done', 'partial', 'error', 'cancelled', 'expired'].includes(e.kind);
      const eventToken = lifetime.capture('resolver-event-lifetime');
      const errorToken = lifetime.begin(
        terminal ? 'resolver-terminal-error' : `resolver-event-error:${e.handleId ?? 'global'}`,
      );
      const modulesToken = terminal ? lifetime.begin('modules') : null;
      const resolverToken = terminal ? lifetime.begin('resolver') : null;
      const childrenToken = terminal ? lifetime.begin('children') : null;
      const ownsEvent = () => ownsToken(eventToken);
      void handleResolverEvent(engine, e, ownsEvent, terminal)
        .then(async () => {
          if (!ownsEvent() || !modulesToken || !resolverToken || !childrenToken) return;
          await Promise.all([
            refreshModules(engine, () => ownsToken(modulesToken)),
            refreshResolverState(engine, () => ownsToken(resolverToken), true),
          ]);
          await refreshLoadedOidLookups(engine, () => ownsEvent() && ownsToken(modulesToken));
          if (!ownsEvent() || !ownsToken(childrenToken)) return;
          store().clearChildrenCache();
          await loadChildren(engine, '', () => ownsToken(childrenToken));
        })
        .catch((error: unknown) => {
          applyToken(errorToken, () =>
            store().setResolverError(error instanceof Error ? error.message : String(error)),
          );
        });
    });

    const offTools = engine.events.subscribe('tools', (e: EngineEvent) => {
      const eventToken = lifetime.capture('tools-event');
      if (!ownsToken(eventToken)) return;
      if (e.kind === 'watch-alert') {
        void notifyWatchAlert(notificationAdapter, store().notificationPreferences, e.payload, () =>
          ownsToken(eventToken),
        ).catch(() => undefined);
      } else if (e.kind === 'resolver-changed') {
        const resolverToken = lifetime.begin('resolver');
        void refreshResolverState(engine, () => ownsToken(resolverToken), true).catch(
          () => undefined,
        );
      } else if (e.kind === 'catalog-changed') {
        const modulesToken = lifetime.begin('modules');
        const childrenToken = lifetime.begin('children');
        void refreshModules(engine, () => ownsToken(modulesToken))
          .then(async () => {
            if (!ownsToken(eventToken) || !ownsToken(childrenToken)) return;
            store().clearChildrenCache();
            await loadChildren(engine, '', () => ownsToken(childrenToken));
          })
          .catch(() => undefined);
      }
    });

    const historyToken = packetBootstrap.captureHistory();
    void engine.packets
      .history()
      .then((packets) => packetBootstrap.applyHistory(historyToken, packets))
      .catch(() => undefined);
    const statusToken = packetBootstrap.captureStatus();
    void engine.packets
      .status()
      .then((status) => packetBootstrap.applyStatus(statusToken, status))
      .catch(() => undefined);

    void lifetime.runLatest(
      'info',
      () => engine.system.info(),
      (nextInfo) => ownsEngine() && setInfo(nextInfo),
      () => ownsEngine() && setInfo(null),
    );
    const modulesToken = lifetime.begin('modules');
    void refreshModules(engine, () => ownsToken(modulesToken)).catch(() => undefined);
    const profilesToken = lifetime.begin('agent-profiles');
    void refreshAgentProfiles(engine, () => ownsToken(profilesToken)).catch(() => undefined);
    const groupsToken = lifetime.begin('agent-groups');
    void refreshAgentGroups(engine, () => ownsToken(groupsToken)).catch(() => undefined);
    const childrenToken = lifetime.begin('children');
    void loadChildren(engine, '', () => ownsToken(childrenToken)).catch(() => undefined);
    const resolverToken = lifetime.begin('resolver');
    void refreshResolverState(engine, () => ownsToken(resolverToken)).catch((error: unknown) => {
      applyToken(resolverToken, () =>
        store().setResolverError(error instanceof Error ? error.message : String(error)),
      );
    });
    const trapStatusToken = lifetime.begin('traps');
    void refreshTrapReceiverStatus(engine, () => ownsToken(trapStatusToken)).catch(() => undefined);
    const trapRecordsToken = lifetime.begin('trap-records');
    void refreshTrapRecords(engine, {}, () => ownsToken(trapRecordsToken)).catch(() => undefined);

    return () => {
      const accepted = store();
      void cleanupAcceptedEngineHandles(engine, {
        running: accepted.running,
        importHandle: accepted.importHandle,
        sourceTestHandles: accepted.sourceTestHandles,
        sourcePreviewHandle: accepted.sourcePreviewHandle,
      });
      lifetime.dispose();
      disposeResolverSourceController(engine);
      disposeResolverCacheClearController(engine);
      disposeToolsPersistentCollectionsController(engine);
      disposeTrapPersistentCollectionsController(engine);
      disposeAgentPersistentCollectionsController(engine);
      disposeQueryArtifactCollectionsController(engine);
      disposePatternPersistentCollectionsController(engine);
      packetBootstrap.dispose();
      offOps();
      offTraps();
      offResolver();
      offTools();
      offPackets();
    };
  }, [engine, notificationAdapter, ownsEngine]);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {mode === 'compact' ? (
        <View
          style={[
            styles.header,
            {
              backgroundColor: t.workbench.titleBarBackground,
              borderBottomColor: t.workbench.panelBorder,
            },
          ]}
        >
          <View style={styles.compactBrand}>
            <MibBeaconMark size={30} />
            <View style={styles.compactBrandCopy}>
              <Text style={[styles.title, { color: t.workbench.titleBarForeground }]}>
                MIB Beacon
              </Text>
              {info ? (
                <Text style={[styles.sub, { color: t.textDim }]}>
                  {info.platform} · net-snmp {info.netSnmpVersion}
                </Text>
              ) : null}
            </View>
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
        <RegisteredQueryActions navigateToQuery={navigateToQuery} />
        <RegisteredResolverCacheActions />
        {mode !== 'compact' ? (
          <AppNavigation
            expanded={mode === 'expanded'}
            tabs={tabs}
            tab={activeTab}
            trapCount={trapCount}
            info={info}
            onSelect={selectTab}
            onNewWindow={host?.canOpenWindow ? host.newWindow : undefined}
            onCommands={() => {
              setPaletteView('commands');
              setPaletteOpen(true);
            }}
            onShortcuts={() => setShortcutsOpen(true)}
          />
        ) : null}
        <View style={[styles.body, mode === 'compact' ? styles.mobileBody : null]}>
          {activeTab === 'browse' ? (
            <BrowseScreen info={info} unified focusSearchRequest={browseSearchFocusRequest} />
          ) : null}
          {activeTab === 'liveMibs' ? (
            <LiveMibsScreen
              info={info}
              createProfileRequest={agentProfileCreateRequest}
              onCreateProfileRequestHandled={handleAgentProfileCreateRequest}
            />
          ) : null}
          {activeTab === 'query' ? <QueryScreen info={info} /> : null}
          {activeTab === 'agents' ? <AgentsScreen info={info} /> : null}
          {activeTab === 'traps' ? <TrapsScreen info={info} /> : null}
          {activeTab === 'tools' ? (
            <ToolsScreen info={info} shareChartPng={host?.shareChartPng} />
          ) : null}
          {activeTab === 'mibs' ? <MibsScreen /> : null}
          {activeTab === 'settings' ? (
            <SettingsScreen
              host={host}
              executeAction={executeRegisteredActionById}
              onBrowseThemes={() => {
                setPaletteView('theme-catalog');
                setPaletteOpen(true);
              }}
            />
          ) : null}
          <PacketConsole host={host} />
        </View>
      </View>

      <FileImportReviewModal />

      <ResolverConsentModal
        visible={Boolean(consent)}
        missingModules={consent?.missingModules ?? []}
        sourceHosts={consent?.sourceHosts ?? []}
        onRespond={(allow, askAgain) =>
          void respondResolverConsent(engine, allow, askAgain, ownsEngine)
        }
      />

      <ShortcutOverlay visible={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <CommandPalette
        visible={paletteOpen}
        commands={paletteCommands}
        historyStorage={resolvedPaletteStorage}
        shortcutHint={host ? 'Ctrl/Cmd + Shift + P' : 'Ctrl/Cmd + Shift + Space'}
        view={paletteView}
        themes={availableThemes}
        currentThemeIds={{ light: lightThemeId, dark: darkThemeId }}
        openVsxEnabled={openVsxThemeCatalogEnabled}
        onClose={closePalette}
        onViewChange={setPaletteView}
        onExecute={executeRegisteredAction}
        onOpenOid={openPaletteOid}
        onPreviewTheme={onPreviewTheme}
        onClearThemePreview={onClearThemePreview}
        onCommitTheme={commitTheme}
        onInstallCatalogThemes={(themes, selected) => {
          const state = useAppStore.getState();
          state.installThemes(themes);
          commitTheme(selected);
          state.pushToast({
            tone: 'success',
            message: `Installed and applied ${selected.label}.`,
          });
        }}
        onEnableOpenVsx={() => useAppStore.getState().setOpenVsxThemeCatalogEnabled(true)}
      />

      <CompactMoreDialog
        visible={mode === 'compact' && moreOpen}
        destinations={getCompactOverflowTabs()}
        onClose={() => setMoreOpen(false)}
        onSelect={(next) => {
          setMoreOpen(false);
          selectTab(next);
        }}
      />

      {mode === 'compact' ? (
        <BottomNavigation
          items={getCompactBottomNavigationItems()}
          tab={activeTab}
          trapCount={trapCount}
          safeAreaBottomInset={safeAreaBottomInset}
          onSelect={selectTab}
          onMore={() => setMoreOpen(true)}
        />
      ) : null}

      <ToastHost />
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
  items,
  tab,
  trapCount,
  safeAreaBottomInset,
  onSelect,
  onMore,
}: {
  items: CompactNavigationItem[];
  tab: Tab;
  trapCount: number;
  safeAreaBottomInset: number;
  onSelect: (tab: Tab) => void;
  onMore: () => void;
}) {
  const t = useTheme();
  return (
    <View
      nativeID="app-bottom-navigation"
      accessibilityRole="tablist"
      style={[
        styles.tabbar,
        {
          backgroundColor: t.workbench.activityBarBackground,
          borderTopColor: t.workbench.panelBorder,
          paddingBottom: TABBAR_BASE_PADDING + safeAreaBottomInset,
        },
      ]}
    >
      {items.map((item) => {
        const destination = item.key === 'more' ? null : item.key;
        const active = item.key === 'more' ? isCompactOverflowTab(tab) : item.key === tab;
        return (
          <Pressable
            key={item.key}
            onPress={destination ? () => onSelect(destination) : onMore}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
            aria-selected={active}
            style={[
              styles.tab,
              active ? { backgroundColor: t.components.selected.background } : null,
            ]}
          >
            <View>
              <Text
                style={[
                  styles.tabGlyph,
                  {
                    color: active ? t.components.selected.icon : t.workbench.activityBarForeground,
                  },
                ]}
              >
                {item.glyph}
              </Text>
              {item.key === 'traps' && trapCount > 0 ? (
                <View style={[styles.badge, { backgroundColor: t.components.badge.background }]}>
                  <Text style={[styles.badgeText, { color: t.components.badge.foreground }]}>
                    {trapCount > 99 ? '99+' : trapCount}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              style={[
                styles.tabLabel,
                {
                  color: active
                    ? t.components.selected.foreground
                    : t.workbench.activityBarForeground,
                },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CompactMoreDialog({
  visible,
  destinations,
  onClose,
  onSelect,
}: {
  visible: boolean;
  destinations: NavigationTab[];
  onClose: () => void;
  onSelect: (tab: Tab) => void;
}) {
  const t = useTheme();
  return (
    <Dialog
      visible={visible}
      presentation="sheet"
      title="More"
      subtitle="Additional workspaces and preferences"
      scrollable={false}
      onRequestClose={onClose}
    >
      <View accessibilityRole="menu" style={styles.moreMenu}>
        {destinations.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="menuitem"
            accessibilityLabel={item.label}
            accessibilityHint={item.description}
            onPress={() => onSelect(item.key)}
            style={({ pressed }) => [
              styles.moreMenuItem,
              {
                backgroundColor: pressed ? t.accentSoft : t.surfaceAlt,
                borderColor: t.border,
              },
            ]}
          >
            <View
              style={[styles.moreMenuGlyph, { backgroundColor: t.surface, borderColor: t.border }]}
            >
              <Text style={[styles.moreMenuGlyphText, { color: t.accent }]}>{item.glyph}</Text>
            </View>
            <View style={styles.moreMenuCopy}>
              <Text style={[styles.moreMenuTitle, { color: t.text }]}>{item.label}</Text>
              <Label tone="dim" size={11}>
                {item.description}
              </Label>
            </View>
            <Text style={[styles.moreMenuArrow, { color: t.textDim }]}>›</Text>
          </Pressable>
        ))}
      </View>
    </Dialog>
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
    <Dialog
      visible={visible}
      onRequestClose={() => onRespond(false, true)}
      title="External MIB lookup"
      subtitle="Review missing definitions and external hosts before continuing."
      maxWidth={520}
      footer={
        <View style={styles.modalActions}>
          <Button title="Cancel" variant="ghost" onPress={() => onRespond(false, askAgain)} />
          <Button title="Continue" onPress={() => onRespond(true, askAgain)} />
        </View>
      }
    >
      <Text style={[styles.modalTitle, { color: t.text }]}>
        Search configured external sources?
      </Text>
      <Label tone="dim" size={12}>
        Local parsing found missing definitions. MIB Beacon can contact the enabled hosts below.
        Valid modules are cached on the engine host (the LAN server when using the web app). These
        sources are configured for lookup; they are not inherently trusted or endorsed.
      </Label>
      {missingModules.length ? (
        <View style={styles.modalList}>
          {missingModules.map((module) => (
            <Text key={module} style={[styles.modalCode, { color: t.mono }]}>
              • {module}
            </Text>
          ))}
        </View>
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
    </Dialog>
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
  compactBrand: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  compactBrandCopy: { flex: 1, minWidth: 0 },
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
  tabbar: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 },
  tabGlyph: { fontSize: 20, lineHeight: 24 },
  tabLabel: { fontSize: 11, fontWeight: '600' },
  moreMenu: { gap: 8 },
  moreMenuItem: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  moreMenuGlyph: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreMenuGlyphText: { fontSize: 20, fontWeight: '800' },
  moreMenuCopy: { flex: 1, minWidth: 0, gap: 2 },
  moreMenuTitle: { fontSize: 14, fontWeight: '800' },
  moreMenuArrow: { fontSize: 24, lineHeight: 26 },
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
  modalTitle: { fontSize: 19, fontWeight: '800' },
  modalList: { gap: 2 },
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
