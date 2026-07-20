import { describe, expect, it } from 'vitest';
import type { NavigationTab } from './navigation';
import {
  PaletteHistoryController,
  PALETTE_HISTORY_KEY,
  applyPaletteCommandEffect,
  buildPaletteEntries,
  filterPaletteCommands,
  getPaletteCommands,
  parsePaletteHistory,
  parsePaletteQuery,
  recordPaletteRecent,
  validatePaletteRecentOids,
  type PaletteHistoryStorage,
  type PaletteRecentItem,
} from './command-palette';

const tabs: NavigationTab[] = [
  { key: 'browse', glyph: '⌬', label: 'Browse' },
  { key: 'query', glyph: '⇄', label: 'Query' },
  { key: 'agents', glyph: '◎', label: 'Agents' },
  { key: 'traps', glyph: '⚑', label: 'Traps' },
  { key: 'tools', glyph: '⌁', label: 'Tools' },
  { key: 'settings', glyph: '⚙', label: 'Settings' },
];

describe('command palette inventory and filtering', () => {
  it('builds responsive navigation, safe preparation commands, and host capabilities', () => {
    const commands = getPaletteCommands(tabs, true);
    expect(commands.map(({ id }) => id)).toEqual([
      'navigate:browse',
      'navigate:query',
      'navigate:agents',
      'navigate:traps',
      'navigate:tools',
      'navigate:settings',
      'browse:focus-search',
      'browse:import',
      'preferences:color-theme',
      'preferences:browse-color-themes',
      'preferences:import-color-theme',
      'agents:create-profile',
      'app:shortcuts',
      'window:new',
      'query:prepare-get',
      'query:prepare-get-next',
      'query:prepare-get-bulk',
      'query:prepare-walk',
      'query:prepare-set',
      'traps:receive',
      'traps:send',
    ]);
    expect(commands.find(({ id }) => id === 'query:prepare-walk')?.effect).toEqual({
      kind: 'prepare-query',
      operation: 'walk',
    });
    expect(getPaletteCommands(tabs, false).some(({ id }) => id === 'window:new')).toBe(false);
  });

  it('ranks label prefixes before keyword and substring matches', () => {
    const commands = getPaletteCommands(tabs, false);
    expect(
      filterPaletteCommands(commands, 'trap')
        .map(({ id }) => id)
        .slice(0, 3),
    ).toEqual(['navigate:traps', 'traps:receive', 'traps:send']);
    expect(filterPaletteCommands(commands, 'bulk')[0]?.id).toBe('query:prepare-get-bulk');
  });

  it('uses @ as the explicit OID mode', () => {
    expect(parsePaletteQuery(' walk ')).toEqual({ mode: 'commands', query: 'walk' });
    expect(parsePaletteQuery('@')).toEqual({ mode: 'oids', query: '' });
    expect(parsePaletteQuery(' @ sysDescr ')).toEqual({ mode: 'oids', query: 'sysDescr' });
    expect(parsePaletteQuery('@1.3.6.1')).toEqual({ mode: 'oids', query: '1.3.6.1' });
  });

  it('shows mixed recents without duplicating commands and bare @ shows only recent OIDs', () => {
    const commands = getPaletteCommands(tabs, false);
    const recents: PaletteRecentItem[] = [
      { kind: 'command', commandId: 'navigate:browse' },
      { kind: 'command', commandId: 'window:new' },
      { kind: 'oid', oid: '1.3.6.1.2.1.1.1', name: 'sysDescr', module: 'SNMPv2-MIB' },
    ];
    const empty = buildPaletteEntries(commands, recents, '');
    expect(empty.filter(({ section }) => section === 'Recents').map(({ key }) => key)).toEqual([
      'command:navigate:browse',
      'oid:1.3.6.1.2.1.1.1',
    ]);
    expect(empty.filter(({ key }) => key === 'command:navigate:browse')).toHaveLength(1);
    expect(buildPaletteEntries(commands, recents, '@').map(({ key }) => key)).toEqual([
      'oid:1.3.6.1.2.1.1.1',
    ]);
  });

  it('prepares query and trap state without exposing a network executor', () => {
    const calls: string[] = [];
    const context = {
      navigate: (tab: string) => calls.push(`navigate:${tab}`),
      focusBrowseSearch: () => calls.push('focus-search'),
      importMib: () => calls.push('import'),
      openThemePicker: () => calls.push('theme-picker'),
      openThemeCatalog: () => calls.push('theme-catalog'),
      importTheme: () => calls.push('import-theme'),
      createAgentProfile: () => calls.push('create-agent-profile'),
      showShortcuts: () => calls.push('shortcuts'),
      newWindow: () => calls.push('new-window'),
      prepareQuery: (operation: string) => calls.push(`prepare:${operation}`),
      openTraps: (mode: string) => calls.push(`traps:${mode}`),
    };
    applyPaletteCommandEffect({ kind: 'prepare-query', operation: 'walk' }, context);
    applyPaletteCommandEffect({ kind: 'open-traps', mode: 'send' }, context);
    applyPaletteCommandEffect({ kind: 'open-theme-picker' }, context);
    applyPaletteCommandEffect({ kind: 'open-theme-catalog' }, context);
    applyPaletteCommandEffect({ kind: 'import-theme' }, context);
    applyPaletteCommandEffect({ kind: 'create-agent-profile' }, context);
    expect(calls).toEqual([
      'prepare:walk',
      'navigate:query',
      'traps:send',
      'navigate:traps',
      'theme-picker',
      'theme-catalog',
      'import-theme',
      'navigate:liveMibs',
      'create-agent-profile',
    ]);
    expect(Object.keys(context)).not.toContain('runQuery');
    expect(Object.keys(context)).not.toContain('sendTrap');
  });
});

