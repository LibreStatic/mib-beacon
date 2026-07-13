import { AppRegistry } from 'react-native';
import { EngineProvider, AppRoot } from '@mibbeacon/app';
import { makeEngineProxy } from './engine-proxy';

const engine = makeEngineProxy();

function Root() {
  return (
    <EngineProvider engine={engine}>
      <AppRoot
        host={{
          canOpenWindow: true,
          newWindow: () => void window.mibbeaconBridge.newWindow(),
          setWindowTitle: (title) => void window.mibbeaconBridge.setWindowTitle(title),
        }}
      />
    </EngineProvider>
  );
}

AppRegistry.registerComponent('MibBeacon', () => Root);
AppRegistry.runApplication('MibBeacon', {
  rootTag: document.getElementById('root'),
});
