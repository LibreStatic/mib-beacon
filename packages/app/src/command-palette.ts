import type { NavigationTab } from './navigation';
import type { QueryOperation, Tab, TrapMode } from './store';
import type { AppAction } from './action-registry';

export const PALETTE_HISTORY_KEY = 'mibbeacon:command-palette:recents:v1';
export const PALETTE_HISTORY_LIMIT = 10;

export type PaletteCommandId =
  | `navigate:${Exclude<Tab, 'mibs'>}`
  | 'browse:focus-search'
  | 'browse:import'
  | 'preferences:color-theme'
  | 'preferences:browse-color-themes'
  | 'preferences:import-color-theme'
  | 'agents:create-profile'
  | 'app:shortcuts'
  | 'window:new'
  | 'query:prepare-get'
  | 'query:prepare-get-next'
  | 'query:prepare-get-bulk'
  | 'query:prepare-walk'
  | 'query:prepare-set'
  | 'traps:receive'
  | 'traps:send'
  | 'query:get'
  | 'query:get-next'
  | 'query:get-bulk'
  | 'query:walk'
  | 'query:stage-set'
  | 'query:run-current'
  | 'query:repeat'
  | 'query:stop';

export type PaletteCommandEffect =
  | { kind: 'navigate'; tab: Tab }
  | { kind: 'focus-browse-search' }
  | { kind: 'import-mib' }
  | { kind: 'open-theme-picker' }
  | { kind: 'open-theme-catalog' }
  | { kind: 'import-theme' }
  | { kind: 'create-agent-profile' }
  | { kind: 'show-shortcuts' }
  | { kind: 'new-window' }
  | { kind: 'prepare-query'; operation: QueryOperation }
  | { kind: 'open-traps'; mode: TrapMode };

export interface PaletteCommand {
  id: PaletteCommandId;
  label: string;
  group: 'Navigation' | 'Preferences' | 'Application' | 'Agents' | 'Query' | 'Traps';
  glyph: string;
  keywords: readonly string[];
  effect: PaletteCommandEffect;
}

export type PaletteRecentItem =
  | { kind: 'command'; commandId: string }
  | {
      kind: 'oid';
      oid: string;
      name: string;
      module?: string;
      nodeKind?: string;
    };

export interface PaletteHistoryStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}

export interface PaletteCommandContext {
  navigate(tab: Tab): void;
  focusBrowseSearch(): void;
  importMib(): void;
  openThemePicker(): void;
  openThemeCatalog(): void;
  importTheme(): void;
  createAgentProfile(): void;
  showShortcuts(): void;
  newWindow?(): void;
  prepareQuery(operation: QueryOperation): void;
  openTraps(mode: TrapMode): void;
}

export function applyPaletteCommandEffect(
  effect: PaletteCommandEffect,
  context: PaletteCommandContext,
): void {
  if (effect.kind === 'navigate') context.navigate(effect.tab);
  else if (effect.kind === 'focus-browse-search') {
    context.navigate('browse');
    context.focusBrowseSearch();
  } else if (effect.kind === 'import-mib') {
    context.navigate('browse');
    context.importMib();
  } else if (effect.kind === 'open-theme-picker') context.openThemePicker();
  else if (effect.kind === 'open-theme-catalog') context.openThemeCatalog();
  else if (effect.kind === 'import-theme') context.importTheme();
  else if (effect.kind === 'create-agent-profile') {
    context.navigate('liveMibs');
    context.createAgentProfile();
  }
  else if (effect.kind === 'show-shortcuts') context.showShortcuts();
  else if (effect.kind === 'new-window') context.newWindow?.();
  else if (effect.kind === 'prepare-query') {
    context.prepareQuery(effect.operation);
    context.navigate('query');
  } else {
    context.openTraps(effect.mode);
    context.navigate('traps');
  }
}

export type PaletteEntry =
  | {
      key: `command:${string}`;
      kind: 'command';
      section: 'Recents' | string;
      command: AppAction;
      recent: boolean;
    }
  | {
      key: `oid:${string}`;
      kind: 'oid';
      section: 'Recents';
      item: Extract<PaletteRecentItem, { kind: 'oid' }>;
      recent: true;
    };

