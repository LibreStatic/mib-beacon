export type PacketTraceDirection = 'tx' | 'rx';
export type PacketTraceStatus = 'pending' | 'valid' | 'invalid';
export type PacketTraceOperation =
  | 'get'
  | 'getNext'
  | 'getBulk'
  | 'walk'
  | 'set'
  | 'trap'
  | 'inform'
  | 'response'
  | 'unknown';

export interface PacketTraceEvent {
  id: string;
  timestamp: number;
  direction: PacketTraceDirection;
  status: PacketTraceStatus;
  transport: 'udp4' | 'udp6';
  operation: PacketTraceOperation;
  localAddress?: string;
  localPort?: number;
  remoteAddress?: string;
  remotePort?: number;
  byteLength: number;
  rawHex: string;
  error?: string;
}

import type { FileStore } from '@mibbeacon/transport';

export interface PacketTraceSettings {
  retentionMiB: number;
}

export interface PacketTraceServiceStatus extends PacketTraceSettings {
  persistence: 'active' | 'disabled' | 'degraded';
  warning?: string;
  persistedBytes: number;
}

type PacketTraceServiceEvent = 'packet' | 'status' | 'persistence-warning' | 'cleared';

export class PacketTraceService {
  private readonly ring = new PacketTraceRing();
  private readonly historyPath: string;
  private readonly settingsPath: string;
  private settings: PacketTraceSettings = { retentionMiB: 32 };
  private persistence: PacketTraceServiceStatus['persistence'] = 'active';
  private warning?: string;
  private persistedLines: string[] = [];
  private persistedBytes = 0;
  private writes: Promise<void> = Promise.resolve();
  private readonly exports = new Map<string, Uint8Array>();
  private exportSequence = 0;

  constructor(
    private readonly files: FileStore,
    private readonly emit: (kind: PacketTraceServiceEvent, payload: unknown) => void,
    private readonly persistenceAvailable = true,
  ) {
    this.historyPath = files.join(files.dataDir(), 'packet-trace.jsonl');
    this.settingsPath = files.join(files.dataDir(), 'packet-trace-settings.json');
  }

  async initialize(): Promise<void> {
    if (!this.persistenceAvailable) {
      this.settings.retentionMiB = 0;
      this.persistence = 'disabled';
      this.emit('status', this.status());
      return;
    }
    try {
      const stored = JSON.parse(await this.files.readText(this.settingsPath)) as Partial<PacketTraceSettings>;
      this.settings.retentionMiB = normalizePacketTraceRetentionMiB(stored.retentionMiB ?? 32);
    } catch {
      // First run or unreadable settings: retain the safe default.
    }
    this.persistence = this.settings.retentionMiB === 0 ? 'disabled' : 'active';
    if (this.persistence === 'active') {
      try {
        const text = await this.files.readText(this.historyPath);
        this.persistedLines = text.split('\n').filter(Boolean).map((line) => `${line}\n`);
        this.persistedBytes = utf8Bytes(this.persistedLines.join(''));
        for (const line of this.persistedLines) {
          try {
            this.ring.upsert(JSON.parse(line) as PacketTraceEvent);
          } catch {
            // A torn final line must not prevent loading the remaining capture.
          }
        }
      } catch {
        // No history yet.
      }
    }
    this.emit('status', this.status());
  }

  record(event: PacketTraceEvent): void {
    this.ring.upsert(event);
    this.emit('packet', event);
    if (event.status === 'pending' || this.persistence !== 'active') return;
    const line = `${JSON.stringify(event)}\n`;
    this.writes = this.writes.then(() => this.persist(line)).catch(() => undefined);
  }

  history(): PacketTraceEvent[] {
    return this.ring.list();
  }

  status(): PacketTraceServiceStatus {
    return {
      retentionMiB: this.settings.retentionMiB,
      persistence: this.persistence,
      persistedBytes: this.persistedBytes,
      ...(this.warning ? { warning: this.warning } : {}),
    };
  }

