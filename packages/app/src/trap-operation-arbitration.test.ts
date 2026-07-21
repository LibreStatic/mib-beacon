import { describe, expect, it, vi } from 'vitest';
import type { EngineAPI, TrapRecord } from '@mibbeacon/core/client';
import {
  refreshTrapReceiverStatus,
  refreshTrapRecords,
  markTrapRead,
  deleteTrap,
  repeatNotification,
  toggleReceiver,
} from './actions';
import { clearTrapCapture } from './engine-manual-actions';
import { useAppStore } from './store';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const record = (id: string) =>
  ({
    id,
    receivedAt: 1,
    sourceAddress: '192.0.2.1',
    sourcePort: 162,
    version: 1,
    pduType: 167,
    varbinds: [],
  }) as TrapRecord;

describe('non-persistent trap operation arbitration', () => {
  it('lets only the newest same-engine record refresh write the store', async () => {
    const first = deferred<TrapRecord[]>();
    const second = deferred<TrapRecord[]>();
    const query = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const engine = { traps: { query } } as unknown as EngineAPI;
    const sink = vi.spyOn(useAppStore.getState(), 'setTrapRecords');
    const old = refreshTrapRecords(engine, { source: 'old' });
    const current = refreshTrapRecords(engine, { source: 'current' });
    second.resolve([record('current')]);
    await current;
    first.resolve([record('old')]);
    await old;
    expect(sink).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledWith([record('current')]);
    sink.mockRestore();
  });

  it.each(['mark', 'delete', 'clear'] as const)(
    'does not let a pending record refresh overwrite a successful %s',
    async (operation) => {
      const stale = deferred<TrapRecord[]>();
      const markRead = vi.fn(async () => undefined);
      const remove = vi.fn(async () => undefined);
      const clear = vi.fn(async () => undefined);
      const engine = {
        traps: { query: () => stale.promise, markRead, delete: remove, clear },
      } as unknown as EngineAPI;
      useAppStore.getState().setTrapRecords([record('a')]);
      const refresh = refreshTrapRecords(engine);
      if (operation === 'mark') await markTrapRead(engine, 'a', true);
      else if (operation === 'delete') await deleteTrap(engine, 'a');
      else await clearTrapCapture(engine);
      stale.resolve([record('a')]);
      await refresh;
      if (operation === 'mark') expect(useAppStore.getState().records[0]?.readAt).toBeDefined();
      else expect(useAppStore.getState().records).toEqual([]);
    },
  );

  it('serializes mark then delete for the same record without dropping either intent', async () => {
    const markPending = deferred<void>();
    const order: string[] = [];
    const engine = {
      traps: {
        markRead: vi.fn(async () => {
          order.push('mark');
          await markPending.promise;
        }),
        delete: vi.fn(async () => {
          order.push('delete');
        }),
      },
    } as unknown as EngineAPI;
    const marked = markTrapRead(engine, 'a', true);
    const deleted = deleteTrap(engine, 'a');
    await vi.waitFor(() => expect(order).toEqual(['mark']));
    markPending.resolve();
    await Promise.all([marked, deleted]);
    expect(order).toEqual(['mark', 'delete']);
  });

  it('serializes record mutation then clear without dropping either intent', async () => {
    const deletePending = deferred<void>();
    const order: string[] = [];
    const engine = {
      traps: {
        delete: vi.fn(async () => {
          order.push('delete');
          await deletePending.promise;
        }),
        clear: vi.fn(async () => {
          order.push('clear');
        }),
      },
    } as unknown as EngineAPI;
    const deleted = deleteTrap(engine, 'a');
    const cleared = clearTrapCapture(engine);
    await vi.waitFor(() => expect(order).toEqual(['delete']));
    deletePending.resolve();
    await Promise.all([deleted, cleared]);
    expect(order).toEqual(['delete', 'clear']);
  });

  it('drops a queued record mutation when captured engine ownership is lost', async () => {
    const firstPending = deferred<void>();
    let secondOwns = true;
    const remove = vi.fn(() => firstPending.promise);
    const markRead = vi.fn(async () => undefined);
    const engine = { traps: { delete: remove, markRead } } as unknown as EngineAPI;
    const first = deleteTrap(engine, 'a');
    const second = markTrapRead(engine, 'b', true, () => secondOwns);
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
    secondOwns = false;
    firstPending.resolve();
    await first;
    await expect(second).rejects.toThrow('ownership');
    expect(markRead).not.toHaveBeenCalled();
  });

  it.each(['mark', 'delete', 'clear'] as const)(
    'coalesces duplicate pending %s record actions',
    async (operation) => {
      const pending = deferred<void>();
      const markRead = vi.fn(() => pending.promise);
      const remove = vi.fn(() => pending.promise);
      const clear = vi.fn(() => pending.promise);
      const engine = { traps: { markRead, delete: remove, clear } } as unknown as EngineAPI;
      const run = () =>
        operation === 'mark'
          ? markTrapRead(engine, 'a', true)
          : operation === 'delete'
            ? deleteTrap(engine, 'a')
            : clearTrapCapture(engine);
      const first = run();
      const duplicate = run();
      await vi.waitFor(() =>
        expect(
          operation === 'mark' ? markRead : operation === 'delete' ? remove : clear,
        ).toHaveBeenCalledOnce(),
      );
      pending.resolve();
      await Promise.all([first, duplicate]);
    },
  );

  it('coalesces rapid receiver transitions for one engine', async () => {
    useAppStore.getState().setReceiver({ running: false });
    const pending = deferred<{
      running: boolean;
      port: number;
      count: number;
      drops: number;
      transports: ('udp4' | 'udp6')[];
    }>();
    const startReceiver = vi.fn(() => pending.promise);
    const engine = { traps: { startReceiver } } as unknown as EngineAPI;
    const first = toggleReceiver(engine, '162');
    const duplicate = toggleReceiver(engine, '162');
    expect(startReceiver).toHaveBeenCalledOnce();
    pending.resolve({ running: true, port: 162, count: 0, drops: 0, transports: ['udp4'] });
    await Promise.all([first, duplicate]);
    expect(useAppStore.getState().receiver.running).toBe(true);
  });

  it('does not let an older status refresh overwrite a newer receiver transition', async () => {
    useAppStore.getState().setReceiver({ running: false });
    const stale = deferred<{
      running: boolean;
      port: number;
      count: number;
      drops: number;
      transports: ('udp4' | 'udp6')[];
    }>();
    const engine = {
      traps: {
        status: () => stale.promise,
        startReceiver: vi.fn(async () => ({
          running: true,
          port: 1162,
          count: 0,
          drops: 0,
          transports: ['udp4'] as ('udp4' | 'udp6')[],
        })),
      },
    } as unknown as EngineAPI;
    const oldStatus = refreshTrapReceiverStatus(engine);
    await toggleReceiver(engine, '1162');
    stale.resolve({ running: false, port: 0, count: 0, drops: 0, transports: [] });
    await oldStatus;
    expect(useAppStore.getState().receiver).toMatchObject({ running: true, port: 1162 });
  });

  it('uses sendBusy as a synchronous duplicate-send gate', async () => {
    useAppStore.getState().setSendBusy(false);
    const pending = deferred<{ acknowledged: boolean }>();
    const send = vi.fn(() => pending.promise);
    const engine = { traps: { send } } as unknown as EngineAPI;
    const request = {
      target: { host: '192.0.2.1', version: 'v2c' as const, community: 'public' },
      kind: 'trap' as const,
      trapOid: '1.3.6.1',
      varbinds: [],
    };
    const first = repeatNotification(engine, request);
    const duplicate = repeatNotification(engine, request);
    expect(send).toHaveBeenCalledOnce();
    pending.resolve({ acknowledged: false });
    await Promise.all([first, duplicate]);
    expect(useAppStore.getState().sendBusy).toBe(false);
  });
});
