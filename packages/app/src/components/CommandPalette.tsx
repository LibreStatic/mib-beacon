import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextInput,
} from 'react-native';
import { Card, Field, KindGlyph, Mono, Pill, Text, useTheme } from '@mibbeacon/ui';
import type { ThemeDescriptor } from '@mibbeacon/ui/theme-values';
import type { MibNodeKind, MibSearchHit } from '@mibbeacon/core/client';
import type { AppAction } from '../action-registry';
import { MibObjectNotFoundError } from '../actions';
import {
  PaletteHistoryController,
  buildPaletteEntries,
  parsePaletteQuery,
  validatePaletteRecentOids,
  type PaletteEntry,
  type PaletteHistoryStorage,
  type PaletteRecentItem,
} from '../command-palette';
import { useEngine } from '../engine-context';
import {
  downloadOpenVsxTheme,
  searchOpenVsxThemes,
  type OpenVsxThemeListing,
} from '../open-vsx-themes';
import {
  buildThemeQuickPickEntries,
  resolveThemePressIntent,
  shouldPreviewBeforeThemeApply,
  type ThemeQuickPickEntry,
} from '../theme-quick-pick';

export type CommandPaletteView = 'commands' | 'theme-picker' | 'theme-catalog';

type LiveOidEntry = {
  key: `oid:${string}`;
  kind: 'oid';
  section: 'Objects';
  item: Extract<PaletteRecentItem, { kind: 'oid' }>;
  recent: false;
};

type DisplayEntry = PaletteEntry | LiveOidEntry;

interface CommandPaletteProps {
  visible: boolean;
  commands: readonly AppAction[];
  historyStorage?: PaletteHistoryStorage;
  shortcutHint: string;
  view: CommandPaletteView;
  themes: readonly ThemeDescriptor[];
  currentThemeIds: { light: string; dark: string };
  openVsxEnabled: boolean;
  onClose: () => void;
  onViewChange: (view: CommandPaletteView) => void;
  onExecute: (command: AppAction) => boolean | void | Promise<boolean | void>;
  onOpenOid: (oid: string) => Promise<void>;
  onPreviewTheme: (theme: ThemeDescriptor) => void;
  onClearThemePreview: () => void;
  onCommitTheme: (theme: ThemeDescriptor) => void;
  onInstallCatalogThemes: (themes: ThemeDescriptor[], selected: ThemeDescriptor) => void;
  onEnableOpenVsx: () => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  if (props.view === 'commands') return <CommandPaletteCommands {...props} />;
  return (
    <ThemeCommandPalette
      visible={props.visible}
      view={props.view}
      themes={props.themes}
      currentThemeIds={props.currentThemeIds}
      openVsxEnabled={props.openVsxEnabled}
      onClose={props.onClose}
      onViewChange={props.onViewChange}
      onPreviewTheme={props.onPreviewTheme}
      onClearThemePreview={props.onClearThemePreview}
      onCommitTheme={props.onCommitTheme}
      onInstallCatalogThemes={props.onInstallCatalogThemes}
      onEnableOpenVsx={props.onEnableOpenVsx}
    />
  );
}

