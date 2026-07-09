import { ipcMain, type BrowserWindow } from 'electron';
import type { EngineAPI } from '@omc/core';
import { ENGINE_METHODS, ENGINE_EVENT_CHANNELS, dispatchEngineCall } from '@omc/core/bridge';

/**
 * Maps the EngineAPI onto Electron IPC using the shared host-side dispatch
 * (@omc/core/bridge), which the LAN server also uses over WebSocket.
 */
export function registerEngineBridge(engine: EngineAPI, getWindow: () => BrowserWindow | null): void {
  for (const method of Object.keys(ENGINE_METHODS)) {
    ipcMain.handle(`omc:${method}`, (_event, ...args) => dispatchEngineCall(engine, method, args));
  }

  for (const channel of ENGINE_EVENT_CHANNELS) {
    engine.events.subscribe(channel, (event) => {
      getWindow()?.webContents.send('omc:event', event);
    });
  }
}
