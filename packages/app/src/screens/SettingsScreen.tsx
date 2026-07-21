import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  Button,
  CODE_OSS_DEFAULT_THEMES,
  Card,
  Chip,
  Field,
  Label,
  Mono,
  Pill,
  Row,
  SectionTitle,
  Text,
  ThemedSwitch,
  useTheme,
} from '@mibbeacon/ui';
import type {
  EngineEvent,
  LiveMibSettings,
  PacketTraceServiceStatus,
  ResolverSourceDraft,
  SourceConfig,
  SourceKind,
} from '@mibbeacon/core/client';
import { useEngine, useEngineOwnership } from '../engine-context';
import { useAppStore } from '../store';
import {
  cancelResolverSourcePreview,
  dragResolverSource,
  moveResolverSource,
  previewResolverSource,
  refreshResolverState,
  removeResolverSource,
  resolverSourceController,
  resolverCacheClearController,
  saveResolverSource,
  testResolverSource,
  toggleResolverSource,
} from '../actions';
import { resetSplitWorkspaceLayouts } from '../components/SplitWorkspace';
import { resetVerticalDockLayouts } from '../components/VerticalDockWorkspace';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { useResponsiveLayout } from '../responsive-context';
import type { AppHostAdapter, HostUpdateStatus } from '../AppRoot';
import { RELEASE_INFO } from '../generated/release-info';
import licenseInventory from '../generated/third-party-licenses.json';
import { DEFAULT_PATTERN_TRACE_COLOR, isPatternTraceColor } from '../pattern-trace-settings';
import {
  getActiveSettingsSection,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
  type SettingsSectionOffsets,
} from '../settings-navigation';
import { acquireBrowserThemeFiles } from '../theme-file-picker';
import { prepareThemeImports } from '../theme-import';
import {
  LIVE_MIB_GLOBAL_SCOPE,
  LiveMibSettingsController,
  createLiveMibNumericFormDraft,
  editLiveMibNumericFormDraft,
  liveMibAgentScopeKey,
  liveMibSettingsStatusText,
  resolveConfirmedLiveMibSettingsForScope,
  resolveLiveMibSettingsForScope,
  validateLiveMibNumericFormDraft,
  type LiveMibNumericKey,
  type LiveMibNumericFormDraft,
  type LiveMibSettingsScopeKey,
} from '../live-mib-settings-transaction';
import {
  ResolverSettingsController,
  resolverSettingsStatusText,
} from '../resolver-settings-transaction';
import {
  AutomaticUpdatePreferenceController,
  UpdateStatusCoordinator,
  updatePreferenceStatusText,
  type UpdatePreferenceSnapshot,
} from '../update-preference-transaction';
import {
  PacketRetentionController,
  packetRetentionStatusText,
} from '../packet-retention-transaction';
import {
  resolverSourceCollectionStatusText,
  resolverSourceEditorRecovery,
} from '../resolver-source-collection';
import { resolverCacheClearStatusText } from '../resolver-cache-transaction';
import {
  createBrowserNotificationAdapter,
  type HostNotificationAdapter,
  type NotificationPermissionState,
} from '../notification-delivery';

const CUSTOM_KINDS: { kind: Exclude<SourceKind, 'cache'>; label: string }[] = [
  { kind: 'http-template', label: 'HTTP template' },
  { kind: 'ftp', label: 'FTP / FTPS' },
  { kind: 'json-catalog', label: 'JSON catalog' },
  { kind: 'github-tree', label: 'GitHub tree' },
];

