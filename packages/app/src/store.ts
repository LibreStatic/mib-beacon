import { create } from 'zustand';
import type { FileImportReview } from './file-import';
import type {
  DecodedVarbind,
  ImportResult,
  MibNodeDetail,
  MibNodeSummary,
  ModuleTreeNode,
  ModuleView,
  MibSearchHit,
  ModuleInfo,
  SnmpVersion,
  SecurityLevel,
  AuthProtocol,
  PrivProtocol,
  TrapRecord,
  NotificationKind,
  NotificationSendRequest,
  NotificationSendResult,
  SnmpVarbindInput,
  ResolverOperationState,
  ResolverSettings,
  ResolverCacheStats,
  ResolverHistoryEntry,
  ResolverOperationStatus,
  OidLookupResult,
  ResolverSourcePreviewResult,
  SourceConfig,
} from '@mibbeacon/core/client';

export type Tab = 'browse' | 'query' | 'traps' | 'mibs' | 'settings';

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

export type BrowseTreeNode = MibNodeSummary | ModuleTreeNode;
export type BrowseSearchPhase = 'idle' | 'debouncing' | 'searching' | 'opening' | 'error';
export type QueryOperation = 'get' | 'getNext' | 'walk' | 'set';
export type TrapMode = 'receive' | 'send';

export interface NotificationForm {
  kind: NotificationKind;
  target: AgentForm;
  trapOid: string;
  upTime: string;
  agentAddress: string;
  varbinds: SnmpVarbindInput[];
}

export interface NotificationHistoryItem {
  id: string;
  request: NotificationSendRequest;
  result?: NotificationSendResult;
  error?: string;
}

export interface FileImportDraft {
  review: FileImportReview;
  selected: string[];
  replacements: string[];
  handleId: string | null;
  visible: boolean;
  reopenMessage?: string;
}

export interface AppState {
  tab: Tab;
  setTab: (tab: Tab) => void;

  // --- browse ---
  expanded: Record<string, boolean>;
  childrenCache: Record<string, BrowseTreeNode[]>;
  moduleFocus: ModuleView | null;
  selected: MibNodeDetail | null;
  search: string;
  hits: MibSearchHit[];
  searchPhase: BrowseSearchPhase;
  searchError: string | null;
  setExpanded: (oid: string, open: boolean) => void;
  setChildren: (oid: string, children: BrowseTreeNode[]) => void;
  setModuleFocus: (focus: ModuleView | null) => void;
  clearChildrenCache: () => void;
  setSelected: (node: MibNodeDetail | null) => void;
  setSearch: (q: string) => void;
  setHits: (hits: MibSearchHit[]) => void;
  setSearchPhase: (phase: BrowseSearchPhase) => void;
  setSearchError: (error: string | null) => void;

  // --- query ---
  agent: AgentForm;
  oid: string;
  oidName: string | null;
  results: DecodedVarbind[];
  running: string | null; // walk handleId
  walkStart: number;
  stats: WalkStats;
  queryError: string | null;
  queryOperation: QueryOperation;
  setDraft: SnmpVarbindInput;
  setReview: boolean;
  setAgent: (patch: Partial<AgentForm>) => void;
  setV3: (patch: Partial<AgentForm['v3']>) => void;
  setOid: (oid: string) => void;
  setOidName: (name: string | null) => void;
  setResults: (results: DecodedVarbind[]) => void;
  appendResults: (batch: DecodedVarbind[]) => void;
  setRunning: (handleId: string | null, start?: number) => void;
  setStats: (stats: WalkStats) => void;
  setQueryError: (msg: string | null) => void;
  setQueryOperation: (operation: QueryOperation) => void;
  updateSetDraft: (patch: Partial<SnmpVarbindInput>) => void;
  setSetReview: (review: boolean) => void;