const STATIC_COMMANDS: readonly PaletteCommand[] = [
  {
    id: 'browse:focus-search',
    label: 'Focus Browse search',
    group: 'Application',
    glyph: '⌕',
    keywords: ['mib', 'oid', 'find', 'catalog'],
    effect: { kind: 'focus-browse-search' },
  },
  {
    id: 'browse:import',
    label: 'Import MIB',
    group: 'Application',
    glyph: '↑',
    keywords: ['file', 'load', 'catalog'],
    effect: { kind: 'import-mib' },
  },
  {
    id: 'preferences:color-theme',
    label: 'Preferences: Color Theme',
    group: 'Preferences',
    glyph: '◐',
    keywords: ['appearance', 'color', 'theme', 'light', 'dark'],
    effect: { kind: 'open-theme-picker' },
  },
  {
    id: 'preferences:browse-color-themes',
    label: 'Preferences: Browse Additional Color Themes',
    group: 'Preferences',
    glyph: '＋',
    keywords: ['appearance', 'color', 'theme', 'open vsx', 'install', 'download'],
    effect: { kind: 'open-theme-catalog' },
  },
  {
    id: 'preferences:import-color-theme',
    label: 'Preferences: Import Color Theme',
    group: 'Preferences',
    glyph: '⇧',
    keywords: ['appearance', 'color', 'theme', 'json', 'jsonc', 'vsix', 'file'],
    effect: { kind: 'import-theme' },
  },
  {
    id: 'agents:create-profile',
    label: 'Create agent profile',
    group: 'Agents',
    glyph: '＋',
    keywords: ['agent', 'target', 'snmp', 'profile', 'live mibs'],
    effect: { kind: 'create-agent-profile' },
  },
  {
    id: 'app:shortcuts',
    label: 'Show keyboard shortcuts',
    group: 'Application',
    glyph: '?',
    keywords: ['keys', 'help'],
    effect: { kind: 'show-shortcuts' },
  },
  {
    id: 'window:new',
    label: 'New window',
    group: 'Application',
    glyph: '＋',
    keywords: ['desktop', 'open'],
    effect: { kind: 'new-window' },
  },
  {
    id: 'traps:receive',
    label: 'Open Trap receiver',
    group: 'Traps',
    glyph: '⚑',
    keywords: ['trap', 'receive', 'listen'],
    effect: { kind: 'open-traps', mode: 'receive' },
  },
  {
    id: 'traps:send',
    label: 'Prepare Trap notification',
    group: 'Traps',
    glyph: '↗',
    keywords: ['trap', 'send', 'notification'],
    effect: { kind: 'open-traps', mode: 'send' },
  },
];

export function getPaletteCommands(
  tabs: readonly NavigationTab[],
  canOpenWindow: boolean,
): PaletteCommand[] {
  const navigation = tabs.map((tab): PaletteCommand => ({
    id: `navigate:${tab.key}` as PaletteCommandId,
    label: `Go to ${tab.label}`,
    group: 'Navigation',
    glyph: tab.glyph,
    keywords: ['navigate', 'tab', 'screen', tab.label.toLowerCase()],
    effect: { kind: 'navigate', tab: tab.key },
  }));
  return navigation.concat(
    STATIC_COMMANDS.filter(({ id }) => canOpenWindow || id !== 'window:new'),
  );
}

export function filterPaletteCommands(
  commands: readonly AppAction[],
  query: string,
): AppAction[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...commands];
  return commands
    .map((command, index) => {
      const label = command.label.toLowerCase();
      const keywords = command.keywords.map((keyword) => keyword.toLowerCase());
      const score = label.startsWith(normalized)
        ? 0
        : label.includes(normalized)
          ? 1
          : keywords.some((keyword) => keyword.startsWith(normalized))
            ? 2
            : keywords.some((keyword) => keyword.includes(normalized))
              ? 3
              : null;
      return { command, index, score };
    })
    .filter(
      (entry): entry is { command: AppAction; index: number; score: number } =>
        entry.score !== null,
    )
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ command }) => command);
}

export function parsePaletteQuery(input: string): {
  mode: 'commands' | 'oids';
  query: string;
} {
  const trimmed = input.trim();
  return trimmed.startsWith('@')
    ? { mode: 'oids', query: trimmed.slice(1).trim() }
    : { mode: 'commands', query: trimmed };
}

