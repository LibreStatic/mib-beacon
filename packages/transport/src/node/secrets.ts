import type { SecretStore } from '../types';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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

export interface PersistentSecretStoreOptions {
  filePath: string;
  codec: SecretCodec;
}

/** Persistent encrypted key/value store for host-provided codecs such as Electron safeStorage. */
export function createPersistentSecretStore({ filePath, codec }: PersistentSecretStoreOptions): SecretStore {
  let valuesPromise: Promise<Record<string, string>> | undefined;
  let mutation = Promise.resolve();
  const load = (): Promise<Record<string, string>> => {
    valuesPromise ??= readFile(filePath, 'utf8')
      .then((text) => {
        const parsed = JSON.parse(text) as unknown;
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
          throw new Error('Encrypted secret file must contain an object');
        }
        if (Object.values(parsed).some((value) => typeof value !== 'string')) {
          throw new Error('Encrypted secret file contains an invalid value');
        }
        return parsed as Record<string, string>;
      })
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
        throw error;
      });
    return valuesPromise;
  };
  const persist = async (values: Record<string, string>): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(values), { encoding: 'utf8', mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, filePath);
    await chmod(filePath, 0o600);
  };
  const mutate = (operation: (values: Record<string, string>) => void): Promise<void> => {
    mutation = mutation.then(async () => {
      if (!codec.isEncrypted()) throw new Error('Encrypted credential storage is unavailable');
      const values = await load();
      operation(values);
      await persist(values);
    });
    return mutation;
  };
  return {
    set: (key, value) => mutate((values) => { values[key] = codec.encrypt(value); }),
    async get(key) {
      const encrypted = (await load())[key];
      return encrypted === undefined ? null : codec.decrypt(encrypted);
    },
    delete: (key) => mutate((values) => { delete values[key]; }),
    isEncrypted: () => codec.isEncrypted(),
  };
}
