import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Button, Chip, consolePalette, Text } from '@mibbeacon/ui';
import type { PacketTraceEvent } from '@mibbeacon/core/client';
import { useEngine } from '../engine-context';
import { useResponsiveLayout } from '../responsive-context';
import { useAppStore } from '../store';
import {
  formatPacketHexDump,
  getPacketActivityLights,
  getPacketConsoleLayout,
} from '../packet-console';
import type { AppHostAdapter, PacketCaptureExportReader } from '../AppRoot';

// The packet console is a fixed-dark terminal in both themes; colors come from
// the shared, contrast-tested consolePalette rather than the app theme.
const CONSOLE_BG = consolePalette.bg;
const CONSOLE_PANEL = consolePalette.panel;
const CONSOLE_LINE = consolePalette.line;
const CONSOLE_TEXT = consolePalette.text;
const CONSOLE_DIM = consolePalette.dim;
const CONSOLE_OK = consolePalette.ok;
const CONSOLE_ERROR = consolePalette.error;

export function PacketActivityLights({ compact = false }: { compact?: boolean }) {
  const packets = useAppStore((state) => state.packetEvents);
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => refresh((value) => value + 1), 1_850);
    return () => clearTimeout(timer);
  }, [packets]);
  const lights = getPacketActivityLights(packets);
  return (
    <View
      accessibilityLabel={`Packet activity: transmit ${lights.tx ? 'active' : 'idle'}, receive ${lights.rx ? 'active' : 'idle'}, errors ${lights.error ? 'active' : 'idle'}`}
      style={styles.lights}
    >
      <ActivityDot active={lights.tx} color={CONSOLE_OK} label={compact ? undefined : 'TX'} />
      <ActivityDot active={lights.rx} color={CONSOLE_OK} label={compact ? undefined : 'RX'} />
      <ActivityDot active={lights.error} color={CONSOLE_ERROR} label={compact ? undefined : 'ERR'} />
    </View>
  );
}

function ActivityDot({ active, color, label }: { active: boolean; color: string; label?: string }) {
  const opacity = useRef(new Animated.Value(active ? 1 : 0.24)).current;
  useEffect(() => {
    opacity.stopAnimation();
    if (!active) {
      opacity.setValue(0.24);
      return;
    }
    const pulse = Animated.sequence(
      Array.from({ length: 6 }, (_, index) =>
        Animated.timing(opacity, {
          toValue: index % 2 === 0 ? 1 : 0.38,
          duration: 150,
          useNativeDriver: true,
        }),
      ),
    );
    const pulseLoop = Animated.loop(pulse);
    pulseLoop.start();
    return () => pulseLoop.stop();
  }, [active, opacity]);
  return (
    <View style={styles.lightItem}>
      <Animated.View
        style={[
          styles.lightDot,
          { backgroundColor: active ? color : consolePalette.dotIdle, opacity, shadowColor: color },
        ]}
      />
      {label ? <Text style={styles.lightLabel}>{label}</Text> : null}
    </View>
  );
}