export function SettingsScreen({
  host,
  onBrowseThemes,
  executeAction,
}: {
  host?: AppHostAdapter;
  onBrowseThemes: () => void;
  executeAction: (actionId: string) => Promise<void | boolean>;
}) {
  const engine = useEngine();
  const ownsEngine = useEngineOwnership();
  const t = useTheme();
  const updates = host?.updates;
  const { mode, supportsSplitView } = useResponsiveLayout();
  const sources = useAppStore((s) => s.resolverSources);
  const cache = useAppStore((s) => s.resolverCache);
  const history = useAppStore((s) => s.resolverHistory);
  const error = useAppStore((s) => s.resolverError);
  const themeMode = useAppStore((s) => s.themeMode);
  const lightThemeId = useAppStore((s) => s.lightThemeId);
  const darkThemeId = useAppStore((s) => s.darkThemeId);
  const installedThemes = useAppStore((s) => s.installedThemes);
  const openVsxThemeCatalogEnabled = useAppStore((s) => s.openVsxThemeCatalogEnabled);
  const notificationPreferences = useAppStore((s) => s.notificationPreferences);
  const setNotificationPreference = useAppStore((s) => s.setNotificationPreference);
  const densityMode = useAppStore((s) => s.densityMode);
  const patternTraceColor = useAppStore((s) => s.patternTraceColor);
  const agentProfiles = useAppStore((s) => s.agentProfiles);
  const [editing, setEditing] = useState<SourceConfig | 'new' | null>(null);
  const sourceCollectionController = useMemo(
    () => resolverSourceController(engine, ownsEngine, false),
    [engine, ownsEngine],
  );
  const sourceCollectionState = useSyncExternalStore(
    (listener) => sourceCollectionController.subscribe(listener),
    () => sourceCollectionController.snapshot(),
    () => sourceCollectionController.snapshot(),
  );
  const cacheClearController = useMemo(
    () => resolverCacheClearController(engine, ownsEngine),
    [engine, ownsEngine],
  );
  const cacheClearState = useSyncExternalStore(
    (listener) => cacheClearController.subscribe(listener),
    () => cacheClearController.snapshot(),
    () => cacheClearController.snapshot(),
  );
  const sourceCollectionBlocked =
    sourceCollectionState.readiness.phase !== 'ready' ||
    ['error-reverted', 'uncertain', 'conflict'].includes(sourceCollectionState.phase);
  const [testModule, setTestModule] = useState('IF-MIB');
  const [configTransfer, setConfigTransfer] = useState('');
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('appearance');
  const [updateStatus, setUpdateStatus] = useState<HostUpdateStatus | null>(null);
  const [, setUpdatePreferenceRevision] = useState(0);
  const updateLifetime = useMemo(
    () => ({
      adapter: updates,
      controller: new AutomaticUpdatePreferenceController(),
      status: new UpdateStatusCoordinator(setUpdateStatus),
    }),
    [updates],
  );
  const updatePreferenceController = updateLifetime.controller;
  const updateStatusCoordinator = updateLifetime.status;
  const [showLicenses, setShowLicenses] = useState(false);
  const [, setPacketRetentionRevision] = useState(0);
  const packetRetentionLifetime = useMemo(
    () => ({
      engine,
      controller: new PacketRetentionController((status) =>
        useAppStore.getState().setPacketStatus(status),
      ),
    }),
    [engine],
  );
  const packetRetentionController = packetRetentionLifetime.controller;
  const [patternTraceColorDraft, setPatternTraceColorDraft] = useState(patternTraceColor);
  const [liveAgentId, setLiveAgentId] = useState<string | null>(null);
  const [, setLiveRevision] = useState(0);
  const liveController = useMemo(() => new LiveMibSettingsController(), []);
  const [, setResolverRevision] = useState(0);
  const resolverController = useMemo(
    () =>
      new ResolverSettingsController((confirmed) => {
        useAppStore.getState().setResolverSettings(confirmed);
      }),
    [],
  );
  const [liveNumericForms, setLiveNumericForms] = useState<
    Partial<Record<LiveMibSettingsScopeKey, LiveMibNumericFormDraft>>
  >({});
  const [themeImportBusy, setThemeImportBusy] = useState(false);
  const [themeImportMessage, setThemeImportMessage] = useState<{
    tone: 'ok' | 'warn' | 'error';
    text: string;
  } | null>(null);
  const notificationAdapter = useMemo<HostNotificationAdapter | null>(
    () => host?.notifications ?? createBrowserNotificationAdapter(),
    [host?.notifications],
  );
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>('unsupported');
  const [notificationPermissionMessage, setNotificationPermissionMessage] = useState<string | null>(
    null,
  );
  const settingsScroll = useRef<ScrollView>(null);
  const sectionOffsets = useRef<SettingsSectionOffsets>({});
  const cacheSource = sources.find((source) => source.kind === 'cache');
  const availableThemes = [...CODE_OSS_DEFAULT_THEMES, ...installedThemes];

  const importThemes = async () => {
    setThemeImportBusy(true);
    setThemeImportMessage(null);
    try {
      const files = await (host?.pickThemeFiles?.() ?? acquireBrowserThemeFiles());
      if (!files.length) return;
      const imported = prepareThemeImports(files);
      useAppStore.getState().installThemes(imported.themes);
      setThemeImportMessage({
        tone: imported.warnings.length ? 'warn' : 'ok',
        text: `Installed ${imported.themes.length} theme${imported.themes.length === 1 ? '' : 's'}${
          imported.warnings.length ? ` · ${imported.warnings[0]}` : ''
        }`,
      });
    } catch (cause) {
      setThemeImportMessage({
        tone: 'error',
        text: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setThemeImportBusy(false);
    }
  };

  const externalSources = sources.filter((source) => source.kind !== 'cache');
  useEffect(() => {
    sourceCollectionController.activate();
    void sourceCollectionController.load().catch(() => undefined);
  }, [sourceCollectionController]);
  useEffect(() => {
    cacheClearController.activate();
    if (cacheClearController.snapshot().readiness === 'unloaded') {
      void cacheClearController.load().catch(() => undefined);
    }
  }, [cacheClearController]);
  useEffect(() => {
    updatePreferenceController.activate();
    updateStatusCoordinator.activate();
    const unsubscribe = updatePreferenceController.subscribe(() =>
      setUpdatePreferenceRevision((revision) => revision + 1),
    );
    return () => {
      unsubscribe();
      updatePreferenceController.dispose();
      updateStatusCoordinator.dispose();
    };
  }, [updatePreferenceController, updateStatusCoordinator]);
  useEffect(() => {
    const adapter = updateLifetime.adapter;
    if (!adapter) return;
    let active = true;
    void updatePreferenceController
      .load(async () =>
        toUpdatePreferenceSnapshot(
          await updateStatusCoordinator.run(
            () => adapter.get(),
            (state) => state?.status,
          ),
        ),
      )
      .catch(() => undefined);
    const unsubscribe = adapter.onStatus((status) => {
      if (active) updateStatusCoordinator.event(status);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [updateLifetime, updatePreferenceController, updateStatusCoordinator]);
  useEffect(() => {
    packetRetentionController.activate();
    const unsubscribe = packetRetentionController.subscribe(() =>
      setPacketRetentionRevision((revision) => revision + 1),
    );
    const unsubscribePackets = packetRetentionLifetime.engine.events.subscribe(
      'packets',
      (event: EngineEvent) => {
        if (event.kind === 'status' || event.kind === 'persistence-warning') {
          packetRetentionController.observe(event.payload as PacketTraceServiceStatus);
        }
      },
    );
    void packetRetentionController
      .load(() => packetRetentionLifetime.engine.packets.status())
      .catch(() => undefined);
    return () => {
      unsubscribePackets();
      unsubscribe();
      packetRetentionController.dispose();
    };
  }, [packetRetentionController, packetRetentionLifetime]);
  useEffect(() => {
    let active = true;
    setNotificationPermissionMessage(null);
    if (!notificationAdapter) {
      setNotificationPermission('unsupported');
      return () => {
        active = false;
      };
    }
    void notificationAdapter
      .getPermission()
      .then((permission) => {
        if (active) setNotificationPermission(permission);
      })
      .catch((cause) => {
        if (!active) return;
        setNotificationPermission('unsupported');
        setNotificationPermissionMessage(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [notificationAdapter]);
  useEffect(() => setPatternTraceColorDraft(patternTraceColor), [patternTraceColor]);
  useEffect(() => {
    return liveController.subscribe(() => setLiveRevision((revision) => revision + 1));
  }, [liveController]);
  useEffect(() => {
    resolverController.activate();
    const unsubscribe = resolverController.subscribe(() =>
      setResolverRevision((revision) => revision + 1),
    );
    return () => {
      unsubscribe();
      resolverController.dispose();
    };
  }, [resolverController]);
  useEffect(() => {
    const readiness = resolverController.readiness();
    if (readiness.phase === 'ready' || readiness.phase === 'loading') return;
    void resolverController.load(() => engine.resolver.settings.get()).catch(() => undefined);
  }, [engine, resolverController]);
  useEffect(() => {
    const readiness = liveController.readiness(LIVE_MIB_GLOBAL_SCOPE);
    if (readiness.phase === 'ready' || readiness.phase === 'loading') return;
    void liveController
      .load(LIVE_MIB_GLOBAL_SCOPE, () => engine.liveMibs.settings.get())
      .catch(() => undefined);
  }, [engine, liveController]);
  useEffect(() => {
    if (!liveAgentId) return;
    const scopeKey = liveMibAgentScopeKey(liveAgentId);
    const readiness = liveController.readiness(scopeKey);
    if (readiness.phase === 'ready' || readiness.phase === 'loading') return;
    void liveController
      .load(scopeKey, () => engine.liveMibs.agentOverrides.get(liveAgentId))
      .catch(() => undefined);
  }, [engine, liveAgentId, liveController]);
  const liveScopeKey = liveAgentId ? liveMibAgentScopeKey(liveAgentId) : LIVE_MIB_GLOBAL_SCOPE;
  const resolverState = resolverController.get();
  const resolverReadiness = resolverController.readiness();
  const resolverDraft = resolverController.display();
  const resolverAvailability =
    resolverReadiness.phase === 'error'
      ? { text: 'LOAD ERROR', color: t.error }
      : resolverReadiness.phase !== 'ready'
        ? { text: 'LOADING', color: t.textDim }
        : resolverDraft.enabled
          ? { text: 'ONLINE', color: t.ok }
          : { text: 'DISABLED', color: t.textDim };
  const resolverTransport = () => ({
    write: (value: typeof resolverDraft) => engine.resolver.settings.update(value),
    read: () => engine.resolver.settings.get(),
  });
  const updatePreferenceState = updatePreferenceController.get();
  const updatePreferenceReadiness = updatePreferenceController.readiness();
  const automaticChecks = updatePreferenceController.display();
  const updatePreferenceTransport = () => {
    const adapter = updateLifetime.adapter;
    return {
      write: async (enabled: boolean) =>
        adapter
          ? toUpdatePreferenceSnapshot(
              await updateStatusCoordinator.run(
                () => adapter.setAutomaticChecks(enabled),
                (state) => state?.status,
              ),
            )
          : null,
      read: async () =>
        adapter
          ? toUpdatePreferenceSnapshot(
              await updateStatusCoordinator.run(
                () => adapter.get(),
                (state) => state?.status,
              ),
            )
          : null,
    };
  };
  const runUpdateStatusAction = (action: () => Promise<HostUpdateStatus | null>): void => {
    void updateStatusCoordinator
      .run(action, (status) => status)
      .catch((cause) => {
        updateStatusCoordinator.event({
          phase: 'error',
          currentVersion: updateStatus?.currentVersion ?? RELEASE_INFO.version,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      });
  };
  const packetRetentionState = packetRetentionController.get();
  const packetRetentionReadiness = packetRetentionController.readiness();
  const packetRetentionValidation = packetRetentionController.validation();
  const packetRetention = packetRetentionController.displayText();
  const authoritativePacketStatus = packetRetentionController.status();
  const packetStatusOperation = packetRetentionController.statusOperation();
  const packetRetentionTransport = () => ({
    write: (retentionMiB: number) =>
      packetRetentionLifetime.engine.packets.updateSettings({ retentionMiB }),
    read: () => packetRetentionLifetime.engine.packets.status(),
  });
  const liveState = liveController.get(liveScopeKey);
  const liveReadiness = liveController.readiness(liveScopeKey);
  const globalLiveState = liveController.get(LIVE_MIB_GLOBAL_SCOPE);
  const liveSettings = liveController.display(LIVE_MIB_GLOBAL_SCOPE);
  const liveOverrides = liveAgentId
    ? liveController.display(liveMibAgentScopeKey(liveAgentId))
    : null;
  const agentLiveState = liveAgentId
    ? liveController.get(liveMibAgentScopeKey(liveAgentId))
    : undefined;
  const effectiveLiveSettings = useMemo(
    () => resolveLiveMibSettingsForScope(globalLiveState, agentLiveState),
    [agentLiveState, globalLiveState],
  );
  const liveNumericForm =
    liveNumericForms[liveScopeKey] ?? createLiveMibNumericFormDraft(effectiveLiveSettings);
  const liveNumericValidation = validateLiveMibNumericFormDraft(liveNumericForm);
  const liveConfirmedSignature = JSON.stringify({
    global: globalLiveState.confirmed,
    scope: liveState.confirmed,
  });
  useEffect(() => {
    if (
      liveReadiness.phase !== 'ready' ||
      !['confirmed', 'success', 'error-reverted', 'uncertain'].includes(liveState.phase)
    )
      return;
    setLiveNumericForms((forms) => ({
      ...forms,
      [liveScopeKey]: createLiveMibNumericFormDraft(effectiveLiveSettings),
    }));
  }, [
    effectiveLiveSettings,
    liveConfirmedSignature,
    liveReadiness.phase,
    liveScopeKey,
    liveState.phase,
  ]);
  const editLiveSetting = (patch: Partial<LiveMibSettings>) => {
    if (liveAgentId) {
      liveController.edit(liveMibAgentScopeKey(liveAgentId), {
        ...(liveOverrides ?? {}),
        ...patch,
      });
    } else {
      liveController.edit(LIVE_MIB_GLOBAL_SCOPE, { ...liveSettings, ...patch });
    }
  };
  const editLiveNumericSetting = (key: LiveMibNumericKey, text: string) => {
    setLiveNumericForms((forms) => ({
      ...forms,
      [liveScopeKey]: editLiveMibNumericFormDraft(
        forms[liveScopeKey] ?? createLiveMibNumericFormDraft(effectiveLiveSettings),
        key,
        text,
      ),
    }));
    liveController.touch(liveScopeKey);
    if (/^-?\d+$/.test(text) && Number.isSafeInteger(Number(text))) {
      editLiveSetting({ [key]: Number(text) });
    }
  };
  const resetLiveNumericForm = () => {
    const confirmedEffective = resolveConfirmedLiveMibSettingsForScope(
      globalLiveState,
      agentLiveState,
    );
    setLiveNumericForms((forms) => ({
      ...forms,
      [liveScopeKey]: createLiveMibNumericFormDraft(confirmedEffective),
    }));
  };
  const saveLiveSettings = () => {
    const validation = validateLiveMibNumericFormDraft(liveNumericForm);
    if (!validation.valid) return;
    editLiveSetting(validation.patch);
    void liveController.save(liveScopeKey, liveTransport());
  };
  const liveTransport = (scopeKey: LiveMibSettingsScopeKey = liveScopeKey) => {
    if (scopeKey === LIVE_MIB_GLOBAL_SCOPE) {
      return {
        write: (value: LiveMibSettings) => engine.liveMibs.settings.update(value),
        read: () => engine.liveMibs.settings.get(),
      };
    }
    const agentId = scopeKey.slice('live-mibs:agent:'.length);
    return {
      write: async (value: Partial<LiveMibSettings> | null) => {
        if (value === null) {
          await engine.liveMibs.agentOverrides.reset(agentId);
          return null;
        }
        return engine.liveMibs.agentOverrides.update(agentId, value);
      },
      read: () => engine.liveMibs.agentOverrides.get(agentId),
    };
  };
  const clearPreview = () => {
    void cancelResolverSourcePreview(engine, ownsEngine).catch(() => undefined);
  };
  const openEditor = (source: SourceConfig | 'new') => {
    clearPreview();
    setEditing(source);
  };
  const closeEditor = () => {
    clearPreview();
    setEditing(null);
  };

  const importConfiguration = async () => {
    setTransferMessage(null);
    try {
      const parsed = JSON.parse(configTransfer) as { sources?: unknown[] };
      if (!Array.isArray(parsed.sources)) throw new Error('Expected an exported sources array.');
      await sourceCollectionController.importCustom(configTransfer, ownsEngine);
      const settled = sourceCollectionController.snapshot();
      if (settled.phase === 'uncertain' || settled.phase === 'conflict')
        throw new Error(resolverSourceCollectionStatusText(settled));
      setTransferMessage(`Imported ${parsed.sources.length} custom source definition(s).`);
    } catch (cause) {
      setTransferMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const exportConfiguration = async () => {
    try {
      setConfigTransfer(await engine.resolver.sources.exportCustom());
      setTransferMessage('Export ready. Passwords, tokens, and secret headers are excluded.');
    } catch (cause) {
      setTransferMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const requestNotificationPermission = async () => {
    setNotificationPermissionMessage(null);
    if (!notificationAdapter) {
      setNotificationPermission('unsupported');
      setNotificationPermissionMessage('Notifications are not supported by this host.');
      return;
    }
    try {
      setNotificationPermission(await notificationAdapter.requestPermission());
    } catch (cause) {
      setNotificationPermission('unsupported');
      setNotificationPermissionMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const captureSection = (section: SettingsSectionId) => (event: LayoutChangeEvent) => {
    sectionOffsets.current[section] = event.nativeEvent.layout.y;
  };
  const scrollToSection = (section: SettingsSectionId) => {
    setActiveSection(section);
    settingsScroll.current?.scrollTo({
      y: Math.max(0, (sectionOffsets.current[section] ?? 0) - 12),
      animated: true,
    });
  };
  const trackActiveSection = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const atEnd = contentOffset.y + layoutMeasurement.height >= contentSize.height - 8;
    const next = getActiveSettingsSection(sectionOffsets.current, contentOffset.y, 48, atEnd);
    setActiveSection((current) => (current === next ? current : next));
  };
  const categoryButton = (section: (typeof SETTINGS_SECTIONS)[number], compact = false) => {
    const active = activeSection === section.id;
    return (
      <Pressable
        key={section.id}
        accessibilityRole="button"
        accessibilityLabel={`Show ${section.label} settings`}
        accessibilityState={{ selected: active }}
        onPress={() => scrollToSection(section.id)}
        style={[
          styles.settingsIndexItem,
          compact ? styles.settingsIndexItemCompact : null,
          {
            backgroundColor: active ? t.accentSoft : 'transparent',
            borderColor: active ? t.accent : 'transparent',
          },
        ]}
      >
        <Text style={{ color: active ? t.text : t.textDim, fontSize: 11, fontWeight: '700' }}>
          {section.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.workspace}>
      {supportsSplitView ? (
        <WorkspaceHeader
          title="Resolver settings"
          subtitle="PRIVACY · SOURCE PRIORITY · CACHE · EXTERNAL EVIDENCE"
          actions={<Pill text={resolverAvailability.text} color={resolverAvailability.color} />}
        />
      ) : null}
      {mode === 'medium' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[
            styles.settingsStrip,
            { backgroundColor: t.surface, borderBottomColor: t.border },
          ]}
          contentContainerStyle={styles.settingsStripContent}
        >
          {SETTINGS_SECTIONS.map((section) => categoryButton(section, true))}
        </ScrollView>
      ) : null}
      <View style={[styles.settingsBody, mode === 'expanded' ? styles.desktopSettingsBody : null]}>
        {mode === 'expanded' ? (
          <View
            style={[
              styles.settingsIndex,
              { backgroundColor: t.surface, borderRightColor: t.border },
            ]}
          >
            <SectionTitle>Categories</SectionTitle>
            {SETTINGS_SECTIONS.map((section) => categoryButton(section))}
          </View>
        ) : null}
        <ScrollView
          ref={settingsScroll}
          style={styles.screen}
          contentContainerStyle={[styles.content, supportsSplitView ? styles.desktopContent : null]}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          onScroll={trackActiveSection}
          scrollEventThrottle={32}
        >
          <View style={styles.sectionGroup} onLayout={captureSection('appearance')}>
            <Card>
              <SectionTitle>Appearance & accessibility</SectionTitle>
              <Label tone="dim" size={11}>
                System is the default. Auto density uses compact engineering rows at desktop widths
                and 44-point touch controls on tablet and phone.
              </Label>
              <Label size={11}>Color mode</Label>
              <Row style={styles.wrap}>
                {(['system', 'light', 'dark'] as const).map((value) => (
                  <Chip
                    key={value}
                    label={value}
                    active={themeMode === value}
                    onPress={() => useAppStore.getState().setThemeMode(value)}
                  />
                ))}
              </Row>
              <Label size={11}>Dark theme</Label>
              <Row style={styles.wrap}>
                {availableThemes
                  .filter(({ scheme }) => scheme === 'dark')
                  .map((theme) => (
                    <Chip
                      key={theme.id}
                      label={`${theme.label}${theme.highContrast ? ' · HC' : ''}`}
                      active={darkThemeId === theme.id}
                      onPress={() => useAppStore.getState().setThemeForScheme('dark', theme.id)}
                    />
                  ))}
              </Row>
              <Label size={11}>Light theme</Label>
              <Row style={styles.wrap}>
                {availableThemes
                  .filter(({ scheme }) => scheme === 'light')
                  .map((theme) => (
                    <Chip
                      key={theme.id}
                      label={`${theme.label}${theme.highContrast ? ' · HC' : ''}`}
                      active={lightThemeId === theme.id}
                      onPress={() => useAppStore.getState().setThemeForScheme('light', theme.id)}
                    />
                  ))}
              </Row>
              <Label tone="dim" size={10}>
                Code-OSS defaults are bundled from the MIT-licensed source. System mode uses the
                selected light and dark pair.
              </Label>
              <Row style={styles.wrap}>
                <Button
                  title={themeImportBusy ? 'Importing…' : 'Import VS Code theme'}
                  small
                  variant="ghost"
                  disabled={themeImportBusy}
                  onPress={() => void importThemes()}
                />
                <Pill text="JSON / JSONC / VSIX" color={t.textDim} />
              </Row>
              {themeImportMessage ? (
                <Label tone={themeImportMessage.tone} size={11}>
                  {themeImportMessage.text}
                </Label>
              ) : null}
              {installedThemes.length ? (
                <View style={styles.themeInstallList}>
                  <Label size={11}>Installed themes</Label>
                  {installedThemes.map((theme) => (
                    <View
                      key={theme.id}
                      style={[styles.themeInstallRow, { borderColor: t.border }]}
                    >
                      <View style={styles.themeInstallCopy}>
                        <Text style={{ color: t.text, fontSize: 12, fontWeight: '700' }}>
                          {theme.label}
                        </Text>
                        <Label tone="dim" size={10}>
                          {theme.provenance?.extensionId ??
                            theme.provenance?.fileName ??
                            'Local file'}
                          {theme.provenance?.version ? ` · ${theme.provenance.version}` : ''}
                          {` · ${theme.provenance?.license ?? 'license not declared'}`}
                        </Label>
                      </View>
                      <Button
                        title="Remove"
                        small
                        variant="ghost"
                        onPress={() => useAppStore.getState().removeTheme(theme.id)}
                      />
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={styles.settingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: 13, fontWeight: '700' }}>
                    Open VSX theme catalog
                  </Text>
                  <Text style={{ color: t.textDim, fontSize: 11, lineHeight: 16 }}>
                    Manual searches use the Eclipse-hosted registry. MIB Beacon never contacts
                    Microsoft’s Visual Studio Marketplace.
                  </Text>
                </View>
                <Chip
                  label={openVsxThemeCatalogEnabled ? 'Enabled' : 'Disabled'}
                  active={openVsxThemeCatalogEnabled}
                  onPress={() => {
                    const enabled = !openVsxThemeCatalogEnabled;
                    useAppStore.getState().setOpenVsxThemeCatalogEnabled(enabled);
                  }}
                />
              </View>
              <Row style={styles.wrap}>
                <Button
                  title="Browse color themes in Command Palette"
                  small
                  variant="ghost"
                  onPress={onBrowseThemes}
                />
                <Label tone="dim" size={10}>
                  Hover, arrow, or tap once to preview; click, Enter, or tap again to apply.
                </Label>
              </Row>
              <Label size={11}>Density</Label>
              <Row style={styles.wrap}>
                {(['auto', 'compact', 'comfortable'] as const).map((value) => (
                  <Chip
                    key={value}
                    label={value}
                    active={densityMode === value}
                    onPress={() => useAppStore.getState().setDensityMode(value)}
                  />
                ))}
              </Row>
              <Label size={11}>Pattern tracer marker color</Label>
              <Row style={[styles.wrap, styles.patternColorRow]}>
                <Field
                  label="Hex color"
                  value={patternTraceColorDraft}
                  onChangeText={setPatternTraceColorDraft}
                  onBlur={() => {
                    if (isPatternTraceColor(patternTraceColorDraft)) {
                      useAppStore.getState().setPatternTraceColor(patternTraceColorDraft);
                    } else {
                      setPatternTraceColorDraft(patternTraceColor);
                    }
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <View
                  accessibilityLabel={`Pattern tracer color ${patternTraceColor}`}
                  style={[styles.patternColorPreview, { backgroundColor: patternTraceColor }]}
                />
                <Button
                  title="Reset"
                  small
                  variant="ghost"
                  onPress={() => {
                    setPatternTraceColorDraft(DEFAULT_PATTERN_TRACE_COLOR);
                    useAppStore.getState().setPatternTraceColor(DEFAULT_PATTERN_TRACE_COLOR);
                  }}
                />
              </Row>
              <Label tone="dim" size={10}>
                Used for saved Pattern Tracer markers and response-time overlays. Enter a six-digit
                hex value such as #ef4444.
              </Label>
              <Label tone="ok" size={11}>
                Semantic status, diff, severity, focus, and text tokens are WCAG AA checked in both
                themes. Text controls support scaling through 130%.
              </Label>
            </Card>
          </View>
          <View style={styles.sectionGroup} onLayout={captureSection('liveMibs')}>
            <Card>
              <View style={styles.sectionHead}>
                <View style={styles.sectionHeadCopy}>
                  <SectionTitle>Live MIBs</SectionTitle>
                  <Label tone="dim" size={11}>
                    Safe global defaults with optional overrides for each saved agent.
                  </Label>
                </View>
                <Pill
                  text={liveAgentId ? 'AGENT OVERRIDE' : 'GLOBAL DEFAULT'}
                  color={liveAgentId ? t.accent : t.textDim}
                />
              </View>

              <Label size={11}>Configuration scope</Label>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Row>
                  <Chip
                    label="Global defaults"
                    active={!liveAgentId}
                    onPress={() => setLiveAgentId(null)}
                  />
                  {agentProfiles.map((profile) => (
                    <Chip
                      key={profile.id}
                      label={profile.name}
                      active={liveAgentId === profile.id}
                      onPress={() => setLiveAgentId(profile.id)}
                    />
                  ))}
                </Row>
              </ScrollView>
              {liveAgentId ? (
                <Button
                  title="Reset agent overrides"
                  small
                  variant="ghost"
                  disabled={
                    liveReadiness.phase !== 'ready' ||
                    !liveOverrides ||
                    ['queued', 'updating', 'uncertain'].includes(liveState.phase)
                  }
                  onPress={() => {
                    const scopeKey = liveMibAgentScopeKey(liveAgentId);
                    liveController.edit(scopeKey, null);
                    void liveController.save(scopeKey, liveTransport(scopeKey));
                  }}
                />
              ) : null}

              {liveReadiness.phase !== 'ready' ? (
                <View style={styles.sectionGroup}>
                  <Label tone={liveReadiness.phase === 'error' ? 'error' : 'dim'} size={11}>
                    {liveReadiness.phase === 'error'
                      ? `Unable to load this scope: ${liveReadiness.error}`
                      : 'Loading authoritative Live MIB settings…'}
                  </Label>
                  {liveReadiness.phase === 'error' ? (
                    <Button
                      title="Retry loading"
                      small
                      variant="ghost"
                      onPress={() => {
                        if (liveAgentId) {
                          const scopeKey = liveMibAgentScopeKey(liveAgentId);
                          void liveController
                            .load(scopeKey, () => engine.liveMibs.agentOverrides.get(liveAgentId))
                            .catch(() => undefined);
                        } else {
                          void liveController
                            .load(LIVE_MIB_GLOBAL_SCOPE, () => engine.liveMibs.settings.get())
                            .catch(() => undefined);
                        }
                      }}
                    />
                  ) : null}
                </View>
              ) : (
                <>
                  <Label size={11}>Refresh strategy</Label>
                  <Row style={styles.wrap}>
                    {(['adaptive', 'fixed', 'manual'] as const).map((value) => (
                      <Chip
                        key={value}
                        label={value}
                        active={effectiveLiveSettings.refreshMode === value}
                        onPress={() => editLiveSetting({ refreshMode: value })}
                      />
                    ))}
                  </Row>
                  <Row style={styles.wrap}>
                    <Field
                      label="Refresh interval (ms)"
                      value={liveNumericForm.values.refreshIntervalMs}
                      keyboardType="numeric"
                      editable={!['uncertain', 'error-reverted'].includes(liveState.phase)}
                      onChangeText={(value) => editLiveNumericSetting('refreshIntervalMs', value)}
                    />
                    <Field
                      label="Stale after (ms)"
                      value={liveNumericForm.values.staleAfterMs}
                      keyboardType="numeric"
                      editable={!['uncertain', 'error-reverted'].includes(liveState.phase)}
                      onChangeText={(value) => editLiveNumericSetting('staleAfterMs', value)}
                    />
                  </Row>
                  <SettingToggle
                    label="Pause adaptive polling while hidden"
                    hint="Avoid background device load when the Live MIBs workspace is not visible."
                    value={effectiveLiveSettings.pauseWhenHidden}
                    disabled={['uncertain', 'error-reverted'].includes(liveState.phase)}
                    onChange={(pauseWhenHidden) => editLiveSetting({ pauseWhenHidden })}
                  />

                  <Label size={11}>Scan workers</Label>
                  <Row style={styles.wrap}>
                    {[1, 2, 4, 8].map((scanConcurrency) => (
                      <Chip
                        key={scanConcurrency}
                        label={
                          scanConcurrency === 1
                            ? '1 · sequential'
                            : `${scanConcurrency} · concurrent`
                        }
                        active={effectiveLiveSettings.scanConcurrency === scanConcurrency}
                        onPress={() => editLiveSetting({ scanConcurrency })}
                      />
                    ))}
                  </Row>
                  {effectiveLiveSettings.scanConcurrency > 1 ? (
                    <Label tone="warn" size={10}>
                      Concurrent scans open multiple SNMP sessions to this agent. Reduce the setting
                      if the device drops requests or becomes CPU constrained.
                    </Label>
                  ) : null}
                  <SettingToggle
                    label="Show read-only objects"
                    hint="Off keeps the document tree focused on editable values. Locked values remain available when enabled."
                    value={effectiveLiveSettings.showReadOnly}
                    disabled={['uncertain', 'error-reverted'].includes(liveState.phase)}
                    onChange={(showReadOnly) => editLiveSetting({ showReadOnly })}
                  />

                  <Label size={11}>Write trigger</Label>
                  <Row style={styles.wrap}>
                    {(['confirm', 'blur', 'change'] as const).map((writeMode) => (
                      <Chip
                        key={writeMode}
                        label={
                          writeMode === 'confirm'
                            ? 'Confirm every Set'
                            : writeMode === 'blur'
                              ? 'Send on blur'
                              : 'Send on change'
                        }
                        active={effectiveLiveSettings.writeMode === writeMode}
                        onPress={() => editLiveSetting({ writeMode })}
                      />
                    ))}
                  </Row>
                  {effectiveLiveSettings.writeMode === 'change' ? (
                    <Field
                      label="Change debounce (0–2000 ms)"
                      value={liveNumericForm.values.writeDebounceMs}
                      keyboardType="numeric"
                      editable={!['uncertain', 'error-reverted'].includes(liveState.phase)}
                      onChangeText={(value) => editLiveNumericSetting('writeDebounceMs', value)}
                    />
                  ) : null}
                  <SettingToggle
                    label="Verify successful Sets"
                    hint="Read the value back from the device before showing the edit as confirmed."
                    value={effectiveLiveSettings.verifyWrites}
                    disabled={['uncertain', 'error-reverted'].includes(liveState.phase)}
                    onChange={(verifyWrites) => editLiveSetting({ verifyWrites })}
                  />

                  <Label size={11}>Two-state values</Label>
                  <Row style={styles.wrap}>
                    {(['auto', 'switch', 'select'] as const).map((booleanEditor) => (
                      <Chip
                        key={booleanEditor}
                        label={booleanEditor}
                        active={effectiveLiveSettings.booleanEditor === booleanEditor}
                        onPress={() => editLiveSetting({ booleanEditor })}
                      />
                    ))}
                  </Row>
                  <SettingToggle
                    label="Prefer formatted values"
                    hint="Use enum labels and DISPLAY-HINT output while preserving raw values underneath."
                    value={effectiveLiveSettings.preferFormattedValues}
                    disabled={['uncertain', 'error-reverted'].includes(liveState.phase)}
                    onChange={(preferFormattedValues) => editLiveSetting({ preferFormattedValues })}
                  />
                  <Field
                    label="Auto-collapse object after instances"
                    value={liveNumericForm.values.documentAutoCollapseThreshold}
                    keyboardType="numeric"
                    editable={!['uncertain', 'error-reverted'].includes(liveState.phase)}
                    onChangeText={(value) =>
                      editLiveNumericSetting('documentAutoCollapseThreshold', value)
                    }
                  />

                  <SettingToggle
                    label="Enable managed file-transfer workflows"
                    hint="Required for vendor adapters that stage a file outside the SNMP message. Off by default."
                    value={effectiveLiveSettings.managedTransfersEnabled}
                    disabled={['uncertain', 'error-reverted'].includes(liveState.phase)}
                    onChange={(managedTransfersEnabled) =>
                      editLiveSetting({ managedTransfersEnabled })
                    }
                  />
                  <Field
                    label="Maximum staged upload bytes"
                    value={liveNumericForm.values.maximumUploadBytes}
                    keyboardType="numeric"
                    editable={!['uncertain', 'error-reverted'].includes(liveState.phase)}
                    onChangeText={(value) => editLiveNumericSetting('maximumUploadBytes', value)}
                  />
                  {!liveNumericValidation.valid ? (
                    <Label tone="error" size={11}>
                      {liveNumericValidation.reason}
                    </Label>
                  ) : null}
                  <Row style={styles.wrap}>
                    <Button
                      title="Save changes"
                      small
                      disabled={liveState.phase !== 'dirty' || !liveNumericValidation.valid}
                      onPress={saveLiveSettings}
                    />
                    <Button
                      title="Cancel / revert"
                      small
                      variant="ghost"
                      disabled={!liveController.canCancel(liveScopeKey)}
                      onPress={() => {
                        liveController.cancel(liveScopeKey);
                        resetLiveNumericForm();
                      }}
                    />
                    {liveState.phase === 'error-reverted' ? (
                      <>
                        <Button
                          title="Retry"
                          small
                          variant="ghost"
                          onPress={() => void liveController.retry(liveScopeKey, liveTransport())}
                        />
                        <Button
                          title="Acknowledge"
                          small
                          variant="ghost"
                          onPress={() => {
                            liveController.acknowledge(liveScopeKey);
                            void liveController.save(liveScopeKey, liveTransport());
                          }}
                        />
                      </>
                    ) : null}
                    {liveState.phase === 'uncertain' ? (
                      <Button
                        title="Check remote value"
                        small
                        variant="ghost"
                        onPress={() =>
                          void liveController.reconcile(liveScopeKey, liveTransport().read)
                        }
                      />
                    ) : null}
                  </Row>
                  <Label
                    tone={
                      ['success', 'confirmed'].includes(liveState.phase)
                        ? 'ok'
                        : ['error-reverted', 'conflict'].includes(liveState.phase)
                          ? 'error'
                          : liveState.phase === 'dirty'
                            ? 'warn'
                            : 'dim'
                    }
                    size={11}
                  >
                    {liveMibSettingsStatusText(liveState)}
                  </Label>
                </>
              )}
            </Card>
          </View>
          <View style={styles.sectionGroup} onLayout={captureSection('updates')}>
            <Card>
              <SectionTitle>Desktop updates</SectionTitle>
              {host?.updates ? (
                <>
                  {updatePreferenceReadiness.phase === 'loading' ||
                  updatePreferenceReadiness.phase === 'unloaded' ? (
                    <Label tone="dim" size={11}>
                      Loading the authoritative update preference…
                    </Label>
                  ) : updatePreferenceReadiness.phase === 'error' ? (
                    <>
                      <Label tone="error" size={11}>
                        Update preference could not be loaded. {updatePreferenceReadiness.error}
                      </Label>
                      <Button
                        title="Retry loading"
                        small
                        variant="ghost"
                        onPress={() =>
                          void updatePreferenceController
                            .load(async () =>
                              toUpdatePreferenceSnapshot(
                                await updateStatusCoordinator.run(
                                  () => host.updates!.get(),
                                  (state) => state?.status,
                                ),
                              ),
                            )
                            .catch(() => undefined)
                        }
                      />
                    </>
                  ) : (
                    <>
                      <SettingToggle
                        label="Check for updates automatically"
                        hint="Off by default. Enabling this permits packaged desktop builds to contact GitHub Releases after startup."
                        value={automaticChecks}
                        disabled={['uncertain', 'error-reverted'].includes(
                          updatePreferenceState.phase,
                        )}
                        onChange={(enabled) => updatePreferenceController.edit(enabled)}
                      />
                      <Label
                        tone={
                          ['error-reverted', 'uncertain', 'conflict'].includes(
                            updatePreferenceState.phase,
                          )
                            ? 'error'
                            : updatePreferenceState.phase === 'dirty'
                              ? 'warn'
                              : ['success', 'confirmed'].includes(updatePreferenceState.phase)
                                ? 'ok'
                                : 'dim'
                        }
                        size={11}
                      >
                        {updatePreferenceStatusText(updatePreferenceState)}
                      </Label>
                      <Row style={styles.wrap}>
                        <Button
                          title="Save preference"
                          small
                          disabled={updatePreferenceState.phase !== 'dirty'}
                          onPress={() =>
                            void updatePreferenceController.save(updatePreferenceTransport())
                          }
                        />
                        <Button
                          title="Cancel / revert"
                          small
                          variant="ghost"
                          disabled={!updatePreferenceController.canCancel()}
                          onPress={() => updatePreferenceController.cancel()}
                        />
                        {updatePreferenceState.phase === 'error-reverted' ? (
                          <>
                            <Button
                              title="Retry"
                              small
                              variant="ghost"
                              onPress={() =>
                                void updatePreferenceController.retry(updatePreferenceTransport())
                              }
                            />
                            <Button
                              title="Acknowledge"
                              small
                              variant="ghost"
                              onPress={() => void updatePreferenceController.acknowledgeAndResume()}
                            />
                          </>
                        ) : null}
                        {updatePreferenceState.phase === 'uncertain' ? (
                          <Button
                            title="Check remote value"
                            small
                            variant="ghost"
                            onPress={() =>
                              void updatePreferenceController.reconcile(async () =>
                                toUpdatePreferenceSnapshot(
                                  await updateStatusCoordinator.run(
                                    () => host.updates!.get(),
                                    (state) => state?.status,
                                  ),
                                ),
                              )
                            }
                          />
                        ) : null}
                      </Row>
                    </>
                  )}
                  <Row style={styles.wrap}>
                    <Pill
                      text={(updateStatus?.phase ?? 'idle').replace('-', ' ').toUpperCase()}
                      color={
                        updateStatus?.phase === 'error'
                          ? t.error
                          : updateStatus?.phase === 'available' ||
                              updateStatus?.phase === 'downloaded'
                            ? t.ok
                            : t.textDim
                      }
                    />
                    <Button
                      title={updateStatus?.phase === 'checking' ? 'Checking…' : 'Check now'}
                      small
                      variant="ghost"
                      disabled={updateStatus?.phase === 'checking'}
                      onPress={() => runUpdateStatusAction(() => host.updates!.check())}
                    />
                    {updateStatus?.phase === 'available' ? (
                      <Button
                        title="Download update"
                        small
                        onPress={() => runUpdateStatusAction(() => host.updates!.download())}
                      />
                    ) : null}
                    {updateStatus?.phase === 'downloaded' ? (
                      <Button
                        title="Restart and install"
                        small
                        onPress={() => void host.updates?.install()}
                      />
                    ) : null}
                  </Row>
                  <Label tone="dim" size={11}>
                    Current {updateStatus?.currentVersion ?? RELEASE_INFO.version}
                    {updateStatus?.availableVersion
                      ? ` · available ${updateStatus.availableVersion}`
                      : ''}
                    {typeof updateStatus?.percent === 'number'
                      ? ` · ${updateStatus.percent.toFixed(0)}%`
                      : ''}
                  </Label>
                  {updateStatus?.message ? (
                    <Label tone="error" size={11}>
                      {updateStatus.message}
                    </Label>
                  ) : null}
                  <Label tone="dim" size={10}>
                    AppImage, NSIS, and dmg builds use this updater. deb/rpm update manually;
                    Flatpak updates through Flathub.
                  </Label>
                </>
              ) : (
                <Label tone="dim" size={11}>
                  Application updates are managed by this platform's package or app-store mechanism.
                </Label>
              )}
            </Card>
          </View>
          <View style={styles.sectionGroup} onLayout={captureSection('notifications')}>
            <Card>
              <View style={styles.sectionHead}>
                <View style={styles.sectionHeadCopy}>
                  <SectionTitle>Notifications</SectionTitle>
                  <Label tone="dim" size={11}>
                    Explicit opt-in controls for local trap-rule and watch-alert notifications.
                  </Label>
                </View>
                <Pill
                  text={notificationPermission.toUpperCase()}
                  color={
                    notificationPermission === 'granted'
                      ? t.ok
                      : notificationPermission === 'denied'
                        ? t.error
                        : t.textDim
                  }
                />
              </View>
              {!notificationAdapter ? (
                <Label tone="warn" size={11}>
                  Notifications are not supported by this host. Rule and watch notifications stay
                  disabled until the platform provides a notification adapter.
                </Label>
              ) : (
                <>
                  <SettingToggle
                    label="Trap rule notifications"
                    hint="Show a local notification when a received trap matches a saved rule."
                    value={notificationPreferences.trapRules}
                    disabled={notificationPermission !== 'granted'}
                    onChange={(enabled) => setNotificationPreference('trapRules', enabled)}
                  />
                  <SettingToggle
                    label="Watch alert notifications"
                    hint="Show a local notification when a Tool watch threshold fires."
                    value={notificationPreferences.watchAlerts}
                    disabled={notificationPermission !== 'granted'}
                    onChange={(enabled) => setNotificationPreference('watchAlerts', enabled)}
                  />
                  {notificationPermission !== 'granted' ? (
                    <Label tone={notificationPermission === 'denied' ? 'error' : 'warn'} size={11}>
                      Permission is {notificationPermission}. Enable notifications explicitly before
                      notification toggles can be changed.
                    </Label>
                  ) : (
                    <Label tone="ok" size={11}>
                      Permission granted. Enabled classes can notify without requesting permission
                      from trap or watch events.
                    </Label>
                  )}
                  <Row style={styles.wrap}>
                    <Button
                      title="Request notification permission"
                      small
                      variant="ghost"
                      disabled={notificationPermission === 'granted'}
                      onPress={() => void requestNotificationPermission()}
                    />
                    <Pill text={notificationAdapter.label.toUpperCase()} color={t.textDim} />
                  </Row>
                </>
              )}
              {notificationPermissionMessage ? (
                <Label tone="error" size={11}>
                  {notificationPermissionMessage}
                </Label>
              ) : null}
            </Card>
          </View>

          <View style={styles.sectionGroup} onLayout={captureSection('layout')}>
            <Card>
              <SectionTitle>Layout</SectionTitle>
              <Label tone="dim" size={11}>
                Reset persisted split-pane ratios and packet dock sizing back to the responsive
                defaults. Current panes keep working; the defaults apply as panes remount or resize.
              </Label>
              <Row style={styles.wrap}>
                <Button
                  title="Reset split panes"
                  small
                  variant="ghost"
                  onPress={() => {
                    resetSplitWorkspaceLayouts();
                    useAppStore.getState().pushToast({
                      tone: 'success',
                      message: 'Split pane layout defaults restored',
                    });
                  }}
                />
                <Button
                  title="Reset packet dock"
                  small
                  variant="ghost"
                  onPress={() => {
                    resetVerticalDockLayouts();
                    useAppStore.getState().pushToast({
                      tone: 'success',
                      message: 'Packet dock layout defaults restored',
                    });
                  }}
                />
              </Row>
            </Card>
          </View>

          <View style={styles.sectionGroup} onLayout={captureSection('privacy')}>
            <View style={styles.hero}>
              <View style={styles.heroCopy}>
                <Text style={[styles.heroTitle, { color: t.text }]}>Resolver control room</Text>
                <Text style={{ color: t.textDim, fontSize: 12 }}>
                  Privacy, source order, cache, and external evidence
                </Text>
              </View>
              <Pill text={resolverAvailability.text} color={resolverAvailability.color} />
            </View>

            <Card>
              <SectionTitle>Privacy & automation</SectionTitle>
              {resolverReadiness.phase === 'loading' || resolverReadiness.phase === 'unloaded' ? (
                <Label tone="dim" size={11}>
                  Loading the authoritative resolver settings…
                </Label>
              ) : resolverReadiness.phase === 'error' ? (
                <>
                  <Label tone="error" size={11}>
                    Resolver settings could not be loaded. {resolverReadiness.error}
                  </Label>
                  <Button
                    title="Retry loading"
                    small
                    variant="ghost"
                    onPress={() =>
                      void resolverController
                        .load(() => engine.resolver.settings.get())
                        .catch(() => undefined)
                    }
                  />
                </>
              ) : (
                <>
                  <SettingToggle
                    label="Enable resolver"
                    hint="Allow cache and configured sources to resolve modules."
                    value={resolverDraft.enabled}
                    disabled={['uncertain', 'error-reverted'].includes(resolverState.phase)}
                    onChange={(enabled) => resolverController.edit({ enabled })}
                  />
                  <SettingToggle
                    label="Resolve missing imports automatically"
                    hint="Runs only after a local import reports missing dependencies."
                    value={resolverDraft.autoResolveImports}
                    disabled={
                      !resolverDraft.enabled ||
                      ['uncertain', 'error-reverted'].includes(resolverState.phase)
                    }
                    onChange={(autoResolveImports) =>
                      resolverController.edit({ autoResolveImports })
                    }
                  />
                  <View style={styles.settingRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: t.text, fontSize: 13, fontWeight: '700' }}>
                        External access consent
                      </Text>
                      <Text style={{ color: t.textDim, fontSize: 11, lineHeight: 16 }}>
                        Consent can only be remembered from the disclosure prompt. Revoke it here at
                        any time.
                      </Text>
                    </View>
                    {resolverDraft.externalConsentRemembered ? (
                      <Button
                        title="Revoke"
                        small
                        variant="danger"
                        disabled={['uncertain', 'error-reverted'].includes(resolverState.phase)}
                        onPress={() =>
                          resolverController.edit({ externalConsentRemembered: false })
                        }
                      />
                    ) : (
                      <Pill text="ASK EVERY TIME" color={t.textDim} />
                    )}
                  </View>
                  <Label
                    tone={
                      resolverState.phase === 'error-reverted' ||
                      resolverState.phase === 'uncertain' ||
                      resolverState.phase === 'conflict'
                        ? 'error'
                        : 'dim'
                    }
                    size={11}
                  >
                    {resolverSettingsStatusText(resolverState)}
                  </Label>
                  <Row style={styles.wrap}>
                    <Button
                      title="Save changes"
                      small
                      disabled={resolverState.phase !== 'dirty'}
                      onPress={() => void resolverController.save(resolverTransport())}
                    />
                    <Button
                      title="Cancel / revert"
                      small
                      variant="ghost"
                      disabled={!resolverController.canCancel()}
                      onPress={() => resolverController.cancel()}
                    />
                    {resolverState.phase === 'error-reverted' ? (
                      <>
                        <Button
                          title="Retry"
                          small
                          variant="ghost"
                          onPress={() => void resolverController.retry(resolverTransport())}
                        />
                        <Button
                          title="Acknowledge"
                          small
                          variant="ghost"
                          onPress={() => void resolverController.acknowledgeAndResume()}
                        />
                      </>
                    ) : null}
                    {resolverState.phase === 'uncertain' ? (
                      <Button
                        title="Check remote value"
                        small
                        variant="ghost"
                        onPress={() =>
                          void resolverController.reconcile(() => engine.resolver.settings.get())
                        }
                      />
                    ) : null}
                  </Row>
                </>
              )}
            </Card>
          </View>

          <View style={styles.sectionGroup} onLayout={captureSection('cache')}>
            <Card>
              <View style={styles.sectionHead}>
                <View style={styles.sectionHeadCopy}>
                  <SectionTitle>Dependency cache</SectionTitle>
                  <Text style={{ color: t.text, fontSize: 20, fontWeight: '800' }}>
                    {cache?.entries ?? 0} modules
                  </Text>
                  <Label tone="dim" size={11}>
                    {formatBytes(cache?.bytes ?? 0)} on the engine host
                  </Label>
                </View>
                <Button
                  title="Clear cache"
                  small
                  variant="danger"
                  disabled={
                    !cache?.entries ||
                    ['queued', 'updating', 'uncertain'].includes(cacheClearState.phase)
                  }
                  onPress={() =>
                    void executeAction('settings:clear-resolver-cache').catch(() => undefined)
                  }
                />
              </View>
              <View role="status" accessibilityLiveRegion="polite">
                <Text
                  style={{
                    color:
                      cacheClearState.phase === 'success'
                        ? t.ok
                        : cacheClearState.phase === 'confirmed'
                          ? t.textDim
                          : t.warn,
                    fontSize: 12,
                  }}
                >
                  {resolverCacheClearStatusText(cacheClearState)}
                </Text>
              </View>
              {cacheClearState.phase === 'error-reverted' ||
              cacheClearState.phase === 'conflict' ? (
                <Row>
                  <Button
                    title="Retry clear"
                    small
                    onPress={() =>
                      void cacheClearController.retry(ownsEngine).catch(() => undefined)
                    }
                  />
                  <Button
                    title="Dismiss"
                    small
                    variant="ghost"
                    onPress={() => cacheClearController.acknowledge()}
                  />
                </Row>
              ) : null}
              {cacheClearState.phase === 'uncertain' ? (
                <Button
                  title="Check engine cache"
                  small
                  variant="ghost"
                  onPress={() =>
                    void cacheClearController.reconcile(ownsEngine).catch(() => undefined)
                  }
                />
              ) : null}
            </Card>
          </View>

          <View style={styles.sectionGroup} onLayout={captureSection('sources')}>
            <View style={styles.sectionHead}>
              <View style={styles.sectionHeadCopy}>
                <SectionTitle>Source priority</SectionTitle>
                <Label tone="dim" size={11}>
                  Engine cache is always checked first; configured external sources follow in this
                  order.
                </Label>
              </View>
              <Button
                title="Add source"
                small
                disabled={sourceCollectionBlocked}
                onPress={() => openEditor('new')}
              />
            </View>
            <Card style={styles.sourcesCard}>
              <Row>
                <Field
                  label="Test module"
                  value={testModule}
                  onChangeText={setTestModule}
                  placeholder="IF-MIB"
                />
                <Button
                  title="Refresh"
                  small
                  variant="ghost"
                  onPress={() =>
                    void refreshResolverState(engine, ownsEngine).catch(() => undefined)
                  }
                />
              </Row>
              <Label
                tone={
                  ['error-reverted', 'uncertain', 'conflict'].includes(
                    sourceCollectionState.phase,
                  ) || sourceCollectionState.readiness.phase === 'error'
                    ? 'error'
                    : sourceCollectionState.phase === 'success'
                      ? 'ok'
                      : 'dim'
                }
                size={11}
              >
                {resolverSourceCollectionStatusText(sourceCollectionState)}
              </Label>
              {['error-reverted', 'conflict'].includes(sourceCollectionState.phase) ? (
                <Button
                  title="Acknowledge and continue"
                  small
                  variant="ghost"
                  onPress={() => sourceCollectionController.acknowledge()}
                />
              ) : null}
              {['uncertain', 'conflict'].includes(sourceCollectionState.phase) ||
              sourceCollectionState.readiness.phase === 'error' ? (
                <Button
                  title="Reconcile with engine"
                  small
                  variant="ghost"
                  onPress={() => void sourceCollectionController.reconcile()}
                />
              ) : null}
              {cacheSource ? (
                <SourceRow
                  source={cacheSource}
                  first
                  last
                  testModule={testModule}
                  onEdit={() => undefined}
                />
              ) : null}
              {externalSources.map((source, index) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  first={index === 0}
                  last={index === externalSources.length - 1}
                  index={index}
                  count={externalSources.length}
                  testModule={testModule}
                  onEdit={() => openEditor(source)}
                />
              ))}
            </Card>
          </View>

          <View style={styles.sectionGroup} onLayout={captureSection('transfer')}>
            <Card>
              <SectionTitle>Import / export custom sources</SectionTitle>
              <Label tone="warn" size={11}>
                Exports are intentionally redacted. Credentials stay in the engine host secret store
                and must be entered again on another engine.
              </Label>
              <Field
                multiline
                value={configTransfer}
                onChangeText={setConfigTransfer}
                placeholder="Exported JSON appears here, or paste a configuration to import…"
              />
              <Row style={styles.wrap}>
                <Button
                  title="Generate redacted export"
                  small
                  variant="ghost"
                  onPress={() => void exportConfiguration()}
                />
                <Button
                  title="Import pasted config"
                  small
                  disabled={!configTransfer.trim() || sourceCollectionBlocked}
                  onPress={() => void importConfiguration()}
                />
              </Row>
              {transferMessage ? (
                <Label
                  tone={
                    transferMessage.startsWith('Imported') || transferMessage.startsWith('Export')
                      ? 'ok'
                      : 'error'
                  }
                  size={11}
                >
                  {transferMessage}
                </Label>
              ) : null}
            </Card>
          </View>

          <View style={styles.sectionGroup} onLayout={captureSection('activity')}>
            <Card>
              <SectionTitle>Packet capture storage</SectionTitle>
              <Label tone="dim" size={11}>
                The live console keeps a bounded RAM feed. Final packet records are also stored as
                rolling JSON Lines text up to this limit; 0 disables disk persistence.
              </Label>
              {packetRetentionReadiness.phase === 'loading' ||
              packetRetentionReadiness.phase === 'unloaded' ? (
                <Label tone="dim" size={11}>
                  Loading the authoritative packet retention status…
                </Label>
              ) : packetRetentionReadiness.phase === 'error' ? (
                <>
                  <Label tone="error" size={11}>
                    Packet retention could not be loaded. {packetRetentionReadiness.error}
                  </Label>
                  <Button
                    title="Retry loading"
                    small
                    variant="ghost"
                    onPress={() =>
                      void packetRetentionController
                        .load(() => packetRetentionLifetime.engine.packets.status())
                        .catch(() => undefined)
                    }
                  />
                </>
              ) : (
                <>
                  <Row style={styles.wrap}>
                    <Field
                      label="Retention (MiB, 0–256)"
                      value={packetRetention}
                      onChangeText={(text) => packetRetentionController.edit(text)}
                      editable={
                        !['uncertain', 'error-reverted'].includes(packetRetentionState.phase)
                      }
                      keyboardType="number-pad"
                    />
                    <Button
                      title="Save limit"
                      small
                      disabled={
                        packetRetentionState.phase !== 'dirty' || !packetRetentionValidation.valid
                      }
                      onPress={() =>
                        void packetRetentionController.save(packetRetentionTransport())
                      }
                    />
                    <Button
                      title="Cancel / revert"
                      small
                      variant="ghost"
                      disabled={!packetRetentionController.canCancel()}
                      onPress={() => packetRetentionController.cancel()}
                    />
                    {packetRetentionState.phase === 'error-reverted' ? (
                      <>
                        <Button
                          title="Retry"
                          small
                          variant="ghost"
                          onPress={() =>
                            void packetRetentionController.retry(packetRetentionTransport())
                          }
                        />
                        <Button
                          title="Acknowledge"
                          small
                          variant="ghost"
                          onPress={() => void packetRetentionController.acknowledgeAndResume()}
                        />
                      </>
                    ) : null}
                    {packetRetentionState.phase === 'uncertain' ? (
                      <Button
                        title="Check remote value"
                        small
                        variant="ghost"
                        onPress={() =>
                          void packetRetentionController.reconcile(() =>
                            packetRetentionLifetime.engine.packets.status(),
                          )
                        }
                      />
                    ) : null}
                    <Button
                      title="Open packet console"
                      small
                      variant="ghost"
                      onPress={() => useAppStore.getState().setPacketConsoleOpen(true)}
                    />
                    {authoritativePacketStatus?.persistence === 'degraded' ? (
                      <Button
                        title={
                          packetStatusOperation.phase === 'updating'
                            ? 'Retrying disk writes…'
                            : 'Retry disk writes'
                        }
                        small
                        variant="ghost"
                        disabled={packetStatusOperation.phase === 'updating'}
                        onPress={() =>
                          void packetRetentionController.runStatusOperation(
                            () => packetRetentionLifetime.engine.packets.retryPersistence(),
                            () => packetRetentionLifetime.engine.packets.status(),
                          )
                        }
                      />
                    ) : null}
                  </Row>
                  {!packetRetentionValidation.valid ? (
                    <Label tone="error" size={11}>
                      {packetRetentionValidation.reason}
                    </Label>
                  ) : null}
                  <Label
                    tone={
                      ['error-reverted', 'uncertain', 'conflict'].includes(
                        packetRetentionState.phase,
                      )
                        ? 'error'
                        : packetRetentionState.phase === 'dirty'
                          ? 'warn'
                          : ['confirmed', 'success'].includes(packetRetentionState.phase)
                            ? 'ok'
                            : 'dim'
                    }
                    size={11}
                  >
                    {packetRetentionStatusText(packetRetentionState)}
                  </Label>
                  {packetStatusOperation.phase === 'error' ||
                  packetStatusOperation.phase === 'uncertain' ? (
                    <Label tone="error" size={11}>
                      Disk-write retry {packetStatusOperation.phase}. {packetStatusOperation.error}
                    </Label>
                  ) : null}
                </>
              )}
              <Row style={styles.wrap}>
                <Pill
                  text={(authoritativePacketStatus?.persistence ?? 'loading').toUpperCase()}
                  color={
                    authoritativePacketStatus?.persistence === 'degraded'
                      ? t.error
                      : authoritativePacketStatus?.persistence === 'disabled'
                        ? t.textDim
                        : t.ok
                  }
                />
                <Label tone="dim" size={10}>
                  {((authoritativePacketStatus?.persistedBytes ?? 0) / 1024 / 1024).toFixed(2)} MiB
                  persisted
                </Label>
              </Row>
              {authoritativePacketStatus?.warning ? (
                <Label tone="error" size={11}>
                  {authoritativePacketStatus.warning}
                </Label>
              ) : null}
              <Label tone="warn" size={10}>
                Raw SNMP can contain community strings and unencrypted values. PCAPNG exports keep
                exact UDP payload bytes and mark reconstructed IP/UDP headers in packet comments.
              </Label>
            </Card>
            <Card>
              <SectionTitle>Recent resolver activity</SectionTitle>
              {!history.length ? (
                <Label tone="dim" size={12}>
                  No resolver operations yet.
                </Label>
              ) : null}
              {history.slice(0, 30).map((entry) => (
                <View
                  key={entry.handleId}
                  style={[styles.historyRow, { borderBottomColor: t.border }]}
                >
                  <Pill
                    text={entry.status}
                    color={
                      entry.status === 'done' ? t.ok : entry.status === 'partial' ? t.warn : t.error
                    }
                  />
                  <View style={{ flex: 1 }}>
                    <Mono dim size={10} numberOfLines={1}>
                      {entry.handleId}
                    </Mono>
                    <Text style={{ color: t.textDim, fontSize: 10 }}>
                      {new Date(entry.finishedAt).toLocaleString()}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          </View>

          <View style={styles.sectionGroup} onLayout={captureSection('about')}>
            <Card>
              <SectionTitle>About MIB Beacon</SectionTitle>
              <Label size={12}>Version {RELEASE_INFO.version}</Label>
              <Label tone="dim" size={11}>
                Copyright LibreStatic contributors. Licensed under {RELEASE_INFO.license}. This
                software comes with no warranty.
              </Label>
              <Row style={styles.wrap}>
                <Button
                  title="Source for this exact version"
                  small
                  variant="ghost"
                  onPress={() => void Linking.openURL(RELEASE_INFO.exactSourceUrl)}
                />
                <Button
                  title={
                    showLicenses
                      ? 'Hide dependency licenses'
                      : `Dependency licenses (${licenseInventory.packages.length})`
                  }
                  small
                  variant="ghost"
                  onPress={() => setShowLicenses((shown) => !shown)}
                />
              </Row>
              {showLicenses ? (
                <ScrollView style={styles.licenseList} nestedScrollEnabled>
                  {licenseInventory.packages.map((dependency) => (
                    <View
                      key={`${dependency.name}@${dependency.version}`}
                      style={[styles.licenseRow, { borderBottomColor: t.border }]}
                    >
                      <Mono size={10}>
                        {dependency.name}@{dependency.version}
                      </Mono>
                      <Label tone="dim" size={10}>
                        {dependency.license}
                      </Label>
                    </View>
                  ))}
                </ScrollView>
              ) : null}
              {licenseInventory.buildOnlyExceptions.length ? (
                <Label tone="dim" size={9}>
                  Build-only exclusions are recorded in the generated inventory and are not linked
                  into release applications.
                </Label>
              ) : null}
            </Card>
          </View>

          {error ? <Label tone="error">{error}</Label> : null}
          <View style={{ height: 28 }} />

          <SourceEditor
            source={editing === 'new' ? undefined : (editing ?? undefined)}
            visible={editing !== null}
            onClose={closeEditor}
          />
        </ScrollView>
      </View>
    </View>
  );
}

function toUpdatePreferenceSnapshot(
  state: { preferences: { automaticChecks: boolean }; status: HostUpdateStatus } | null | undefined,
): UpdatePreferenceSnapshot | null {
  return state
    ? { automaticChecks: state.preferences.automaticChecks, status: state.status }
    : null;
}

function SettingToggle({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const t = useTheme();
  return (
    <View style={styles.settingRow}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 13, fontWeight: '700' }}>{label}</Text>
        <Text style={{ color: t.textDim, fontSize: 11, lineHeight: 16 }}>{hint}</Text>
      </View>
      <ThemedSwitch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
      />
    </View>
  );
}

function SourceRow({
  source,
  first,
  last,
  index = 0,
  count = 1,
  testModule,
  onEdit,
}: {
  source: SourceConfig;
  first: boolean;
  last: boolean;
  index?: number;
  count?: number;
  testModule: string;
  onEdit: () => void;
}) {
  const engine = useEngine();
  const ownsEngine = useEngineOwnership();
  const t = useTheme();
  const collection = resolverSourceController(engine, ownsEngine, false);
  const collectionState = collection.snapshot();
  const blocked =
    collectionState.readiness.phase !== 'ready' ||
    ['error-reverted', 'uncertain', 'conflict'].includes(collectionState.phase);
  const sourceMutationStatus = collection.statusFor(source.id);
  const test = useAppStore((s) => s.sourceTestResults[source.id]);
  const testing = Boolean(useAppStore((s) => s.sourceTestHandles[source.id]));
  const fixedCache = source.kind === 'cache';
  const dragResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !fixedCache && !blocked,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !fixedCache && !blocked && Math.abs(gesture.dy) > 4,
        onPanResponderRelease: (_event, gesture) => {
          const rows = Math.round(gesture.dy / 64);
          if (rows !== 0) {
            void dragResolverSource(
              engine,
              source.id,
              Math.max(0, Math.min(count - 1, index + rows)),
              ownsEngine,
            ).catch(() => undefined);
          }
        },
      }),
    [blocked, count, engine, fixedCache, index, ownsEngine, source.id],
  );
  return (
    <View style={[styles.sourceRow, { borderTopColor: t.border }]}>
      <View style={styles.sourceOrder}>
        {fixedCache ? (
          <Text style={{ color: t.ok, fontSize: 15 }}>●</Text>
        ) : (
          <>
            <View
              {...dragResponder.panHandlers}
              accessible
              accessibilityLabel={`Drag ${source.name} to change source priority`}
              accessibilityHint="Drag vertically; keyboard and screen-reader users can use the arrow buttons"
              style={styles.dragHandle}
            >
              <Text style={{ color: t.textDim, fontSize: 14 }}>↕</Text>
            </View>
            <Pressable
              disabled={first || blocked}
              accessibilityRole="button"
              accessibilityLabel={`Move ${source.name} earlier`}
              accessibilityState={{ disabled: first || blocked }}
              onPress={() =>
                void moveResolverSource(engine, source.id, -1, ownsEngine).catch(() => undefined)
              }
              style={styles.reorderButton}
            >
              <Text style={{ color: first ? t.border : t.accent, fontSize: 18 }}>↑</Text>
            </Pressable>
            <Pressable
              disabled={last || blocked}
              accessibilityRole="button"
              accessibilityLabel={`Move ${source.name} later`}
              accessibilityState={{ disabled: last || blocked }}
              onPress={() =>
                void moveResolverSource(engine, source.id, 1, ownsEngine).catch(() => undefined)
              }
              style={styles.reorderButton}
            >
              <Text style={{ color: last ? t.border : t.accent, fontSize: 18 }}>↓</Text>
            </Pressable>
          </>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Row style={styles.wrap}>
          <Text style={{ color: t.text, fontSize: 13, fontWeight: '800' }}>{source.name}</Text>
          <Pill text={source.kind} />
          {source.builtIn ? <Pill text="built-in" color={t.kind.module} /> : null}
          {sourceMutationStatus ? (
            <Pill
              text={sourceMutationStatus.toUpperCase()}
              color={sourceMutationStatus === 'updating' ? t.warn : t.textDim}
            />
          ) : null}
        </Row>
        <Mono dim size={9} numberOfLines={1}>
          {sourceLocation(source)}
        </Mono>
        {source.stats ? (
          <Label tone="dim" size={9}>
            {source.stats.lastUsedAt
              ? `Last used ${new Date(source.stats.lastUsedAt).toLocaleString()}`
              : 'Never used'}
            {' · '}
            {source.stats.lastResult ?? 'No result'}
            {' · '}
            {source.stats.cacheHits} cache hits
          </Label>
        ) : null}
        {source.validationError ? (
          <Label tone="error" size={10}>
            {source.validationError}
          </Label>
        ) : null}
        {test ? (
          <View style={{ gap: 2 }}>
            <Label tone={test.ok ? 'ok' : test.state === 'started' ? 'dim' : 'error'} size={10}>
              {test.ok
                ? `Found at ${test.location ?? source.name}`
                : `${test.stage ? `${test.stage}${test.httpStatus ? ` · HTTP ${test.httpStatus}` : ''}: ` : ''}${test.message ?? test.state}`}
            </Label>
            {test.responseExcerpt ? (
              <Mono dim size={9} numberOfLines={4}>
                {test.responseExcerpt}
              </Mono>
            ) : null}
          </View>
        ) : null}
      </View>
      {fixedCache ? (
        <Pill text="ALWAYS FIRST" color={t.ok} />
      ) : (
        <ThemedSwitch
          accessibilityLabel={`Enable ${source.name}`}
          value={source.enabled}
          disabled={blocked}
          onValueChange={() =>
            void toggleResolverSource(engine, source, ownsEngine).catch(() => undefined)
          }
        />
      )}
      <View style={styles.sourceActions}>
        {source.kind !== 'cache' ? (
          <Button
            title={testing ? 'Testing…' : 'Test'}
            small
            variant="ghost"
            disabled={testing || !source.enabled || !testModule.trim()}
            onPress={() =>
              void testResolverSource(engine, source.id, testModule, ownsEngine).catch(
                () => undefined,
              )
            }
          />
        ) : null}
        {!source.builtIn ? (
          <Button title="Edit" small variant="ghost" disabled={blocked} onPress={onEdit} />
        ) : null}
      </View>
    </View>
  );
}

interface FormState {
  id: string;
  name: string;
  kind: Exclude<SourceKind, 'cache'>;
  urlTemplate: string;
  fixedExtension: string;
  modulePattern: string;
  authKind: 'none' | 'basic';
  username: string;
  password: string;
  headers: string;
  secretHeaders: string;
  storedSecretHeaders: number;
  clearStoredSecretHeaders: boolean;
  owner: string;
  repo: string;
  branch: string;
  pathPrefix: string;
  token: string;
  storedToken: boolean;
  clearStoredToken: boolean;
  refreshDays: string;
  host: string;
  port: string;
  secure: 'none' | 'ftps-explicit';
  anonymous: boolean;
  pathTemplate: string;
  catalogUrl: string;
  urlQuery: string;
  nameQuery: string;
}

function SourceEditor({
  source,
  visible,
  onClose,
}: {
  source?: SourceConfig;
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {visible ? (
        <SourceEditorBody key={source?.id ?? 'new'} source={source} onClose={onClose} />
      ) : null}
    </Modal>
  );
}

function SourceEditorBody({ source, onClose }: { source?: SourceConfig; onClose: () => void }) {
  const engine = useEngine();
  const ownsEngine = useEngineOwnership();
  const t = useTheme();
  const sourceController = resolverSourceController(engine, ownsEngine, false);
  const sourceState = useSyncExternalStore(
    (listener) => sourceController.subscribe(listener),
    () => sourceController.snapshot(),
    () => sourceController.snapshot(),
  );
  const editorBlocked = ['error-reverted', 'uncertain', 'conflict'].includes(sourceState.phase);
  const [form, setForm] = useState<FormState>(() => sourceToForm(source));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failedOperation, setFailedOperation] = useState<'save' | 'delete'>('save');
  const [localCommand, setLocalCommand] = useState<string | null>(null);
  const previewing = Boolean(useAppStore((state) => state.sourcePreviewHandle));
  const catalogPreview = useAppStore((state) => state.sourcePreview);
  const editorRecovery = resolverSourceEditorRecovery(
    sourceState,
    localCommand,
    Boolean(error),
    saving,
  );
  const patch = (next: Partial<FormState>) => {
    void cancelResolverSourcePreview(engine, ownsEngine).catch(() => undefined);
    setForm((current) => ({ ...current, ...next }));
  };

  const save = async (retry = false) => {
    setSaving(true);
    setFailedOperation('save');
    setLocalCommand(source ? `update:${source.id}` : 'create');
    setError(null);
    try {
      await saveResolverSource(
        engine,
        buildSourceDraft(form, source),
        source?.id,
        ownsEngine,
        retry,
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const previewCatalog = async () => {
    setError(null);
    try {
      const draft = buildSourceDraft(form, source);
      if (draft.config.kind !== 'json-catalog')
        throw new Error('Preview is available for JSON catalogs only.');
      await previewResolverSource(engine, draft, ownsEngine);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const remove = async (retry = false) => {
    if (!source) return;
    setSaving(true);
    setFailedOperation('delete');
    setLocalCommand(`remove:${source.id}`);
    setError(null);
    try {
      await removeResolverSource(engine, source.id, ownsEngine, retry);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.editorRoot, { backgroundColor: t.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.editorHead, { borderBottomColor: t.border }]}>
        <View>
          <SectionTitle>{source ? 'Edit custom source' : 'New custom source'}</SectionTitle>
          <Text style={[styles.editorTitle, { color: t.text }]}>
            {source?.name ?? 'Connect a catalog'}
          </Text>
        </View>
        <Button title="Close" small variant="ghost" onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={styles.editorContent} keyboardShouldPersistTaps="handled">
        {!source ? (
          <Row style={styles.wrap}>
            {CUSTOM_KINDS.map((item) => (
              <Chip
                key={item.kind}
                label={item.label}
                active={form.kind === item.kind}
                onPress={() => patch({ kind: item.kind })}
              />
            ))}
          </Row>
        ) : null}
        <Row>
          <Field
            label="Source ID"
            value={form.id}
            editable={!source}
            onChangeText={(id) => patch({ id })}
            placeholder="lab-catalog"
          />
          <Field label="Display name" value={form.name} onChangeText={(name) => patch({ name })} />
        </Row>

        {form.kind === 'http-template' ? (
          <>
            <Field
              label="URL template"
              value={form.urlTemplate}
              onChangeText={(urlTemplate) => patch({ urlTemplate })}
              placeholder="https://example/mibs/@mib@"
            />
            <Row>
              <Field
                label="Fixed extension"
                value={form.fixedExtension}
                onChangeText={(fixedExtension) => patch({ fixedExtension })}
                placeholder=".mib"
              />
              <Field
                label="Module regex (optional)"
                value={form.modulePattern}
                onChangeText={(modulePattern) => patch({ modulePattern })}
              />
            </Row>
            <HttpAuthFields form={form} patch={patch} />
          </>
        ) : null}

        {form.kind === 'ftp' ? (
          <>
            <Row>
              <Field label="Host" value={form.host} onChangeText={(host) => patch({ host })} />
              <Field
                label="Port"
                keyboardType="number-pad"
                value={form.port}
                onChangeText={(port) => patch({ port })}
                placeholder={form.secure === 'ftps-explicit' ? '21' : '21'}
              />
            </Row>
            <Row style={styles.wrap}>
              <Chip
                label="FTP"
                active={form.secure === 'none'}
                onPress={() => patch({ secure: 'none' })}
              />
              <Chip
                label="Explicit FTPS"
                active={form.secure === 'ftps-explicit'}
                onPress={
                  Platform.OS === 'web' ? () => patch({ secure: 'ftps-explicit' }) : undefined
                }
              />
              <Chip
                label="Anonymous"
                active={form.anonymous}
                onPress={() => patch({ anonymous: !form.anonymous })}
              />
            </Row>
            {Platform.OS !== 'web' ? (
              <Label tone="error" size={10}>
                Explicit FTPS is unavailable on mobile because certificate and hostname verification
                is not supported. Use FTP or configure this source on a Node/Electron engine host.
              </Label>
            ) : null}
            {!form.anonymous ? (
              <Row>
                <Field
                  label="Username"
                  value={form.username}
                  onChangeText={(username) => patch({ username })}
                />
                <Field
                  label="Password"
                  secureTextEntry
                  value={form.password}
                  onChangeText={(password) => patch({ password })}
                  placeholder={source && 'Leave blank to keep existing'}
                />
              </Row>
            ) : null}
            <Field
              label="Path template"
              value={form.pathTemplate}
              onChangeText={(pathTemplate) => patch({ pathTemplate })}
              placeholder="/pub/mibs/@mib@"
            />
            <Field
              label="Fixed extension"
              value={form.fixedExtension}
              onChangeText={(fixedExtension) => patch({ fixedExtension })}
              placeholder=".mib"
            />
          </>
        ) : null}

        {form.kind === 'json-catalog' ? (
          <>
            <Field
              label="Catalog URL"
              value={form.catalogUrl}
              onChangeText={(catalogUrl) => patch({ catalogUrl })}
            />
            <Field
              label="URL JSONPath"
              value={form.urlQuery}
              onChangeText={(urlQuery) => patch({ urlQuery })}
              placeholder="$.modules[*].url"
            />
            <Field
              label="Name JSONPath (optional)"
              value={form.nameQuery}
              onChangeText={(nameQuery) => patch({ nameQuery })}
              placeholder="$.modules[*].name"
            />
            <Field
              label="Index refresh days"
              keyboardType="number-pad"
              value={form.refreshDays}
              onChangeText={(refreshDays) => patch({ refreshDays })}
            />
            <HttpAuthFields form={form} patch={patch} />
            <Button
              title={previewing ? 'Fetching preview…' : 'Preview catalog mapping'}
              small
              variant="ghost"
              disabled={previewing || saving}
              onPress={() => void previewCatalog()}
            />
            <Label tone="dim" size={11}>
              Preview uses the live catalog endpoint without saving this source.
            </Label>
            {catalogPreview?.error ? (
              <Label tone="error" size={11}>
                {catalogPreview.error}
              </Label>
            ) : null}
            {catalogPreview?.result ? (
              <Card>
                <SectionTitle>Live catalog preview</SectionTitle>
                {catalogPreview.result.entries.slice(0, 20).map((entry) => (
                  <View key={`${entry.name}-${entry.url}`} style={{ gap: 2 }}>
                    <Mono size={11}>{entry.name}</Mono>
                    <Mono dim size={9} numberOfLines={1}>
                      {entry.url}
                    </Mono>
                  </View>
                ))}
                {!catalogPreview.result.entries.length ? (
                  <Label tone="dim" size={11}>
                    The catalog returned no mapped entries.
                  </Label>
                ) : null}
                {catalogPreview.result.rawSnippet ? (
                  <View style={styles.rawSnippet}>
                    <Label tone="dim" size={10}>
                      RAW JSON SNIPPET (FIRST 4 KIB)
                    </Label>
                    <Mono dim size={9}>
                      {catalogPreview.result.rawSnippet}
                    </Mono>
                  </View>
                ) : null}
              </Card>
            ) : null}
          </>
        ) : null}

        {form.kind === 'github-tree' ? (
          <>
            <Row>
              <Field label="Owner" value={form.owner} onChangeText={(owner) => patch({ owner })} />
              <Field
                label="Repository"
                value={form.repo}
                onChangeText={(repo) => patch({ repo })}
              />
            </Row>
            <Row>
              <Field
                label="Branch"
                value={form.branch}
                onChangeText={(branch) => patch({ branch })}
              />
              <Field
                label="Path prefix"
                value={form.pathPrefix}
                onChangeText={(pathPrefix) => patch({ pathPrefix })}
              />
            </Row>
            <Field
              label="GitHub token (optional)"
              secureTextEntry
              value={form.token}
              onChangeText={(token) => patch({ token, clearStoredToken: false })}
              placeholder={
                form.storedToken && !form.clearStoredToken
                  ? 'Stored securely · leave blank to keep'
                  : 'Optional token'
              }
            />
            {form.storedToken ? (
              <Row style={styles.wrap}>
                <Pill
                  text={form.clearStoredToken ? 'TOKEN WILL BE CLEARED' : 'TOKEN STORED'}
                  color={form.clearStoredToken ? t.warn : t.ok}
                />
                <Button
                  title={form.clearStoredToken ? 'Keep stored token' : 'Clear stored token'}
                  small
                  variant="ghost"
                  onPress={() => patch({ clearStoredToken: !form.clearStoredToken, token: '' })}
                />
              </Row>
            ) : null}
            <Field
              label="Tree refresh days"
              keyboardType="number-pad"
              value={form.refreshDays}
              onChangeText={(refreshDays) => patch({ refreshDays })}
            />
          </>
        ) : null}

        {error ? <Label tone="error">{error}</Label> : null}
        {editorBlocked ? (
          <Label tone="error" size={11}>
            {resolverSourceCollectionStatusText(sourceState)}
          </Label>
        ) : null}
        {editorRecovery === 'retry-local' ? (
          <Row style={styles.wrap}>
            <Button
              title="Acknowledge"
              small
              variant="ghost"
              onPress={() => sourceController.acknowledge()}
            />
            <Button
              title="Retry rejected change"
              small
              onPress={() => {
                sourceController.prepareRetry();
                if (failedOperation === 'delete') void remove(true);
                else void save(true);
              }}
            />
          </Row>
        ) : null}
        {editorRecovery === 'acknowledge-queued' ? (
          <Button
            title="Acknowledge and resume queued save"
            small
            variant="ghost"
            onPress={() => sourceController.acknowledge()}
          />
        ) : null}
        {editorRecovery === 'reconcile' ? (
          <Button
            title="Reconcile with engine"
            small
            variant="ghost"
            onPress={() => void sourceController.reconcile().catch(() => undefined)}
          />
        ) : null}
        <Button
          title={saving ? 'Saving…' : 'Save source'}
          disabled={saving || editorBlocked}
          onPress={() => void save()}
        />
        {source && !source.builtIn ? (
          <Button
            title={saving ? 'Working…' : 'Delete source'}
            variant="danger"
            disabled={saving || editorBlocked}
            onPress={() => void remove()}
          />
        ) : null}
        <View style={{ height: 28 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function HttpAuthFields({
  form,
  patch,
}: {
  form: FormState;
  patch: (next: Partial<FormState>) => void;
}) {
  const t = useTheme();
  return (
    <>
      <Row style={styles.wrap}>
        <Chip
          label="No authentication"
          active={form.authKind === 'none'}
          onPress={() => patch({ authKind: 'none' })}
        />
        <Chip
          label="Basic authentication"
          active={form.authKind === 'basic'}
          onPress={() => patch({ authKind: 'basic' })}
        />
      </Row>
      {form.authKind === 'basic' ? (
        <Row>
          <Field
            label="Username"
            value={form.username}
            onChangeText={(username) => patch({ username })}
          />
          <Field
            label="Password"
            secureTextEntry
            value={form.password}
            onChangeText={(password) => patch({ password })}
            placeholder="Leave blank to keep existing"
          />
        </Row>
      ) : null}
      <Field
        label="Public headers (JSON)"
        multiline
        value={form.headers}
        onChangeText={(headers) => patch({ headers })}
        placeholder={'{"Accept":"text/plain"}'}
      />
      <Field
        label="Secret headers (JSON)"
        multiline
        secureTextEntry
        value={form.secretHeaders}
        onChangeText={(secretHeaders) => patch({ secretHeaders, clearStoredSecretHeaders: false })}
        placeholder={
          form.storedSecretHeaders && !form.clearStoredSecretHeaders
            ? `${form.storedSecretHeaders} secret header(s) stored · enter JSON to replace`
            : '{"Authorization":"Bearer …"}'
        }
      />
      {form.storedSecretHeaders ? (
        <Row style={styles.wrap}>
          <Pill
            text={
              form.clearStoredSecretHeaders
                ? 'HEADERS WILL BE CLEARED'
                : `${form.storedSecretHeaders} SECRET HEADER(S) STORED`
            }
            color={form.clearStoredSecretHeaders ? t.warn : t.ok}
          />
          <Button
            title={form.clearStoredSecretHeaders ? 'Keep stored headers' : 'Clear stored headers'}
            small
            variant="ghost"
            onPress={() =>
              patch({ clearStoredSecretHeaders: !form.clearStoredSecretHeaders, secretHeaders: '' })
            }
          />
        </Row>
      ) : null}
    </>
  );
}

function sourceToForm(source?: SourceConfig): FormState {
  const shared = {
    id: source?.id ?? '',
    name: source?.name ?? '',
    kind: source?.kind === 'cache' || !source ? ('http-template' as const) : source.kind,
    urlTemplate: '',
    fixedExtension: '',
    modulePattern: '',
    authKind: 'none' as const,
    username: '',
    password: '',
    headers: '',
    secretHeaders: '',
    storedSecretHeaders: 0,
    clearStoredSecretHeaders: false,
    owner: '',
    repo: '',
    branch: 'main',
    pathPrefix: '',
    token: '',
    storedToken: false,
    clearStoredToken: false,
    refreshDays: '7',
    host: '',
    port: '',
    secure: 'none' as const,
    anonymous: true,
    pathTemplate: '',
    catalogUrl: '',
    urlQuery: '$.modules[*].url',
    nameQuery: '$.modules[*].name',
  };
  if (!source || source.kind === 'cache') return shared;
  if (source.kind === 'http-template')
    return {
      ...shared,
      kind: source.kind,
      urlTemplate: source.urlTemplate,
      fixedExtension: source.fixedExtension ?? '',
      modulePattern: source.modulePattern ?? '',
      authKind: source.authKind,
      username: source.username ?? '',
      headers: jsonOrBlank(source.headers),
      storedSecretHeaders: Object.keys(source.secretHeaders ?? {}).length,
    };
  if (source.kind === 'github-tree')
    return {
      ...shared,
      kind: source.kind,
      owner: source.owner,
      repo: source.repo,
      branch: source.branch,
      pathPrefix: source.pathPrefix ?? '',
      refreshDays: String(source.refreshDays ?? 7),
      storedToken: Boolean(source.tokenRef),
    };
  if (source.kind === 'json-catalog')
    return {
      ...shared,
      kind: source.kind,
      catalogUrl: source.catalogUrl,
      urlQuery: source.urlQuery,
      nameQuery: source.nameQuery ?? '',
      refreshDays: String(source.refreshDays ?? 7),
      authKind: source.authKind,
      username: source.username ?? '',
      headers: jsonOrBlank(source.headers),
      storedSecretHeaders: Object.keys(source.secretHeaders ?? {}).length,
    };
  return {
    ...shared,
    kind: source.kind,
    host: source.host,
    port: source.port ? String(source.port) : '',
    secure: source.secure,
    anonymous: source.anonymous,
    username: source.username ?? '',
    pathTemplate: source.pathTemplate,
    fixedExtension: source.fixedExtension ?? '',
  };
}

function buildSourceDraft(form: FormState, source?: SourceConfig): ResolverSourceDraft {
  const id = slug(form.id || form.name);
  if (!id || !form.name.trim()) throw new Error('Source ID and name are required.');
  const base = {
    id,
    name: form.name.trim(),
    enabled: source?.enabled ?? true,
    priority: source?.priority ?? 0,
    builtIn: false,
  };
  const secrets: ResolverSourceDraft['secrets'] = {};
  if (form.password) secrets.password = form.password;
  if (form.token) secrets.token = form.token;
  const secretHeaders = parseHeaders(form.secretHeaders);
  if (Object.keys(secretHeaders).length) secrets.headers = secretHeaders;
  const clearSecrets: NonNullable<ResolverSourceDraft['clearSecrets']> = [];
  if (form.clearStoredToken) clearSecrets.push('token');
  if (form.clearStoredSecretHeaders) clearSecrets.push('headers');
  let config: SourceConfig;
  if (form.kind === 'http-template') {
    if (!form.urlTemplate.includes('@mib@'))
      throw new Error('HTTP URL template must contain @mib@.');
    config = {
      ...base,
      kind: form.kind,
      urlTemplate: form.urlTemplate.trim(),
      authKind: form.authKind,
      username: form.username.trim() || undefined,
      fixedExtension: form.fixedExtension.trim() || undefined,
      modulePattern: form.modulePattern.trim() || undefined,
      headers: parseHeaders(form.headers),
    };
  } else if (form.kind === 'ftp') {
    if (!form.host.trim() || !form.pathTemplate.includes('@mib@'))
      throw new Error('FTP host and a path containing @mib@ are required.');
    if (Platform.OS !== 'web' && form.secure === 'ftps-explicit')
      throw new Error(
        'Explicit FTPS is unavailable on mobile because certificate and hostname verification is not supported.',
      );
    config = {
      ...base,
      kind: form.kind,
      host: form.host.trim(),
      port: numberOrUndefined(form.port),
      secure: form.secure,
      anonymous: form.anonymous,
      username: form.anonymous ? undefined : form.username.trim(),
      pathTemplate: form.pathTemplate.trim(),
      fixedExtension: form.fixedExtension.trim() || undefined,
    };
  } else if (form.kind === 'json-catalog') {
    if (!form.catalogUrl.trim() || !form.urlQuery.trim())
      throw new Error('Catalog URL and URL JSONPath are required.');
    config = {
      ...base,
      kind: form.kind,
      catalogUrl: form.catalogUrl.trim(),
      urlQuery: form.urlQuery.trim(),
      nameQuery: form.nameQuery.trim() || undefined,
      refreshDays: numberOrUndefined(form.refreshDays),
      authKind: form.authKind,
      username: form.username.trim() || undefined,
      headers: parseHeaders(form.headers),
    };
  } else {
    if (!form.owner.trim() || !form.repo.trim() || !form.branch.trim())
      throw new Error('GitHub owner, repository, and branch are required.');
    config = {
      ...base,
      kind: form.kind,
      owner: form.owner.trim(),
      repo: form.repo.trim(),
      branch: form.branch.trim(),
      pathPrefix: form.pathPrefix.trim() || undefined,
      refreshDays: numberOrUndefined(form.refreshDays),
    };
  }
  return {
    config,
    ...(Object.keys(secrets).length ? { secrets } : {}),
    ...(clearSecrets.length ? { clearSecrets } : {}),
  };
}

function parseHeaders(value: string): Record<string, string> {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (
    !parsed ||
    Array.isArray(parsed) ||
    typeof parsed !== 'object' ||
    Object.values(parsed).some((item) => typeof item !== 'string')
  )
    throw new Error('Headers must be a JSON object with string values.');
  return parsed as Record<string, string>;
}

function jsonOrBlank(value?: Record<string, string>): string {
  return value && Object.keys(value).length ? JSON.stringify(value, null, 2) : '';
}
function numberOrUndefined(value: string): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : undefined;
}
function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
function formatBytes(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
function sourceLocation(source: SourceConfig): string {
  if (source.kind === 'cache') return 'Private content-addressed engine cache';
  if (source.kind === 'http-template') return source.urlTemplate;
  if (source.kind === 'github-tree')
    return `github.com/${source.owner}/${source.repo}/${source.branch}/${source.pathPrefix ?? ''}`;
  if (source.kind === 'json-catalog') return `${source.catalogUrl} · ${source.urlQuery}`;
  return `${source.secure === 'ftps-explicit' ? 'ftps' : 'ftp'}://${source.host}${source.pathTemplate}`;
}

const styles = StyleSheet.create({
  workspace: { flex: 1, minWidth: 0, minHeight: 0 },
  settingsBody: { flex: 1, minWidth: 0, minHeight: 0 },
  desktopSettingsBody: { flexDirection: 'row' },
  settingsStrip: { flexGrow: 0, borderBottomWidth: 1 },
  settingsStripContent: { paddingHorizontal: 10, paddingVertical: 7, gap: 6 },
  settingsIndex: {
    width: 176,
    borderRightWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 7,
  },
  settingsIndexItem: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 },
  settingsIndexItemCompact: { paddingVertical: 7, minWidth: 130 },
  screen: { flex: 1 },
  content: { padding: 12, gap: 12 },
  patternColorRow: { alignItems: 'center' },
  patternColorPreview: { width: 32, height: 32, borderRadius: 16, borderWidth: 1 },
  desktopContent: {
    width: '100%',
    maxWidth: 980,
    alignSelf: 'center',
    padding: 18,
    paddingBottom: 38,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  heroCopy: { flex: 1, minWidth: 0 },
  heroTitle: { fontSize: 21, fontWeight: '900', letterSpacing: -0.4 },
  sectionGroup: { gap: 12 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  sectionHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minWidth: 0,
  },
  sectionHeadCopy: { flex: 1, minWidth: 180, flexShrink: 1 },
  wrap: { flexWrap: 'wrap' },
  themeInstallList: { gap: 7 },
  themeInstallRow: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  themeInstallCopy: { flex: 1, minWidth: 180, gap: 2 },
  themeCatalog: { gap: 8 },
  themeCatalogRow: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  sourcesCard: { paddingTop: 8 },
  sourceRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  sourceOrder: { width: 28, alignItems: 'center' },
  dragHandle: { paddingHorizontal: 5, paddingVertical: 2 },
  reorderButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  sourceActions: { flexDirection: 'row', gap: 5, marginLeft: 30 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rawSnippet: {
    maxHeight: 180,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(127,127,127,0.08)',
  },
  licenseList: { maxHeight: 360 },
  licenseRow: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 5, gap: 1 },
  editorRoot: { flex: 1 },
  editorHead: {
    paddingTop: Platform.OS === 'ios' ? 52 : 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editorTitle: { fontSize: 19, fontWeight: '900' },
  editorContent: { padding: 14, gap: 11 },
});
