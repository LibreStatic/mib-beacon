import { AppRegistry } from 'react-native';
import { EngineProvider, AppRoot } from '@mibbeacon/app';
import { makeWsEngineProxy } from './ws-engine-proxy';

const engine = makeWsEngineProxy();

function Root() {
  return (
    <EngineProvider engine={engine}>
      <AppRoot />
    </EngineProvider>
  );
}

AppRegistry.registerComponent('MibBeacon', () => Root);
AppRegistry.runApplication('MibBeacon', {
  rootTag: document.getElementById('root'),
});
