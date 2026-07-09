/**
 * Platform abstraction interfaces (see docs/plans/01-architecture.md).
 *
 * These are the ONLY seam that differs between the Electron (Node) host and the
 * React Native host. Everything above transport is platform-agnostic.
 *
 * NOTE: node-net-snmp manages its own UDP sockets and crypto internally; on RN
 * those `require('dgram')` / `require('crypto')` calls are redirected by Metro
 * aliases (see apps/mobile/metro.config). The socket/crypto factories here exist
 * for OUR code (resolver FTP, future needs), not to feed node-net-snmp.
 */

// ---------------------------------------------------------------------------
// UDP
// ---------------------------------------------------------------------------

export type UdpFamily = 'udp4' | 'udp6';

export interface UdpMessage {
  data: Uint8Array;
  address: string;
  port: number;
}

export interface UdpSocket {
  bind(port?: number, address?: string): Promise<void>;
  send(data: Uint8Array, port: number, address: string): Promise<void>;
  onMessage(listener: (msg: UdpMessage) => void): () => void;
  onError(listener: (err: Error) => void): () => void;
  address(): { address: string; port: number } | null;
  close(): Promise<void>;
}

export interface UdpSocketFactory {
  create(family: UdpFamily): UdpSocket;
}

// ---------------------------------------------------------------------------
// TCP (used by the resolver's FTP source, plan 07)
// ---------------------------------------------------------------------------

export interface TcpSocket {
  connect(port: number, host: string, opts?: { tls?: boolean }): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  onData(listener: (data: Uint8Array) => void): () => void;
  onError(listener: (err: Error) => void): () => void;
  onClose(listener: () => void): () => void;
  end(): Promise<void>;
}

export interface TcpSocketFactory {
  create(): TcpSocket;
}

// ---------------------------------------------------------------------------
// Crypto (generic primitives; SNMP USM crypto is internal to node-net-snmp)
// ---------------------------------------------------------------------------

export interface CryptoProvider {
  randomBytes(n: number): Uint8Array;
  /** Lists available cipher names (used by the spike to probe DES availability). */
  availableCiphers(): string[];
  hasCipher(name: string): boolean;
}

// ---------------------------------------------------------------------------
// Filesystem (content-addressed MIB cache, snapshots)
// ---------------------------------------------------------------------------

export interface FileStore {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  ensureDir(path: string): Promise<void>;
  /** Absolute path to the app's private data directory. */
  dataDir(): string;
  join(...segments: string[]): string;
}

// ---------------------------------------------------------------------------
// SQLite storage
// ---------------------------------------------------------------------------

export type SqlValue = string | number | null | Uint8Array;

export interface StorageAdapter {
  exec(sql: string): void;
  run(sql: string, params?: SqlValue[]): { changes: number; lastInsertRowid: number };
  get<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): T | undefined;
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): T[];
  transaction<T>(fn: () => T): T;
  close(): void;
}

export interface StorageFactory {
  open(filePath: string): StorageAdapter;
}

// ---------------------------------------------------------------------------
// Secret store (SNMP credentials — never plaintext SQLite)
// ---------------------------------------------------------------------------

export interface SecretStore {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  /** True if the backing store actually encrypts at rest. */
  isEncrypted(): boolean;
}

// ---------------------------------------------------------------------------
// HTTP (resolver online sources)
// ---------------------------------------------------------------------------

export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Cap on downloaded bytes; reject beyond it (guards against soft-200 giants). */
  maxBytes?: number;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text: string;
  bytes: number;
}

export interface HttpClient {
  fetch(req: HttpRequest): Promise<HttpResponse>;
}

// ---------------------------------------------------------------------------
// The complete platform surface handed to the engine.
// ---------------------------------------------------------------------------

export interface Transport {
  udp: UdpSocketFactory;
  tcp: TcpSocketFactory;
  crypto: CryptoProvider;
  files: FileStore;
  storage: StorageFactory;
  secrets: SecretStore;
  http: HttpClient;
  /** Which platform backend is active (for diagnostics/logging only). */
  readonly platform: 'node' | 'react-native';
}

export const USER_AGENT = 'OpenMIBCatalog/0.0.0 (+https://github.com/openmibcatalog/openmibcatalog)';
