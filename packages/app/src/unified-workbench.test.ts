import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineAPI, MibNodeDetail } from '@omc/core/client';
import {
  BROWSE_TITLE,
  getCompactBottomNavigationItems,
  getCompactOverflowTabs,
  getNavigationTabs,
  isCompactOverflowTab,
} from './navigation';
import {
  getNodeOperationPlan,
  openLiveMibScope,
  openTableView,
  prepareNodeOperation,
  selectModuleInPlace,
  unloadModule,
} from './actions';
import { useAppStore } from './store';

const scalar = {
  oid: '1.3.6.1.2.1.1.5',
  name: 'sysName',
  kind: 'scalar',
  access: 'read-write',
  syntax: 'DisplayString',
  hasChildren: false,
  childCount: 0,
} as MibNodeDetail;

const column = {
  oid: '1.3.6.1.2.1.2.2.1.2',
  name: 'ifDescr',
  kind: 'column',
  access: 'read-only',
  syntax: 'DisplayString',
  hasChildren: false,
  childCount: 0,
} as MibNodeDetail;

beforeEach(() => {
  useAppStore.setState({
    tab: 'browse',
    moduleFocus: null,
    selected: null,
    search: '',
    hits: [],
    childrenCache: {},
    expanded: {},
    browserConsoleOpen: false,
    queryOperation: 'get',
    oid: '1.3.6.1.2.1',
    oidName: null,
    queryError: null,
    running: null,
  } as never);
});

describe('responsive application navigation', () => {
  it('keeps every phone workspace discoverable while preserving five bottom items', () => {
    expect(getNavigationTabs('compact').map((item) => item.key)).toEqual([
      'browse',
      'liveMibs',
      'query',
      'agents',
      'traps',
      'tools',
      'settings',
    ]);
    expect(getCompactBottomNavigationItems().map((item) => item.key)).toEqual([
      'browse',
      'query',
      'traps',
      'tools',
      'more',
    ]);
    expect(getCompactOverflowTabs().map((item) => item.key)).toEqual([
      'liveMibs',
      'agents',
      'settings',
    ]);
    expect(getNavigationTabs('compact').find((item) => item.key === 'query')?.label).toBe(
      'Results',
    );
  });

  it('marks More selected for every compact overflow workspace', () => {
    expect(isCompactOverflowTab('liveMibs')).toBe(true);
    expect(isCompactOverflowTab('agents')).toBe(true);
    expect(isCompactOverflowTab('settings')).toBe(true);
    expect(isCompactOverflowTab('tools')).toBe(false);
  });

  it('adds Live MIBs as a dedicated larger-layout workspace', () => {
    const tabs = getNavigationTabs('medium');
    expect(tabs.map((item) => item.key)).toEqual([
      'browse',
      'liveMibs',
      'query',
      'agents',
      'traps',
      'tools',
      'settings',
    ]);
    expect(tabs[0]?.label).toBe('Browse');
    expect(getNavigationTabs('expanded')).toEqual(tabs);
  });

  it('uses the concise Browse workspace title', () => {
    expect(BROWSE_TITLE).toBe('Browse');
  });
});

describe('selection-driven operation targets', () => {
  it('opens a selected object in the dedicated Live MIBs workspace', () => {
    openLiveMibScope(scalar.oid);
    expect(useAppStore.getState()).toMatchObject({
      tab: 'liveMibs',
      liveMibScopeOid: scalar.oid,
    });
  });

  it('routes legacy table opens into Live MIBs', async () => {
    const table = { ...scalar, kind: 'table', name: 'ifTable' } as MibNodeDetail;
    const entry = {
      ...scalar,
      kind: 'entry',
      name: 'ifEntry',
      oid: `${table.oid}.1`,
    } as MibNodeDetail;
    const engine = {
      mibs: {
        tree: vi
          .fn()
          .mockResolvedValue([
            { oid: entry.oid, name: entry.name, kind: 'entry', hasChildren: true, childCount: 1 },
          ]),
        node: vi.fn().mockResolvedValue(entry),
      },
    } as unknown as EngineAPI;
    await openTableView(engine, table);
    expect(useAppStore.getState()).toMatchObject({
      tab: 'liveMibs',
      liveMibScopeOid: entry.oid,
    });
  });

  it('normalizes scalar instances without requiring user input', () => {
    expect(getNodeOperationPlan(scalar, 'get')).toMatchObject({
      allowed: true,
      oid: `${scalar.oid}.0`,
      requiresInstance: false,
    });
  });

  it('requires an instance suffix before operating on a column', () => {
    expect(getNodeOperationPlan(column, 'get')).toMatchObject({
      allowed: false,
      oid: `${column.oid}.`,
      requiresInstance: true,
    });
    expect(getNodeOperationPlan(column, 'get', '7')).toMatchObject({
      allowed: true,
      oid: `${column.oid}.7`,
      requiresInstance: false,
    });
  });

  it('does not offer Set for read-only objects', () => {
    expect(getNodeOperationPlan(column, 'set', '7')).toMatchObject({
      allowed: false,
      reason: 'This object is not writable.',
    });
  });

  it('prepares an operation in place without changing tabs or sending traffic', async () => {
    const get = vi.fn();
    const engine = { ops: { get } } as unknown as EngineAPI;

    await prepareNodeOperation(engine, scalar, 'get', { execute: false });

    expect(useAppStore.getState()).toMatchObject({
      tab: 'browse',
      browserConsoleOpen: true,
      queryOperation: 'get',
      oid: `${scalar.oid}.0`,
      oidName: scalar.name,
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('does not retarget an operation while a walk is running', async () => {
    useAppStore.setState({ running: 'walk-1', oid: '1.3.6.1.2.1.2' });
    const engine = { ops: { get: vi.fn() } } as unknown as EngineAPI;

    await prepareNodeOperation(engine, scalar, 'get');

    expect(useAppStore.getState().oid).toBe('1.3.6.1.2.1.2');
    expect(useAppStore.getState().browserConsoleOpen).toBe(true);
    expect(useAppStore.getState().queryError).toContain('Stop the running walk');
  });
});

describe('in-place module focus', () => {
  it('loads a module tree without navigating away from the current workspace', async () => {
    useAppStore.setState({ tab: 'settings' });
    const module = { name: 'IF-MIB', objectCount: 12, isBase: false };
    const engine = {
      mibs: {
        module: vi.fn().mockResolvedValue({ module, dependencies: [], roots: [] }),
        moduleTree: vi.fn().mockResolvedValue([]),
      },
    } as unknown as EngineAPI;

    await selectModuleInPlace(engine, module.name);

    expect(useAppStore.getState().tab).toBe('settings');
    expect(useAppStore.getState().moduleFocus?.module.name).toBe(module.name);
  });

  it('clears an object selection when its focused module is unloaded', async () => {
    useAppStore.setState({
      moduleFocus: {
        module: { name: 'IF-MIB', objectCount: 12, isBase: false },
        dependencies: [],
        roots: [],
      },
      selected: column,
    } as never);
    const engine = {
      mibs: {
        unload: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        tree: vi.fn().mockResolvedValue([]),
      },
    } as unknown as EngineAPI;

    await unloadModule(engine, 'IF-MIB');

    expect(useAppStore.getState().moduleFocus).toBeNull();
    expect(useAppStore.getState().selected).toBeNull();
  });
});