  // --- traps ---
  receiver: { running: boolean; port?: number };
  records: TrapRecord[];
  setReceiver: (r: { running: boolean; port?: number }) => void;
  addTrap: (rec: TrapRecord) => void;
  clearTraps: () => void;
  trapMode: TrapMode;
  notification: NotificationForm;
  sendBusy: boolean;
  sendError: string | null;
  sendHistory: NotificationHistoryItem[];
  setTrapMode: (mode: TrapMode) => void;
  updateNotification: (patch: Partial<NotificationForm>) => void;
  setNotificationVarbinds: (varbinds: SnmpVarbindInput[]) => void;
  setSendBusy: (busy: boolean) => void;
  setSendError: (error: string | null) => void;
  addSendHistory: (item: NotificationHistoryItem) => void;

  // --- mibs ---
  modules: ModuleInfo[];
  importBusy: boolean;
  lastImport: ImportResult | null;
  importHandle: string | null;
  importStatus: ResolverOperationStatus | null;
  importProgress: ResolverProgressItem[];
  importCompleted: number;
  importTotal: number;
  fileImportDraft: FileImportDraft | null;
  setModules: (modules: ModuleInfo[]) => void;
  setImportBusy: (busy: boolean) => void;
  setLastImport: (result: ImportResult | null) => void;
  beginImport: (handleId: string) => void;
  setImportStatus: (status: ResolverOperationStatus | null) => void;
  addImportProgress: (item: ResolverProgressItem) => void;
  setImportCounts: (completed: number, total: number) => void;
  finishImport: (status: ResolverOperationStatus, result: ImportResult | null) => void;
  setFileImportDraft: (draft: FileImportDraft | null) => void;
  updateFileImportDraft: (patch: Partial<FileImportDraft>) => void;
  acceptFileImportDraft: (handleId: string) => void;
  settleFileImportDraft: (handleId: string, state: ResolverOperationState) => void;

  // --- resolver / settings ---
  resolverSettings: ResolverSettings | null;
  resolverSources: SourceConfig[];
  resolverCache: ResolverCacheStats | null;
  resolverHistory: ResolverHistoryEntry[];
  resolverError: string | null;
  consent: ResolverConsentPrompt | null;
  consentQueue: ResolverConsentPrompt[];
  sourceTestHandles: Record<string, string>;
  sourceTestResults: Record<string, SourceTestState>;
  sourcePreviewHandle: string | null;
  sourcePreview: SourcePreviewState | null;
  lookupHandles: Record<string, string>;
  oidLookups: Record<string, OidLookupState>;
  setResolverSettings: (settings: ResolverSettings | null) => void;
  setResolverSources: (sources: SourceConfig[]) => void;
  setResolverCache: (cache: ResolverCacheStats | null) => void;
  setResolverHistory: (history: ResolverHistoryEntry[]) => void;
  setResolverError: (error: string | null) => void;
  enqueueConsent: (consent: ResolverConsentPrompt) => void;
  dismissConsent: (handleId: string) => void;
  setSourceTestHandle: (sourceId: string, handleId: string) => void;
  finishSourceTest: (sourceId: string, state: SourceTestState) => void;
  beginSourcePreview: (handleId: string) => void;
  finishSourcePreview: (state: SourcePreviewState) => void;
  clearSourcePreview: () => void;
  beginOidLookup: (oid: string, handleId: string) => void;
  finishOidLookup: (oid: string, state: OidLookupState) => void;
}

export interface ResolverProgressItem {
  id: string;
  kind: string;
  module?: string;
  sourceId?: string;
  location?: string;
  message?: string;
  at: number;
}

export interface ResolverConsentPrompt {
  handleId: string;
  missingModules: string[];
  sourceHosts: string[];
  expiresAt?: number;
}

export interface SourceTestState {
  state: ResolverOperationState;
  ok?: boolean;
  message?: string;
  location?: string;
}

export interface OidLookupState {
  state: ResolverOperationState;
  result?: OidLookupResult;
  error?: string;
}

