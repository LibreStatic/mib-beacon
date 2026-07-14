import { contextBridge, ipcRenderer } from 'electron';
import type { BridgeResult } from '@mibbeacon/core/client';
import type { UpdatePreferences, UpdateStatus } from '../main/update-controller';

export interface DesktopOpenFile {
  name: string;
  relativePath: string;
  bytes: number[];
}

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
  updates: {
    get(): Promise<{ preferences: UpdatePreferences; status: UpdateStatus } | null> {
      return ipcRenderer.invoke('mibbeacon:updates:get') as Promise<{
        preferences: UpdatePreferences;
        status: UpdateStatus;
      } | null>;
    },
    setAutomaticChecks(enabled: boolean) {
      return ipcRenderer.invoke('mibbeacon:updates:automatic', enabled) as ReturnType<
        typeof bridge.updates.get
      >;
    },
    check(): Promise<UpdateStatus | null> {
      return ipcRenderer.invoke('mibbeacon:updates:check') as Promise<UpdateStatus | null>;
    },
    download(): Promise<UpdateStatus | null> {
      return ipcRenderer.invoke('mibbeacon:updates:download') as Promise<UpdateStatus | null>;
    },
    install(): Promise<void> {
      return ipcRenderer.invoke('mibbeacon:updates:install') as Promise<void>;
    },
    onStatus(listener: (status: UpdateStatus) => void): () => void {
      const handler = (_event: unknown, status: UpdateStatus) => listener(status);
      ipcRenderer.on('mibbeacon:update-status', handler);
      return () => ipcRenderer.removeListener('mibbeacon:update-status', handler);
    },
  },
  takeOpenFiles(): Promise<DesktopOpenFile[]> {
    return ipcRenderer.invoke('mibbeacon:open-files:take') as Promise<DesktopOpenFile[]>;
  },
};

contextBridge.exposeInMainWorld('mibbeaconBridge', bridge);

export type MibBeaconBridge = typeof bridge;
