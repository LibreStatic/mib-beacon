import type { SecretStore } from '../types';

/**
 * A codec the host injects to actually encrypt secrets at rest.
 * On Electron this is backed by `safeStorage` (see apps/desktop). The transport
 * layer NEVER persists plaintext — a store without a real encrypting codec must
 * report isEncrypted() === false so the engine can refuse to save credentials.
 */
export interface SecretCodec {
  encrypt(plaintext: string): string; // returns opaque, storable string (e.g. base64)
  decrypt(ciphertext: string): string;
  isEncrypted(): boolean;
}

/**
 * In-memory secret store — for tests and the feasibility spike only.
 * Persistent, encrypted credential storage lands with agent profiles (plan 04),
 * where apps/desktop injects a safeStorage-backed codec + a persistent backend.
 */
export function createInMemorySecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    async set(key, value) {
      map.set(key, value);
    },
    async get(key) {
      return map.get(key) ?? null;
    },
    async delete(key) {
      map.delete(key);
    },
    isEncrypted() {
      return false;
    },
  };
}