function CommandPaletteCommands({
  visible,
  commands,
  historyStorage,
  shortcutHint,
  onClose,
  onExecute,
  onOpenOid,
}: CommandPaletteProps) {
  const engine = useEngine();
  const t = useTheme();
  const inputRef = useRef<TextInput>(null);
  const previousFocus = useRef<{ focus?: () => void; isConnected?: boolean } | null>(null);
  const controller = useMemo(() => new PaletteHistoryController(historyStorage), [historyStorage]);
  const [recents, setRecents] = useState<readonly PaletteRecentItem[]>(controller.snapshot());
  const [input, setInput] = useState('');
  const [hits, setHits] = useState<MibSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const parsed = parsePaletteQuery(input);

  useEffect(() => {
    setRecents(controller.snapshot());
    const unsubscribe = controller.subscribe((items) => setRecents([...items]));
    void controller.load();
    return unsubscribe;
  }, [controller]);

  useEffect(() => {
    if (!visible) return;
    setInput('');
    setHits([]);
    setError(null);
    setBusy(false);
    setActiveIndex(0);
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      previousFocus.current = document.activeElement as typeof previousFocus.current;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      clearTimeout(timer);
      const previous = previousFocus.current;
      if (Platform.OS === 'web' && previous?.isConnected !== false) {
        setTimeout(() => previous?.focus?.(), 0);
      }
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let current = true;
    void controller.load().then(async (items) => {
      const stale = await validatePaletteRecentOids(items, async (oid) =>
        Boolean(await engine.mibs.node(oid)),
      );
      if (current) stale.forEach((item) => controller.remove(item));
    });
    return () => {
      current = false;
    };
  }, [controller, engine, visible]);

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!visible || parsed.mode !== 'oids' || !parsed.query) {
      setSearching(false);
      setHits([]);
      return;
    }
    let current = true;
    setSearching(true);
    setError(null);
    const timer = setTimeout(() => {
      void engine.mibs
        .search(parsed.query, 20)
        .then((results) => {
          if (current) setHits(results);
        })
        .catch((cause: unknown) => {
          if (current) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (current) setSearching(false);
        });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [engine, parsed.mode, parsed.query, visible]);

  const entries = useMemo<DisplayEntry[]>(() => {
    if (parsed.mode === 'oids' && parsed.query) {
      return hits.map((hit) => ({
        key: `oid:${hit.oid}`,
        kind: 'oid',
        section: 'Objects',
        item: {
          kind: 'oid',
          oid: hit.oid,
          name: hit.name,
          ...(hit.module ? { module: hit.module } : {}),
          nodeKind: hit.kind,
        },
        recent: false,
      }));
    }
    return buildPaletteEntries(commands, recents, input);
  }, [commands, hits, input, parsed.mode, parsed.query, recents]);

  useEffect(() => setActiveIndex(0), [input]);
  useEffect(() => {
    setActiveIndex((index) => Math.max(0, Math.min(index, entries.length - 1)));
  }, [entries.length]);

  const activate = useCallback(
    async (entry: DisplayEntry) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        if (entry.kind === 'command') {
          const shouldClose = await onExecute(entry.command);
          controller.record({ kind: 'command', commandId: entry.command.id });
          if (shouldClose === false) return;
        } else {
          await onOpenOid(entry.item.oid);
          controller.record(entry.item);
        }
        close();
      } catch (cause) {
        if (entry.kind === 'oid' && entry.recent && cause instanceof MibObjectNotFoundError) {
          controller.remove(entry.item);
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [busy, close, controller, onExecute, onOpenOid],
  );

  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'ArrowDown' && entries.length) {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % entries.length);
      } else if (event.key === 'ArrowUp' && entries.length) {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + entries.length) % entries.length);
      } else if (event.key === 'Enter' && entries[activeIndex]) {
        event.preventDefault();
        void activate(entries[activeIndex]);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activate, activeIndex, close, entries, visible]);

  const emptyMessage = searching
    ? null
    : parsed.mode === 'oids' && !parsed.query
      ? 'Type an object name or numeric OID after @.'
      : parsed.mode === 'oids'
        ? 'No loaded MIB objects match this search.'
        : 'No commands match this search.';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close command palette"
          onPress={close}
        />
        <Card style={styles.card}>
          <View style={styles.inputRow}>
            <Text style={[styles.prompt, { color: t.accent }]}>&gt;</Text>
            <Field
              ref={inputRef}
              accessibilityLabel="Command palette input"
              placeholder="Type a command or @ to search OIDs…"
              value={input}
              onChangeText={(value) => {
                setInput(value);
                setError(null);
              }}
              style={styles.input}
            />
            {searching || busy ? <ActivityIndicator color={t.accent} size="small" /> : null}
          </View>

          <ScrollView
            style={styles.results}
            contentContainerStyle={styles.resultsContent}
            keyboardShouldPersistTaps="handled"
          >
            {entries.map((entry, index) => {
              const previousSection = entries[index - 1]?.section;
              return (
                <View key={entry.key}>
                  {entry.section !== previousSection ? (
                    <View style={styles.sectionRow}>
                      <Text style={[styles.sectionLabel, { color: t.textDim }]}>
                        {entry.section}
                      </Text>
                      {entry.section === 'Recents' && recents.length ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Clear command palette recents"
                          onPress={() => controller.clear()}
                        >
                          <Text style={[styles.clearText, { color: t.accent }]}>Clear recents</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  <PaletteRow
                    entry={entry}
                    active={index === activeIndex}
                    disabled={
                      busy || (entry.kind === 'command' && !entry.command.enabled.value)
                    }
                    onHover={() => setActiveIndex(index)}
                    onPress={() => void activate(entry)}
                  />
                </View>
              );
            })}
            {!entries.length && emptyMessage ? (
              <Text accessibilityLiveRegion="polite" style={[styles.empty, { color: t.textDim }]}>
                {emptyMessage}
              </Text>
            ) : null}
          </ScrollView>

          {error ? (
            <Text accessibilityLiveRegion="assertive" style={[styles.error, { color: t.error }]}>
              {error}
            </Text>
          ) : null}
          <View style={[styles.footer, { borderTopColor: t.border }]}>
            <Mono dim size={10}>
              ↑↓ Navigate · Enter Select · Esc Close
            </Mono>
            <Mono dim size={10}>
              {shortcutHint}
            </Mono>
          </View>
        </Card>
      </View>
    </Modal>
  );
}

type ThemeDisplayEntry =
  | ThemeQuickPickEntry
  | { key: `catalog:${string}`; kind: 'catalog'; section: 'Open VSX'; listing: OpenVsxThemeListing }
  | { key: 'enable-open-vsx'; kind: 'enable'; section: 'Open VSX'; label: string };

function ThemeCommandPalette({
  visible,
  view,
  themes,
  currentThemeIds,
  openVsxEnabled,
  onClose,
  onViewChange,
  onPreviewTheme,
  onClearThemePreview,
  onCommitTheme,
  onInstallCatalogThemes,
  onEnableOpenVsx,
}: {
  visible: boolean;
  view: Exclude<CommandPaletteView, 'commands'>;
  themes: readonly ThemeDescriptor[];
  currentThemeIds: { light: string; dark: string };
  openVsxEnabled: boolean;
  onClose: () => void;
  onViewChange: (view: CommandPaletteView) => void;
  onPreviewTheme: (theme: ThemeDescriptor) => void;
  onClearThemePreview: () => void;
  onCommitTheme: (theme: ThemeDescriptor) => void;
  onInstallCatalogThemes: (themes: ThemeDescriptor[], selected: ThemeDescriptor) => void;
  onEnableOpenVsx: () => void;
}) {
  const t = useTheme();
  const inputRef = useRef<TextInput>(null);
  const previewCache = useRef(new Map<string, { themes: ThemeDescriptor[]; warnings: string[] }>());
  const previewRequest = useRef(0);
  const [input, setInput] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [catalogResults, setCatalogResults] = useState<OpenVsxThemeListing[]>([]);
  const [searching, setSearching] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);
  const [touchArmedKey, setTouchArmedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setInput('');
    setActiveIndex(0);
    setError(null);
    setPreviewedKey(null);
    setTouchArmedKey(null);
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [view, visible]);

  useEffect(() => {
    if (view !== 'theme-catalog' || !openVsxEnabled || input.trim().length < 2) {
      setCatalogResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setError(null);
    const timer = setTimeout(() => {
      void searchOpenVsxThemes(input, { signal: controller.signal })
        .then(setCatalogResults)
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [input, openVsxEnabled, view]);

  const entries = useMemo<ThemeDisplayEntry[]>(() => {
    if (view === 'theme-picker') return buildThemeQuickPickEntries(themes, input, currentThemeIds);
    if (!openVsxEnabled)
      return [
        {
          key: 'enable-open-vsx',
          kind: 'enable',
          section: 'Open VSX',
          label: 'Enable Open VSX theme catalog',
        },
      ];
    return catalogResults.map((listing) => ({
      key: `catalog:${listing.id}@${listing.version}` as const,
      kind: 'catalog' as const,
      section: 'Open VSX' as const,
      listing,
    }));
  }, [catalogResults, currentThemeIds, input, openVsxEnabled, themes, view]);

  useEffect(() => setActiveIndex(0), [entries.length, input, view]);

  const previewCatalog = useCallback(
    async (entry: Extract<ThemeDisplayEntry, { kind: 'catalog' }>) => {
      const key = `${entry.listing.id}@${entry.listing.version}`;
      const request = ++previewRequest.current;
      setPreviewedKey(entry.key);
      setDownloadingId(entry.listing.id);
      setError(null);
      try {
        let imported = previewCache.current.get(key);
        if (!imported) {
          imported = await downloadOpenVsxTheme(entry.listing);
          previewCache.current.set(key, imported);
        }
        if (request === previewRequest.current && imported.themes[0]) {
          onPreviewTheme(imported.themes[0]);
        }
        return imported;
      } catch (cause) {
        if (request === previewRequest.current)
          setError(cause instanceof Error ? cause.message : String(cause));
        return null;
      } finally {
        if (request === previewRequest.current) setDownloadingId(null);
      }
    },
    [onPreviewTheme],
  );

  const preview = useCallback(
    (entry: ThemeDisplayEntry) => {
      setActiveIndex(
        Math.max(
          0,
          entries.findIndex(({ key }) => key === entry.key),
        ),
      );
      if (entry.kind === 'theme') {
        setPreviewedKey(entry.key);
        onPreviewTheme(entry.theme);
      } else if (entry.kind === 'catalog') {
        void previewCatalog(entry);
      } else {
        previewRequest.current += 1;
        setPreviewedKey(null);
        setDownloadingId(null);
        onClearThemePreview();
      }
    },
    [entries, onClearThemePreview, onPreviewTheme, previewCatalog],
  );

  const close = useCallback(() => {
    previewRequest.current += 1;
    onClearThemePreview();
    onClose();
  }, [onClearThemePreview, onClose]);

  const back = useCallback(() => {
    previewRequest.current += 1;
    onClearThemePreview();
    onViewChange(view === 'theme-catalog' ? 'theme-picker' : 'commands');
  }, [onClearThemePreview, onViewChange, view]);

  const activate = useCallback(
    async (entry: ThemeDisplayEntry, previewBeforeApply = false) => {
      if (entry.kind === 'browse') {
        onClearThemePreview();
        onViewChange('theme-catalog');
        return;
      }
      if (entry.kind === 'enable') {
        onEnableOpenVsx();
        return;
      }
      if (resolveThemePressIntent(previewBeforeApply, touchArmedKey, entry.key) === 'preview') {
        setTouchArmedKey(entry.key);
        preview(entry);
        return;
      }
      setTouchArmedKey(null);
      if (entry.kind === 'theme') {
        onCommitTheme(entry.theme);
        onClose();
        return;
      }
      const imported =
        previewCache.current.get(`${entry.listing.id}@${entry.listing.version}`) ??
        (await previewCatalog(entry));
      const selected = imported?.themes[0];
      if (!imported || !selected) return;
      onInstallCatalogThemes(imported.themes, selected);
      onClose();
    },
    [
      onClearThemePreview,
      onClose,
      onCommitTheme,
      onEnableOpenVsx,
      onInstallCatalogThemes,
      onViewChange,
      preview,
      previewCatalog,
      touchArmedKey,
    ],
  );

  useEffect(() => {
    const entry = entries[activeIndex];
    if (!visible || !entry) return;
    preview(entry);
  }, [activeIndex, entries, preview, visible]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        back();
      } else if (event.key === 'ArrowDown' && entries.length) {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % entries.length);
      } else if (event.key === 'ArrowUp' && entries.length) {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + entries.length) % entries.length);
      } else if (event.key === 'Enter' && entries[activeIndex]) {
        event.preventDefault();
        void activate(entries[activeIndex]);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activate, activeIndex, back, entries, visible]);

  const placeholder =
    view === 'theme-picker'
      ? 'Select Color Theme (Up/Down Keys to Preview)'
      : openVsxEnabled
        ? 'Search licensed Open VSX color themes'
        : 'Open VSX catalog is disabled';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={back}>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close theme picker"
          onPress={close}
        />
        <Card style={styles.card}>
          <View style={styles.inputRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back}>
              <Text style={[styles.backGlyph, { color: t.textDim }]}>‹</Text>
            </Pressable>
            <Field
              ref={inputRef}
              accessibilityLabel={placeholder}
              placeholder={placeholder}
              value={input}
              editable={view === 'theme-picker' || openVsxEnabled}
              onChangeText={(value) => {
                setInput(value);
                setError(null);
              }}
              style={styles.input}
            />
            {searching || downloadingId ? (
              <ActivityIndicator color={t.accent} size="small" />
            ) : null}
          </View>
          <ScrollView
            style={styles.results}
            contentContainerStyle={styles.resultsContent}
            keyboardShouldPersistTaps="handled"
          >
            {entries.map((entry, index) => {
              const previousSection = entries[index - 1]?.section;
              const label =
                entry.kind === 'catalog'
                  ? entry.listing.displayName
                  : entry.kind === 'theme'
                    ? entry.label
                    : entry.label;
              const metadata =
                entry.kind === 'catalog'
                  ? `${entry.listing.id} · ${entry.listing.license} · ${entry.listing.downloadCount.toLocaleString()} downloads`
                  : entry.kind === 'theme'
                    ? `${entry.theme.scheme}${entry.theme.highContrast ? ' · high contrast' : ''}`
                    : entry.kind === 'enable'
                      ? 'Required before MIB Beacon contacts the Eclipse-hosted registry.'
                      : 'Search and preview licensed themes from Open VSX.';
              const active = index === activeIndex;
              return (
                <View key={entry.key}>
                  {entry.section !== previousSection ? (
                    <View style={styles.sectionRow}>
                      <Text style={[styles.sectionLabel, { color: t.textDim }]}>
                        {entry.section}
                      </Text>
                    </View>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityHint={
                      entry.kind === 'theme' || entry.kind === 'catalog'
                        ? 'Hover or focus to preview. Press to apply.'
                        : undefined
                    }
                    accessibilityState={{
                      selected: active || previewedKey === entry.key,
                    }}
                    onHoverIn={() => preview(entry)}
                    onFocus={() => preview(entry)}
                    onPress={(event) => {
                      const pointerType = (
                        event.nativeEvent as typeof event.nativeEvent & { pointerType?: string }
                      ).pointerType;
                      const previewBeforeApply = shouldPreviewBeforeThemeApply(
                        Platform.OS,
                        pointerType,
                      );
                      void activate(entry, previewBeforeApply);
                    }}
                    style={[
                      styles.resultRow,
                      {
                        backgroundColor: active ? t.components.selected.background : 'transparent',
                        borderLeftColor: active ? t.components.selected.border : 'transparent',
                      },
                    ]}
                  >
                    <View style={styles.glyph}>
                      <Text
                        style={[
                          styles.commandGlyph,
                          { color: active ? t.components.selected.icon : t.textDim },
                        ]}
                      >
                        {entry.kind === 'browse'
                          ? '+'
                          : entry.kind === 'enable'
                            ? '◉'
                            : entry.kind === 'catalog'
                              ? downloadingId === entry.listing.id
                                ? '↧'
                                : '◐'
                              : entry.current
                                ? '✓'
                                : '◐'}
                      </Text>
                    </View>
                    <View style={styles.resultCopy}>
                      <Text
                        style={[
                          styles.resultTitle,
                          { color: active ? t.components.selected.foreground : t.text },
                        ]}
                        numberOfLines={1}
                      >
                        {label}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.themeMetadata,
                          {
                            color: active ? t.components.selected.mutedForeground : t.textDim,
                          },
                        ]}
                      >
                        {metadata}
                      </Text>
                    </View>
                    {entry.kind === 'catalog' && entry.listing.verified ? (
                      <Pill text="VERIFIED" color={t.ok} />
                    ) : null}
                  </Pressable>
                </View>
              );
            })}
            {!entries.length && !searching ? (
              <Text style={[styles.empty, { color: t.textDim }]}>
                {input.trim().length < 2
                  ? 'Type at least two characters to search themes.'
                  : 'No licensed color themes matched.'}
              </Text>
            ) : null}
          </ScrollView>
          {error ? (
            <Text accessibilityLiveRegion="assertive" style={[styles.error, { color: t.error }]}>
              {error}
            </Text>
          ) : null}
          <View style={[styles.footer, { borderTopColor: t.border }]}>
            <Mono dim size={10}>
              ↑↓ Preview · Enter Apply · Esc Back
            </Mono>
            <Mono dim size={10}>
              Hover previews · Tap once previews · Tap again applies
            </Mono>
          </View>
        </Card>
      </View>
    </Modal>
  );
}

