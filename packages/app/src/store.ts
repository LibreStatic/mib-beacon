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
  VendorMibBrowseResult,
  ResolverSourcePreviewResult,
  SourceConfig,
  AgentProfile,
  AgentGroup,
  TableIndexDescriptor,
  PacketTraceEvent,
  PacketTraceServiceStatus,
} from '@mibbeacon/core/client';
import { upsertPacketTrace } from './packet-console';
import { enqueueToast, toastDuration, type ToastInput, type ToastItem } from './toast-queue';
import { normalizePatternTraceColor } from './pattern-trace-settings';
import {
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  getCodeOssDefaultTheme,
} from '@mibbeacon/ui/default-themes';
import type { ThemeDescriptor } from '@mibbeacon/ui/theme-values';
import {
  THEME_STORAGE_KEYS,
  browserThemeStorage,
  isOpenVsxCatalogEnabled,
  parseStoredThemes,
  type ThemeStorageAdapter,
} from './theme-storage';

export type Tab =
  'browse' | 'liveMibs' | 'query' | 'agents' | 'traps' | 'tools' | 'mibs' | 'settings';
export type AppThemeMode = 'system' | 'light' | 'dark';
export type AppDensityMode = 'auto' | 'compact' | 'comfortable';
export interface AppNotificationPreferences {
  trapRules: boolean;
  watchAlerts: boolean;
}

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
  lightThemeId: string;
  darkThemeId: string;
  installedThemes: ThemeDescriptor[];
  themesHydrated: boolean;
  openVsxThemeCatalogEnabled: boolean;
  densityMode: AppDensityMode;
  setThemeMode: (mode: AppThemeMode) => void;
  setThemeForScheme: (scheme: 'light' | 'dark', themeId: string) => void;
  installThemes: (themes: ThemeDescriptor[]) => void;
  removeTheme: (themeId: string) => void;
  setOpenVsxThemeCatalogEnabled: (enabled: boolean) => void;
  setDensityMode: (mode: AppDensityMode) => void;
  patternTraceColor: string;
  setPatternTraceColor: (color: string) => void;
  notificationPreferences: AppNotificationPreferences;
  setNotificationPreference: (key: keyof AppNotificationPreferences, enabled: boolean) => void;

  packetConsoleOpen: boolean;
  packetFeedPaused: boolean;
  packetEvents: PacketTraceEvent[];
  packetStatus: PacketTraceServiceStatus | null;
  setPacketConsoleOpen: (open: boolean) => void;
  setPacketFeedPaused: (paused: boolean) => void;
  setPacketEvents: (events: PacketTraceEvent[]) => void;
  addPacketEvent: (event: PacketTraceEvent) => void;
  setPacketStatus: (status: PacketTraceServiceStatus | null) => void;
  clearPacketEvents: () => void;

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
  liveMibScopeOid: string | null;
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
  setLiveMibScopeOid: (oid: string | null) => void;

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
  trapComposerOpen: boolean;
  notification: NotificationForm;
  notificationAgentId: string | null;
  sendBusy: boolean;
  sendError: string | null;
  sendHistory: NotificationHistoryItem[];
  setTrapMode: (mode: TrapMode) => void;
  setTrapComposerOpen: (open: boolean) => void;
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
  vendorMibBrowseHandles: Record<string, string>;
  vendorMibBrowses: Record<string, VendorMibBrowseState>;
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
  // --- toasts ---
  toasts: ToastItem[];
  /** Queue a transient toast; returns its id. Dedupes identical tone+message. */
  pushToast: (input: ToastInput) => string;
  dismissToast: (id: string) => void;
  beginVendorMibBrowse: (oid: string, handleId: string) => void;
  finishVendorMibBrowse: (oid: string, state: VendorMibBrowseState) => void;
  resetEngineSessionTransientState: () => void;
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

export interface VendorMibBrowseState {
  state: ResolverOperationState;
  result?: VendorMibBrowseResult;
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
  const value = readStoredPreference(key) as T | null;
  return value && values.includes(value) ? value : fallback;
}

let configuredThemeStorage = browserThemeStorage();
let themePreferenceRevision = 0;

