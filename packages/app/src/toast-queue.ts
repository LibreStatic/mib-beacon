/**
 * Pure toast-queue helpers, kept free of React/timers so the queueing,
 * dedupe, cap, and default-duration logic is unit-testable from Node. The
 * store (store.ts) owns the live array and the auto-dismiss timers.
 */
export type ToastTone = 'success' | 'error' | 'info' | 'warn';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Auto-dismiss delay in ms; `0` means sticky (dismiss manually). */
  durationMs: number;
}

export interface ToastInput {
  tone: ToastTone;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}

/** Most toasts on screen at once; oldest are dropped past this. */
export const TOAST_MAX = 3;

/** Default auto-dismiss delay by tone. Errors linger longest. */
export const DEFAULT_TOAST_DURATIONS: Record<ToastTone, number> = {
  success: 4000,
  info: 4000,
  warn: 6000,
  error: 8000,
};

export function toastDuration(input: ToastInput): number {
  return input.durationMs ?? DEFAULT_TOAST_DURATIONS[input.tone];
}

/**
 * Append `item`, removing any existing toast with the same tone+message
 * (dedupe) and capping the queue to `max` (dropping the oldest). Returns the
 * new queue; callers diff against the old queue to clear dropped timers.
 */
export function enqueueToast(
  queue: ToastItem[],
  item: ToastItem,
  max: number = TOAST_MAX,
): ToastItem[] {
  const deduped = queue.filter((t) => !(t.tone === item.tone && t.message === item.message));
  const next = [...deduped, item];
  return next.length > max ? next.slice(next.length - max) : next;
}