function PaletteRow({
  entry,
  active,
  disabled,
  onHover,
  onPress,
}: {
  entry: DisplayEntry;
  active: boolean;
  disabled: boolean;
  onHover: () => void;
  onPress: () => void;
}) {
  const t = useTheme();
  const oid = entry.kind === 'oid' ? entry.item : null;
  const backgroundColor = disabled
    ? t.components.disabled.background
    : active
      ? t.components.selected.background
      : 'transparent';
  const foreground = disabled
    ? t.components.disabled.foreground
    : active
      ? t.components.selected.foreground
      : t.text;
  const secondaryForeground = disabled
    ? t.components.disabled.foreground
    : active
      ? t.components.selected.mutedForeground
      : t.textDim;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        entry.kind === 'command'
          ? `${entry.command.label}${entry.command.enabled.reason ? `. ${entry.command.enabled.reason}` : ''}`
          : `Open ${entry.item.name} at ${entry.item.oid}`
      }
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onHoverIn={onHover}
      onPress={onPress}
      style={[
        styles.resultRow,
        {
          backgroundColor,
          borderLeftColor: disabled
            ? t.components.disabled.border
            : active
              ? t.components.selected.border
              : 'transparent',
        },
      ]}
    >
      <View style={styles.glyph}>
        {entry.kind === 'oid' ? (
          <KindGlyph kind={(entry.item.nodeKind ?? 'node') as MibNodeKind} />
        ) : (
          <Text style={[styles.commandGlyph, { color: secondaryForeground }]}>
            {entry.command.glyph}
          </Text>
        )}
      </View>
      <View style={styles.resultCopy}>
        <Text style={[styles.resultTitle, { color: foreground }]} numberOfLines={1}>
          {entry.kind === 'command' ? entry.command.label : entry.item.name}
        </Text>
        {oid ? (
          <Text style={[styles.oidMetadata, { color: secondaryForeground }]}>{oid.oid}</Text>
        ) : entry.kind === 'command' && entry.command.enabled.reason ? (
          <Text style={[styles.oidMetadata, { color: secondaryForeground }]}>
            {entry.command.enabled.reason}
          </Text>
        ) : null}
      </View>
      {oid?.module ? <Pill text={oid.module} /> : null}
      {entry.recent ? (
        <Text style={[styles.recentMark, { color: secondaryForeground }]}>↺</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    zIndex: 10_000,
    backgroundColor: 'rgba(5, 9, 16, 0.72)',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 14,
    paddingTop: '8%',
  },
  card: { width: '100%', maxWidth: 680, maxHeight: '78%', padding: 8, gap: 0 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6 },
  prompt: { fontFamily: 'monospace', fontSize: 22, fontWeight: '900' },
  backGlyph: { fontSize: 28, lineHeight: 28, width: 28, textAlign: 'center' },
  input: { borderWidth: 0, fontSize: 16 },
  results: { minHeight: 120 },
  resultsContent: { paddingBottom: 6 },
  sectionRow: {
    minHeight: 30,
    paddingHorizontal: 10,
    paddingTop: 9,
    paddingBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  clearText: { fontSize: 11, fontWeight: '700' },
  resultRow: {
    minHeight: 50,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  glyph: { width: 25, alignItems: 'center' },
  commandGlyph: { fontSize: 18, fontWeight: '800' },
  resultCopy: { flex: 1, minWidth: 0, gap: 2 },
  resultTitle: { fontSize: 13, fontWeight: '700' },
  themeMetadata: { fontFamily: 'monospace', fontSize: 10 },
  oidMetadata: { fontFamily: 'monospace', fontSize: 11 },
  recentMark: { fontSize: 15 },
  empty: { paddingVertical: 28, paddingHorizontal: 12, textAlign: 'center', fontSize: 13 },
  error: { paddingHorizontal: 10, paddingVertical: 7, fontSize: 12 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
});
