import { create } from 'zustand';
import type {
  DecodedVarbind,
  ImportResult,
  MibNodeDetail,
  MibNodeSummary,
  MibSearchHit,
  ModuleInfo,
  SnmpVersion,
  SecurityLevel,
  AuthProtocol,
  PrivProtocol,
  TrapRecord,
} from '@omc/core/client';

export type Tab = 'browse' | 'query' | 'traps' | 'mibs';

const RESULTS_CAP = 5000;
const TRAPS_CAP = 200;

export interface AgentForm {
  host: string;
  port: string;
  version: SnmpVersion;
  community: string;
  v3: {
    user: string;
    level: SecurityLevel;
    authProtocol: AuthProtocol;
    authKey: string;
    privProtocol: PrivProtocol;
    privKey: string;
  };
}

export interface WalkStats {
  count: number;
  batches: number;
  ms: number;
}

export interface AppState {
  tab: Tab;
  setTab: (tab: Tab) => void;

  // --- browse ---
  expanded: Record<string, boolean>;
  childrenCache: Record<string, MibNodeSummary[]>;
  selected: MibNodeDetail | null;
  search: string;
  hits: MibSearchHit[];
  setExpanded: (oid: string, open: boolean) => void;
  setChildren: (oid: string, children: MibNodeSummary[]) => void;
  clearChildrenCache: () => void;
  setSelected: (node: MibNodeDetail | null) => void;
  setSearch: (q: string) => void;
  setHits: (hits: MibSearchHit[]) => void;

  // --- query ---
  agent: AgentForm;
  oid: string;
  oidName: string | null;
  results: DecodedVarbind[];
  running: string | null; // walk handleId
  walkStart: number;
  stats: WalkStats;
  queryError: string | null;
  setAgent: (patch: Partial<AgentForm>) => void;
  setV3: (patch: Partial<AgentForm['v3']>) => void;
  setOid: (oid: string) => void;
  setOidName: (name: string | null) => void;
  setResults: (results: DecodedVarbind[]) => void;
  appendResults: (batch: DecodedVarbind[]) => void;
  setRunning: (handleId: string | null, start?: number) => void;
  setStats: (stats: WalkStats) => void;
  setQueryError: (msg: string | null) => void;

  // --- traps ---
  receiver: { running: boolean; port?: number };
  records: TrapRecord[];
  setReceiver: (r: { running: boolean; port?: number }) => void;
  addTrap: (rec: TrapRecord) => void;
  clearTraps: () => void;

  // --- mibs ---
  modules: ModuleInfo[];
  importBusy: boolean;
  lastImport: ImportResult | null;
  setModules: (modules: ModuleInfo[]) => void;
  setImportBusy: (busy: boolean) => void;
  setLastImport: (result: ImportResult | null) => void;
}

const defaultAgent: AgentForm = {
  host: '',
  port: '161',
  version: 'v2c',
  community: 'public',
  v3: {
    user: '',
    level: 'authPriv',
    authProtocol: 'sha256',
    authKey: '',
    privProtocol: 'aes',
    privKey: '',
  },
};

export const useAppStore = create<AppState>((set) => ({
  tab: 'browse',
  setTab: (tab) => set({ tab }),

  expanded: {},
  childrenCache: {},
  selected: null,
  search: '',
  hits: [],
  setExpanded: (oid, open) => set((s) => ({ expanded: { ...s.expanded, [oid]: open } })),
  setChildren: (oid, children) => set((s) => ({ childrenCache: { ...s.childrenCache, [oid]: children } })),
  clearChildrenCache: () => set({ childrenCache: {}, expanded: {} }),
  setSelected: (selected) => set({ selected }),
  setSearch: (search) => set({ search }),
  setHits: (hits) => set({ hits }),

  agent: defaultAgent,
  oid: '1.3.6.1.2.1',
  oidName: null,
  results: [],
  running: null,
  walkStart: 0,
  stats: { count: 0, batches: 0, ms: 0 },
  queryError: null,
  setAgent: (patch) => set((s) => ({ agent: { ...s.agent, ...patch } })),
  setV3: (patch) => set((s) => ({ agent: { ...s.agent, v3: { ...s.agent.v3, ...patch } } })),
  setOid: (oid) => set({ oid }),
  setOidName: (oidName) => set({ oidName }),
  setResults: (results) => set({ results }),
  appendResults: (batch) =>
    set((s) => {
      const merged = s.results.length >= RESULTS_CAP ? s.results : s.results.concat(batch);
      return { results: merged.length > RESULTS_CAP ? merged.slice(0, RESULTS_CAP) : merged };
    }),
  setRunning: (running, start = 0) => set({ running, walkStart: start }),
  setStats: (stats) => set({ stats }),
  setQueryError: (queryError) => set({ queryError }),

  receiver: { running: false },
  records: [],
  setReceiver: (receiver) => set({ receiver }),
  addTrap: (rec) => set((s) => ({ records: [rec, ...s.records].slice(0, TRAPS_CAP) })),
  clearTraps: () => set({ records: [] }),

  modules: [],
  importBusy: false,
  lastImport: null,
  setModules: (modules) => set({ modules }),
  setImportBusy: (importBusy) => set({ importBusy }),
  setLastImport: (lastImport) => set({ lastImport }),
}));
