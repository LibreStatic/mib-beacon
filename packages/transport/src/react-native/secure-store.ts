import type { SecretStore } from '../types';

interface ExpoSecureStore {
  setItemAsync(key: string, value: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  deleteItemAsync(key: string): Promise<void>;
}

export function secureStoreKey(key: string): string {
  const encoded = Array.from(new TextEncoder().encode(key), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `mibbeacon.${encoded}`;
}

export function createRnSecretStore(secureStore: ExpoSecureStore): SecretStore {
  return {
    async set(key, value) {
      await secureStore.setItemAsync(secureStoreKey(key), value);
    },
    async get(key) {
      return secureStore.getItemAsync(secureStoreKey(key));
    },
    async delete(key) {
      await secureStore.deleteItemAsync(secureStoreKey(key));
    },
    isEncrypted() {
      return true;
    },
  };
}
