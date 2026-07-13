import { app, BrowserWindow, safeStorage } from 'electron';
import crypto from 'node:crypto';
import { join } from 'node:path';
import { createNodeTransport, createPersistentSecretStore } from '@omc/transport/node';
import { createEngine } from '@omc/core';
import { registerEngineBridge } from './bridge';

const isProbe = process.argv.includes('--probe-crypto');

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
  const host = process.env.OMC_SPIKE_HOST ?? '127.0.0.1';
  const port = Number(process.env.OMC_SPIKE_PORT ?? 1611);
  const engine = createEngine(createNodeTransport({ dataDir: '/tmp/omc-probe' }), { dbPath: ':memory:' });
  const oid = '1.3.6.1.2.1.1.1.0';
  const cases: Array<{ label: string; agent: Parameters<typeof engine.ops.get>[0]['agent'] }> = [
    { label: 'v2c', agent: { host, port, version: 'v2c', community: 'public' } },
    {
      label: 'v3 SHA-256/AES-128',
      agent: { host, port, version: 'v3', v3: { user: 'spike_sha256_aes128', level: 'authPriv', authProtocol: 'sha256', authKey: 'authpass_sha256', privProtocol: 'aes', privKey: 'privpass_aes128' } },
    },
    {
      label: 'v3 MD5/DES',
      agent: { host, port, version: 'v3', v3: { user: 'spike_md5_des', level: 'authPriv', authProtocol: 'md5', authKey: 'authpass_md5xxx', privProtocol: 'des', privKey: 'privpass_desxxx' } },
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

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
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
  const engine = createEngine(transport, {
    dbPath: join(userData, 'omc.db'),
  });
  registerEngineBridge(engine, () => mainWindow);

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    title: 'Open MIB Catalog',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

if (isProbe) {
  // Headless crypto + SNMP probe. Run after whenReady so Electron's runtime
  // (native modules, event loop) is fully initialized; no window is created.
  app.disableHardwareAcceleration();
  app.whenReady().then(runCryptoProbe).finally(() => process.exit(0));
} else {
  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
