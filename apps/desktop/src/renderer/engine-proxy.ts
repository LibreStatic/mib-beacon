import { EventBus, OmcError, type EngineAPI } from '@omc/core/client';
import type { OmcBridge, BridgeResult } from '../preload/index';

declare global {
  interface Window {
    omcBridge: OmcBridge;
  }
}

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const res: BridgeResult = await window.omcBridge.invoke(method, ...args);
  if (!res.ok) {
    throw new OmcError(
      (res.error?.code as never) ?? 'INTERNAL',
      res.error?.message ?? 'IPC call failed',
      { hint: res.error?.hint },
    );
  }
  return res.value as T;
}

const stub = (plannedIn: string) => ({ plannedIn });

/**
 * Renderer-side EngineAPI: proxies method calls over IPC and re-dispatches
 * main-process engine events onto a local bus so components subscribe normally.
 */
export function makeEngineProxy(): EngineAPI {
  const bus = new EventBus();
  window.omcBridge.onEvent((event) => {
    const e = event as { channel: Parameters<EventBus['emit']>[0]['channel'] };
    if (e?.channel) bus.emit(event as Parameters<EventBus['emit']>[0]);
  });

  return {
    system: {
      info: () => call('system.info'),
    },
    ops: {
      get: (req) => call('ops.get', req),
      startWalk: (req) => call('ops.startWalk', req),
      cancel: (id) => call('ops.cancel', id),
    },
    traps: {
      startReceiver: (cfg) => call('traps.startReceiver', cfg),
      stopReceiver: () => call('traps.stopReceiver'),
      status: () => call('traps.status'),
      list: () => call('traps.list'),
      clear: () => call('traps.clear'),
    },
    events: {
      subscribe: (channel, listener) => bus.subscribe(channel, listener),
    },
    mibs: stub('plan 03'),
    agents: stub('plan 04'),
    resolver: stub('plan 06'),
    tools: stub('plan 08'),
    logs: stub('plan 04'),
  };
}
