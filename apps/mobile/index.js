// Global polyfills MUST load before net-snmp (which assumes Buffer/process).
import { Buffer } from 'buffer';
import process from 'process';

if (typeof global.Buffer === 'undefined') global.Buffer = Buffer;
if (typeof global.process === 'undefined') global.process = process;

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