  async updateSettings(patch: Partial<PacketTraceSettings>): Promise<PacketTraceServiceStatus> {
    if (!this.persistenceAvailable) return this.status();
    if (patch.retentionMiB !== undefined) {
      this.settings.retentionMiB = normalizePacketTraceRetentionMiB(patch.retentionMiB);
    }
    await this.files.writeText(this.settingsPath, JSON.stringify(this.settings));
    this.warning = undefined;
    if (this.settings.retentionMiB === 0) {
      this.persistence = 'disabled';
      this.persistedLines = [];
      this.persistedBytes = 0;
      await this.files.remove(this.historyPath);
    } else {
      this.persistence = 'active';
      await this.compactTo(this.settings.retentionMiB * 1024 * 1024);
    }
    const status = this.status();
    this.emit('status', status);
    return status;
  }

  async retryPersistence(): Promise<PacketTraceServiceStatus> {
    if (this.settings.retentionMiB === 0) return this.status();
    this.persistence = 'active';
    this.warning = undefined;
    try {
      await this.files.appendText(this.historyPath, '');
    } catch (error) {
      this.degrade(error);
    }
    const status = this.status();
    this.emit('status', status);
    return status;
  }

  async clear(): Promise<void> {
    await this.flush();
    this.ring.clear();
    this.persistedLines = [];
    this.persistedBytes = 0;
    await this.files.remove(this.historyPath);
    this.emit('cleared', {});
    this.emit('status', this.status());
  }

  async flush(): Promise<void> {
    await this.writes;
  }

  exportPcapng(): Uint8Array {
    const merged = new Map<string, PacketTraceEvent>();
    for (const line of this.persistedLines) {
      try {
        const event = JSON.parse(line) as PacketTraceEvent;
        merged.set(event.id, event);
      } catch {
        // Ignore a torn line.
      }
    }
    for (const event of this.ring.list()) merged.set(event.id, event);
    return encodePacketTracePcapng([...merged.values()].sort((a, b) => a.timestamp - b.timestamp));
  }

  createExport(): { id: string; fileName: string; byteLength: number } {
    const id = `pcapng-${Date.now()}-${this.exportSequence++}`;
    const bytes = this.exportPcapng();
    this.exports.set(id, bytes);
    return {
      id,
      fileName: `mibbeacon-packets-${new Date().toISOString().replace(/[:.]/g, '-')}.pcapng`,
      byteLength: bytes.length,
    };
  }

  readExportChunk(
    id: string,
    offset: number,
    limit = 256 * 1024,
  ): { base64: string; nextOffset: number; done: boolean } {
    const bytes = this.exports.get(id);
    if (!bytes) throw new Error('Packet capture export expired');
    const start = Math.max(0, Math.trunc(offset));
    const end = Math.min(bytes.length, start + Math.max(1, Math.min(1024 * 1024, Math.trunc(limit))));
    return { base64: base64(bytes.slice(start, end)), nextOffset: end, done: end >= bytes.length };
  }

  disposeExport(id: string): void {
    this.exports.delete(id);
  }

  private async persist(line: string): Promise<void> {
    const cap = this.settings.retentionMiB * 1024 * 1024;
    const bytes = utf8Bytes(line);
    if (bytes > cap) {
      this.degrade(new Error('A single packet trace exceeds the configured persistence limit'));
      return;
    }
    try {
      if (this.persistedBytes + bytes > cap) await this.compactTo(Math.floor(cap / 2) - bytes);
      await this.files.appendText(this.historyPath, line);
      this.persistedLines.push(line);
      this.persistedBytes += bytes;
      this.emit('status', this.status());
    } catch (error) {
      this.degrade(error);
    }
  }

  private async compactTo(targetBytes: number): Promise<void> {
    while (this.persistedLines.length > 0 && this.persistedBytes > Math.max(0, targetBytes)) {
      this.persistedBytes -= utf8Bytes(this.persistedLines.shift()!);
    }
    await this.files.writeText(this.historyPath, this.persistedLines.join(''));
  }

