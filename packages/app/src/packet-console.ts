import type { PacketTraceEvent } from '@mibbeacon/core/client';
import type { ResponsiveMode } from './responsive-layout';

export interface PacketConsoleLayout {
  edge: 'top' | 'bottom';
  overlay: boolean;
  collapsedSize: number;
  minSize: number;
  maxSize: number;
  size: number;
}

export function getPacketConsoleLayout(
  mode: ResponsiveMode,
  viewportHeight: number,
  ratio: number,
): PacketConsoleLayout {
  const compact = mode === 'compact';
  const minSize = compact ? 180 : 160;
  const maxSize = Math.max(minSize, Math.floor(viewportHeight * (compact ? 0.72 : 0.55)));
  return {
    edge: compact ? 'top' : 'bottom',
    overlay: compact,
    collapsedSize: compact ? 24 : 20,
    minSize,
    maxSize,
    size: Math.max(minSize, Math.min(maxSize, Math.round(viewportHeight * ratio))),
  };
}

export function formatPacketHexDump(rawHex: string, columns = 16): string {
  const bytes = (rawHex.match(/[0-9a-f]{2}/gi) ?? []).map((value) => Number.parseInt(value, 16));
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += columns) {
    const row = bytes.slice(offset, offset + columns);
    const hex = row.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
    const ascii = row.map((byte) => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(columns * 3 - 1)}  |${ascii}|`);
  }
  return lines.join('\n');
}

export function getPacketActivityLights(
  packets: readonly PacketTraceEvent[],
  now = Date.now(),
  holdMs = 1_800,
): { tx: boolean; rx: boolean; error: boolean } {
  const recent = packets.filter(({ timestamp }) => now - timestamp <= holdMs);
  return {
    tx: recent.some(({ direction }) => direction === 'tx'),
    rx: recent.some(({ direction }) => direction === 'rx'),
    error: recent.some(({ status }) => status === 'invalid'),
  };
}

export function upsertPacketTrace(
  packets: readonly PacketTraceEvent[],
  event: PacketTraceEvent,
  cap = 500,
): PacketTraceEvent[] {
  const next = [...packets];
  const index = next.findIndex(({ id }) => id === event.id);
  if (index >= 0) next[index] = event;
  else next.push(event);
  return next.slice(-Math.max(1, cap));
}
