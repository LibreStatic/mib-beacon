import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type UpdateSmokeState = 'checking' | 'downloading' | 'installing' | 'complete' | 'error';

export interface UpdateSmokeMarker {
  schemaVersion: 1;
  fromVersion: string;
  expectedVersion: string;
  state: UpdateSmokeState;
  updatedAt: string;
  error?: string;
}

export interface UpdateSmokeUpdater {
  allowPrerelease: boolean;
  autoDownload: boolean;
  checkForUpdates(): Promise<{ updateInfo: { version: string } } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface PackagedUpdateSmokeOptions {
  currentVersion: string;
  isPackaged: boolean;
  markerPath: string;
  updater: UpdateSmokeUpdater;
}

export function deriveRc2Version(version: string): string {
  if (!/-rc\.1$/.test(version)) {
    throw new Error(`Update smoke must start from an rc.1 build, received ${version}.`);
  }
  return version.replace(/-rc\.1$/, '-rc.2');
}

export class PackagedUpdateSmoke {
  constructor(private readonly options: PackagedUpdateSmokeOptions) {}

  async run(requested: boolean): Promise<'inactive' | 'installing' | 'completed'> {
    const marker = await this.readMarker();
    if (marker?.state === 'installing' && marker.expectedVersion === this.options.currentVersion) {
      await this.writeMarker({ ...marker, state: 'complete', updatedAt: new Date().toISOString() });
      return 'completed';
    }
    if (!requested) return 'inactive';
    if (!this.options.isPackaged) {
      throw new Error('Update smoke requires a packaged application.');
    }

    const fromVersion = this.options.currentVersion;
    const expectedVersion = deriveRc2Version(fromVersion);
    const base: UpdateSmokeMarker = {
      schemaVersion: 1,
      fromVersion,
      expectedVersion,
      state: 'checking',
      updatedAt: new Date().toISOString(),
    };
    await this.writeMarker(base);

    try {
      this.options.updater.allowPrerelease = true;
      this.options.updater.autoDownload = false;
      const update = await this.options.updater.checkForUpdates();
      if (!update) throw new Error('The update provider returned no result.');
      if (update.updateInfo.version !== expectedVersion) {
        throw new Error(
          `Expected update ${expectedVersion}, provider returned ${update.updateInfo.version}.`,
        );
      }
      await this.writeMarker({
        ...base,
        state: 'downloading',
        updatedAt: new Date().toISOString(),
      });
      await this.options.updater.downloadUpdate();
      await this.writeMarker({
        ...base,
        state: 'installing',
        updatedAt: new Date().toISOString(),
      });
      this.options.updater.quitAndInstall(false, true);
      return 'installing';
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      await this.writeMarker({
        ...base,
        state: 'error',
        updatedAt: new Date().toISOString(),
        error,
      });
      throw cause;
    }
  }

  private async readMarker(): Promise<UpdateSmokeMarker | null> {
    try {
      return JSON.parse(await readFile(this.options.markerPath, 'utf8')) as UpdateSmokeMarker;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw cause;
    }
  }

  private async writeMarker(marker: UpdateSmokeMarker): Promise<void> {
    await mkdir(dirname(this.options.markerPath), { recursive: true });
    const temporary = `${this.options.markerPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.options.markerPath);
  }
}
