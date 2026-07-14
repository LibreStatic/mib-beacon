import { app, BrowserWindow, ipcMain, Menu, safeStorage, screen } from 'electron';
import { autoUpdater } from 'electron-updater';
import crypto from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createNodeTransport, createPersistentSecretStore } from '@mibbeacon/transport/node';
import { createEngine, type AgentSpec } from '@mibbeacon/core';
import { registerEngineBridge } from './bridge';
import {
  MAX_ASSOCIATED_FILE_BYTES,
  createMibSingleInstanceData,
  isMibAssociationPath,
  mibImportsFromSingleInstanceData,
  mibPathsFromArguments,
} from './file-associations';
import { UpdateController, type UpdatePreferences, type UpdateStatus } from './update-controller';
import { PackagedUpdateSmoke } from './update-smoke';
import { getNextWindowBounds, getVisibleWindowBounds, type Rectangle } from './window-geometry';

const isProbe = process.argv.includes('--probe-crypto');
const isSmokeTest = process.argv.includes('--smoke-test');
const isUpdateSmokeTest = process.argv.includes('--update-smoke-test');

/**
 * Spike S2 under Electron's runtime (BoringSSL, not OpenSSL): report which
 * SNMPv3 privacy ciphers are actually available here. Runs without a window so
 * it works headless. See docs/plans/SPIKE-RESULTS.md.
 */
async function runCryptoProbe(): Promise<void> {
  const ciphers = crypto.getCiphers();
  console.log(
    'CRYPTO_PROBE ' +
      JSON.stringify({
        runtime: 'electron-main',
        node: process.versions.node,
        electron: process.versions.electron,
        // Electron reports its TLS lib here; BoringSSL vs OpenSSL is the crux of
        // the DES question.
        openssl: process.versions.openssl ?? '(none / boringssl)',
        desCbc: ciphers.includes('des-cbc'),
        aes128Cfb: ciphers.includes('aes-128-cfb'),
        aes256Cfb: ciphers.includes('aes-256-cfb'),
      }),
  );

  // Exercise the REAL engine (S1 + S2) under Electron's runtime against the dev
  // snmpd container. Skips gracefully if the container isn't up.
  const host = process.env.MIB_BEACON_SPIKE_HOST ?? '127.0.0.1';
  const port = Number(process.env.MIB_BEACON_SPIKE_PORT ?? 1611);
  const engine = createEngine(createNodeTransport({ dataDir: '/tmp/mibbeacon-probe' }), {
    dbPath: ':memory:',
  });
  const oid = '1.3.6.1.2.1.1.1.0';
  const cases: Array<{ label: string; agent: AgentSpec }> = [
    { label: 'v2c', agent: { host, port, version: 'v2c', community: 'public' } },
    {
      label: 'v3 SHA-256/AES-128',
      agent: {
        host,
        port,
        version: 'v3',
        v3: {
          user: 'spike_sha256_aes128',
          level: 'authPriv',
          authProtocol: 'sha256',
          authKey: 'authpass_sha256',
          privProtocol: 'aes',
          privKey: 'privpass_aes128',
        },
      },
    },
    {
      label: 'v3 MD5/DES',
      agent: {
        host,
        port,
        version: 'v3',
        v3: {
          user: 'spike_md5_des',
          level: 'authPriv',
          authProtocol: 'md5',
          authKey: 'authpass_md5xxx',
          privProtocol: 'des',
          privKey: 'privpass_desxxx',
        },
      },
    },
  ];
  for (const c of cases) {
    try {
      const [vb] = await engine.ops.get({ agent: c.agent, oids: [oid] });
      console.log(`SNMP_PROBE ${c.label}: OK value="${vb?.value}"`);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      console.log(`SNMP_PROBE ${c.label}: FAIL ${err.code ?? ''} ${err.message ?? String(e)}`);
    }
  }
}

const windows = new Map<number, BrowserWindow>();
const pendingMibPaths = new Set<string>();
const pendingImports: Array<{ name: string; relativePath: string; bytes: number[] }> = [];
let savedBounds: Rectangle | null = null;
let releaseWindowBridgeState: (webContentsId: number) => void = () => undefined;
let updateController: UpdateController | null = null;

ipcMain.handle('mibbeacon:open-files:take', (event) => {
  const belongsToAppWindow = [...windows.values()].some(
    (window) => !window.isDestroyed() && window.webContents.id === event.sender.id,
  );
  return belongsToAppWindow ? pendingImports.splice(0) : [];
});

function boundsFile(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

function loadSavedBounds(): Rectangle | null {
  try {
    const parsed = JSON.parse(readFileSync(boundsFile(), 'utf8')) as Partial<Rectangle>;
    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number'
    ) {
      return parsed as Rectangle;
    }
  } catch {
    // First launch or an invalid state file: use safe defaults.
  }
  return null;
}

