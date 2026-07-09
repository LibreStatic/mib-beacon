// React Native transport backend. Compiled by Metro in apps/mobile; validated
// on-device (spike S3). Excluded from the Node-side package typecheck.
import type { Transport } from '../types.js';
import { rnUdpFactory } from './udp.js';
import { rnTcpFactory } from './tcp.js';
import { rnStorageFactory } from './storage.js';
import { rnCrypto, createRnFileStore, rnSecretStore, rnHttpClient } from './misc.js';

export { rnUdpFactory } from './udp.js';
export { rnTcpFactory } from './tcp.js';
export { rnStorageFactory } from './storage.js';
export { rnCrypto, createRnFileStore, rnSecretStore, rnHttpClient } from './misc.js';

export function createReactNativeTransport(): Transport {
  return {
    udp: rnUdpFactory,
    tcp: rnTcpFactory,
    crypto: rnCrypto,
    files: createRnFileStore(),
    storage: rnStorageFactory,
    secrets: rnSecretStore,
    http: rnHttpClient,
    platform: 'react-native',
  };
}
