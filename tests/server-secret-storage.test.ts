import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServerSecretStore, verifyServerSecretStore } from '../apps/server/src/secrets';

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
const WRONG_TEST_KEY = Buffer.alloc(32, 8).toString('base64');

describe('LAN server credential storage', () => {
  it('persists agent credentials with authenticated encryption and reloads them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-server-secrets-'));
    const filePath = join(directory, 'credentials.json');
    const store = createServerSecretStore({ filePath, key: TEST_KEY });

    await store.set('agent:one', 'public');
    await store.set('agent:two', 'public');

    const persisted = await readFile(filePath, 'utf8');
    const values = JSON.parse(persisted) as Record<string, string>;
    expect(store.isEncrypted()).toBe(true);
    expect(persisted).not.toContain('public');
    expect(values['agent:one']).not.toBe(values['agent:two']);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);

    const reloaded = createServerSecretStore({ filePath, key: TEST_KEY });
    await expect(reloaded.get('agent:one')).resolves.toBe('public');
    await expect(
      createServerSecretStore({ filePath, key: WRONG_TEST_KEY }).get('agent:one'),
    ).rejects.toThrow(/Unable to decrypt saved server credentials/);

    const tampered = JSON.parse(persisted) as Record<string, string>;
    const payload = Buffer.from(tampered['agent:one']!, 'base64');
    payload[payload.byteLength - 1] ^= 1;
    tampered['agent:one'] = payload.toString('base64');
    await writeFile(filePath, JSON.stringify(tampered));
    await expect(
      createServerSecretStore({ filePath, key: TEST_KEY }).get('agent:one'),
    ).rejects.toThrow(/Unable to decrypt saved server credentials/);
  });

  it('rejects an old credential file at startup when given a different valid key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-server-secrets-'));
    const filePath = join(directory, 'credentials.json');
    const store = createServerSecretStore({ filePath, key: TEST_KEY });
    await store.set('agent:one', 'public');

    await expect(verifyServerSecretStore({ filePath, key: TEST_KEY })).resolves.toBeUndefined();
    await expect(verifyServerSecretStore({ filePath, key: WRONG_TEST_KEY })).rejects.toThrow(
      /Unable to decrypt saved server credentials/,
    );
  });

  it('rejects a missing or malformed server key before serving browser clients', () => {
    expect(() => createServerSecretStore({ filePath: '/tmp/unused', key: undefined })).toThrow(
      /MIB_BEACON_SERVER_SECRET_KEY/,
    );
    expect(() => createServerSecretStore({ filePath: '/tmp/unused', key: 'not-a-32-byte-key' })).toThrow(
      /MIB_BEACON_SERVER_SECRET_KEY/,
    );
  });

  it('injects the configured encrypted store into the LAN server engine', () => {
    const server = readFileSync(new URL('../apps/server/src/server.ts', import.meta.url), 'utf8');

    expect(server).toContain("import { createServerSecretStore, verifyServerSecretStore } from './secrets';");
    expect(server).toContain("filePath: path.join(DATA_DIR, 'credentials.json')");
    expect(server).toContain('key: process.env.MIB_BEACON_SERVER_SECRET_KEY');
    expect(server).toContain('await verifyServerSecretStore(secretStoreOptions)');
    expect(server).toContain('createNodeTransport({ dataDir: DATA_DIR, secrets })');
  });

  it('passes the required credential key into the Compose runtime', () => {
    const compose = readFileSync(new URL('../compose.yml', import.meta.url), 'utf8');

    expect(compose).toContain('MIB_BEACON_SERVER_SECRET_KEY:');
    expect(compose).toContain('${MIB_BEACON_SERVER_SECRET_KEY:?');
  });
});
