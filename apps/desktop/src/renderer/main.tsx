import { AppRegistry } from 'react-native';
import { useEffect } from 'react';
import { EngineProvider, AppRoot, type AppHostAdapter } from '@mibbeacon/app';
import { makeEngineProxy } from './engine-proxy';

const engine = makeEngineProxy();
type OpenFileListener = Parameters<NonNullable<AppHostAdapter['subscribeOpenFiles']>>[0];
type OpenFiles = Parameters<OpenFileListener>[0];
const openFileListeners = new Set<OpenFileListener>();
const queuedOpenFiles: OpenFiles[] = [];

async function pollOpenFiles(): Promise<void> {
  const files = await window.mibbeaconBridge.takeOpenFiles();
  if (!files.length) return;
  const decoded = files.map((file) => ({
    name: file.name,
    relativePath: file.relativePath,
    bytes: new Uint8Array(file.bytes),
  }));
  if (!openFileListeners.size) queuedOpenFiles.push(decoded);
  else for (const listener of openFileListeners) listener(decoded);
}

const desktopHost: AppHostAdapter = {
  canOpenWindow: true,
  newWindow: () => void window.mibbeaconBridge.newWindow(),
  setWindowTitle: (title) => void window.mibbeaconBridge.setWindowTitle(title),
  updates: window.mibbeaconBridge.updates,
  subscribeOpenFiles: (listener) => {
    openFileListeners.add(listener);
    for (const files of queuedOpenFiles.splice(0)) listener(files);
    return () => openFileListeners.delete(listener);
  },
};

function Root() {
  useEffect(() => {
    const poll = () => void pollOpenFiles();
    window.addEventListener('focus', poll);
    window.addEventListener('mibbeacon:open-files-ready', poll);
    poll();
    return () => {
      window.removeEventListener('focus', poll);
      window.removeEventListener('mibbeacon:open-files-ready', poll);
    };
  }, []);
  return (
    <EngineProvider engine={engine}>
      <AppRoot host={desktopHost} />
    </EngineProvider>
  );
}

AppRegistry.registerComponent('MibBeacon', () => Root);
AppRegistry.runApplication('MibBeacon', {
  rootTag: document.getElementById('root'),
});
