import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineAPI } from '@mibbeacon/core/client';
import { useAppStore } from './store';
import { sendNotification } from './actions';

function clearToasts() {
  for (const toast of [...useAppStore.getState().toasts]) {
    useAppStore.getState().dismissToast(toast.id);
  }
}

describe('toast store slice', () => {
  beforeEach(clearToasts);
  afterEach(() => vi.useRealTimers());

  it('auto-dismisses after the tone default duration', () => {
    vi.useFakeTimers();
    const id = useAppStore.getState().pushToast({ tone: 'success', message: 'Saved' });
    expect(useAppStore.getState().toasts.map((t) => t.id)).toContain(id);
    vi.advanceTimersByTime(4000);
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });

  it('keeps sticky (durationMs 0) toasts until dismissed', () => {
    vi.useFakeTimers();
    const id = useAppStore.getState().pushToast({ tone: 'error', message: 'boom', durationMs: 0 });
    vi.advanceTimersByTime(60_000);
    expect(useAppStore.getState().toasts.map((t) => t.id)).toEqual([id]);
    useAppStore.getState().dismissToast(id);
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });

  it('clears a dropped toast timer on dedupe so it cannot fire late', () => {
    vi.useFakeTimers();
    useAppStore.getState().pushToast({ tone: 'info', message: 'ping' });
    vi.advanceTimersByTime(3000);
    // Same tone+message replaces the first entry and clears its timer.
    const second = useAppStore.getState().pushToast({ tone: 'info', message: 'ping' });
    vi.advanceTimersByTime(1500); // past the first timer's original 4000ms mark
    expect(useAppStore.getState().toasts.map((t) => t.id)).toEqual([second]);
  });
});

describe('sendNotification feedback', () => {
  beforeEach(() => {
    clearToasts();
    useAppStore.getState().setNotificationAgentId(null);
    useAppStore.getState().updateNotification({
      target: { ...useAppStore.getState().notification.target, host: '192.0.2.10' },
    });
  });

  it('pushes a success toast when the trap is sent', async () => {
    const engine = {
      traps: { send: vi.fn().mockResolvedValue({ ok: true }) },
    } as unknown as EngineAPI;
    await sendNotification(engine);
    const toasts = useAppStore.getState().toasts;
    expect(toasts.some((t) => t.tone === 'success')).toBe(true);
  });

  it('pushes an error toast when the send fails', async () => {
    const engine = {
      traps: { send: vi.fn().mockRejectedValue(new Error('destination unreachable')) },
    } as unknown as EngineAPI;
    await sendNotification(engine);
    const toasts = useAppStore.getState().toasts;
    expect(toasts.some((t) => t.tone === 'error')).toBe(true);
    expect(useAppStore.getState().sendError).toBeTruthy();
  });
});
