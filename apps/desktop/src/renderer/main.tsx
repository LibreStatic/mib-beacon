import { AppRegistry } from 'react-native';
import { EngineProvider, SpikeScreen } from '@omc/app';
import { makeEngineProxy } from './engine-proxy';

const engine = makeEngineProxy();

function Root() {
  return (
    <EngineProvider engine={engine}>
      <SpikeScreen />
    </EngineProvider>
  );
}

AppRegistry.registerComponent('OpenMibCatalog', () => Root);
AppRegistry.runApplication('OpenMibCatalog', {
  rootTag: document.getElementById('root'),
});