function persistBounds(bounds: Rectangle): void {
  savedBounds = bounds;
  try {
    writeFileSync(boundsFile(), JSON.stringify(bounds));
  } catch {
    // Window placement is a convenience; never prevent shutdown if persistence fails.
  }
}

function updatePreferencesFile(): string {
  return join(app.getPath('userData'), 'release-preferences.json');
}

function readUpdatePreferences(): UpdatePreferences {
  try {
    const value = JSON.parse(
      readFileSync(updatePreferencesFile(), 'utf8'),
    ) as Partial<UpdatePreferences>;
    return { automaticChecks: value.automaticChecks === true };
  } catch {
    return { automaticChecks: false };
  }
}

function writeUpdatePreferences(preferences: UpdatePreferences): void {
  writeFileSync(updatePreferencesFile(), `${JSON.stringify(preferences, null, 2)}\n`, {
    mode: 0o600,
  });
}

function broadcastUpdateStatus(status: UpdateStatus): void {
  for (const window of windows.values()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('mibbeacon:update-status', status);
    }
  }
}

function queueMibPaths(paths: readonly string[]): void {
  for (const path of paths) if (isMibAssociationPath(path)) pendingMibPaths.add(path);
  if (app.isReady()) materializePendingMibPaths();
}

function materializePendingMibPaths(): void {
  for (const path of pendingMibPaths) {
    pendingMibPaths.delete(path);
    try {
      if (statSync(path).size > MAX_ASSOCIATED_FILE_BYTES) {
        console.error('ASSOCIATED_MIB_REJECTED', { path, reason: 'candidate-too-large' });
        continue;
      }
      const bytes = readFileSync(path);
      pendingImports.push({
        name: basename(path),
        relativePath: basename(path),
        bytes: [...bytes],
      });
    } catch (cause) {
      console.error('ASSOCIATED_MIB_READ_FAILED', {
        path,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  sendPendingImports();
}

function sendPendingImports(): void {
  if (!pendingImports.length) return;
  const focused = BrowserWindow.getFocusedWindow();
  const target = focused && windows.has(focused.id) ? focused : [...windows.values()][0];
  if (
    !target ||
    target.isDestroyed() ||
    target.webContents.isDestroyed() ||
    target.webContents.isLoading()
  ) {
    return;
  }
  // Keep bytes in the main process until the sandboxed preload retrieves them.
  // A one-way payload can race renderer listener setup during OS launches.
  void target.webContents
    .executeJavaScript("window.dispatchEvent(new Event('mibbeacon:open-files-ready'))", true)
    .catch((cause) => console.error('ASSOCIATED_MIB_SIGNAL_FAILED', cause));
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
}

function initialBounds(): Rectangle {
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return getNextWindowBounds(
      focused.getBounds(),
      screen.getDisplayMatching(focused.getBounds()).workArea,
    );
  }
  return getVisibleWindowBounds(savedBounds ?? { x: 0, y: 0, width: 1100, height: 780 }, workAreas);
}

function createWindow(): BrowserWindow {
  const bounds = initialBounds();
  const window = new BrowserWindow({
    ...bounds,
    minWidth: 390,
    minHeight: 560,
    title: 'MIB Beacon',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  windows.set(window.id, window);
  const webContentsId = window.webContents.id;

  window.on('close', () => {
    if (!window.isMinimized() && !window.isMaximized() && !window.isFullScreen()) {
      persistBounds(window.getBounds());
    }
  });
  window.on('unresponsive', () => {
    console.error('WINDOW_UNRESPONSIVE', { windowId: window.id, webContentsId });
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('WINDOW_LOAD_FAILED', {
      windowId: window.id,
      webContentsId,
      code,
      description,
      url,
    });
  });
  window.webContents.on('did-finish-load', () => {
    sendPendingImports();
    if (isSmokeTest) {
      console.log('SMOKE_MAIN_WINDOW_READY');
      setTimeout(() => app.quit(), 250);
    }
  });
  window.on('closed', () => {
    releaseWindowBridgeState(webContentsId);
    windows.delete(window.id);
  });

  const windowId = String(window.id);
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    url.searchParams.set('windowId', windowId);
    void window.loadURL(url.toString());
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'), {
      query: { windowId },
    });
  }
  return window;
}

function configureApplication(engine: ReturnType<typeof createEngine>): void {
  const bridge = registerEngineBridge(
    engine,
    () => [...windows.values()],
    () => BrowserWindow.getFocusedWindow(),
  );
  releaseWindowBridgeState = bridge.releaseWindow;
  app.on('render-process-gone', (_event, webContents, details) => {
    console.error('RENDER_PROCESS_GONE', { webContentsId: webContents.id, ...details });
  });
  app.on('child-process-gone', (_event, details) => {
    console.error('CHILD_PROCESS_GONE', details);
  });
  ipcMain.handle('mibbeacon:window:new', () => createWindow().id);
  ipcMain.handle(
    'mibbeacon:window:id',
    (event) => BrowserWindow.fromWebContents(event.sender)?.id ?? null,
  );
  ipcMain.handle('mibbeacon:window:title', (event, title: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && typeof title === 'string') window.setTitle(title.slice(0, 160));
  });
  ipcMain.handle('mibbeacon:updates:get', () => updateController?.snapshot() ?? null);
  ipcMain.handle('mibbeacon:updates:automatic', (_event, enabled: unknown) =>
    updateController?.setAutomaticChecks(enabled === true),
  );
  ipcMain.handle('mibbeacon:updates:check', () => updateController?.check(true));
  ipcMain.handle('mibbeacon:updates:download', () => updateController?.download());
  ipcMain.handle('mibbeacon:updates:install', () => updateController?.install());

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          {
            label: 'New Window',
            accelerator: 'CmdOrCtrl+Shift+N',
            click: () => createWindow(),
          },
          { type: 'separator' },
          process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
}

function createSharedEngine(): ReturnType<typeof createEngine> {
  const userData = app.getPath('userData');
  const secrets = createPersistentSecretStore({
    filePath: join(userData, 'resolver-secrets.json'),
    codec: {
      encrypt: (plaintext) => safeStorage.encryptString(plaintext).toString('base64'),
      decrypt: (ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext, 'base64')),
      isEncrypted: () => safeStorage.isEncryptionAvailable(),
    },
  });
  const transport = createNodeTransport({ dataDir: userData, secrets });
  return createEngine(transport, {
    dbPath: join(userData, 'mibbeacon.db'),
  });
}

