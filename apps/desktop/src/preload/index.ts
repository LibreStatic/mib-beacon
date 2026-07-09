import { contextBridge, ipcRenderer } from 'electron';

export interface BridgeResult {
  ok: boolean;
  value?: unknown;
  error?: { code: string; message: string; hint?: string };
}

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
};

contextBridge.exposeInMainWorld('omcBridge', bridge);

export type OmcBridge = typeof bridge;
