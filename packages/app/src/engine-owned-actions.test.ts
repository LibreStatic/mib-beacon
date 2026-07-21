import { describe, expect, it, vi } from 'vitest';
import type { EngineAPI } from '@omc/core/client';
import {
  clearResolverCache,
  loadChildren,
  refreshAgentGroups,
  refreshAgentProfiles,
  refreshModules,
  selectModuleInPlace,
} from './actions';
import { useAppStore } from './store';

describe('engine-owned action writes', () => {
  it('suppresses an old-engine module completion and accepts the current one', async () => {
    let resolveOld!: (value: never[]) => void;
    const oldEngine = {
      mibs: { list: () => new Promise((resolve) => (resolveOld = resolve)) },
    } as unknown as EngineAPI;
    const currentEngine = {
      mibs: { list: vi.fn().mockResolvedValue([{ name: 'CURRENT' }]) },
    } as unknown as EngineAPI;
    const setModules = vi.spyOn(useAppStore.getState(), 'setModules');
    let oldOwns = true;
    const oldRefresh = refreshModules(oldEngine, () => oldOwns);
    oldOwns = false;
    await refreshModules(currentEngine, () => true);
    resolveOld([]);
    await oldRefresh;
    expect(setModules).toHaveBeenCalledOnce();
    expect(setModules).toHaveBeenCalledWith([{ name: 'CURRENT' }]);
    setModules.mockRestore();
  });

  it('checks ownership after an asynchronous tree read before writing', async () => {
    useAppStore.getState().clearChildrenCache();
    let resolveTree!: (value: never[]) => void;
    const engine = {
      mibs: { tree: () => new Promise((resolve) => (resolveTree = resolve)) },
    } as unknown as EngineAPI;
    const setChildren = vi.spyOn(useAppStore.getState(), 'setChildren');
    let owns = true;
    const loading = loadChildren(engine, '', () => owns);
    owns = false;
    resolveTree([]);
    await loading;
    expect(setChildren).not.toHaveBeenCalled();
    setChildren.mockRestore();
  });

  it('suppresses stale profile and group completions after ownership changes', async () => {
    const resolveProfiles: Array<(value: never[]) => void> = [];
    const resolveGroups: Array<(value: never[]) => void> = [];
    const engine = {
      agents: {
        list: () => new Promise((resolve) => resolveProfiles.push(resolve)),
        groups: { list: () => new Promise((resolve) => resolveGroups.push(resolve)) },
      },
    } as unknown as EngineAPI;
    const setProfiles = vi.spyOn(useAppStore.getState(), 'setAgentProfiles');
    const setGroups = vi.spyOn(useAppStore.getState(), 'setAgentGroups');
    let owns = true;
    const profiles = refreshAgentProfiles(engine, () => owns);
    const groups = refreshAgentGroups(engine, () => owns);
    owns = false;
    resolveProfiles.forEach((resolve) => resolve([]));
    resolveGroups.forEach((resolve) => resolve([]));
    await Promise.all([profiles, groups]);
    expect(setProfiles).not.toHaveBeenCalled();
    expect(setGroups).not.toHaveBeenCalled();
    setProfiles.mockRestore();
    setGroups.mockRestore();
  });

  it('does not apply stale module focus or root loading after engine replacement', async () => {
    let resolveModule!: (value: unknown) => void;
    const moduleTree = vi.fn();
    const engine = {
      mibs: {
        module: () => new Promise((resolve) => (resolveModule = resolve)),
        moduleTree,
      },
    } as unknown as EngineAPI;
    const setModuleFocus = vi.spyOn(useAppStore.getState(), 'setModuleFocus');
    let owns = true;
    const selecting = selectModuleInPlace(engine, 'OLD-MIB', () => owns);
    owns = false;
    resolveModule({ module: { name: 'OLD-MIB' }, dependencies: [] });
    await selecting;
    expect(setModuleFocus).not.toHaveBeenCalled();
    expect(moduleTree).not.toHaveBeenCalled();
    setModuleFocus.mockRestore();
  });

  it('does not recreate resolver authority for an old engine after cache clear settles', async () => {
    let resolveClear!: () => void;
    const list = vi.fn();
    const engine = {
      resolver: {
        cache: { clear: () => new Promise<void>((resolve) => (resolveClear = resolve)) },
        sources: { list },
      },
    } as unknown as EngineAPI;
    let owns = true;
    const clearing = clearResolverCache(engine, () => owns);
    await Promise.resolve();
    owns = false;
    resolveClear();
    await expect(clearing).rejects.toThrow(/ownership/i);
    expect(list).not.toHaveBeenCalled();
  });
});
