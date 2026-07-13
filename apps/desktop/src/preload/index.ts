import { contextBridge, ipcRenderer } from 'electron';
import type { BridgeResult } from '@mibbeacon/core/client';

/**
 * The only surface crossing the sandbox. The renderer builds a typed EngineAPI
 * proxy on top of `invoke` + `onEvent` (see renderer/engine-proxy.ts).
 */
const bridge = {
  invoke(method: string, ...args: unknown[]): Promise<BridgeResult> {
    return ipcRenderer.invoke(`mibbeacon:${method}`, ...args);
  },
  onEvent(listener: (event: unknown) => void): () => void {
    const handler = (_e: unknown, event: unknown) => listener(event);
    ipcRenderer.on('mibbeacon:event', handler);
    return () => ipcRenderer.removeListener('mibbeacon:event', handler);
  },
  newWindow(): Promise<number> {
    return ipcRenderer.invoke('mibbeacon:window:new') as Promise<number>;
  },
  windowId(): Promise<number | null> {
    return ipcRenderer.invoke('mibbeacon:window:id') as Promise<number | null>;
  },
  setWindowTitle(title: string): Promise<void> {
    return ipcRenderer.invoke('mibbeacon:window:title', title) as Promise<void>;
  },
};

contextBridge.exposeInMainWorld('mibbeaconBridge', bridge);

export type MibBeaconBridge = typeof bridge;
