import type { Transport, SecretStore } from '../types.js';
import { nodeUdpFactory } from './udp.js';
import { nodeTcpFactory } from './tcp.js';
import { nodeCrypto } from './crypto.js';
import { createNodeFileStore } from './files.js';
import { nodeStorageFactory } from './storage.js';
import { createInMemorySecretStore } from './secrets.js';
import { nodeHttpClient } from './http.js';

export { nodeUdpFactory } from './udp.js';
export { nodeTcpFactory } from './tcp.js';
export { nodeCrypto } from './crypto.js';
export { createNodeFileStore } from './files.js';
export { nodeStorageFactory } from './storage.js';
export { createInMemorySecretStore } from './secrets.js';
export type { SecretCodec } from './secrets.js';
export { nodeHttpClient } from './http.js';

export interface NodeTransportOptions {
  dataDir?: string;
  /** Host-injected encrypting secret store (Electron safeStorage). */
  secrets?: SecretStore;
}

export function createNodeTransport(opts: NodeTransportOptions = {}): Transport {
  return {
    udp: nodeUdpFactory,
    tcp: nodeTcpFactory,
    crypto: nodeCrypto,
    files: createNodeFileStore(opts.dataDir),
    storage: nodeStorageFactory,
    secrets: opts.secrets ?? createInMemorySecretStore(),
    http: nodeHttpClient,
    platform: 'node',
  };
}