function readStoredPreference(key: string): string | null {
  try {
    const value = configuredThemeStorage?.getItem(key);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function writeUiPreference(key: string, value: string): void {
  try {
    const result = configuredThemeStorage?.setItem(key, value);
    if (result && 'catch' in result) void result.catch(() => undefined);
  } catch {
    // Native hosts without localStorage retain the preference for this app session.
  }
}

function persistInstalledThemes(themes: ThemeDescriptor[]): void {
  writeUiPreference(THEME_STORAGE_KEYS.installed, JSON.stringify(themes));
}

async function storedValue(storage: ThemeStorageAdapter | undefined, key: string) {
  try {
    return (await storage?.getItem(key)) ?? null;
  } catch {
    return null;
  }
}

export async function configureThemeStorage(storage?: ThemeStorageAdapter): Promise<void> {
  configuredThemeStorage = storage ?? browserThemeStorage();
  const revision = themePreferenceRevision;
  const [mode, light, dark, density, installed, openVsxEnabled, notifyTraps, notifyWatches] =
    await Promise.all([
      storedValue(configuredThemeStorage, THEME_STORAGE_KEYS.mode),
      storedValue(configuredThemeStorage, THEME_STORAGE_KEYS.light),
      storedValue(configuredThemeStorage, THEME_STORAGE_KEYS.dark),
      storedValue(configuredThemeStorage, THEME_STORAGE_KEYS.density),
      storedValue(configuredThemeStorage, THEME_STORAGE_KEYS.installed),
      storedValue(configuredThemeStorage, THEME_STORAGE_KEYS.openVsxEnabled),
      storedValue(configuredThemeStorage, 'mibbeacon:notifications:trap-rules'),
      storedValue(configuredThemeStorage, 'mibbeacon:notifications:watch-alerts'),
    ]);
  const themes = parseStoredThemes(installed);
  const installedIds = new Set(themes.map(({ id }) => id));
  const validLight =
    getCodeOssDefaultTheme(light ?? '')?.scheme === 'light' ||
    (light != null && installedIds.has(light));
  const validDark =
    getCodeOssDefaultTheme(dark ?? '')?.scheme === 'dark' ||
    (dark != null && installedIds.has(dark));
  useAppStore.setState({
    installedThemes: themes,
    themesHydrated: true,
    ...(revision === themePreferenceRevision
      ? {
          themeMode: mode === 'system' || mode === 'light' || mode === 'dark' ? mode : 'system',
          densityMode:
            density === 'auto' || density === 'compact' || density === 'comfortable'
              ? density
              : 'auto',
          lightThemeId: validLight ? light! : DEFAULT_LIGHT_THEME_ID,
          darkThemeId: validDark ? dark! : DEFAULT_DARK_THEME_ID,
          openVsxThemeCatalogEnabled: isOpenVsxCatalogEnabled(openVsxEnabled),
          notificationPreferences: {
            trapRules: notifyTraps === 'true',
            watchAlerts: notifyWatches === 'true',
          },
        }
      : {}),
  });
}

const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();
let toastSeq = 0;
function clearToastTimer(id: string): void {
  const handle = toastTimers.get(id);
  if (handle != null) {
    clearTimeout(handle);
    toastTimers.delete(id);
  }
}

function fileImportReopenMessage(
  state: Pick<AppState, 'importStatus' | 'lastImport'>,
  terminal: ResolverOperationState,
): string {
  const failure = state.importStatus?.failures[0];
  const detail = failure
    ? `${failure.module ? `${failure.module}: ` : ''}${failure.message}`
    : state.lastImport?.errors[0]?.message;
  return detail
    ? `Import ${terminal} — ${detail}. Review your original selection and try again.`
    : `Import ${terminal}. Review your original selection and try again.`;
}

export const useAppStore = create<AppState>((set) => ({
  tab: 'browse',
  setTab: (tab) => set({ tab }),
  themeMode: readUiPreference('mibbeacon:theme', ['system', 'light', 'dark'], 'system'),
  lightThemeId: readStoredPreference(THEME_STORAGE_KEYS.light)?.trim() || DEFAULT_LIGHT_THEME_ID,
  darkThemeId: readStoredPreference(THEME_STORAGE_KEYS.dark)?.trim() || DEFAULT_DARK_THEME_ID,
  installedThemes: parseStoredThemes(readStoredPreference(THEME_STORAGE_KEYS.installed)),
  themesHydrated: Boolean(configuredThemeStorage),
  openVsxThemeCatalogEnabled: isOpenVsxCatalogEnabled(
    readStoredPreference(THEME_STORAGE_KEYS.openVsxEnabled),
  ),
  densityMode: readUiPreference('mibbeacon:density', ['auto', 'compact', 'comfortable'], 'auto'),
  patternTraceColor: normalizePatternTraceColor(
    readStoredPreference('mibbeacon:pattern-trace-color'),
  ),
  notificationPreferences: {
    trapRules: readStoredPreference('mibbeacon:notifications:trap-rules') === 'true',
    watchAlerts: readStoredPreference('mibbeacon:notifications:watch-alerts') === 'true',
  },
  setThemeMode: (themeMode) => {
    themePreferenceRevision += 1;
    writeUiPreference('mibbeacon:theme', themeMode);
    set({ themeMode });
  },
  setThemeForScheme: (scheme, themeId) => {
    themePreferenceRevision += 1;
    writeUiPreference(`mibbeacon:theme-${scheme}`, themeId);
    set(scheme === 'dark' ? { darkThemeId: themeId } : { lightThemeId: themeId });
  },
  installThemes: (themes) => {
    themePreferenceRevision += 1;
    return set((state) => {
      const byId = new Map(state.installedThemes.map((theme) => [theme.id, theme]));
      for (const theme of themes) if (theme.source === 'imported') byId.set(theme.id, theme);
      const installedThemes = [...byId.values()].slice(-50);
      persistInstalledThemes(installedThemes);
      return { installedThemes };
    });
  },
  removeTheme: (themeId) => {
    themePreferenceRevision += 1;
    return set((state) => {
      const installedThemes = state.installedThemes.filter(({ id }) => id !== themeId);
      persistInstalledThemes(installedThemes);
      const patch: Partial<AppState> = { installedThemes };
      if (state.lightThemeId === themeId) {
        patch.lightThemeId = DEFAULT_LIGHT_THEME_ID;
        writeUiPreference(THEME_STORAGE_KEYS.light, DEFAULT_LIGHT_THEME_ID);
      }
      if (state.darkThemeId === themeId) {
        patch.darkThemeId = DEFAULT_DARK_THEME_ID;
        writeUiPreference(THEME_STORAGE_KEYS.dark, DEFAULT_DARK_THEME_ID);
      }
      return patch;
    });
  },
  setOpenVsxThemeCatalogEnabled: (openVsxThemeCatalogEnabled) => {
    themePreferenceRevision += 1;
    writeUiPreference(THEME_STORAGE_KEYS.openVsxEnabled, String(openVsxThemeCatalogEnabled));
    set({ openVsxThemeCatalogEnabled });
  },
  setDensityMode: (densityMode) => {
    themePreferenceRevision += 1;
    writeUiPreference('mibbeacon:density', densityMode);
    set({ densityMode });
  },
  setPatternTraceColor: (color) => {
    const normalized = normalizePatternTraceColor(color);
    writeUiPreference('mibbeacon:pattern-trace-color', normalized);
    set({ patternTraceColor: normalized });
  },
  setNotificationPreference: (key, enabled) => {
    writeUiPreference(
      `mibbeacon:notifications:${key === 'trapRules' ? 'trap-rules' : 'watch-alerts'}`,
      String(enabled),
    );
    set((state) => ({
      notificationPreferences: { ...state.notificationPreferences, [key]: enabled },
    }));
  },
  packetConsoleOpen: false,
  packetFeedPaused: false,
  packetEvents: [],
  packetStatus: null,
  setPacketConsoleOpen: (packetConsoleOpen) => set({ packetConsoleOpen }),
  setPacketFeedPaused: (packetFeedPaused) => set({ packetFeedPaused }),
  setPacketEvents: (packetEvents) => set({ packetEvents: packetEvents.slice(-500) }),
  addPacketEvent: (event) =>
    set((state) =>
      state.packetFeedPaused ? {} : { packetEvents: upsertPacketTrace(state.packetEvents, event) },
    ),
  setPacketStatus: (packetStatus) => set({ packetStatus }),
  clearPacketEvents: () => set({ packetEvents: [] }),

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
  liveMibScopeOid: null,
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
  setLiveMibScopeOid: (liveMibScopeOid) => set({ liveMibScopeOid }),

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
  trapComposerOpen: false,
  notification: defaultNotification,
  notificationAgentId: null,
  sendBusy: false,
  sendError: null,
  sendHistory: [],
  setTrapMode: (trapMode) => set({ trapMode }),
  setTrapComposerOpen: (trapComposerOpen) => set({ trapComposerOpen }),
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
  finishImport: (importStatus, lastImport) => {
    set({ importStatus, lastImport, importBusy: false, importHandle: null });
    const loaded = lastImport?.loaded.length ?? 0;
    const failed = lastImport?.errors.length ?? 0;
    const modules = (n: number) => `${n} module${n === 1 ? '' : 's'}`;
    const toast = useAppStore.getState().pushToast;
    switch (importStatus.state) {
      case 'done':
        toast({ tone: 'success', message: `Imported ${modules(loaded)}` });
        break;
      case 'partial':
        toast({ tone: 'warn', message: `Imported ${modules(loaded)} · ${failed} failed` });
        break;
      case 'expired':
        toast({ tone: 'warn', message: 'Import expired before completing' });
        break;
      case 'error':
        toast({
          tone: 'error',
          message: lastImport?.errors[0]?.message ?? 'Import failed',
        });
        break;
      // 'cancelled' is user-initiated; stay quiet.
    }
  },
  setFileImportDraft: (fileImportDraft) =>
    set({
      fileImportDraft,
      ...(fileImportDraft?.visible ? { browserImportOpen: false } : {}),
    }),
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
            reopenMessage: fileImportReopenMessage(state, terminal),
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
            reopenMessage: fileImportReopenMessage(state, terminal),
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
  vendorMibBrowseHandles: {},
  vendorMibBrowses: {},
  resetEngineSessionTransientState: () =>
    set((state) => ({
      running: null,
      walkStart: 0,
      moduleFocus: null,
      selected: null,
      expanded: {},
      hits: [],
      childrenCache: {},
      searchPhase: 'idle',
      searchError: null,
      agentOperationStatuses: {},
      operationPduLog: [],
      results: [],
      stats: { count: 0, batches: 0, ms: 0 },
      queryError: null,
      sendBusy: false,
      sendError: null,
      sendHistory: [],
      oidName: null,
      setPreviousValues: [],
      setReview: false,
      tableView: null,
      importBusy: false,
      lastImport: null,
      importHandle: null,
      importStatus: null,
      importProgress: [],
      importCompleted: 0,
      importTotal: 0,
      fileImportDraft: state.fileImportDraft
        ? { ...state.fileImportDraft, handleId: null, visible: true }
        : null,
      consent: null,
      consentQueue: [],
      sourceTestHandles: {},
      sourceTestResults: {},
      sourcePreviewHandle: null,
      sourcePreview: null,
      lookupHandles: {},
      oidLookups: {},
      vendorMibBrowseHandles: {},
      vendorMibBrowses: {},
    })),
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
  toasts: [],
  pushToast: (input) => {
    const id = `toast-${++toastSeq}`;
    const durationMs = toastDuration(input);
    const item: ToastItem = {
      id,
      tone: input.tone,
      message: input.message,
      actionLabel: input.actionLabel,
      onAction: input.onAction,
      durationMs,
    };
    set((s) => {
      const next = enqueueToast(s.toasts, item);
      const kept = new Set(next.map((t) => t.id));
      // Clear timers for toasts dropped by dedupe or the queue cap.
      for (const t of s.toasts) if (!kept.has(t.id)) clearToastTimer(t.id);
      return { toasts: next };
    });
    if (durationMs > 0) {
      toastTimers.set(
        id,
        setTimeout(() => useAppStore.getState().dismissToast(id), durationMs),
      );
    }
    return id;
  },
  dismissToast: (id) => {
    clearToastTimer(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  beginVendorMibBrowse: (oid, handleId) =>
    set((s) => ({
      vendorMibBrowseHandles: { ...s.vendorMibBrowseHandles, [oid]: handleId },
      vendorMibBrowses: { ...s.vendorMibBrowses, [oid]: { state: 'started' } },
    })),
  finishVendorMibBrowse: (oid, state) =>
    set((s) => {
      const handles = { ...s.vendorMibBrowseHandles };
      delete handles[oid];
      return {
        vendorMibBrowseHandles: handles,
        vendorMibBrowses: { ...s.vendorMibBrowses, [oid]: state },
      };
    }),
}));
