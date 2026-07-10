// Validated on-device (spike S3). Compiled by Metro in apps/mobile.
// SDK 54 moved the string-path API to the /legacy entry (the new File/Directory
// API lands with the MIB cache work in plan 03).
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import QuickCrypto from 'react-native-quick-crypto';
import type { CryptoProvider, FileStore, SecretStore, HttpClient } from '../types';
import { nodeHttpClient } from '../node/http';

export const rnCrypto: CryptoProvider = {
  randomBytes: (n) => new Uint8Array(QuickCrypto.randomBytes(n)),
  availableCiphers: () => {
    const c = QuickCrypto as unknown as { getCiphers?: () => string[] };
    return c.getCiphers ? c.getCiphers() : [];
  },
  hasCipher(name) {
    return this.availableCiphers().includes(name);
  },
};

export function createRnFileStore(): FileStore {
  const base = FileSystem.documentDirectory ?? '';
  const join = (...segments: string[]) => segments.join('/').replace(/\/+/g, '/');
  return {
    async readText(p) {
      return FileSystem.readAsStringAsync(p);
    },
    async writeText(p, content) {
      await FileSystem.writeAsStringAsync(p, content);
    },
    async readBytes(p) {
      const b64 = await FileSystem.readAsStringAsync(p, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    },
    async writeBytes(p, data) {
      const b64 = btoa(String.fromCharCode(...data));
      await FileSystem.writeAsStringAsync(p, b64, { encoding: FileSystem.EncodingType.Base64 });
    },
    async exists(p) {
      return (await FileSystem.getInfoAsync(p)).exists;
    },
    async remove(p) {
      await FileSystem.deleteAsync(p, { idempotent: true });
    },
    async ensureDir(p) {
      await FileSystem.makeDirectoryAsync(p, { intermediates: true });
    },
    dataDir() {
      return base;
    },
    join,
  };
}

/** expo-secure-store encrypts at rest via the OS keystore. */
export const rnSecretStore: SecretStore = {
  async set(key, value) {
    await SecureStore.setItemAsync(key, value);
  },
  async get(key) {
    return SecureStore.getItemAsync(key);
  },
  async delete(key) {
    await SecureStore.deleteItemAsync(key);
  },
  isEncrypted() {
    return true;
  },
};

/** fetch() exists in the RN runtime; reuse the same capped client as Node. */
export const rnHttpClient: HttpClient = nodeHttpClient;