export function buildPaletteEntries(
  commands: readonly AppAction[],
  recents: readonly PaletteRecentItem[],
  input: string,
): PaletteEntry[] {
  const parsed = parsePaletteQuery(input);
  const byId = new Map(commands.map((command) => [command.id, command]));
  if (parsed.mode === 'oids') {
    if (parsed.query) return [];
    return recents
      .filter((item): item is Extract<PaletteRecentItem, { kind: 'oid' }> => item.kind === 'oid')
      .map((item) => ({
        key: `oid:${item.oid}` as const,
        kind: 'oid' as const,
        section: 'Recents' as const,
        item,
        recent: true as const,
      }));
  }
  if (parsed.query) {
    return filterPaletteCommands(commands, parsed.query).map((command) => ({
      key: `command:${command.id}` as const,
      kind: 'command' as const,
      section: command.group,
      command,
      recent: false as const,
    }));
  }

  const recentEntries: PaletteEntry[] = [];
  const recentCommandIds = new Set<string>();
  for (const item of recents) {
    if (item.kind === 'command') {
      const command = byId.get(item.commandId);
      if (!command) continue;
      recentCommandIds.add(command.id);
      recentEntries.push({
        key: `command:${command.id}`,
        kind: 'command',
        section: 'Recents',
        command,
        recent: true,
      });
    } else {
      recentEntries.push({
        key: `oid:${item.oid}`,
        kind: 'oid',
        section: 'Recents',
        item,
        recent: true,
      });
    }
  }
  return recentEntries.concat(
    commands
      .filter(({ id }) => !recentCommandIds.has(id))
      .map((command) => ({
        key: `command:${command.id}` as const,
        kind: 'command' as const,
        section: command.group,
        command,
        recent: false as const,
      })),
  );
}

function normalizeRecent(item: PaletteRecentItem): PaletteRecentItem {
  return item.kind === 'oid' ? { ...item, oid: item.oid.trim().replace(/^\./, '') } : item;
}

function recentKey(item: PaletteRecentItem): string {
  return item.kind === 'command' ? `command:${item.commandId}` : `oid:${item.oid}`;
}

export function recordPaletteRecent(
  items: readonly PaletteRecentItem[],
  item: PaletteRecentItem,
): PaletteRecentItem[] {
  const normalized = normalizeRecent(item);
  const key = recentKey(normalized);
  return [
    normalized,
    ...items.map(normalizeRecent).filter((entry) => recentKey(entry) !== key),
  ].slice(0, PALETTE_HISTORY_LIMIT);
}

export async function validatePaletteRecentOids(
  items: readonly PaletteRecentItem[],
  exists: (oid: string) => Promise<boolean>,
): Promise<Array<Extract<PaletteRecentItem, { kind: 'oid' }>>> {
  const stale: Array<Extract<PaletteRecentItem, { kind: 'oid' }>> = [];
  for (const item of items) {
    if (item.kind !== 'oid') continue;
    try {
      if (!(await exists(item.oid))) stale.push(item);
    } catch {
      // Engine availability is transient; only a successful negative lookup is stale.
    }
  }
  return stale;
}

function isPaletteCommandId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 160 &&
    /^[A-Za-z][A-Za-z0-9._-]{0,63}(?::[A-Za-z0-9][A-Za-z0-9._-]{0,63})+$/.test(value)
  );
}

function parseRecentItem(value: unknown): PaletteRecentItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (item.kind === 'command' && isPaletteCommandId(item.commandId)) {
    return { kind: 'command', commandId: item.commandId };
  }
  if (
    item.kind === 'oid' &&
    typeof item.oid === 'string' &&
    /^\.?\d+(?:\.\d+)+$/.test(item.oid.trim()) &&
    typeof item.name === 'string' &&
    item.name.trim()
  ) {
    return {
      kind: 'oid',
      oid: item.oid.trim().replace(/^\./, ''),
      name: item.name.slice(0, 200),
      ...(typeof item.module === 'string' ? { module: item.module.slice(0, 200) } : {}),
      ...(typeof item.nodeKind === 'string' ? { nodeKind: item.nodeKind.slice(0, 80) } : {}),
    };
  }
  return null;
}

