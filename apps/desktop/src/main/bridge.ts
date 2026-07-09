import { ipcMain, type BrowserWindow } from 'electron';
import type { EngineAPI } from '@omc/core';

/**
 * Maps the EngineAPI onto IPC. Spike scope keeps the method registry explicit;
 * plan 04 generalizes this to a type-derived generated mapper as the API grows.
 * All payloads are structured-clone-safe.
 */
type Handler = (engine: EngineAPI, ...args: unknown[]) => unknown;

const METHODS: Record<string, Handler> = {
  'system.info': (e) => e.system.info(),
  'ops.get': (e, req) => e.ops.get(req as never),
  'ops.startWalk': (e, req) => e.ops.startWalk(req as never),
  'ops.cancel': (e, id) => e.ops.cancel(id as string),
  'traps.startReceiver': (e, cfg) => e.traps.startReceiver(cfg as never),
  'traps.stopReceiver': (e) => e.traps.stopReceiver(),
  'traps.status': (e) => e.traps.status(),
  'traps.list': (e) => e.traps.list(),
  'traps.clear': (e) => e.traps.clear(),
};

const CHANNELS = ['ops', 'traps', 'resolver', 'tools', 'logs'] as const;

export function registerEngineBridge(engine: EngineAPI, getWindow: () => BrowserWindow | null): void {
  for (const [key, fn] of Object.entries(METHODS)) {
    ipcMain.handle(`omc:${key}`, async (_event, ...args) => {
      try {
        return { ok: true, value: await fn(engine, ...args) };
      } catch (err) {
        // Serialize OmcError (or any error) across IPC.
        const e = err as { code?: string; message?: string; hint?: string };
        return { ok: false, error: { code: e.code ?? 'INTERNAL', message: e.message ?? String(err), hint: e.hint } };
      }
    });
  }

  // Forward engine events to the renderer.
  for (const channel of CHANNELS) {
    engine.events.subscribe(channel, (event) => {
      getWindow()?.webContents.send('omc:event', event);
    });
  }
}
