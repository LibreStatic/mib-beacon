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
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root.');

const bootScreen = root.querySelector<HTMLElement>('.boot-screen');
const appRoot = document.createElement('div');
appRoot.id = 'app-root';
root.append(appRoot);

AppRegistry.runApplication('MibBeacon', {
  rootTag: appRoot,
});

window.requestAnimationFrame(() => {
  bootScreen?.setAttribute('aria-hidden', 'true');
  bootScreen?.classList.add('boot-screen--exit');
  window.setTimeout(() => bootScreen?.remove(), 120);
});