export function parsePaletteHistory(value: string | null): PaletteRecentItem[] {
  if (!value) return [];
  if (value.length > 100_000) return [];
  try {
    const parsed = JSON.parse(value) as { version?: unknown; items?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) return [];
    const items: PaletteRecentItem[] = [];
    for (const candidate of parsed.items.slice(0, 100)) {
      const item = parseRecentItem(candidate);
      if (item) {
        const key = recentKey(item);
        if (!items.some((entry) => recentKey(entry) === key)) items.push(item);
      }
      if (items.length === PALETTE_HISTORY_LIMIT) break;
    }
    return items;
  } catch {
    return [];
  }
}

function serializePaletteHistory(items: readonly PaletteRecentItem[]): string {
  return JSON.stringify({ version: 1, items: items.slice(0, PALETTE_HISTORY_LIMIT) });
}

function mergePaletteHistory(
  optimistic: readonly PaletteRecentItem[],
  persisted: readonly PaletteRecentItem[],
): PaletteRecentItem[] {
  const merged: PaletteRecentItem[] = [];
  for (const item of [...optimistic, ...persisted]) {
    const normalized = normalizeRecent(item);
    const key = recentKey(normalized);
    if (!merged.some((entry) => recentKey(entry) === key)) merged.push(normalized);
    if (merged.length === PALETTE_HISTORY_LIMIT) break;
  }
  return merged;
}

export class PaletteHistoryController {
  private items: PaletteRecentItem[] = [];
  private listeners = new Set<(items: readonly PaletteRecentItem[]) => void>();
  private loadPromise: Promise<readonly PaletteRecentItem[]> | null = null;
  private hydrated = false;
  private dirtyBeforeHydration = false;
  private clearedBeforeHydration = false;
  private writeChain = Promise.resolve();

  constructor(private readonly storage?: PaletteHistoryStorage) {}

  snapshot(): readonly PaletteRecentItem[] {
    return this.items;
  }

  subscribe(listener: (items: readonly PaletteRecentItem[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  load(): Promise<readonly PaletteRecentItem[]> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      let persisted: PaletteRecentItem[] = [];
      try {
        persisted = parsePaletteHistory((await this.storage?.getItem(PALETTE_HISTORY_KEY)) ?? null);
      } catch {
        // Persistence is best-effort; optimistic session history remains usable.
      }
      this.items = this.clearedBeforeHydration ? [] : mergePaletteHistory(this.items, persisted);
      this.hydrated = true;
      this.emit();
      if (this.dirtyBeforeHydration) this.scheduleWrite(this.clearedBeforeHydration);
      return this.items;
    })();
    return this.loadPromise;
  }

  record(item: PaletteRecentItem): void {
    this.items = recordPaletteRecent(this.items, item);
    this.emit();
    this.markDirty(false);
  }

  remove(item: PaletteRecentItem): void {
    const key = recentKey(normalizeRecent(item));
    this.items = this.items.filter((entry) => recentKey(entry) !== key);
    this.emit();
    this.markDirty(false);
  }

  clear(): void {
    this.items = [];
    this.emit();
    this.markDirty(true);
  }

  async flush(): Promise<void> {
    await this.load();
    await this.writeChain;
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.items);
  }

  private markDirty(clear: boolean): void {
    if (!this.hydrated) {
      this.dirtyBeforeHydration = true;
      this.clearedBeforeHydration ||= clear;
      void this.load();
      return;
    }
    this.scheduleWrite(clear);
  }

  private scheduleWrite(clear: boolean): void {
    const snapshot = [...this.items];
    this.writeChain = this.writeChain
      .then(async () => {
        try {
          if (clear && this.storage?.removeItem) await this.storage.removeItem(PALETTE_HISTORY_KEY);
          else await this.storage?.setItem(PALETTE_HISTORY_KEY, serializePaletteHistory(snapshot));
        } catch {
          // Quota and host storage failures never block in-memory command history.
        }
      })
      .catch(() => undefined);
  }
}

export function createBrowserPaletteHistoryStorage(): PaletteHistoryStorage | undefined {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!storage) return undefined;
    return {
      getItem: async (key) => storage.getItem(key),
      setItem: async (key, value) => storage.setItem(key, value),
      removeItem: async (key) => storage.removeItem(key),
    };
  } catch {
    return undefined;
  }
}
