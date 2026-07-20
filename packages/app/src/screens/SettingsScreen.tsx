import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  Button,
  Card,
  Chip,
  Field,
  Label,
  Mono,
  Pill,
  Row,
  SectionTitle,
  useTheme,
} from '@mibbeacon/ui';
import type { ResolverSourceDraft, SourceConfig, SourceKind } from '@mibbeacon/core/client';
import { useEngine } from '../engine-context';
import { useAppStore } from '../store';
import {
  clearResolverCache,
  dragResolverSource,
  moveResolverSource,
  previewResolverSource,
  refreshResolverState,
  removeResolverSource,
  saveResolverSource,
  testResolverSource,
  toggleResolverSource,
  updateResolverSettings,
} from '../actions';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { useResponsiveLayout } from '../responsive-context';
import type { AppHostAdapter, HostUpdateStatus } from '../AppRoot';
import { RELEASE_INFO } from '../generated/release-info';
import licenseInventory from '../generated/third-party-licenses.json';
import {
  DEFAULT_PATTERN_TRACE_COLOR,
  isPatternTraceColor,
} from '../pattern-trace-settings';
import {
  getActiveSettingsSection,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
  type SettingsSectionOffsets,
} from '../settings-navigation';

const CUSTOM_KINDS: { kind: Exclude<SourceKind, 'cache'>; label: string }[] = [
  { kind: 'http-template', label: 'HTTP template' },
  { kind: 'ftp', label: 'FTP / FTPS' },
  { kind: 'json-catalog', label: 'JSON catalog' },
  { kind: 'github-tree', label: 'GitHub tree' },
];