export function PacketConsole({ host }: { host?: AppHostAdapter }) {
  const engine = useEngine();
  const { mode, height } = useResponsiveLayout();
  const open = useAppStore((state) => state.packetConsoleOpen);
  const paused = useAppStore((state) => state.packetFeedPaused);
  const packets = useAppStore((state) => state.packetEvents);
  const status = useAppStore((state) => state.packetStatus);
  const layout = getPacketConsoleLayout(mode, height, mode === 'compact' ? 0.68 : 0.42);
  const [size, setSize] = useState(layout.size);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [direction, setDirection] = useState<'all' | 'tx' | 'rx'>('all');
  const [validity, setValidity] = useState<'all' | 'valid' | 'invalid'>('all');
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dragStart = useRef(size);
  useEffect(() => setSize((value) => Math.max(layout.minSize, Math.min(layout.maxSize, value))), [layout.maxSize, layout.minSize]);
  const filtered = useMemo(
    () =>
      packets.filter(
        (packet) =>
          (direction === 'all' || packet.direction === direction) &&
          (validity === 'all' || packet.status === validity),
      ),
    [direction, packets, validity],
  );
  const selected = filtered.find(({ id }) => id === selectedId) ?? filtered.at(-1) ?? null;
  useEffect(() => {
    if (!selectedId && filtered.length) setSelectedId(filtered.at(-1)!.id);
  }, [filtered, selectedId]);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 3,
        onPanResponderGrant: () => {
          dragStart.current = size;
        },
        onPanResponderMove: (_event, gesture) => {
          if (!open) return;
          const delta = layout.edge === 'top' ? gesture.dy : -gesture.dy;
          setSize(Math.max(layout.minSize, Math.min(layout.maxSize, dragStart.current + delta)));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (!open && Math.abs(gesture.dy) > 12) useAppStore.getState().setPacketConsoleOpen(true);
        },
      }),
    [layout.edge, layout.maxSize, layout.minSize, open, size],
  );

  const clear = async () => {
    await engine.packets.clear();
    useAppStore.getState().clearPacketEvents();
    setSelectedId(null);
  };
  const togglePause = async () => {
    if (!paused) {
      useAppStore.getState().setPacketFeedPaused(true);
      return;
    }
    const history = await engine.packets.history();
    useAppStore.getState().setPacketEvents(history);
    useAppStore.getState().setPacketFeedPaused(false);
  };
  const exportCapture = async () => {
    setExporting(true);
    setMessage(null);
    let id: string | null = null;
    try {
      const descriptor = await engine.packets.export.create();
      id = descriptor.id;
      const reader: PacketCaptureExportReader = {
        fileName: descriptor.fileName,
        byteLength: descriptor.byteLength,
        readChunk: async (offset) => engine.packets.export.readChunk(descriptor.id, offset),
      };
      if (host?.savePacketCapture) await host.savePacketCapture(reader);
      else if (Platform.OS === 'web' && typeof document !== 'undefined') await downloadInBrowser(reader);
      else throw new Error('This host does not provide a packet-capture file exporter.');
      setMessage(`Exported ${descriptor.fileName}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (id) await engine.packets.export.dispose(id).catch(() => undefined);
      setExporting(false);
    }
  };

  const shellStyle = layout.overlay
    ? [styles.mobileShell, { height: open ? size : layout.collapsedSize }]
    : [styles.desktopShell, { height: open ? size : layout.collapsedSize }];
  return (
    <View nativeID="packet-console" style={shellStyle} pointerEvents="box-none">
      <View {...pan.panHandlers} style={[styles.dragZone, layout.edge === 'top' ? styles.dragTop : styles.dragBottom]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? 'Collapse packet console' : 'Open packet console'}
          accessibilityState={{ expanded: open }}
          onPress={() => useAppStore.getState().setPacketConsoleOpen(!open)}
          style={styles.pullTab}
        >
          <View style={styles.grip} />
          <Text style={styles.pullLabel}>PACKETS</Text>
          <PacketActivityLights compact />
          <Text style={styles.packetCount}>{packets.length}</Text>
        </Pressable>
      </View>
      {open ? (
        <View style={styles.consoleBody}>
          <View style={[styles.toolbar, mode === 'compact' ? styles.toolbarMobile : null]}>
            <View style={styles.consoleTitleWrap}>
              <Text numberOfLines={1} style={styles.consolePrompt}>mibbeacon://wire</Text>
              {mode !== 'compact' ? <Text style={styles.consoleMeta}>UDP PAYLOAD INSPECTOR · LIVE</Text> : null}
            </View>
            <View style={[styles.toolbarActions, mode === 'compact' ? styles.toolbarActionsMobile : null]}>
              <Button title={paused ? 'Resume' : 'Pause'} small variant="ghost" onPress={() => void togglePause()} />
              <Button title="Clear" small variant="ghost" onPress={() => void clear()} />
              <Button title={exporting ? 'Exporting…' : 'PCAPNG'} small disabled={exporting || packets.length === 0} onPress={() => void exportCapture()} />
            </View>
          </View>
          <View style={[styles.filters, mode === 'compact' ? styles.filtersMobile : null]}>
            <View style={styles.filterGroup}>
              {(['all', 'tx', 'rx'] as const).map((value) => (
                <Chip key={value} label={value.toUpperCase()} active={direction === value} onPress={() => setDirection(value)} />
              ))}
            </View>
            <View style={styles.filterGroup}>
              {(['all', 'valid', 'invalid'] as const).map((value) => (
                <Chip key={`validity-${value}`} label={value === 'all' ? 'ANY' : value === 'valid' ? 'OK' : 'ERR'} active={validity === value} onPress={() => setValidity(value)} />
              ))}
            </View>
            {paused ? <Text style={styles.paused}>FEED PAUSED</Text> : null}
          </View>
          {status?.warning ? <Text style={styles.warning}>{status.warning}</Text> : null}
          {message ? <Text style={{ color: message.startsWith('Exported') ? CONSOLE_OK : CONSOLE_ERROR, fontSize: 10, paddingHorizontal: 10 }}>{message}</Text> : null}
          <View style={[styles.workspace, mode === 'compact' ? styles.workspaceMobile : null]}>
            <FlatList
              style={[styles.packetList, mode === 'compact' ? styles.packetListMobile : null]}
              data={[...filtered].reverse()}
              keyExtractor={({ id }) => id}
              ListEmptyComponent={<Text style={styles.empty}>Waiting for SNMP datagrams…</Text>}
              renderItem={({ item }) => (
                <PacketRow packet={item} selected={item.id === selected?.id} onPress={() => setSelectedId(item.id)} />
              )}
            />
            <View style={[styles.hexPane, mode === 'compact' ? styles.hexPaneMobile : null]}>
              {selected ? (
                <>
                  <View style={styles.hexHead}>
                    <Text style={styles.hexTitle}>{selected.direction.toUpperCase()} · {selected.operation.toUpperCase()} · {selected.byteLength} BYTES</Text>
                    <Text style={[styles.hexStatus, { color: selected.status === 'invalid' ? CONSOLE_ERROR : selected.status === 'valid' ? CONSOLE_OK : consolePalette.pending }]}>{selected.status.toUpperCase()}</Text>
                  </View>
                  <ScrollView style={styles.hexViewport} contentContainerStyle={styles.hexViewportContent} nestedScrollEnabled>
                    <ScrollView horizontal contentContainerStyle={styles.hexScroll} nestedScrollEnabled>
                      <Text style={styles.hexDump}>{formatPacketHexDump(selected.rawHex)}</Text>
                    </ScrollView>
                  </ScrollView>
                  {selected.error ? <Text style={styles.packetError}>{selected.error}</Text> : null}
                </>
              ) : (
                <Text style={styles.empty}>Select a packet to inspect its exact wire payload.</Text>
              )}
            </View>
          </View>
          <View style={[styles.footer, mode === 'compact' ? styles.footerMobile : null]}>
            <Text style={styles.footerText}>Raw SNMP may expose community strings or unencrypted values. History: {status?.persistence ?? 'loading'} · {status?.retentionMiB ?? 32} MiB cap.</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function PacketRow({ packet, selected, onPress }: { packet: PacketTraceEvent; selected: boolean; onPress: () => void }) {
  const color = packet.status === 'invalid' ? CONSOLE_ERROR : packet.status === 'pending' ? consolePalette.pending : CONSOLE_OK;
  return (
    <Pressable onPress={onPress} style={[styles.packetRow, selected ? styles.packetRowSelected : null]}>
      <Text style={[styles.direction, { color }]}>{packet.direction === 'tx' ? '→ TX' : '← RX'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.packetHeadline} numberOfLines={1}>{packet.operation.toUpperCase()} · {packet.remoteAddress ?? 'unknown'}:{packet.remotePort ?? '—'}</Text>
        <Text style={styles.packetMeta}>{new Date(packet.timestamp).toLocaleTimeString()} · {packet.transport} · {packet.byteLength} B</Text>
      </View>
    </Pressable>
  );
}

async function downloadInBrowser(reader: PacketCaptureExportReader): Promise<void> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  while (offset < reader.byteLength) {
    const chunk = await reader.readChunk(offset);
    chunks.push(decodeBase64(chunk.base64));
    offset = chunk.nextOffset;
    if (chunk.done) break;
  }
  const blob = new Blob(chunks as BlobPart[], { type: 'application/vnd.tcpdump.pcap' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = reader.fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

const styles = StyleSheet.create({
  desktopShell: { flexShrink: 0, backgroundColor: CONSOLE_BG, borderTopWidth: 1, borderTopColor: CONSOLE_LINE, overflow: 'hidden' },
  mobileShell: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 90, backgroundColor: CONSOLE_BG, borderBottomWidth: 1, borderBottomColor: CONSOLE_LINE, overflow: 'hidden', shadowColor: consolePalette.shadow, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 18 },
  dragZone: { position: 'absolute', left: 0, right: 0, height: 24, zIndex: 3, alignItems: 'center' },
  dragTop: { top: 0 },
  dragBottom: { top: 0 },
  pullTab: { minWidth: 168, height: 24, paddingHorizontal: 10, backgroundColor: CONSOLE_PANEL, borderColor: CONSOLE_LINE, borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  grip: { width: 18, height: 2, borderRadius: 1, backgroundColor: consolePalette.grip },
  pullLabel: { color: CONSOLE_TEXT, fontFamily: 'monospace', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  packetCount: { color: CONSOLE_DIM, fontFamily: 'monospace', fontSize: 9 },
  lights: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  lightItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  lightDot: { width: 7, height: 7, borderRadius: 4, shadowOpacity: 0.9, shadowRadius: 5 },
  lightLabel: { color: CONSOLE_DIM, fontFamily: 'monospace', fontSize: 8 },
  consoleBody: { flex: 1, paddingTop: 24, backgroundColor: CONSOLE_BG },
  toolbar: { minHeight: 44, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: CONSOLE_LINE, flexDirection: 'row', alignItems: 'center', gap: 10 },
  toolbarMobile: {
    minHeight: 80,
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 4,
  },
  consoleTitleWrap: { flex: 1 },
  consolePrompt: { color: CONSOLE_OK, fontFamily: 'monospace', fontSize: 12, fontWeight: '700' },
  consoleMeta: { color: CONSOLE_DIM, fontFamily: 'monospace', fontSize: 8, letterSpacing: 1 },
  toolbarActions: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  toolbarActionsMobile: { width: '100%', justifyContent: 'flex-end' },
  filters: { minHeight: 38, paddingHorizontal: 8, paddingVertical: 5, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, borderBottomWidth: 1, borderBottomColor: CONSOLE_LINE },
  filtersMobile: { alignItems: 'stretch', gap: 4 },
  filterGroup: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  paused: { color: consolePalette.pending, fontFamily: 'monospace', fontSize: 9, fontWeight: '800' },
  warning: { color: CONSOLE_ERROR, fontFamily: 'monospace', fontSize: 10, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: consolePalette.warnBg },
  workspace: { flex: 1, minHeight: 0, flexDirection: 'row' },
  workspaceMobile: { flexDirection: 'column', minHeight: 0, overflow: 'hidden' },
  packetList: { flex: 0.42, minHeight: 80, borderRightWidth: 1, borderRightColor: CONSOLE_LINE },
  packetListMobile: { flex: 1, minHeight: 0, borderRightWidth: 0, overflow: 'hidden' },
  packetRow: { minHeight: 44, paddingHorizontal: 9, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: CONSOLE_LINE, flexDirection: 'row', alignItems: 'center', gap: 8 },
  packetRowSelected: { backgroundColor: consolePalette.rowSelected },
  direction: { width: 32, fontFamily: 'monospace', fontSize: 9, fontWeight: '900' },
  packetHeadline: { color: CONSOLE_TEXT, fontFamily: 'monospace', fontSize: 10, fontWeight: '700' },
  packetMeta: { color: CONSOLE_DIM, fontFamily: 'monospace', fontSize: 8, marginTop: 2 },
  hexPane: { flex: 0.58, minHeight: 80, backgroundColor: CONSOLE_PANEL },
  hexPaneMobile: { flex: 1, minHeight: 0, borderTopWidth: 1, borderTopColor: CONSOLE_LINE, overflow: 'hidden' },
  hexHead: { minHeight: 32, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: CONSOLE_LINE },
  hexTitle: { color: CONSOLE_DIM, fontFamily: 'monospace', fontSize: 9, fontWeight: '700' },
  hexStatus: { fontFamily: 'monospace', fontSize: 9, fontWeight: '900' },
  hexViewport: { flex: 1, minHeight: 0 },
  hexViewportContent: { flexGrow: 1 },
  hexScroll: { padding: 10 },
  hexDump: { color: CONSOLE_TEXT, fontFamily: 'monospace', fontSize: 10, lineHeight: 15 },
  packetError: { color: CONSOLE_ERROR, fontFamily: 'monospace', fontSize: 9, paddingHorizontal: 10, paddingBottom: 6 },
  empty: { color: CONSOLE_DIM, fontFamily: 'monospace', fontSize: 10, padding: 14 },
  footer: { minHeight: 22, paddingHorizontal: 9, justifyContent: 'center', borderTopWidth: 1, borderTopColor: CONSOLE_LINE },
  footerMobile: { paddingVertical: 5 },
  footerText: { color: CONSOLE_DIM, fontFamily: 'monospace', fontSize: 9, lineHeight: 12 },
});
