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
  NotificationAgentSendRequest,
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
  AgentProfile,
  AgentGroup,
  TableIndexDescriptor,
} from '@mibbeacon/core/client';

export type Tab = 'browse' | 'query' | 'agents' | 'traps' | 'tools' | 'mibs' | 'settings';
export type AppThemeMode = 'system' | 'light' | 'dark';
export type AppDensityMode = 'auto' | 'compact' | 'comfortable';

const RESULTS_CAP = 5000;
const TRAPS_CAP = 200;

export interface AgentForm {
  host: string;
  port: string;
  transport: 'udp4' | 'udp6';
  version: SnmpVersion;
  timeoutMs: string;
  retries: string;
  getBulkNonRepeaters: string;
  getBulkMaxRepetitions: string;
  community: string;
  v3: {
    user: string;
    level: SecurityLevel;
    authProtocol: AuthProtocol;
    authKey: string;
    privProtocol: PrivProtocol;
    privKey: string;
    context: string;
    contextEngineId: string;
  };
}

export interface WalkStats {
  count: number;
  batches: number;
  ms: number;
}

export interface QueryResultTab {
  id: string;
  title: string;
  results: DecodedVarbind[];
  stats: WalkStats;
  pinned: boolean;
  createdAt: number;
}

export interface TableViewState {
  entryOid: string;
  name: string;
  columns: { oid: string; name: string; access?: string; syntax?: string }[];
  indexes: TableIndexDescriptor[];
  selectedColumnOids: string[];
  rotate: boolean;
  pollMs: number;
}

export type BrowseTreeNode = MibNodeSummary | ModuleTreeNode;
export type BrowseSearchPhase = 'idle' | 'debouncing' | 'searching' | 'opening' | 'error';
export type QueryOperation = 'get' | 'getNext' | 'getBulk' | 'walk' | 'set';
export type TrapMode = 'receive' | 'send';

export interface NotificationForm {
  kind: NotificationKind;
  target: AgentForm;
  trapOid: string;
  upTime: string;
  agentAddress: string;
  v1Enterprise: string;
  v1Generic: string;
  v1Specific: string;
  varbinds: SnmpVarbindInput[];
}

export interface NotificationHistoryItem {
  id: string;
  request: NotificationSendRequest | NotificationAgentSendRequest;
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
  themeMode: AppThemeMode;
  densityMode: AppDensityMode;
  setThemeMode: (mode: AppThemeMode) => void;
  setDensityMode: (mode: AppDensityMode) => void;

  // --- browse ---
  expanded: Record<string, boolean>;
  childrenCache: Record<string, BrowseTreeNode[]>;
  moduleFocus: ModuleView | null;
  selected: MibNodeDetail | null;
  search: string;
  hits: MibSearchHit[];
  searchPhase: BrowseSearchPhase;
  searchError: string | null;
  browserConsoleOpen: boolean;
  browserImportOpen: boolean;
  setExpanded: (oid: string, open: boolean) => void;
  setChildren: (oid: string, children: BrowseTreeNode[]) => void;
  setModuleFocus: (focus: ModuleView | null) => void;
  clearChildrenCache: () => void;
  setSelected: (node: MibNodeDetail | null) => void;
  setSearch: (q: string) => void;
  setHits: (hits: MibSearchHit[]) => void;
  setSearchPhase: (phase: BrowseSearchPhase) => void;
  setSearchError: (error: string | null) => void;
  setBrowserConsoleOpen: (open: boolean) => void;
  setBrowserImportOpen: (open: boolean) => void;