export function SettingsScreen({ host }: { host?: AppHostAdapter }) {
  const engine = useEngine();
  const t = useTheme();
  const { mode, supportsSplitView } = useResponsiveLayout();
  const settings = useAppStore((s) => s.resolverSettings);
  const sources = useAppStore((s) => s.resolverSources);
  const cache = useAppStore((s) => s.resolverCache);
  const history = useAppStore((s) => s.resolverHistory);
  const error = useAppStore((s) => s.resolverError);
  const themeMode = useAppStore((s) => s.themeMode);
  const densityMode = useAppStore((s) => s.densityMode);
  const patternTraceColor = useAppStore((s) => s.patternTraceColor);
  const packetStatus = useAppStore((s) => s.packetStatus);
  const [editing, setEditing] = useState<SourceConfig | 'new' | null>(null);
  const [testModule, setTestModule] = useState('IF-MIB');
  const [configTransfer, setConfigTransfer] = useState('');
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('appearance');
  const [updateStatus, setUpdateStatus] = useState<HostUpdateStatus | null>(null);
  const [automaticChecks, setAutomaticChecks] = useState(false);
  const [showLicenses, setShowLicenses] = useState(false);
  const [packetRetention, setPacketRetention] = useState('32');
  const [packetMessage, setPacketMessage] = useState<string | null>(null);
  const [patternTraceColorDraft, setPatternTraceColorDraft] = useState(patternTraceColor);
  const settingsScroll = useRef<ScrollView>(null);
  const sectionOffsets = useRef<SettingsSectionOffsets>({});
  const cacheSource = sources.find((source) => source.kind === 'cache');
  const externalSources = sources.filter((source) => source.kind !== 'cache');
  useEffect(() => {
    if (!host?.updates) return;
    let active = true;
    void host.updates.get().then((state) => {
      if (!active || !state) return;
      setAutomaticChecks(state.preferences.automaticChecks);
      setUpdateStatus(state.status);
    });
    const unsubscribe = host.updates.onStatus((status) => {
      if (active) setUpdateStatus(status);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [host]);
  useEffect(() => {
    if (packetStatus) setPacketRetention(String(packetStatus.retentionMiB));
  }, [packetStatus]);
  useEffect(() => setPatternTraceColorDraft(patternTraceColor), [patternTraceColor]);
  const savePacketRetention = async () => {
    const value = Number(packetRetention);
    if (!Number.isInteger(value) || value < 0 || value > 256) {
      setPacketMessage('Enter a whole number from 0 through 256 MiB.');
      return;
    }
    try {
      const status = await engine.packets.updateSettings({ retentionMiB: value });
      useAppStore.getState().setPacketStatus(status);
      setPacketMessage(value === 0 ? 'Disk persistence disabled; live RAM capture remains active.' : `Packet history retention set to ${value} MiB.`);
    } catch (cause) {
      setPacketMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const clearPreview = () => {
    const state = useAppStore.getState();
    if (state.sourcePreviewHandle) void engine.resolver.cancel(state.sourcePreviewHandle);
    state.clearSourcePreview();
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
      await engine.resolver.sources.importCustom(configTransfer);
      await refreshResolverState(engine);
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
          actions={
            <Pill
              text={settings?.enabled ? 'ONLINE' : 'DISABLED'}
              color={settings?.enabled ? t.ok : t.textDim}
            />
          }
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
              <Label size={11}>Theme</Label>
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
          <View style={styles.sectionGroup} onLayout={captureSection('updates')}>
            <Card>
              <SectionTitle>Desktop updates</SectionTitle>
              {host?.updates ? (
                <>
                  <SettingToggle
                    label="Check for updates automatically"
                    hint="Off by default. Enabling this permits packaged desktop builds to contact GitHub Releases after startup."
                    value={automaticChecks}
                    onChange={(enabled) => {
                      setAutomaticChecks(enabled);
                      void host.updates?.setAutomaticChecks(enabled).then((state) => {
                        if (state) setUpdateStatus(state.status);
                      });
                    }}
                  />
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
                      onPress={() =>
                        void host.updates
                          ?.check()
                          .then((status) => status && setUpdateStatus(status))
                      }
                    />
                    {updateStatus?.phase === 'available' ? (
                      <Button
                        title="Download update"
                        small
                        onPress={() =>
                          void host.updates
                            ?.download()
                            .then((status) => status && setUpdateStatus(status))
                        }
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
          <View style={styles.sectionGroup} onLayout={captureSection('privacy')}>
            <View style={styles.hero}>
              <View style={styles.heroCopy}>
                <Text style={[styles.heroTitle, { color: t.text }]}>Resolver control room</Text>
                <Text style={{ color: t.textDim, fontSize: 12 }}>
                  Privacy, source order, cache, and external evidence
                </Text>
              </View>
              <Pill
                text={settings?.enabled ? 'ONLINE' : 'DISABLED'}
                color={settings?.enabled ? t.ok : t.textDim}
              />
            </View>

            <Card>
              <SectionTitle>Privacy & automation</SectionTitle>
              <SettingToggle
                label="Enable resolver"
                hint="Allow cache and configured sources to resolve modules."
                value={settings?.enabled ?? false}
                onChange={(enabled) => void updateResolverSettings(engine, { enabled })}
              />
              <SettingToggle
                label="Resolve missing imports automatically"
                hint="Runs only after a local import reports missing dependencies."
                value={settings?.autoResolveImports ?? false}
                disabled={!settings?.enabled}
                onChange={(autoResolveImports) =>
                  void updateResolverSettings(engine, { autoResolveImports })
                }
              />
              <View style={styles.settingRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: t.text, fontSize: 13, fontWeight: '700' }}>
                    External access consent
                  </Text>
                  <Text style={{ color: t.textDim, fontSize: 11, lineHeight: 16 }}>
                    Consent can only be remembered from the disclosure prompt. Revoke it here at any
                    time.
                  </Text>
                </View>
                {settings?.externalConsentRemembered ? (
                  <Button
                    title="Revoke"
                    small
                    variant="danger"
                    onPress={() =>
                      void updateResolverSettings(engine, { externalConsentRemembered: false })
                    }
                  />
                ) : (
                  <Pill text="ASK EVERY TIME" color={t.textDim} />
                )}
              </View>
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
                  disabled={!cache?.entries}
                  onPress={() => void clearResolverCache(engine)}
                />
              </View>
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
              <Button title="Add source" small onPress={() => openEditor('new')} />
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
                  onPress={() => void refreshResolverState(engine)}
                />
              </Row>
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
                  disabled={!configTransfer.trim()}
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
              <Row style={styles.wrap}>
                <Field
                  label="Retention (MiB, 0–256)"
                  value={packetRetention}
                  onChangeText={setPacketRetention}
                  keyboardType="number-pad"
                />
                <Button title="Save limit" small onPress={() => void savePacketRetention()} />
                <Button
                  title="Open packet console"
                  small
                  variant="ghost"
                  onPress={() => useAppStore.getState().setPacketConsoleOpen(true)}
                />
                {packetStatus?.persistence === 'degraded' ? (
                  <Button
                    title="Retry disk writes"
                    small
                    variant="ghost"
                    onPress={() =>
                      void engine.packets.retryPersistence().then((status) => {
                        useAppStore.getState().setPacketStatus(status);
                        setPacketMessage(status.warning ?? 'Packet persistence is active again.');
                      })
                    }
                  />
                ) : null}
              </Row>
              <Row style={styles.wrap}>
                <Pill
                  text={(packetStatus?.persistence ?? 'loading').toUpperCase()}
                  color={
                    packetStatus?.persistence === 'degraded'
                      ? t.error
                      : packetStatus?.persistence === 'disabled'
                        ? t.textDim
                        : t.ok
                  }
                />
                <Label tone="dim" size={10}>
                  {((packetStatus?.persistedBytes ?? 0) / 1024 / 1024).toFixed(2)} MiB persisted
                </Label>
              </Row>
              {packetStatus?.warning ? <Label tone="error" size={11}>{packetStatus.warning}</Label> : null}
              {packetMessage ? (
                <Label tone={packetMessage.includes('Enter') ? 'error' : 'ok'} size={11}>
                  {packetMessage}
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
    <View style={[styles.settingRow, { opacity: disabled ? 0.5 : 1 }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 13, fontWeight: '700' }}>{label}</Text>
        <Text style={{ color: t.textDim, fontSize: 11, lineHeight: 16 }}>{hint}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: t.accent }}
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
  const t = useTheme();
  const test = useAppStore((s) => s.sourceTestResults[source.id]);
  const testing = Boolean(useAppStore((s) => s.sourceTestHandles[source.id]));
  const fixedCache = source.kind === 'cache';
  const dragResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !fixedCache,
        onMoveShouldSetPanResponder: (_event, gesture) => !fixedCache && Math.abs(gesture.dy) > 4,
        onPanResponderRelease: (_event, gesture) => {
          const rows = Math.round(gesture.dy / 64);
          if (rows !== 0) {
            void dragResolverSource(
              engine,
              source.id,
              Math.max(0, Math.min(count - 1, index + rows)),
            );
          }
        },
      }),
    [count, engine, fixedCache, index, source.id],
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
              disabled={first}
              accessibilityRole="button"
              accessibilityLabel={`Move ${source.name} earlier`}
              accessibilityState={{ disabled: first }}
              onPress={() => void moveResolverSource(engine, source.id, -1)}
              style={styles.reorderButton}
            >
              <Text style={{ color: first ? t.border : t.accent, fontSize: 18 }}>↑</Text>
            </Pressable>
            <Pressable
              disabled={last}
              accessibilityRole="button"
              accessibilityLabel={`Move ${source.name} later`}
              accessibilityState={{ disabled: last }}
              onPress={() => void moveResolverSource(engine, source.id, 1)}
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
        <Switch
          accessibilityLabel={`Enable ${source.name}`}
          value={source.enabled}
          onValueChange={() => void toggleResolverSource(engine, source)}
          trackColor={{ true: t.accent }}
        />
      )}
      <View style={styles.sourceActions}>
        {source.kind !== 'cache' ? (
          <Button
            title={testing ? 'Testing…' : 'Test'}
            small
            variant="ghost"
            disabled={testing || !source.enabled || !testModule.trim()}
            onPress={() => void testResolverSource(engine, source.id, testModule)}
          />
        ) : null}
        {!source.builtIn ? <Button title="Edit" small variant="ghost" onPress={onEdit} /> : null}
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
  const t = useTheme();
  const [form, setForm] = useState<FormState>(() => sourceToForm(source));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const previewing = Boolean(useAppStore((state) => state.sourcePreviewHandle));
  const catalogPreview = useAppStore((state) => state.sourcePreview);
  const patch = (next: Partial<FormState>) => {
    const state = useAppStore.getState();
    if (state.sourcePreviewHandle) void engine.resolver.cancel(state.sourcePreviewHandle);
    state.clearSourcePreview();
    setForm((current) => ({ ...current, ...next }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveResolverSource(engine, buildSourceDraft(form, source), source?.id);
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
      await previewResolverSource(engine, draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const remove = async () => {
    if (!source) return;
    setSaving(true);
    setError(null);
    try {
      await removeResolverSource(engine, source.id);
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
        <Button
          title={saving ? 'Saving…' : 'Save source'}
          disabled={saving}
          onPress={() => void save()}
        />
        {source && !source.builtIn ? (
          <Button
            title={saving ? 'Working…' : 'Delete source'}
            variant="danger"
            disabled={saving}
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
