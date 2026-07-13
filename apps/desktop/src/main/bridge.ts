import { ipcMain, type BrowserWindow } from 'electron';
import type { EngineAPI } from '@omc/core';
import type { EngineEvent } from '@omc/core/client';
import { ENGINE_METHODS, ENGINE_EVENT_CHANNELS, dispatchEngineCall } from '@omc/core/bridge';
import { getEventRecipientIds } from './event-routing';

/**
 * Maps the EngineAPI onto Electron IPC using the shared host-side dispatch
 * (@omc/core/bridge), which the LAN server also uses over WebSocket.
 */
export function registerEngineBridge(
  engine: EngineAPI,
  getWindows: () => BrowserWindow[],
  getFocusedWindow: () => BrowserWindow | null,
): void {
  const ownerByHandle = new Map<string, number>();
  const pendingResolverEvents = new Map<string, EngineEvent[]>();

  const sendTo = (webContentsId: number, event: EngineEvent) => {
    const window = getWindows().find(
      (candidate) => !candidate.isDestroyed() && candidate.webContents.id === webContentsId,
    );
    if (window && !window.webContents.isDestroyed()) window.webContents.send('omc:event', event);
  };

  const broadcast = (event: EngineEvent) => {
    for (const window of getWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send('omc:event', event);
      }
    }
  };

  for (const method of Object.keys(ENGINE_METHODS)) {
    ipcMain.handle(`omc:${method}`, async (event, ...args) => {
      const result = await dispatchEngineCall(engine, method, args);
      const value = result.value as { handleId?: unknown } | undefined;
      if (result.ok && typeof value?.handleId === 'string') {
        ownerByHandle.set(value.handleId, event.sender.id);
        for (const pending of pendingResolverEvents.get(value.handleId) ?? []) {
          sendTo(event.sender.id, pending);
        }
        pendingResolverEvents.delete(value.handleId);
      }
      if (
        result.ok &&
        (method === 'resolver.settings.update' ||
          method.startsWith('resolver.sources.') ||
          method === 'resolver.cache.clear')
      ) {
        broadcast({ channel: 'tools', kind: 'resolver-changed', payload: { method } });
      }
      return result;
    });
  }

  for (const channel of ENGINE_EVENT_CHANNELS) {
    engine.events.subscribe(channel, (event) => {
      if (channel === 'resolver' && event.handleId) {
        const ownerId = ownerByHandle.get(event.handleId);
        if (ownerId !== undefined) sendTo(ownerId, event);
        else {
          const pending = pendingResolverEvents.get(event.handleId) ?? [];
          pending.push(event);
          pendingResolverEvents.set(event.handleId, pending);
        }
        if (['done', 'error', 'partial', 'cancelled', 'expired'].includes(event.kind)) {
          ownerByHandle.delete(event.handleId);
        }
        return;
      }

      const windows = getWindows().filter((window) => !window.isDestroyed());
      const windowsByWebContents = new Map(
        windows.map((window) => [window.webContents.id, window]),
      );
      const focusedId = getFocusedWindow()?.webContents.id;
      const recipientIds = getEventRecipientIds(
        event,
        [...windowsByWebContents.keys()],
        ownerByHandle,
        focusedId,
      );
      for (const id of recipientIds) {
        const window = windowsByWebContents.get(id);
        if (window && !window.webContents.isDestroyed())
          window.webContents.send('omc:event', event);
      }

      if (event.handleId && ['done', 'error', 'cancelled', 'expired'].includes(event.kind)) {
        ownerByHandle.delete(event.handleId);
      }
    });
  }
}
