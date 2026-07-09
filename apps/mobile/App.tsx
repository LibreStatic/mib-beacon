import { useMemo } from 'react';
import { SafeAreaView, StatusBar, useColorScheme } from 'react-native';
import { createReactNativeTransport } from '@omc/transport/react-native';
import { createEngine } from '@omc/core';
import { EngineProvider, SpikeScreen } from '@omc/app';

/**
 * Mobile host: the engine runs IN-PROCESS (no IPC) with the React Native
 * transport backend. The same SpikeScreen renders as on desktop.
 */
export default function App() {
  const engine = useMemo(() => {
    const transport = createReactNativeTransport();
    return createEngine(transport, { dbPath: `${transport.files.dataDir()}omc.db` });
  }, []);

  const isDark = useColorScheme() === 'dark';
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? '#0e1116' : '#f6f7f9' }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <EngineProvider engine={engine}>
        <SpikeScreen />
      </EngineProvider>
    </SafeAreaView>
  );
}
