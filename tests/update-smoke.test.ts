import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  deriveRc2Version,
  PackagedUpdateSmoke,
  type UpdateSmokeMarker,
  type UpdateSmokeUpdater,
} from '../apps/desktop/src/main/update-smoke';

async function fixture(version = '1.2.3-rc.1') {
  const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-update-smoke-'));
  const markerPath = join(directory, 'update-smoke.json');
  const updater: UpdateSmokeUpdater = {
    allowPrerelease: false,
    autoDownload: true,
    checkForUpdates: vi.fn().mockResolvedValue({ updateInfo: { version: '1.2.3-rc.2' } }),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn(),
  };
  return {
    markerPath,
    updater,
    smoke: new PackagedUpdateSmoke({
      currentVersion: version,
      isPackaged: true,
      markerPath,
      updater,
    }),
  };
}

async function readMarker(path: string): Promise<UpdateSmokeMarker> {
  return JSON.parse(await readFile(path, 'utf8')) as UpdateSmokeMarker;
}

describe('packaged release-candidate update smoke', () => {
  it('derives only a consecutive rc.2 target from an rc.1 build', () => {
    expect(deriveRc2Version('1.2.3-rc.1')).toBe('1.2.3-rc.2');
    expect(() => deriveRc2Version('1.2.3-beta.1')).toThrow(/rc\.1/i);
  });

  it('does nothing unless the packaged smoke flag was explicitly requested', async () => {
    const { smoke, updater } = await fixture();

    await expect(smoke.run(false)).resolves.toBe('inactive');
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('checks, downloads, and records an rc.1 to rc.2 install before restarting', async () => {
    const { smoke, updater, markerPath } = await fixture();

    await expect(smoke.run(true)).resolves.toBe('installing');
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.autoDownload).toBe(false);
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    await expect(readMarker(markerPath)).resolves.toMatchObject({
      schemaVersion: 1,
      fromVersion: '1.2.3-rc.1',
      expectedVersion: '1.2.3-rc.2',
      state: 'installing',
    });
  });

  it('turns an installing marker into reproducible completion evidence after rc.2 restarts', async () => {
    const first = await fixture();
    await first.smoke.run(true);
    const restarted = new PackagedUpdateSmoke({
      currentVersion: '1.2.3-rc.2',
      isPackaged: true,
      markerPath: first.markerPath,
      updater: first.updater,
    });

    await expect(restarted.run(true)).resolves.toBe('completed');
    await expect(readMarker(first.markerPath)).resolves.toMatchObject({ state: 'complete' });
  });

  it('rejects a non-consecutive provider response and records the error', async () => {
    const { smoke, updater, markerPath } = await fixture();
    vi.mocked(updater.checkForUpdates).mockResolvedValue({ updateInfo: { version: '1.2.4' } });

    await expect(smoke.run(true)).rejects.toThrow(/expected update 1\.2\.3-rc\.2/i);
    await expect(readMarker(markerPath)).resolves.toMatchObject({
      state: 'error',
      error: expect.stringMatching(/provider returned 1\.2\.4/i),
    });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
});