export interface SourcePreviewState {
  state: ResolverOperationState;
  result?: ResolverSourcePreviewResult;
  error?: string;
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

const defaultNotification: NotificationForm = {
  kind: 'trap',
  target: { ...defaultAgent, port: '162', v3: { ...defaultAgent.v3 } },
  trapOid: '1.3.6.1.6.3.1.1.5.1',
  upTime: '',
  agentAddress: '',
  varbinds: [],
};

export const useAppStore = create<AppState>((set) => ({
  tab: 'browse',
  setTab: (tab) => set({ tab }),

  expanded: {},
  childrenCache: {},
  moduleFocus: null,
  selected: null,
  search: '',
  hits: [],
  searchPhase: 'idle',
  searchError: null,
  setExpanded: (oid, open) => set((s) => ({ expanded: { ...s.expanded, [oid]: open } })),
  setChildren: (oid, children) =>
    set((s) => ({ childrenCache: { ...s.childrenCache, [oid]: children } })),
  setModuleFocus: (moduleFocus) => set({ moduleFocus }),
  clearChildrenCache: () => set({ childrenCache: {}, expanded: {} }),
  setSelected: (selected) => set({ selected }),
  setSearch: (search) => set({ search }),
  setHits: (hits) => set({ hits }),
  setSearchPhase: (searchPhase) => set({ searchPhase }),
  setSearchError: (searchError) => set({ searchError }),

  agent: defaultAgent,
  oid: '1.3.6.1.2.1',
  oidName: null,
  results: [],
  running: null,
  walkStart: 0,
  stats: { count: 0, batches: 0, ms: 0 },
  queryError: null,
  queryOperation: 'get',
  setDraft: { oid: '1.3.6.1.2.1.1.5.0', type: 'OctetString', value: '' },
  setReview: false,
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
  setQueryOperation: (queryOperation) => set({ queryOperation, setReview: false }),
  updateSetDraft: (patch) =>
    set((s) => ({ setDraft: { ...s.setDraft, ...patch }, setReview: false })),
  setSetReview: (setReview) => set({ setReview }),

  receiver: { running: false },
  records: [],
  setReceiver: (receiver) => set({ receiver }),
  addTrap: (rec) => set((s) => ({ records: [rec, ...s.records].slice(0, TRAPS_CAP) })),
  clearTraps: () => set({ records: [] }),
  trapMode: 'receive',
  notification: defaultNotification,
  sendBusy: false,
  sendError: null,
  sendHistory: [],
  setTrapMode: (trapMode) => set({ trapMode }),
  updateNotification: (patch) => set((s) => ({ notification: { ...s.notification, ...patch } })),
  setNotificationVarbinds: (varbinds) =>
    set((s) => ({ notification: { ...s.notification, varbinds } })),
  setSendBusy: (sendBusy) => set({ sendBusy }),
  setSendError: (sendError) => set({ sendError }),
  addSendHistory: (item) => set((s) => ({ sendHistory: [item, ...s.sendHistory].slice(0, 20) })),

  modules: [],
  importBusy: false,
  lastImport: null,
  importHandle: null,
  importStatus: null,
  importProgress: [],
  importCompleted: 0,
  importTotal: 0,
  fileImportDraft: null,
  setModules: (modules) => set({ modules }),
  setImportBusy: (importBusy) => set({ importBusy }),
  setLastImport: (lastImport) => set({ lastImport }),
  beginImport: (importHandle) =>
    set({
      importHandle,
      importBusy: true,
      importStatus: null,
      importProgress: [],
      importCompleted: 0,
      importTotal: 0,
      lastImport: null,
    }),
  setImportStatus: (importStatus) => set({ importStatus }),
  addImportProgress: (item) =>
    set((s) => ({ importProgress: [...s.importProgress, item].slice(-80) })),
  setImportCounts: (importCompleted, importTotal) => set({ importCompleted, importTotal }),
  finishImport: (importStatus, lastImport) =>
    set({ importStatus, lastImport, importBusy: false, importHandle: null }),
  setFileImportDraft: (fileImportDraft) => set({ fileImportDraft }),
  updateFileImportDraft: (patch) =>
    set((state) => ({
      fileImportDraft: state.fileImportDraft ? { ...state.fileImportDraft, ...patch } : null,
    })),
  acceptFileImportDraft: (handleId) =>
    set((state) => {
      const draft = state.fileImportDraft;
      if (!draft) return {};
      const terminal = state.importStatus?.handleId === handleId ? state.importStatus.state : null;
      if (terminal === 'done') return { fileImportDraft: null };
      if (terminal && ['partial', 'error', 'cancelled', 'expired'].includes(terminal)) {
        return {
          fileImportDraft: {
            ...draft,
            handleId: null,
            visible: true,
            reopenMessage: `Import ${terminal}. Review your original selection and try again.`,
          },
        };
      }
      return { fileImportDraft: { ...draft, handleId, visible: false, reopenMessage: undefined } };
    }),
  settleFileImportDraft: (handleId, terminal) =>
    set((state) => {
      const draft = state.fileImportDraft;
      if (!draft || draft.handleId !== handleId) return {};
      if (terminal === 'done') return { fileImportDraft: null };
      if (['partial', 'error', 'cancelled', 'expired'].includes(terminal)) {
        return {
          fileImportDraft: {
            ...draft,
            handleId: null,
            visible: true,
            reopenMessage: `Import ${terminal}. Review your original selection and try again.`,
          },
        };
      }
      return {};
    }),

  resolverSettings: null,
  resolverSources: [],
  resolverCache: null,
  resolverHistory: [],
  resolverError: null,
  consent: null,
  consentQueue: [],
  sourceTestHandles: {},
  sourceTestResults: {},
  sourcePreviewHandle: null,
  sourcePreview: null,
  lookupHandles: {},
  oidLookups: {},
  setResolverSettings: (resolverSettings) => set({ resolverSettings }),
  setResolverSources: (resolverSources) => set({ resolverSources }),
  setResolverCache: (resolverCache) => set({ resolverCache }),
  setResolverHistory: (resolverHistory) => set({ resolverHistory }),
  setResolverError: (resolverError) => set({ resolverError }),
  enqueueConsent: (prompt) =>
    set((s) => {
      if (s.consent?.handleId === prompt.handleId) return { consent: prompt };
      if (s.consentQueue.some((item) => item.handleId === prompt.handleId)) return {};
      return s.consent ? { consentQueue: [...s.consentQueue, prompt] } : { consent: prompt };
    }),
  dismissConsent: (handleId) =>
    set((s) => {
      const remaining = s.consentQueue.filter((item) => item.handleId !== handleId);
      if (s.consent?.handleId !== handleId) return { consentQueue: remaining };
      return { consent: remaining[0] ?? null, consentQueue: remaining.slice(1) };
    }),
  setSourceTestHandle: (sourceId, handleId) =>
    set((s) => ({
      sourceTestHandles: { ...s.sourceTestHandles, [sourceId]: handleId },
      sourceTestResults: {
        ...s.sourceTestResults,
        [sourceId]: { state: 'started' },
      },
    })),
  finishSourceTest: (sourceId, state) =>
    set((s) => {
      const handles = { ...s.sourceTestHandles };
      delete handles[sourceId];
      return {
        sourceTestHandles: handles,
        sourceTestResults: { ...s.sourceTestResults, [sourceId]: state },
      };
    }),
  beginSourcePreview: (sourcePreviewHandle) =>
    set({ sourcePreviewHandle, sourcePreview: { state: 'started' } }),
  finishSourcePreview: (sourcePreview) => set({ sourcePreview, sourcePreviewHandle: null }),
  clearSourcePreview: () => set({ sourcePreview: null, sourcePreviewHandle: null }),
  beginOidLookup: (oid, handleId) =>
    set((s) => ({
      lookupHandles: { ...s.lookupHandles, [oid]: handleId },
      oidLookups: { ...s.oidLookups, [oid]: { state: 'started' } },
    })),
  finishOidLookup: (oid, state) =>
    set((s) => {
      const handles = { ...s.lookupHandles };
      delete handles[oid];
      return { lookupHandles: handles, oidLookups: { ...s.oidLookups, [oid]: state } };
    }),
}));
