import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AppUpdater } from 'electron-updater';
import {
  createMibSingleInstanceData,
  isMibAssociationPath,
  mibImportsFromSingleInstanceData,
  mibPathsFromArguments,
} from '../apps/desktop/src/main/file-associations';
import {
  UpdateController,
  type UpdatePreferences,
} from '../apps/desktop/src/main/update-controller';
import { PackagedUpdateSmoke, deriveRc2Version } from '../apps/desktop/src/main/update-smoke';

function updateFixture(packaged = true) {
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn().mockResolvedValue(null),
    downloadUpdate: vi.fn().mockResolvedValue([]),
    quitAndInstall: vi.fn(),
  }) as unknown as AppUpdater;
  let preferences: UpdatePreferences = { automaticChecks: false };
  const statuses: string[] = [];
  const controller = new UpdateController({
    updater,
    currentVersion: '0.0.1-beta.1',
    isPackaged: packaged,
    readPreferences: () => preferences,
    writePreferences: (next) => {
      preferences = next;
    },
    emit: (status) => statuses.push(status.phase),
  });
  return { controller, updater, statuses, getPreferences: () => preferences };
}

describe('desktop MIB file associations', () => {
  it('accepts every registered extension case-insensitively', () => {
    expect(['sample.mib', 'sample.MY', 'sample.Smi'].map(isMibAssociationPath)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('extracts unique document paths without treating flags or executables as imports', () => {
    expect(
      mibPathsFromArguments([
        '/opt/mib-beacon/mib-beacon',
        '--no-sandbox',
        '/tmp/IF-MIB.mib',
        '/tmp/IF-MIB.mib',
        'C:\\MIBs\\VENDOR.my',
        '/tmp/readme.txt',
      ]),
    ).toEqual(['/tmp/IF-MIB.mib', 'C:\\MIBs\\VENDOR.my']);
  });

  it('transfers document bytes through Electron single-instance data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mibbeacon-associated-file-'));
    const path = join(directory, 'FORWARDED-MIB.mib');
    const source = Buffer.from('FORWARDED-MIB DEFINITIONS ::= BEGIN\nEND\n');
    writeFileSync(path, source);
    try {
      const data = createMibSingleInstanceData(['/opt/mib-beacon', path]);
      const imports = mibImportsFromSingleInstanceData(data);
      expect(imports).toHaveLength(1);
      expect(imports[0]).toMatchObject({
        name: 'FORWARDED-MIB.mib',
        relativePath: 'FORWARDED-MIB.mib',
      });
      expect(Buffer.from(imports[0]!.bytes)).toEqual(source);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects malformed or oversized single-instance file payloads', () => {
    expect(
      mibImportsFromSingleInstanceData(
        {
          mibbeaconAssociatedMibFiles: [
            { name: '../escape.mib', relativePath: '/tmp/safe.mib', contentBase64: 'eA==' },
            { name: 'bad.txt', relativePath: '/tmp/bad.txt', contentBase64: 'eA==' },
            { name: 'large.mib', relativePath: '/tmp/large.mib', contentBase64: 'eHh4eA==' },
          ],
        },
        3,
      ),
    ).toEqual([]);
  });
});

describe('desktop Linux packaging', () => {
  it('allows only local/data image sources needed for SVG chart rasterization', () => {
    const renderer = readFileSync(
      new URL('../apps/desktop/src/renderer/index.html', import.meta.url),
      'utf8',
    );
    expect(renderer).toContain("img-src 'self' data: blob:");
    expect(renderer).toContain("script-src 'self'");
  });

  it('declares the ALSA runtime needed by Electron on clean Debian-family installs', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'),
    ) as { build?: { deb?: { depends?: string[] } } };
    expect(manifest.build?.deb?.depends).toEqual(
      expect.arrayContaining([
        'libgtk-3-0',
        'libnotify4',
        'libnss3',
        'libxss1',
        'libxtst6',
        'xdg-utils',
        'libatspi2.0-0',
        'libuuid1',
        'libsecret-1-0',
        'libasound2t64 | libasound2',
      ]),
    );
  });

  it('keeps clean-package launch checks reproducible for every Linux format', () => {
    const runner = readFileSync(
      new URL('../dev/audit/linux-package-smoke.sh', import.meta.url),
      'utf8',
    );
    expect(runner).toContain('deb install-launch-uninstall passed');
    expect(runner).toContain('AppImage FUSE launch passed');
    expect(runner).toContain('rpm install-launch-uninstall passed');
    expect(runner).toContain('Flatpak install-launch-uninstall passed');
    expect(runner).toContain('Flatpak native Wayland launch passed');
    expect(runner).toContain('ENGINE_READY');
  });

  it('keeps the Flatpak portal import and persisted-settings journey reproducible', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const runner = readFileSync(
      new URL('../dev/audit/flatpak-interactive-smoke.py', import.meta.url),
      'utf8',
    );
    expect(manifest.scripts?.['audit:flatpak-interactive']).toBe(
      'python3 dev/audit/flatpak-interactive-smoke.py',
    );
    expect(runner).toContain('org.freedesktop.portal.FileChooser');
    expect(runner).toContain('FIXTURE-MIB.mib');
    expect(runner).toContain('NEEDS-IF-MIB.mib');
    expect(runner).toContain('mibbeacon:theme');
    expect(runner).toContain('mibbeacon:density');
    expect(runner).toContain('keyboardOnly');
    expect(runner).toContain('accessibilitySnapshots');
    expect(runner).toContain('packagedVisuals');
    expect(runner).toContain('org.freedesktop.Notifications');
    expect(runner).toContain('flatpak-interactive-chart.png');
    expect(runner).toContain('flatpak-interactive-chart-export.png');
    expect(runner).toContain('expect_download');
    expect(runner).toContain('fileAssociations');
    expect(runner).toContain('"gio", "launch"');
    expect(runner).toContain('ACCESSIBILITY_ENABLED=1');
    expect(runner).toContain('time.monotonic() + 5');
    expect(runner).toContain('control.is_checked()');
    expect(runner).toContain('portal import and settings persistence passed');
  });

  it('mounts the file-import review globally for operating-system associations', () => {
    const root = readFileSync(new URL('../packages/app/src/AppRoot.tsx', import.meta.url), 'utf8');
    expect(root).toContain('<FileImportReviewModal />');
  });

  it('gives every Settings switch a stable accessible name', () => {
    const settings = readFileSync(
      new URL('../packages/app/src/screens/SettingsScreen.tsx', import.meta.url),
      'utf8',
    );
    expect(settings).toContain('accessibilityLabel={label}');
    expect(settings).toContain('accessibilityLabel={`Enable ${source.name}`}');
    expect(settings.match(/<Switch/g)).toHaveLength(2);
    expect(settings.match(/accessibilityLabel=/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('desktop update controller', () => {
  it('defaults to privacy-preserving disabled automatic checks and permits a manual check', async () => {
    const { controller, updater } = updateFixture();
    expect(controller.snapshot().status.phase).toBe('disabled');
    await controller.check(false);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await controller.check(true);
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('persists the automatic-check preference and exposes updater progress', async () => {
    const { controller, updater, statuses, getPreferences } = updateFixture();
    controller.setAutomaticChecks(true);
    expect(getPreferences()).toEqual({ automaticChecks: true });
    updater.emit('update-available', { version: '0.0.1-beta.2' });
    expect(controller.snapshot().status.availableVersion).toBe('0.0.1-beta.2');
    await controller.download();
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();
    updater.emit('update-downloaded', { version: '0.0.1-beta.2' });
    controller.install();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(statuses).toContain('downloaded');
  });

  it('explains that unpackaged development builds cannot update', async () => {
    const { controller } = updateFixture(false);
    await controller.check(true);
    expect(controller.snapshot().status).toMatchObject({
      phase: 'error',
      message: expect.stringContaining('packaged'),
    });
  });
});

describe('packaged rc1 to rc2 update smoke', () => {
  it('derives only the consecutive rc2 target', () => {
    expect(deriveRc2Version('0.1.0-rc.1')).toBe('0.1.0-rc.2');
    expect(() => deriveRc2Version('0.1.0-beta.1')).toThrow(/rc\.1/);
  });

  it('persists installation intent and lets the restarted rc2 prove completion', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mibbeacon-update-smoke-'));
    const markerPath = join(root, 'update-smoke.json');
    const updater = {
      allowPrerelease: false,
      autoDownload: true,
      checkForUpdates: vi.fn().mockResolvedValue({ updateInfo: { version: '0.1.0-rc.2' } }),
      downloadUpdate: vi.fn().mockResolvedValue([]),
      quitAndInstall: vi.fn(),
    };
    try {
      const rc1 = new PackagedUpdateSmoke({
        currentVersion: '0.1.0-rc.1',
        isPackaged: true,
        markerPath,
        updater,
      });
      await expect(rc1.run(true)).resolves.toBe('installing');
      expect(updater.allowPrerelease).toBe(true);
      expect(updater.autoDownload).toBe(false);
      expect(updater.downloadUpdate).toHaveBeenCalledOnce();
      expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);

      const rc2 = new PackagedUpdateSmoke({
        currentVersion: '0.1.0-rc.2',
        isPackaged: true,
        markerPath,
        updater,
      });
      await expect(rc2.run(false)).resolves.toBe('completed');
      expect(JSON.parse(readFileSync(markerPath, 'utf8'))).toMatchObject({
        fromVersion: '0.1.0-rc.1',
        expectedVersion: '0.1.0-rc.2',
        state: 'complete',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
