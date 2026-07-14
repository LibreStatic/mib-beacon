import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInput,
} from 'react-native';
import { Card, Field, KindGlyph, Mono, Pill, useTheme } from '@mibbeacon/ui';
import type { MibNodeKind, MibSearchHit } from '@mibbeacon/core/client';
import { MibObjectNotFoundError } from '../actions';
import {
  PaletteHistoryController,
  buildPaletteEntries,
  parsePaletteQuery,
  validatePaletteRecentOids,
  type PaletteCommand,
  type PaletteEntry,
  type PaletteHistoryStorage,
  type PaletteRecentItem,
} from '../command-palette';
import { useEngine } from '../engine-context';

type LiveOidEntry = {
  key: `oid:${string}`;
  kind: 'oid';
  section: 'Objects';
  item: Extract<PaletteRecentItem, { kind: 'oid' }>;
  recent: false;
};

type DisplayEntry = PaletteEntry | LiveOidEntry;

export function CommandPalette({
  visible,
  commands,
  historyStorage,
  shortcutHint,
  onClose,
  onExecute,
  onOpenOid,
}: {
  visible: boolean;
  commands: readonly PaletteCommand[];
  historyStorage?: PaletteHistoryStorage;
  shortcutHint: string;
  onClose: () => void;
  onExecute: (command: PaletteCommand) => void | Promise<void>;
  onOpenOid: (oid: string) => Promise<void>;
}) {
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
          await onExecute(entry.command);
          controller.record({ kind: 'command', commandId: entry.command.id });
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
                    disabled={busy}
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        entry.kind === 'command'
          ? entry.command.label
          : `Open ${entry.item.name} at ${entry.item.oid}`
      }
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onHoverIn={onHover}
      onPress={onPress}
      style={[
        styles.resultRow,
        {
          backgroundColor: active ? t.accentSoft : 'transparent',
          borderLeftColor: active ? t.accent : 'transparent',
          opacity: disabled ? 0.55 : 1,
        },
      ]}
    >
      <View style={styles.glyph}>
        {entry.kind === 'oid' ? (
          <KindGlyph kind={(entry.item.nodeKind ?? 'node') as MibNodeKind} />
        ) : (
          <Text style={[styles.commandGlyph, { color: active ? t.accent : t.textDim }]}>
            {entry.command.glyph}
          </Text>
        )}
      </View>
      <View style={styles.resultCopy}>
        <Text style={[styles.resultTitle, { color: t.text }]} numberOfLines={1}>
          {entry.kind === 'command' ? entry.command.label : entry.item.name}
        </Text>
        {oid ? (
          <Mono dim size={11}>
            {oid.oid}
          </Mono>
        ) : null}
      </View>
      {oid?.module ? <Pill text={oid.module} /> : null}
      {entry.recent ? <Text style={[styles.recentMark, { color: t.textDim }]}>↺</Text> : null}
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
  input: { borderWidth: 0, backgroundColor: 'transparent', fontSize: 16 },
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
