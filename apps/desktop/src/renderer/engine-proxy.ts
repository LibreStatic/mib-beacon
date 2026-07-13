import { createEngineProxy, type EngineAPI, type EngineEvent } from '@mibbeacon/core/client';
import type { MibBeaconBridge } from '../preload/index';

declare global {
  interface Window {
    mibbeaconBridge: MibBeaconBridge;
  }
}

/**
 * Renderer-side EngineAPI: the shared proxy over an IPC adapter (window.mibbeaconBridge
 * from the preload). The LAN server uses the same proxy over a WebSocket adapter.
 */
export function makeEngineProxy(): EngineAPI {
  return createEngineProxy({
    invoke: (method, ...args) => window.mibbeaconBridge.invoke(method, ...args),
    subscribe: (listener) => window.mibbeaconBridge.onEvent((event) => listener(event as EngineEvent)),
  });
}
