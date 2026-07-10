import { AppRegistry } from 'react-native';
import { EngineProvider, AppRoot } from '@omc/app';
import { makeEngineProxy } from './engine-proxy';

const engine = makeEngineProxy();

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
