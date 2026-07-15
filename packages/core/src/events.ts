/**
 * Minimal typed event bus. Coarse channels (ops/traps/resolver/tools/logs) each
 * carrying a handleId, per docs/plans/01. Maps 1:1 onto Electron IPC on desktop
 * and an in-process emitter on mobile.
 */
export type EngineEventChannel = 'ops' | 'traps' | 'resolver' | 'tools' | 'logs' | 'packets';

export interface EngineEvent<T = unknown> {
  channel: EngineEventChannel;
  handleId?: string;
  kind: string; // e.g. 'batch' | 'done' | 'error' | 'trap'
  payload: T;
}

export type EngineEventListener = (e: EngineEvent) => void;
export type Unsubscribe = () => void;

export class EventBus {
  private listeners = new Map<EngineEventChannel, Set<EngineEventListener>>();

  subscribe(channel: EngineEventChannel, listener: EngineEventListener): Unsubscribe {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  emit(event: EngineEvent): void {
    const set = this.listeners.get(event.channel);
    if (!set) return;
    for (const l of set) {
      try {
        l(event);
      } catch {
        /* a listener throwing must not break emission to others */
      }
    }
  }
}
