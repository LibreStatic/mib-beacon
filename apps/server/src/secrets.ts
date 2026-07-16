import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPersistentSecretStore, type SecretCodec } from '@mibbeacon/transport/node';
import type { SecretStore } from '@mibbeacon/transport';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

interface ServerSecretStoreOptions {
  filePath: string;
  key: string | undefined;
}

interface ServerSecretKeyOptions {
  dataDir: string;
  key: string | undefined;
  allowGeneratedKey: boolean;
}

export function createServerSecretStore({ filePath, key }: ServerSecretStoreOptions): SecretStore {
  return createPersistentSecretStore({ filePath, codec: createServerSecretCodec(key) });
}

/**
 * Compose can opt into a key held in its persistent data volume, keeping the simple
 * first-run path secure without making a static key part of the project config.
 */
export async function resolveServerSecretKey({
  dataDir,
  key,
  allowGeneratedKey,
}: ServerSecretKeyOptions): Promise<string> {
  if (key?.trim()) return normalizeServerSecretKey(key);
  if (!allowGeneratedKey) return normalizeServerSecretKey(key);

  const keyPath = join(dataDir, 'server-secret.key');
  try {
    return normalizeServerSecretKey(await readFile(keyPath, 'utf8'));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  try {
    await readFile(join(dataDir, 'credentials.json'));
    throw new Error(
      'A generated server key is missing for existing credentials; set MIB_BEACON_SERVER_SECRET_KEY to the original key.',
    );
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const generatedKey = randomBytes(KEY_BYTES).toString('base64');
  try {
    await writeFile(keyPath, `${generatedKey}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return generatedKey;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return normalizeServerSecretKey(await readFile(keyPath, 'utf8'));
  }
}

/**
 * Validates every saved ciphertext before the server starts listening. A base64 key can
 * have the right shape while still not being the key that encrypted an existing data dir.
 */
export async function verifyServerSecretStore({ filePath, key }: ServerSecretStoreOptions): Promise<void> {
  const codec = createServerSecretCodec(key);
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  let values: unknown;
  try {
    values = JSON.parse(text);
  } catch {
    throw new Error('Encrypted server credential file is not valid JSON.');
  }
  if (!values || Array.isArray(values) || typeof values !== 'object') {
    throw new Error('Encrypted server credential file must contain an object.');
  }
  for (const value of Object.values(values)) {
    if (typeof value !== 'string') {
      throw new Error('Encrypted server credential file contains an invalid value.');
    }
    codec.decrypt(value);
  }
}

function createServerSecretCodec(key: string | undefined): SecretCodec {
  const encryptionKey = parseServerSecretKey(key);
  return {
    encrypt(plaintext) {
      const initializationVector = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, encryptionKey, initializationVector);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return Buffer.concat([initializationVector, cipher.getAuthTag(), ciphertext]).toString('base64');
    },
    decrypt(storedValue) {
      try {
        const payload = decodePayload(storedValue);
        const initializationVector = payload.subarray(0, IV_BYTES);
        const authTag = payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
        const ciphertext = payload.subarray(IV_BYTES + AUTH_TAG_BYTES);
        const decipher = createDecipheriv(ALGORITHM, encryptionKey, initializationVector);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch {
        throw new Error(
          'Unable to decrypt saved server credentials; verify MIB_BEACON_SERVER_SECRET_KEY has not changed.',
        );
      }
    },
    isEncrypted: () => true,
  };
}

function parseServerSecretKey(value: string | undefined): Buffer {
  const key = value?.trim() ?? '';
  if (!isBase64(key) || Buffer.from(key, 'base64').byteLength !== KEY_BYTES) {
    throw new Error(
      'MIB_BEACON_SERVER_SECRET_KEY must be a base64-encoded 32-byte key (generate one with `openssl rand -base64 32`).',
    );
  }
  return Buffer.from(key, 'base64');
}

function normalizeServerSecretKey(value: string | undefined): string {
  return parseServerSecretKey(value).toString('base64');
}

function decodePayload(value: string): Buffer {
  if (!isBase64(value)) throw new Error('Invalid encrypted server credential');
  const payload = Buffer.from(value, 'base64');
  if (payload.byteLength <= IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error('Invalid encrypted server credential');
  }
  return payload;
}

function isBase64(value: string): boolean {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}