  // --- query ---
  agent: AgentForm;
  agentProfiles: AgentProfile[];
  agentGroups: AgentGroup[];
  selectedAgentId: string | null;
  selectedAgentGroupId: string | null;
  queryGroupMode: boolean;
  agentOperationStatuses: Record<string, { state: string; message?: string; count?: number }>;
  operationPduLog: unknown[];
  rawPduOpen: boolean;
  tableView: TableViewState | null;
  oid: string;
  oidName: string | null;
  results: DecodedVarbind[];
  running: string | null; // walk handleId
  walkStart: number;
  stats: WalkStats;
  queryError: string | null;
  queryOperation: QueryOperation;
  setDraft: SnmpVarbindInput;
  setStaging: SnmpVarbindInput[];
  setPreviousValues: DecodedVarbind[];
  setReview: boolean;
  queryTabs: QueryResultTab[];
  activeQueryTabId: string | null;
  setAgent: (patch: Partial<AgentForm>) => void;
  setV3: (patch: Partial<AgentForm['v3']>) => void;
  setAgentProfiles: (profiles: AgentProfile[]) => void;
  setAgentGroups: (groups: AgentGroup[]) => void;
  selectAgentProfile: (profile: AgentProfile | null) => void;
  selectAgentGroup: (groupId: string | null) => void;
  setQueryGroupMode: (enabled: boolean) => void;
  setAgentOperationStatus: (
    agentId: string,
    status: { state: string; message?: string; count?: number },
  ) => void;
  clearAgentOperationStatuses: () => void;
  appendOperationPdu: (entry: unknown) => void;
  clearOperationPduLog: () => void;
  setRawPduOpen: (open: boolean) => void;
  setTableView: (view: TableViewState | null) => void;
  setTableViewColumns: (oids: string[]) => void;
  setTableViewRotate: (rotate: boolean) => void;
  setTableViewPollMs: (ms: number) => void;
  setOid: (oid: string) => void;
  setOidName: (name: string | null) => void;
  setResults: (results: DecodedVarbind[]) => void;
  appendResults: (batch: DecodedVarbind[]) => void;
  setRunning: (handleId: string | null, start?: number) => void;
  setStats: (stats: WalkStats) => void;
  setQueryError: (msg: string | null) => void;
  setQueryOperation: (operation: QueryOperation) => void;
  updateSetDraft: (patch: Partial<SnmpVarbindInput>) => void;
  addSetDraftToStaging: () => void;
  updateStagedVarbind: (index: number, patch: Partial<SnmpVarbindInput>) => void;
  removeStagedVarbind: (index: number) => void;
  clearSetStaging: () => void;
  setSetPreviousValues: (values: DecodedVarbind[]) => void;
  setSetReview: (review: boolean) => void;
  saveQueryResultTab: (title: string) => void;
  selectQueryResultTab: (id: string) => void;
  closeQueryResultTab: (id: string) => void;
  toggleQueryResultTabPin: (id: string) => void;

  // --- traps ---
  receiver: {
    running: boolean;
    port?: number;
    count?: number;
    drops?: number;
    transports?: ('udp4' | 'udp6')[];
  };
  records: TrapRecord[];
  unreadTrapCount: number;
  setReceiver: (r: AppState['receiver']) => void;
  setTrapRecords: (records: TrapRecord[]) => void;
  addTrap: (rec: TrapRecord) => void;
  markTrapRead: (id: string, read?: boolean) => void;
  removeTrap: (id: string) => void;
  clearTraps: () => void;
  trapMode: TrapMode;
  notification: NotificationForm;
  notificationAgentId: string | null;
  sendBusy: boolean;
  sendError: string | null;
  sendHistory: NotificationHistoryItem[];
  setTrapMode: (mode: TrapMode) => void;
  updateNotification: (patch: Partial<NotificationForm>) => void;
  setNotificationAgentId: (id: string | null) => void;
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
  stage?: string;
  responseExcerpt?: string;
  httpStatus?: number;
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
  transport: 'udp4',
  version: 'v2c',
  timeoutMs: '5000',
  retries: '1',
  getBulkNonRepeaters: '0',
  getBulkMaxRepetitions: '20',
  community: 'public',
  v3: {
    user: '',
    level: 'authPriv',
    authProtocol: 'sha256',
    authKey: '',
    privProtocol: 'aes',
    privKey: '',
    context: '',
    contextEngineId: '',
  },
};

const defaultNotification: NotificationForm = {
  kind: 'trap',
  target: { ...defaultAgent, port: '162', v3: { ...defaultAgent.v3 } },
  trapOid: '1.3.6.1.6.3.1.1.5.1',
  upTime: '',
  agentAddress: '',
  v1Enterprise: '1.3.6.1.4.1',
  v1Generic: '6',
  v1Specific: '0',
  varbinds: [],
};

function readUiPreference<T extends string>(key: string, values: readonly T[], fallback: T): T {
  try {
    const value = (globalThis as { localStorage?: Storage }).localStorage?.getItem(key) as T | null;
    return value && values.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeUiPreference(key: string, value: string): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(key, value);
  } catch {
    // Native hosts without localStorage retain the preference for this app session.
  }
}

