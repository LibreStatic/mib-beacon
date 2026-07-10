import { AppRegistry } from 'react-native';
import { EngineProvider, AppRoot } from '@omc/app';
import { makeWsEngineProxy } from './ws-engine-proxy';

const engine = makeWsEngineProxy();

function Root() {
  return (
    <EngineProvider engine={engine}>
      <AppRoot />
    </EngineProvider>
  );
}

AppRegistry.registerComponent('OpenMibCatalog', () => Root);
AppRegistry.runApplication('OpenMibCatalog', {
  rootTag: document.getElementById('root'),
});
