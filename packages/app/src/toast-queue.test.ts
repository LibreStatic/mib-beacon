import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOAST_DURATIONS,
  enqueueToast,
  toastDuration,
  type ToastItem,
} from './toast-queue';

const item = (id: string, tone: ToastItem['tone'], message: string): ToastItem => ({
  id,
  tone,
  message,
  durationMs: 4000,
});

describe('toast queue helpers', () => {
  it('defaults duration by tone and lets callers override', () => {
    expect(toastDuration({ tone: 'success', message: 'ok' })).toBe(
      DEFAULT_TOAST_DURATIONS.success,
    );
    expect(toastDuration({ tone: 'error', message: 'bad' })).toBe(DEFAULT_TOAST_DURATIONS.error);
    expect(toastDuration({ tone: 'success', message: 'ok', durationMs: 0 })).toBe(0);
  });

  it('appends toasts in order', () => {
    const queue = enqueueToast([item('a', 'success', 'one')], item('b', 'info', 'two'));
    expect(queue.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('dedupes an identical tone+message by replacing the old entry', () => {
    const queue = enqueueToast([item('a', 'error', 'timeout')], item('b', 'error', 'timeout'));
    expect(queue.map((t) => t.id)).toEqual(['b']);
  });

  it('keeps a same-message toast of a different tone', () => {
    const queue = enqueueToast([item('a', 'error', 'saved')], item('b', 'success', 'saved'));
    expect(queue.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('caps the queue to max, dropping the oldest', () => {
    const start = [item('a', 'info', '1'), item('b', 'info', '2'), item('c', 'info', '3')];
    const queue = enqueueToast(start, item('d', 'info', '4'), 3);
    expect(queue.map((t) => t.id)).toEqual(['b', 'c', 'd']);
  });
});
