import crypto from 'node:crypto';
import type { CryptoProvider } from '../types';

export const nodeCrypto: CryptoProvider = {
  randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
  availableCiphers: () => crypto.getCiphers(),
  hasCipher: (name) => crypto.getCiphers().includes(name),
};