  private degrade(error: unknown): void {
    this.persistence = 'degraded';
    this.warning = `Packet history could not be written to disk: ${error instanceof Error ? error.message : String(error)}. Live RAM capture is still active.`;
    const status = this.status();
    this.emit('persistence-warning', status);
    this.emit('status', status);
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export class PacketTraceRing {
  private entries: PacketTraceEvent[] = [];

  constructor(
    private readonly maxEntries = 500,
    private readonly maxRawBytes = 4 * 1024 * 1024,
  ) {}

  upsert(event: PacketTraceEvent): void {
    const index = this.entries.findIndex(({ id }) => id === event.id);
    if (index >= 0) this.entries[index] = event;
    else this.entries.push(event);
    while (
      this.entries.length > this.maxEntries ||
      this.entries.reduce((sum, entry) => sum + entry.byteLength, 0) > this.maxRawBytes
    ) {
      this.entries.shift();
    }
  }

  list(): PacketTraceEvent[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}

export function normalizePacketTraceRetentionMiB(value: number): number {
  if (!Number.isFinite(value)) return 32;
  return Math.max(0, Math.min(256, Math.trunc(value)));
}

export function bytesToPacketHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

export function packetHexToBytes(value: string): Uint8Array {
  const pairs = value.match(/[0-9a-f]{2}/gi) ?? [];
  return Uint8Array.from(pairs.map((pair) => Number.parseInt(pair, 16)));
}

export function isPlausibleSnmpDatagram(bytes: Uint8Array): boolean {
  if (bytes.length < 5 || bytes[0] !== 0x30) return false;
  const outer = berLength(bytes, 1);
  if (!outer || outer.offset + outer.length > bytes.length) return false;
  const versionTag = outer.offset;
  if (bytes[versionTag] !== 0x02) return false;
  const version = berLength(bytes, versionTag + 1);
  if (!version || version.length < 1 || version.length > 4 || version.offset + version.length > bytes.length) return false;
  let value = 0;
  for (let index = 0; index < version.length; index += 1) value = (value << 8) | bytes[version.offset + index]!;
  return value === 0 || value === 1 || value === 3;
}

function berLength(bytes: Uint8Array, offset: number): { length: number; offset: number } | null {
  const first = bytes[offset];
  if (first === undefined) return null;
  if ((first & 0x80) === 0) return { length: first, offset: offset + 1 };
  const count = first & 0x7f;
  if (count === 0 || count > 4 || offset + count >= bytes.length) return null;
  let length = 0;
  for (let index = 0; index < count; index += 1) length = (length << 8) | bytes[offset + 1 + index]!;
  return { length, offset: offset + 1 + count };
}

/**
 * Export app-owned UDP payloads as PCAPNG. The SNMP payload is exact. Because a
 * datagram socket does not expose kernel-created headers, minimal IP/UDP headers
 * are reconstructed and every packet carries an explicit disclosure comment.
 */
export function encodePacketTracePcapng(events: readonly PacketTraceEvent[]): Uint8Array {
  const blocks: Uint8Array[] = [
    block(0x0a0d0d0a, concat(u32(0x1a2b3c4d), u16(1), u16(0), u64(-1n))),
    block(1, concat(u16(101), u16(0), u32(65_535), option(2, text('MIB Beacon raw IP')))),
  ];
  for (const event of events) {
    const payload = packetHexToBytes(event.rawHex);
    const packet = syntheticDatagram(event, payload);
    const micros = BigInt(Math.max(0, Math.trunc(event.timestamp))) * 1000n;
    const comment = text(
      `MIB Beacon ${event.direction.toUpperCase()} ${event.operation} ${event.status}; ` +
        'SNMP payload exact; IP/UDP headers reconstructed from socket metadata',
    );
    blocks.push(
      block(
        6,
        concat(
          u32(0),
          u32(Number((micros >> 32n) & 0xffff_ffffn)),
          u32(Number(micros & 0xffff_ffffn)),
          u32(packet.length),
          u32(packet.length),
          padded(packet),
          option(1, comment),
        ),
      ),
    );
  }
  return concat(...blocks);
}

function syntheticDatagram(event: PacketTraceEvent, payload: Uint8Array): Uint8Array {
  if (event.transport === 'udp6') return syntheticIpv6Datagram(event, payload);
  const source = event.direction === 'tx' ? event.localAddress : event.remoteAddress;
  const destination = event.direction === 'tx' ? event.remoteAddress : event.localAddress;
  const sourcePort = event.direction === 'tx' ? event.localPort : event.remotePort;
  const destinationPort = event.direction === 'tx' ? event.remotePort : event.localPort;
  const udp = udpDatagram(sourcePort, destinationPort, payload);
  const header = new Uint8Array(20);
  header[0] = 0x45;
  writeU16be(header, 2, header.length + udp.length);
  header[8] = 64;
  header[9] = 17;
  header.set(ipv4(source), 12);
  header.set(ipv4(destination), 16);
  writeU16be(header, 10, ipv4Checksum(header));
  return concat(header, udp);
}

function syntheticIpv6Datagram(event: PacketTraceEvent, payload: Uint8Array): Uint8Array {
  const source = event.direction === 'tx' ? event.localAddress : event.remoteAddress;
  const destination = event.direction === 'tx' ? event.remoteAddress : event.localAddress;
  const sourcePort = event.direction === 'tx' ? event.localPort : event.remotePort;
  const destinationPort = event.direction === 'tx' ? event.remotePort : event.localPort;
  const udp = udpDatagram(sourcePort, destinationPort, payload);
  const header = new Uint8Array(40);
  header[0] = 0x60;
  writeU16be(header, 4, udp.length);
  header[6] = 17;
  header[7] = 64;
  header.set(ipv6(source), 8);
  header.set(ipv6(destination), 24);
  return concat(header, udp);
}

function udpDatagram(sourcePort: number | undefined, destinationPort: number | undefined, payload: Uint8Array): Uint8Array {
  const header = new Uint8Array(8);
  writeU16be(header, 0, sourcePort ?? 0);
  writeU16be(header, 2, destinationPort ?? 0);
  writeU16be(header, 4, header.length + payload.length);
  return concat(header, payload);
}

function ipv4(value: string | undefined): Uint8Array {
  const parts = value?.split('.').map(Number);
  return parts?.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? Uint8Array.from(parts)
    : new Uint8Array(4);
}

function ipv6(value: string | undefined): Uint8Array {
  if (!value?.includes(':')) return new Uint8Array(16);
  const [left = '', right = ''] = value.split('::');
  const a = left ? left.split(':') : [];
  const b = right ? right.split(':') : [];
  const words = [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b].slice(0, 8);
  const out = new Uint8Array(16);
  words.forEach((word, index) => writeU16be(out, index * 2, Number.parseInt(word || '0', 16) || 0));
  return out;
}

function ipv4Checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let index = 0; index < bytes.length; index += 2) sum += (bytes[index]! << 8) | bytes[index + 1]!;
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return (~sum) & 0xffff;
}

function block(type: number, body: Uint8Array): Uint8Array {
  const total = 12 + body.length;
  return concat(u32(type), u32(total), body, u32(total));
}

function option(code: number, value: Uint8Array): Uint8Array {
  return concat(u16(code), u16(value.length), padded(value), u16(0), u16(0));
}

function padded(bytes: Uint8Array): Uint8Array {
  const padding = (4 - (bytes.length % 4)) % 4;
  return padding ? concat(bytes, new Uint8Array(padding)) : bytes;
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function u16(value: number): Uint8Array {
  return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function u64(value: bigint): Uint8Array {
  const normalized = value < 0 ? 0xffff_ffff_ffff_ffffn : value;
  return concat(u32(Number(normalized & 0xffff_ffffn)), u32(Number((normalized >> 32n) & 0xffff_ffffn)));
}

function writeU16be(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 8) & 0xff;
  target[offset + 1] = value & 0xff;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
