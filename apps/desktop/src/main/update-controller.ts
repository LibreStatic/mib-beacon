import type { AppUpdater, UpdateInfo } from 'electron-updater';

export interface UpdatePreferences {
  /** Disabled on a fresh install so MIB Beacon never makes an unapproved network request. */
  automaticChecks: boolean;
}

export type UpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  message?: string;
}

export interface UpdateControllerOptions {
  updater: AppUpdater;
  currentVersion: string;
  isPackaged: boolean;
  readPreferences: () => UpdatePreferences;
  writePreferences: (preferences: UpdatePreferences) => void;
  emit: (status: UpdateStatus) => void;
}

export class UpdateController {
  private status: UpdateStatus;

  constructor(private readonly options: UpdateControllerOptions) {
    this.status = {
      phase: options.readPreferences().automaticChecks ? 'idle' : 'disabled',
      currentVersion: options.currentVersion,
    };
    options.updater.autoDownload = false;
    options.updater.autoInstallOnAppQuit = true;
    options.updater.on('checking-for-update', () => this.setStatus({ phase: 'checking' }));
    options.updater.on('update-available', (info: UpdateInfo) =>
      this.setStatus({ phase: 'available', availableVersion: info.version }),
    );
    options.updater.on('update-not-available', () => this.setStatus({ phase: 'not-available' }));
    options.updater.on('download-progress', (progress) =>
      this.setStatus({ phase: 'downloading', percent: progress.percent }),
    );
    options.updater.on('update-downloaded', (info: UpdateInfo) =>
      this.setStatus({ phase: 'downloaded', availableVersion: info.version, percent: 100 }),
    );
    options.updater.on('error', (error: Error) =>
      this.setStatus({ phase: 'error', message: error.message }),
    );
  }

  snapshot(): { preferences: UpdatePreferences; status: UpdateStatus } {
    return { preferences: this.options.readPreferences(), status: { ...this.status } };
  }

  setAutomaticChecks(automaticChecks: boolean): ReturnType<UpdateController['snapshot']> {
    const preferences = { automaticChecks };
    this.options.writePreferences(preferences);
    if (!automaticChecks && ['idle', 'not-available', 'error'].includes(this.status.phase)) {
      this.setStatus({ phase: 'disabled' });
    } else if (automaticChecks && this.status.phase === 'disabled') {
      this.setStatus({ phase: 'idle' });
    }
    return this.snapshot();
  }

  async check(manual = false): Promise<UpdateStatus> {
    if (!this.options.isPackaged) {
      this.setStatus({
        phase: 'error',
        message: 'Update checks are available in packaged builds.',
      });
      return this.status;
    }
    if (!manual && !this.options.readPreferences().automaticChecks) return this.status;
    try {
      await this.options.updater.checkForUpdates();
    } catch (cause) {
      this.setStatus({
        phase: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
    return this.status;
  }

  async download(): Promise<UpdateStatus> {
    if (this.status.phase !== 'available') return this.status;
    try {
      await this.options.updater.downloadUpdate();
    } catch (cause) {
      this.setStatus({
        phase: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
    return this.status;
  }

  install(): void {
    if (this.status.phase === 'downloaded') this.options.updater.quitAndInstall(false, true);
  }

  private setStatus(patch: Partial<UpdateStatus>): void {
    this.status = {
      currentVersion: this.options.currentVersion,
      ...patch,
    } as UpdateStatus;
    this.options.emit(this.status);
  }
}
