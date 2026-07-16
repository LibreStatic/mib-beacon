import {
  createEngineProxy,
  type EngineAPI,
  type EngineEvent,
  type BridgeResult,
} from '@mibbeacon/core/client';

interface ResultMessage {
  type: 'result';
  id: number;
  result: BridgeResult;
}
interface EventMessage {
  type: 'event';
  event: EngineEvent;
}

export function omitTrailingUndefined(args: readonly unknown[]): unknown[] {
  let end = args.length;
  while (end > 0 && args[end - 1] === undefined) end -= 1;
  return args.slice(0, end);
}

/**
 * Browser-side EngineAPI: the shared proxy (@mibbeacon/core/client) over a WebSocket to
 * the LAN server, which runs the real engine. Auto-reconnects.
 */
export function makeWsEngineProxy(): EngineAPI {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const pending = new Map<number, (r: BridgeResult) => void>();
  const listeners = new Set<(e: EngineEvent) => void>();
  let ws: WebSocket;
  let ready: Promise<void>;
  let nextId = 1;

  function connect() {
    ws = new WebSocket(url);
    ready = new Promise<void>((resolve) => {
      ws.addEventListener('open', () => resolve(), { once: true });
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data as string) as ResultMessage | EventMessage;
      if (msg.type === 'result') {
        pending.get(msg.id)?.(msg.result);
        pending.delete(msg.id);
      } else if (msg.type === 'event') {
        for (const l of listeners) l(msg.event);
      }
    });
    ws.addEventListener('close', () => {
      // reject in-flight calls so the UI shows an error instead of hanging
      for (const [, resolve] of pending) {
        resolve({ ok: false, error: { code: 'SOCKET_ERROR', message: 'server connection lost' } });
      }
      pending.clear();
      setTimeout(connect, 1000);
    });
  }
  connect();

  return createEngineProxy({
    async invoke(method, ...args) {
      await ready;
      const id = nextId++;
      return new Promise<BridgeResult>((resolve) => {
        pending.set(id, resolve);
        ws.send(JSON.stringify({ type: 'call', id, method, args: omitTrailingUndefined(args) }));
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
