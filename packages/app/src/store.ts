import { create } from 'zustand';
import type { DecodedVarbind, TrapRecord } from '@omc/core/client';

export interface WalkProgress {
  running: boolean;
  count: number;
  batches: number;
  ms: number;
}

export interface SpikeState {
  busy: boolean;
  results: DecodedVarbind[] | null;
  getError: string | null;
  receiver: { running: boolean; port?: number };
  traps: TrapRecord[];
  walk: WalkProgress;

  setBusy: (b: boolean) => void;
  setResults: (r: DecodedVarbind[] | null, error?: string | null) => void;
  setReceiver: (r: { running: boolean; port?: number }) => void;
  addTrap: (t: TrapRecord) => void;
  clearTraps: () => void;
  setWalk: (w: Partial<WalkProgress>) => void;
}

export const useSpikeStore = create<SpikeState>((set) => ({
  busy: false,
  results: null,
  getError: null,
  receiver: { running: false },
  traps: [],
  walk: { running: false, count: 0, batches: 0, ms: 0 },

  setBusy: (busy) => set({ busy }),
  setResults: (results, getError = null) => set({ results, getError }),
  setReceiver: (receiver) => set({ receiver }),
  addTrap: (t) => set((s) => ({ traps: [t, ...s.traps].slice(0, 200) })),
  clearTraps: () => set({ traps: [] }),
  setWalk: (w) => set((s) => ({ walk: { ...s.walk, ...w } })),
}));
