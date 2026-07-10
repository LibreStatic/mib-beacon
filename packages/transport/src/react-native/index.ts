// React Native transport backend. Compiled by Metro in apps/mobile; validated
// on-device (spike S3). Excluded from the Node-side package typecheck.
import type { Transport } from '../types';
import { rnUdpFactory } from './udp';
import { rnTcpFactory } from './tcp';
import { rnStorageFactory } from './storage';
import { rnCrypto, createRnFileStore, rnSecretStore, rnHttpClient } from './misc';

export { rnUdpFactory } from './udp';
export { rnTcpFactory } from './tcp';
export { rnStorageFactory } from './storage';
export { rnCrypto, createRnFileStore, rnSecretStore, rnHttpClient } from './misc';

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