describe('command palette recents', () => {
  const command = (commandId: 'navigate:browse' | 'query:prepare-walk'): PaletteRecentItem => ({
    kind: 'command',
    commandId,
  });
  const oid = (value: string, name = `oid-${value}`): PaletteRecentItem => ({
    kind: 'oid',
    oid: value,
    name,
    module: 'SNMPv2-MIB',
    nodeKind: 'scalar',
  });

  it('deduplicates by command ID or normalized OID and caps history at ten', () => {
    let items: PaletteRecentItem[] = [];
    items = recordPaletteRecent(items, command('navigate:browse'));
    items = recordPaletteRecent(items, oid('.1.3.6.1', 'first'));
    items = recordPaletteRecent(items, command('navigate:browse'));
    items = recordPaletteRecent(items, oid('1.3.6.1', 'updated'));
    for (let index = 2; index <= 12; index += 1)
      items = recordPaletteRecent(items, oid(`1.3.6.${index}`));

    expect(items).toHaveLength(10);
    expect(items[0]).toMatchObject({ kind: 'oid', oid: '1.3.6.12' });
    expect(items.filter((item) => item.kind === 'oid' && item.oid === '1.3.6.1')).toHaveLength(0);
  });

  it('defensively parses versioned history and drops malformed or obsolete entries', () => {
    const parsed = parsePaletteHistory(
      JSON.stringify({
        version: 1,
        items: [
          command('navigate:browse'),
          { kind: 'command', commandId: 'removed:command' },
          oid('1.3.6.1'),
          { kind: 'oid', oid: 'not-an-oid', name: 'broken' },
        ],
      }),
    );
    expect(parsed).toEqual([command('navigate:browse'), oid('1.3.6.1')]);
    expect(parsePaletteHistory('{broken')).toEqual([]);
    expect(parsePaletteHistory(JSON.stringify({ version: 2, items: [] }))).toEqual([]);
    expect(parsePaletteHistory('x'.repeat(100_001))).toEqual([]);
  });

  it('merges selections made before hydration and persists optimistic state', async () => {
    let resolveRead: (value: string | null) => void = () => undefined;
    const writes: string[] = [];
    const storage: PaletteHistoryStorage = {
      getItem: () => new Promise((resolve) => (resolveRead = resolve)),
      setItem: async (_key, value) => void writes.push(value),
      removeItem: async () => undefined,
    };
    const controller = new PaletteHistoryController(storage);
    const loading = controller.load();
    controller.record(command('query:prepare-walk'));
    resolveRead(
      JSON.stringify({ version: 1, items: [command('navigate:browse'), oid('1.3.6.1')] }),
    );
    await loading;
    await controller.flush();

    expect(controller.snapshot()).toEqual([
      command('query:prepare-walk'),
      command('navigate:browse'),
      oid('1.3.6.1'),
    ]);
    expect(JSON.parse(writes.at(-1) ?? '{}').items).toEqual(controller.snapshot());
  });

  it('clears persisted recents without blocking in-memory behavior on storage failure', async () => {
    const removed: string[] = [];
    const storage: PaletteHistoryStorage = {
      getItem: async () => {
        throw new Error('storage unavailable');
      },
      setItem: async () => {
        throw new Error('quota');
      },
      removeItem: async (key) => void removed.push(key),
    };
    const controller = new PaletteHistoryController(storage);
    controller.record(command('navigate:browse'));
    await controller.load();
    expect(controller.snapshot()).toEqual([command('navigate:browse')]);
    controller.clear();
    await controller.flush();
    expect(controller.snapshot()).toEqual([]);
    expect(removed).toEqual([PALETTE_HISTORY_KEY]);
  });

  it('identifies stale recent OIDs but retains entries after temporary lookup failures', async () => {
    const items = [
      oid('1.3.6.1', 'available'),
      oid('1.3.6.2', 'removed'),
      oid('1.3.6.3', 'temporarily unavailable'),
      command('navigate:browse'),
    ];
    const stale = await validatePaletteRecentOids(items, async (value) => {
      if (value === '1.3.6.1') return true;
      if (value === '1.3.6.2') return false;
      throw new Error('engine restarting');
    });

    expect(stale).toEqual([oid('1.3.6.2', 'removed')]);
  });
});
