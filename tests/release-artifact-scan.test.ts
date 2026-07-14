import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const scanner = resolve(fileURLToPath(new URL('../dev/scan-release-artifacts.mjs', import.meta.url)));

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scan(name: string, content: string) {
  const root = mkdtempSync(join(tmpdir(), 'mibbeacon-scan-test-'));
  roots.push(root);
  writeFileSync(join(root, name), content);
  return spawnSync(process.execPath, [scanner, root], { encoding: 'utf8' });
}

describe('release artifact scanner', () => {
  it('gives the root verification command explicit desktop, APK, and AAB payload roots', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };
    expect(manifest.scripts?.['verify:artifacts']).toBe(
      'node dev/scan-release-artifacts.mjs apps/desktop/out apps/mobile/android/app/build/outputs/apk/release apps/mobile/android/app/build/outputs/bundle/release',
    );
  });

  it('allows a bundled public root certificate', () => {
    const result = scan(
      'expo-root.pem',
      '-----BEGIN CERTIFICATE-----\npublic certificate data\n-----END CERTIFICATE-----\n',
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it('rejects private key content even when stored in a pem file', () => {
    const result = scan(
      'signing.pem',
      '-----BEGIN PRIVATE KEY-----\nsecret material\n-----END PRIVATE KEY-----\n',
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('PRIVATE KEY');
  });
});