function configureUpdates(): void {
  updateController = new UpdateController({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    readPreferences: readUpdatePreferences,
    writePreferences: writeUpdatePreferences,
    emit: broadcastUpdateStatus,
  });
  setTimeout(() => void updateController?.check(false), 15_000);
}

app.on('open-file', (event, path) => {
  event.preventDefault();
  queueMibPaths([path]);
});

if (isProbe) {
  // Headless crypto + SNMP probe. Run after whenReady so Electron's runtime
  // (native modules, event loop) is fully initialized; no window is created.
  app.disableHardwareAcceleration();
  app
    .whenReady()
    .then(runCryptoProbe)
    .finally(() => process.exit(0));
} else {
  const launchArguments = process.argv.slice(1);
  const singleInstanceData = createMibSingleInstanceData(launchArguments);
  const hasInstanceLock = app.requestSingleInstanceLock(singleInstanceData);
  if (!hasInstanceLock) {
    app.quit();
  } else {
    app.on('second-instance', (_event, arguments_, _workingDirectory, additionalData) => {
      const transferred = mibImportsFromSingleInstanceData(additionalData);
      if (transferred.length) {
        pendingImports.push(...transferred.map((file) => ({ ...file, bytes: [...file.bytes] })));
      } else {
        queueMibPaths(mibPathsFromArguments(arguments_));
      }
      const existing = BrowserWindow.getFocusedWindow() ?? [...windows.values()][0];
      if (existing) {
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
      } else if (app.isReady()) createWindow();
      // Let activation/focus finish before crossing into the renderer. Flatpak
      // supplies portal-backed bytes while the second sandbox is shutting
      // down, and Electron can drop a synchronous send from this callback.
      if (transferred.length && app.isReady()) {
        setTimeout(() => {
          sendPendingImports();
        }, 100);
      }
    });

    app.whenReady().then(async () => {
      const updateSmoke = new PackagedUpdateSmoke({
        currentVersion: app.getVersion(),
        isPackaged: app.isPackaged,
        markerPath: join(app.getPath('userData'), 'update-smoke.json'),
        updater: autoUpdater,
      });
      try {
        const outcome = await updateSmoke.run(isUpdateSmokeTest);
        if (outcome === 'completed') {
          console.log('UPDATE_SMOKE_COMPLETE', { version: app.getVersion() });
          app.quit();
          return;
        }
        if (outcome === 'installing') {
          console.log('UPDATE_SMOKE_INSTALLING', { version: app.getVersion() });
          return;
        }
      } catch (error) {
        console.error('UPDATE_SMOKE_FAILED', error);
        if (isUpdateSmokeTest) {
          app.exit(1);
          return;
        }
      }
      savedBounds = loadSavedBounds();
      const engine = createSharedEngine();
      console.log('ENGINE_READY', { platform: process.platform, version: app.getVersion() });
      configureUpdates();
      configureApplication(engine);
      queueMibPaths(mibPathsFromArguments(launchArguments));
      createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
  }
}