export const useAppStore = create<AppState>((set) => ({
  tab: 'browse',
  setTab: (tab) => set({ tab }),
  themeMode: readUiPreference('mibbeacon:theme', ['system', 'light', 'dark'], 'system'),
  densityMode: readUiPreference('mibbeacon:density', ['auto', 'compact', 'comfortable'], 'auto'),
  setThemeMode: (themeMode) => {
    writeUiPreference('mibbeacon:theme', themeMode);
    set({ themeMode });
  },
  setDensityMode: (densityMode) => {
    writeUiPreference('mibbeacon:density', densityMode);
    set({ densityMode });
  },

  expanded: {},
  childrenCache: {},
  moduleFocus: null,
  selected: null,
  search: '',
  hits: [],
  searchPhase: 'idle',
  searchError: null,
  browserConsoleOpen: false,
  browserImportOpen: false,
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
  setBrowserConsoleOpen: (browserConsoleOpen) => set({ browserConsoleOpen }),
  setBrowserImportOpen: (browserImportOpen) => set({ browserImportOpen }),

  agent: defaultAgent,
  agentProfiles: [],
  agentGroups: [],
  selectedAgentId: null,
  selectedAgentGroupId: null,
  queryGroupMode: false,
  agentOperationStatuses: {},
  operationPduLog: [],
  rawPduOpen: false,
  tableView: null,
  oid: '1.3.6.1.2.1',
  oidName: null,
  results: [],
  running: null,
  walkStart: 0,
  stats: { count: 0, batches: 0, ms: 0 },
  queryError: null,
  queryOperation: 'get',
  setDraft: { oid: '1.3.6.1.2.1.1.5.0', type: 'OctetString', value: '' },
  setStaging: [],
  setPreviousValues: [],
  setReview: false,
  queryTabs: [],
  activeQueryTabId: null,
  setAgent: (patch) => set((s) => ({ agent: { ...s.agent, ...patch }, selectedAgentId: null })),
  setV3: (patch) =>
    set((s) => ({
      agent: { ...s.agent, v3: { ...s.agent.v3, ...patch } },
      selectedAgentId: null,
    })),
  setAgentProfiles: (agentProfiles) => set({ agentProfiles }),
  setAgentGroups: (agentGroups) => set({ agentGroups }),
  selectAgentProfile: (profile) =>
    set((s) =>
      profile
        ? {
            selectedAgentId: profile.id,
            agent: {
              host: profile.host,
              port: String(profile.port),
              transport: profile.transport,
              version: profile.version,
              timeoutMs: String(profile.timeoutMs),
              retries: String(profile.retries),
              getBulkNonRepeaters: String(profile.getBulkNonRepeaters),
              getBulkMaxRepetitions: String(profile.getBulkMaxRepetitions),
              community: '',
              v3: {
                user: profile.v3?.user ?? '',
                level: profile.v3?.level ?? 'authPriv',
                authProtocol: profile.v3?.authProtocol ?? 'sha256',
                authKey: '',
                privProtocol: profile.v3?.privProtocol ?? 'aes',
                privKey: '',
                context: profile.v3?.context ?? '',
                contextEngineId: profile.v3?.contextEngineId ?? '',
              },
            },
          }
        : { selectedAgentId: null, agent: { ...s.agent } },
    ),
  selectAgentGroup: (selectedAgentGroupId) => set({ selectedAgentGroupId }),
  setQueryGroupMode: (queryGroupMode) => set({ queryGroupMode }),
  setAgentOperationStatus: (agentId, status) =>
    set((state) => ({
      agentOperationStatuses: { ...state.agentOperationStatuses, [agentId]: status },
    })),
  clearAgentOperationStatuses: () => set({ agentOperationStatuses: {} }),
  appendOperationPdu: (entry) =>
    set((state) => ({ operationPduLog: [...state.operationPduLog, entry].slice(-200) })),
  clearOperationPduLog: () => set({ operationPduLog: [] }),
  setRawPduOpen: (rawPduOpen) => set({ rawPduOpen }),
  setTableView: (tableView) => set({ tableView }),
  setTableViewColumns: (selectedColumnOids) =>
    set((state) => ({
      tableView: state.tableView ? { ...state.tableView, selectedColumnOids } : null,
    })),
  setTableViewRotate: (rotate) =>
    set((state) => ({ tableView: state.tableView ? { ...state.tableView, rotate } : null })),
  setTableViewPollMs: (pollMs) =>
    set((state) => ({ tableView: state.tableView ? { ...state.tableView, pollMs } : null })),
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
  addSetDraftToStaging: () =>
    set((state) => ({
      setStaging: [...state.setStaging, { ...state.setDraft }],
      setReview: false,
      setPreviousValues: [],
    })),
  updateStagedVarbind: (index, patch) =>
    set((state) => ({
      setStaging: state.setStaging.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
      setReview: false,
      setPreviousValues: [],
    })),
  removeStagedVarbind: (index) =>
    set((state) => ({
      setStaging: state.setStaging.filter((_, itemIndex) => itemIndex !== index),
      setReview: false,
      setPreviousValues: [],
    })),
  clearSetStaging: () => set({ setStaging: [], setPreviousValues: [], setReview: false }),
  setSetPreviousValues: (setPreviousValues) => set({ setPreviousValues }),
  setSetReview: (setReview) => set({ setReview }),
  saveQueryResultTab: (title) =>
    set((state) => {
      const id = `result-${Date.now()}-${state.queryTabs.length}`;
      const tab: QueryResultTab = {
        id,
        title,
        results: [...state.results],
        stats: { ...state.stats },
        pinned: false,
        createdAt: Date.now(),
      };
      return { queryTabs: [...state.queryTabs, tab].slice(-20), activeQueryTabId: id };
    }),
  selectQueryResultTab: (id) =>
    set((state) => {
      const tab = state.queryTabs.find((item) => item.id === id);
      return tab
        ? { activeQueryTabId: id, results: [...tab.results], stats: { ...tab.stats } }
        : {};
    }),
  closeQueryResultTab: (id) =>
    set((state) => {
      const queryTabs = state.queryTabs.filter((tab) => tab.id !== id || tab.pinned);
      const active =
        state.activeQueryTabId === id
          ? (queryTabs[queryTabs.length - 1] ?? null)
          : (queryTabs.find((tab) => tab.id === state.activeQueryTabId) ?? null);
      return {
        queryTabs,
        activeQueryTabId: active?.id ?? null,
        ...(active ? { results: [...active.results], stats: { ...active.stats } } : {}),
      };
    }),
  toggleQueryResultTabPin: (id) =>
    set((state) => ({
      queryTabs: state.queryTabs.map((tab) =>
        tab.id === id ? { ...tab, pinned: !tab.pinned } : tab,
      ),
    })),

  receiver: { running: false },
  records: [],
  unreadTrapCount: 0,
  setReceiver: (receiver) => set({ receiver }),
  setTrapRecords: (records) =>
    set({
      records: records.slice(0, TRAPS_CAP),
      unreadTrapCount: records.filter((item) => !item.readAt).length,
    }),
  addTrap: (rec) =>
    set((s) => ({
      records: [rec, ...s.records].slice(0, TRAPS_CAP),
      unreadTrapCount: s.unreadTrapCount + (rec.readAt ? 0 : 1),
    })),
  markTrapRead: (id, read = true) =>
    set((state) => {
      const record = state.records.find((item) => item.id === id);
      if (!record || Boolean(record.readAt) === read) return {};
      return {
        records: state.records.map((item) =>
          item.id === id
            ? { ...item, ...(read ? { readAt: Date.now() } : { readAt: undefined }) }
            : item,
        ),
        unreadTrapCount: Math.max(0, state.unreadTrapCount + (read ? -1 : 1)),
      };
    }),
  removeTrap: (id) =>
    set((state) => {
      const record = state.records.find((item) => item.id === id);
      return {
        records: state.records.filter((item) => item.id !== id),
        unreadTrapCount: Math.max(0, state.unreadTrapCount - (record && !record.readAt ? 1 : 0)),
      };
    }),
  clearTraps: () => set({ records: [], unreadTrapCount: 0 }),
  trapMode: 'receive',
  notification: defaultNotification,
  notificationAgentId: null,
  sendBusy: false,
  sendError: null,
  sendHistory: [],
  setTrapMode: (trapMode) => set({ trapMode }),
  updateNotification: (patch) => set((s) => ({ notification: { ...s.notification, ...patch } })),
  setNotificationAgentId: (notificationAgentId) => set({ notificationAgentId }),
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
