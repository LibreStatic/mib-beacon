import { contextBridge, ipcRenderer } from 'electron';
import type { BridgeResult } from '@omc/core/client';

/**
 * The only surface crossing the sandbox. The renderer builds a typed EngineAPI
 * proxy on top of `invoke` + `onEvent` (see renderer/engine-proxy.ts).
 */
const bridge = {
  invoke(method: string, ...args: unknown[]): Promise<BridgeResult> {
    return ipcRenderer.invoke(`omc:${method}`, ...args);
  },
  onEvent(listener: (event: unknown) => void): () => void {
    const handler = (_e: unknown, event: unknown) => listener(event);
    ipcRenderer.on('omc:event', handler);
    return () => ipcRenderer.removeListener('omc:event', handler);
  },
  newWindow(): Promise<number> {
    return ipcRenderer.invoke('omc:window:new') as Promise<number>;
  },
  windowId(): Promise<number | null> {
    return ipcRenderer.invoke('omc:window:id') as Promise<number | null>;
  },
  setWindowTitle(title: string): Promise<void> {
    return ipcRenderer.invoke('omc:window:title', title) as Promise<void>;
  },
};

contextBridge.exposeInMainWorld('omcBridge', bridge);

export type OmcBridge = typeof bridge;
