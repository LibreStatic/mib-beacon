import { createEngineProxy, type EngineAPI, type EngineEvent } from '@omc/core/client';
import type { OmcBridge } from '../preload/index';

declare global {
  interface Window {
    omcBridge: OmcBridge;
  }
}

/**
 * Renderer-side EngineAPI: the shared proxy over an IPC adapter (window.omcBridge
 * from the preload). The LAN server uses the same proxy over a WebSocket adapter.
 */
export function makeEngineProxy(): EngineAPI {
  return createEngineProxy({
    invoke: (method, ...args) => window.omcBridge.invoke(method, ...args),
    subscribe: (listener) => window.omcBridge.onEvent((event) => listener(event as EngineEvent)),
  });
}
