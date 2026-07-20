import { useEffect, useMemo } from 'react';
import { Platform, StatusBar, useColorScheme } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';
import * as Sharing from 'expo-sharing';
import { Buffer } from 'buffer';
import { createReactNativeTransport } from '@mibbeacon/transport/react-native';
import { createEngine } from '@mibbeacon/core';
import type { AgentSpec } from '@mibbeacon/core/client';
import {
  EngineProvider,
  AppRoot,
  FileImportProvider,
  useAppStore,
  type FileImportAdapter,
  type AppHostAdapter,
  type PaletteHistoryStorage,
} from '@mibbeacon/app';
import { acquireNativeMibDirectory, acquireNativeMibFiles } from './src/file-import';
import { acquireNativeThemeFiles } from './src/theme-import';

// The Android emulator reaches the host machine (where snmpd runs) via 10.0.2.2.
const SPIKE_HOST = '10.0.2.2';
const SPIKE_PORT = 1611;

/**
 * Mobile host: the engine runs IN-PROCESS (no IPC) with the React Native
 * transport backend. The same SpikeScreen renders as on desktop.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <MobileApp />
    </SafeAreaProvider>
  );
}

function MobileApp() {
  const insets = useSafeAreaInsets();
  const engine = useMemo(() => {
    const transport = createReactNativeTransport();
    return createEngine(transport, { dbPath: `${transport.files.dataDir()}mibbeacon.db` });
  }, []);

  // Spike S3 self-test: exercise the RN transport (react-native-udp +
  // react-native-quick-crypto) with real SNMP against the host snmpd, logging a
  // machine-readable result to logcat. Dev-only.
  useEffect(() => {
    if (!__DEV__) return;
    const sysDescr = '1.3.6.1.2.1.1.1.0';
    const v2c: AgentSpec = {
      host: SPIKE_HOST,
      port: SPIKE_PORT,
      version: 'v2c',
      community: 'public',
    };
    const v3: AgentSpec = {
      host: SPIKE_HOST,
      port: SPIKE_PORT,
      version: 'v3',
      v3: {
        user: 'spike_sha256_aes128',
        level: 'authPriv',
        authProtocol: 'sha256',
        authKey: 'authpass_sha256',
        privProtocol: 'aes',
        privKey: 'privpass_aes128',
      },
    };
    (async () => {
      for (const [label, agent] of [
        ['v2c', v2c],
        ['v3-sha256-aes128', v3],
      ] as const) {
        try {
          const [vb] = await engine.ops.get({ agent, oids: [sysDescr] });
          console.log(`S3_SELFTEST ${label}: OK value="${vb?.value}"`);
        } catch (e) {
          const err = e as { code?: string; message?: string };
          console.log(`S3_SELFTEST ${label}: FAIL ${err.code ?? ''} ${err.message ?? String(e)}`);
        }
      }
    })();
  }, [engine]);

  const systemScheme = useColorScheme();
  const themeMode = useAppStore((state) => state.themeMode);
  const isDark = themeMode === 'system' ? systemScheme === 'dark' : themeMode === 'dark';
  const fileImportAdapter = useMemo<FileImportAdapter>(
    () => ({
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      acquireFiles: acquireNativeMibFiles,
      acquireDirectory: acquireNativeMibDirectory,
      destinationLabel: 'Engine on this device',
    }),
    [],
  );
  const host = useMemo<AppHostAdapter>(
    () => ({
      canOpenWindow: false,
      newWindow: () => undefined,
      themeStorage: {
        getItem: (key) => Storage.getItem(key),
        setItem: (key, value) => Storage.setItem(key, value),
        removeItem: (key) => Storage.removeItem(key),
      },
      pickThemeFiles: acquireNativeThemeFiles,
      async savePacketCapture(capture) {
        if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable.');
        const file = new File(Paths.cache, capture.fileName);
        if (file.exists) file.delete();
        file.create({ intermediates: true });
        const handle = file.open();
        try {
          let offset = 0;
          while (offset < capture.byteLength) {
            const chunk = await capture.readChunk(offset);
            handle.writeBytes(new Uint8Array(Buffer.from(chunk.base64, 'base64')));
            offset = chunk.nextOffset;
            if (chunk.done) break;
          }
        } finally {
          handle.close();
        }
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/vnd.tcpdump.pcap',
          dialogTitle: 'Export MIB Beacon packet capture',
        });
      },
    }),
    [],
  );
  const paletteHistoryStorage = useMemo<PaletteHistoryStorage>(
    () => ({
      getItem: (key) => Storage.getItem(key),
      setItem: (key, value) => Storage.setItem(key, value),
      removeItem: (key) => Storage.removeItem(key),
    }),
    [],
  );
  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={{
        flex: 1,
        backgroundColor: isDark ? '#1f1f1f' : '#f8f8f8',
      }}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <EngineProvider engine={engine}>
        <FileImportProvider adapter={fileImportAdapter}>
          <AppRoot
            host={host}
            paletteHistoryStorage={paletteHistoryStorage}
            safeAreaBottomInset={insets.bottom}
          />
        </FileImportProvider>
      </EngineProvider>
    </SafeAreaView>
  );
}
