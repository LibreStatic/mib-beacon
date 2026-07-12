import type { Transport, SecretStore } from '../types';
import { nodeUdpFactory } from './udp';
import { nodeTcpFactory } from './tcp';
import { nodeCrypto } from './crypto';
import { createNodeFileStore } from './files';
import { nodeStorageFactory } from './storage';
import { createInMemorySecretStore } from './secrets';
import { nodeHttpClient } from './http';

export { nodeUdpFactory } from './udp';
export { nodeTcpFactory } from './tcp';
export { nodeCrypto } from './crypto';
export { createNodeFileStore } from './files';
export { nodeStorageFactory } from './storage';
export { createInMemorySecretStore, createPersistentSecretStore } from './secrets';
export type { SecretCodec, PersistentSecretStoreOptions } from './secrets';
export { nodeHttpClient } from './http';

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
