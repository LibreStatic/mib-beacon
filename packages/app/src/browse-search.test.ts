import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineAPI, MibNodeDetail, MibSearchHit } from '@omc/core/client';
import {
  MibObjectNotFoundError,
  getOidAncestorPrefixes,
  openGlobalCatalogObject,
  openSearchHit,
  revealOid,
  runSearch,
} from './actions';
import { useAppStore } from './store';

const detail = {
  oid: '1.3.6.1.2.1.1.1',
  name: 'sysDescr',
  kind: 'scalar',
  hasChildren: false,
  childCount: 0,
} as MibNodeDetail;

const hit = {
  oid: detail.oid,
  name: detail.name,
  kind: detail.kind,
  matched: 'name',
} as MibSearchHit;

beforeEach(() => {
  useAppStore.setState({
    expanded: {},
    childrenCache: {},
    moduleFocus: null,
    selected: null,
    search: 'sysdescr',
    hits: [],
    searchPhase: 'idle',
    searchError: null,
  } as never);
});

describe('Browse search state', () => {
  it('shows a searching phase and stores case-insensitive backend results', async () => {
    const search = vi.fn().mockResolvedValue([hit]);
    const engine = { mibs: { search } } as unknown as EngineAPI;

    const promise = runSearch(engine, 'sysdescr');
    expect(useAppStore.getState().searchPhase).toBe('searching');
    await promise;

    expect(search).toHaveBeenCalledWith('sysdescr', 40);
    expect(useAppStore.getState().hits).toEqual([hit]);
    expect(useAppStore.getState().searchPhase).toBe('idle');
  });

  it('keeps the query and results when opening a hit fails', async () => {
    useAppStore.setState({ hits: [hit] });
    const engine = {
      mibs: { node: vi.fn().mockRejectedValue(new Error('engine unavailable')) },
    } as unknown as EngineAPI;

    await openSearchHit(engine, hit.oid);

    expect(useAppStore.getState().search).toBe('sysdescr');
    expect(useAppStore.getState().hits).toEqual([hit]);
    expect(useAppStore.getState().searchPhase).toBe('error');
    expect(useAppStore.getState().searchError).toContain('engine unavailable');
  });

  it('selects the object before clearing a successful search', async () => {
    useAppStore.setState({ hits: [hit] });
    const engine = {
      mibs: {
        node: vi.fn().mockResolvedValue(detail),
        tree: vi.fn().mockResolvedValue([]),
      },
    } as unknown as EngineAPI;

    await openSearchHit(engine, hit.oid);

    expect(useAppStore.getState().selected).toEqual(detail);
    expect(useAppStore.getState().search).toBe('');
    expect(useAppStore.getState().hits).toEqual([]);
    expect(useAppStore.getState().searchPhase).toBe('idle');
  });
});

describe('OID reveal', () => {
  it('resolves globally before clearing module focus and reveals the selected object', async () => {
    useAppStore.setState({
      moduleFocus: { module: { name: 'OLD-MIB' } },
      selected: null,
      search: 'old query',
      hits: [hit],
      childrenCache: { stale: [] },
    } as never);
    const node = vi.fn().mockResolvedValue(detail);
    const tree = vi.fn().mockResolvedValue([]);
    const engine = { mibs: { node, tree } } as unknown as EngineAPI;

    await openGlobalCatalogObject(engine, detail.oid);

    expect(node).toHaveBeenCalledWith(detail.oid);
    expect(useAppStore.getState()).toMatchObject({
      moduleFocus: null,
      selected: detail,
      search: '',
      hits: [],
      searchPhase: 'idle',
      searchError: null,
    });
    expect(tree).toHaveBeenCalledWith(undefined);
    expect(tree).toHaveBeenCalledWith('1.3.6.1.2.1.1');
  });

  it('does not mutate browse state when the global object no longer exists', async () => {
    const focus = { module: { name: 'OLD-MIB' } };
    useAppStore.setState({ moduleFocus: focus, search: 'keep me', hits: [hit] } as never);
    const engine = {
      mibs: { node: vi.fn().mockResolvedValue(null), tree: vi.fn() },
    } as unknown as EngineAPI;

    await expect(openGlobalCatalogObject(engine, detail.oid)).rejects.toBeInstanceOf(
      MibObjectNotFoundError,
    );
    expect(useAppStore.getState().moduleFocus).toBe(focus);
    expect(useAppStore.getState().search).toBe('keep me');
    expect(useAppStore.getState().hits).toEqual([hit]);
  });

  it('does not mutate browse state when the global tree cannot be loaded', async () => {
    const focus = { module: { name: 'OLD-MIB' } };
    const cache = { stale: [] };
    useAppStore.setState({
      moduleFocus: focus,
      selected: null,
      search: 'keep me',
      hits: [hit],
      childrenCache: cache,
      expanded: {},
    } as never);
    const engine = {
      mibs: {
        node: vi.fn().mockResolvedValue(detail),
        tree: vi.fn().mockRejectedValue(new Error('engine restarting')),
      },
    } as unknown as EngineAPI;

    await expect(openGlobalCatalogObject(engine, detail.oid)).rejects.toThrow('engine restarting');
    expect(useAppStore.getState()).toMatchObject({
      moduleFocus: focus,
      selected: null,
      search: 'keep me',
      hits: [hit],
      childrenCache: cache,
      expanded: {},
    });
  });

  it('generates every parent prefix without including the selected node', () => {
    expect(getOidAncestorPrefixes('1.3.6.1.2.1.1.1')).toEqual([
      '1',
      '1.3',
      '1.3.6',
      '1.3.6.1',
      '1.3.6.1.2',
      '1.3.6.1.2.1',
      '1.3.6.1.2.1.1',
    ]);
  });

  it('starts loading every ancestor without waiting for the previous IPC call', async () => {
    const resolvers: Array<() => void> = [];
    const tree = vi
      .fn()
      .mockImplementation(
        () => new Promise<unknown[]>((resolve) => resolvers.push(() => resolve([]))),
      );
    const engine = { mibs: { tree } } as unknown as EngineAPI;

    const promise = revealOid(engine, '1.3.6.1');
    await Promise.resolve();
    expect(tree).toHaveBeenCalledTimes(3);
    resolvers.forEach((resolve) => resolve());
    await promise;
  });
});
