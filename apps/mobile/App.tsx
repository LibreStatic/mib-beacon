import { useEffect, useMemo } from 'react';
import { Platform, SafeAreaView, StatusBar, useColorScheme } from 'react-native';
import { createReactNativeTransport } from '@mibbeacon/transport/react-native';
import { createEngine } from '@mibbeacon/core';
import type { AgentSpec } from '@mibbeacon/core/client';
import { EngineProvider, AppRoot, FileImportProvider, type FileImportAdapter } from '@mibbeacon/app';
import { acquireNativeMibDirectory, acquireNativeMibFiles } from './src/file-import';

// The Android emulator reaches the host machine (where snmpd runs) via 10.0.2.2.
const SPIKE_HOST = '10.0.2.2';
const SPIKE_PORT = 1611;

/**
 * Mobile host: the engine runs IN-PROCESS (no IPC) with the React Native
 * transport backend. The same SpikeScreen renders as on desktop.
 */
export default function App() {
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
    const v2c: AgentSpec = { host: SPIKE_HOST, port: SPIKE_PORT, version: 'v2c', community: 'public' };
    const v3: AgentSpec = {
      host: SPIKE_HOST,
      port: SPIKE_PORT,
      version: 'v3',
      v3: { user: 'spike_sha256_aes128', level: 'authPriv', authProtocol: 'sha256', authKey: 'authpass_sha256', privProtocol: 'aes', privKey: 'privpass_aes128' },
    };
    (async () => {
      for (const [label, agent] of [['v2c', v2c], ['v3-sha256-aes128', v3]] as const) {
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

  const isDark = useColorScheme() === 'dark';
  const fileImportAdapter = useMemo<FileImportAdapter>(() => ({
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    acquireFiles: acquireNativeMibFiles,
    acquireDirectory: acquireNativeMibDirectory,
    destinationLabel: 'Engine on this device',
  }), []);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? '#0e1116' : '#f6f7f9' }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <EngineProvider engine={engine}>
        <FileImportProvider adapter={fileImportAdapter}>
          <AppRoot />
        </FileImportProvider>
      </EngineProvider>
    </SafeAreaView>
  );
}
