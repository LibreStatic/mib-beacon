import { describe, expect, it } from 'vitest';
import {
  PacketTraceRing,
  PacketTraceService,
  encodePacketTracePcapng,
  isPlausibleSnmpDatagram,
  normalizePacketTraceRetentionMiB,
  type PacketTraceEvent,
} from './packet-trace';
import type { FileStore } from '@mibbeacon/transport';

function packet(id: string, patch: Partial<PacketTraceEvent> = {}): PacketTraceEvent {
  return {
    id,
    timestamp: 1_700_000_000_000,
    direction: 'rx',
    status: 'pending',
    transport: 'udp4',
    operation: 'get',
    localAddress: '127.0.0.1',
    localPort: 40_000,
    remoteAddress: '127.0.0.1',
    remotePort: 161,
    byteLength: 4,
    rawHex: 'de ad be ef',
    ...patch,
  };
}

describe('packet trace retention', () => {
  it('updates a pending packet in place instead of duplicating it', () => {
    const ring = new PacketTraceRing(3, 1_024);
    ring.upsert(packet('one'));
    ring.upsert(packet('one', { status: 'valid' }));

    expect(ring.list()).toEqual([expect.objectContaining({ id: 'one', status: 'valid' })]);
  });

  it('evicts oldest packets by count and raw-byte budget', () => {
    const ring = new PacketTraceRing(2, 6);
    ring.upsert(packet('one', { byteLength: 4 }));
    ring.upsert(packet('two', { byteLength: 4 }));
    ring.upsert(packet('three', { byteLength: 2 }));

    expect(ring.list().map(({ id }) => id)).toEqual(['two', 'three']);
  });

  it('clamps configurable persistence to 0 through 256 MiB', () => {
    expect(normalizePacketTraceRetentionMiB(-1)).toBe(0);
    expect(normalizePacketTraceRetentionMiB(32.8)).toBe(32);
    expect(normalizePacketTraceRetentionMiB(999)).toBe(256);
  });
});

describe('PCAPNG export', () => {
  it('writes a standard section and preserves the exact SNMP payload', () => {
    const bytes = encodePacketTracePcapng([
      packet('one', { status: 'valid', direction: 'tx', rawHex: '30 02 05 00' }),
    ]);

    expect([...bytes.slice(0, 4)]).toEqual([0x0a, 0x0d, 0x0d, 0x0a]);
    expect(Buffer.from(bytes).includes(Buffer.from([0x30, 0x02, 0x05, 0x00]))).toBe(true);
    expect(new TextDecoder().decode(bytes)).toContain('headers reconstructed');
  });
});

describe('wire validation', () => {
  it('rejects non-BER traffic and accepts a complete SNMP community envelope', () => {
    expect(isPlausibleSnmpDatagram(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]))).toBe(false);
    expect(
      isPlausibleSnmpDatagram(
        Uint8Array.from([0x30, 0x0b, 0x02, 0x01, 0x01, 0x04, 0x06, 0x70, 0x75, 0x62, 0x6c, 0x69, 0x63]),
      ),
    ).toBe(true);
  });
});

describe('packet trace persistence', () => {
  it('keeps capturing in RAM and reports a warning when disk writes fail', async () => {
    const files = memoryFiles();
    const events: Array<{ kind: string; payload: unknown }> = [];
    const service = new PacketTraceService(files.store, (kind, payload) =>
      events.push({ kind, payload }),
    );
    await service.initialize();
    files.failAppend = true;

    service.record(packet('disk-full', { status: 'invalid', error: 'bad BER' }));
    await service.flush();

    expect(service.history()).toEqual([expect.objectContaining({ id: 'disk-full' })]);
    expect(service.status()).toMatchObject({ persistence: 'degraded', retentionMiB: 32 });
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'persistence-warning' })]),
    );
  });

  it('uses zero retention as RAM-only mode', async () => {
    const files = memoryFiles();
    const service = new PacketTraceService(files.store, () => undefined);
    await service.initialize();
    await service.updateSettings({ retentionMiB: 0 });

    service.record(packet('ram-only', { status: 'valid' }));
    await service.flush();

    expect(files.values.get('/data/packet-trace.jsonl')).toBeUndefined();
    expect(service.status()).toMatchObject({ persistence: 'disabled', retentionMiB: 0 });
  });
});

function memoryFiles(): {
  store: FileStore;
  values: Map<string, string>;
  failAppend: boolean;
} {
  const state = {
    values: new Map<string, string>(),
    failAppend: false,
    store: null as unknown as FileStore,
  };
  state.store = {
    async readText(path) {
      const value = state.values.get(path);
      if (value === undefined) throw new Error('ENOENT');
      return value;
    },
    async writeText(path, content) {
      state.values.set(path, content);
    },
    async appendText(path, content) {
      if (state.failAppend) throw new Error('ENOSPC');
      state.values.set(path, (state.values.get(path) ?? '') + content);
    },
    async readBytes() { return new Uint8Array(); },
    async writeBytes() {},
    async exists(path) { return state.values.has(path); },
    async remove(path) { state.values.delete(path); },
    async ensureDir() {},
    dataDir() { return '/data'; },
    join(...segments) { return segments.join('/').replace(/\/+/g, '/'); },
  };
  return state;
}
