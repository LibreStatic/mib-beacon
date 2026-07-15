import { describe, expect, it } from 'vitest';
import type { PacketTraceEvent } from '@mibbeacon/core/client';
import {
  formatPacketHexDump,
  getPacketActivityLights,
  getPacketConsoleLayout,
  upsertPacketTrace,
} from './packet-console';

function packet(id: string, patch: Partial<PacketTraceEvent> = {}): PacketTraceEvent {
  return {
    id,
    timestamp: 1_000,
    direction: 'rx',
    status: 'valid',
    transport: 'udp4',
    operation: 'get',
    byteLength: 4,
    rawHex: '41 42 00 ff',
    ...patch,
  };
}

describe('packet hex viewer', () => {
  it('renders offsets, sixteen-byte columns, and printable ASCII', () => {
    expect(formatPacketHexDump('41 42 00 ff')).toBe(
      '00000000  41 42 00 ff                                      |AB..|',
    );
  });
});

describe('packet console layout', () => {
  it('uses a top pull-down overlay on compact screens', () => {
    expect(getPacketConsoleLayout('compact', 800, 0.5)).toEqual({
      edge: 'top',
      overlay: true,
      collapsedSize: 24,
      minSize: 180,
      maxSize: 576,
      size: 400,
    });
  });

  it('uses a bottom resizing dock on desktop', () => {
    expect(getPacketConsoleLayout('expanded', 800, 0.5)).toMatchObject({
      edge: 'bottom',
      overlay: false,
      maxSize: 440,
      size: 400,
    });
  });
});

describe('packet activity', () => {
  it('keeps TX/RX green and malformed traffic red for 1.8 seconds', () => {
    const packets = [
      packet('tx', { direction: 'tx', timestamp: 1_000 }),
      packet('rx', { direction: 'rx', timestamp: 1_200 }),
      packet('bad', { direction: 'rx', status: 'invalid', timestamp: 1_400 }),
    ];
    expect(getPacketActivityLights(packets, 2_000)).toEqual({ tx: true, rx: true, error: true });
    expect(getPacketActivityLights(packets, 3_500)).toEqual({ tx: false, rx: false, error: false });
  });

  it('upserts packet status and bounds the live feed', () => {
    let packets: PacketTraceEvent[] = [];
    packets = upsertPacketTrace(packets, packet('one', { status: 'pending' }), 2);
    packets = upsertPacketTrace(packets, packet('one', { status: 'valid' }), 2);
    packets = upsertPacketTrace(packets, packet('two'), 2);
    packets = upsertPacketTrace(packets, packet('three'), 2);
    expect(packets.map(({ id }) => id)).toEqual(['two', 'three']);
  });
});
