import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { EngineAPI } from '@omc/core/client';
import {
  clearResolverCache,
  disposeResolverCacheClearController,
  disposeResolverSourceController,
  refreshResolverState,
  resolverCacheClearController,
  resolverSourceController,
} from './actions';
import { useAppStore } from './store';

describe('refreshResolverState', () => {
  it('reactivates the same controller retained by Settings across Strict Mode cleanup replay', async () => {
    const engine = {
      resolver: { sources: { list: vi.fn().mockResolvedValue([]) } },
    } as unknown as EngineAPI;
    const retained = resolverSourceController(engine, () => true, false);
    disposeResolverSourceController(engine);
    const replay = resolverSourceController(engine, () => true, false);
    expect(replay).toBe(retained);
    await retained.load();
    expect(retained.snapshot().readiness.phase).toBe('ready');
  });

  it('makes child-before-parent Strict replay activation independent of a coalesced refresh failure', async () => {
    const source = readFileSync(new URL('./screens/SettingsScreen.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*sourceCollectionController\.activate\(\);\s*void sourceCollectionController\.load\(\)/,
    );

    const engine = {
      resolver: {
        sources: { list: vi.fn().mockRejectedValue(new Error('coalesced replay failed')) },
      },
    } as unknown as EngineAPI;
    const retained = resolverSourceController(engine, () => true, false);
    disposeResolverSourceController(engine);
    retained.activate();
    await expect(retained.load()).rejects.toThrow('coalesced replay failed');
    expect(retained.snapshot().readiness).toMatchObject({ phase: 'error' });
  });
  it('coalesces concurrent refreshes for the same renderer engine', async () => {
    const engine = {
      resolver: {
        settings: { get: vi.fn().mockResolvedValue({ enabled: true }) },
        sources: { list: vi.fn().mockResolvedValue([]) },
        cache: { stats: vi.fn().mockResolvedValue({ entries: 0, bytes: 0 }) },
        history: { list: vi.fn().mockResolvedValue([]) },
      },
    } as unknown as EngineAPI;

    await Promise.all([refreshResolverState(engine), refreshResolverState(engine)]);

    expect(engine.resolver.settings.get).toHaveBeenCalledTimes(1);
    expect(engine.resolver.sources.list).toHaveBeenCalledTimes(1);
    expect(engine.resolver.cache.stats).toHaveBeenCalledTimes(1);
    expect(engine.resolver.history.list).toHaveBeenCalledTimes(1);
  });

  it('coalesces raw reads while each engine lifetime applies with its own ownership', async () => {
    let resolveSettings!: (value: { enabled: boolean }) => void;
    const engine = {
      resolver: {
        settings: { get: vi.fn(() => new Promise((resolve) => (resolveSettings = resolve))) },
        sources: { list: vi.fn().mockResolvedValue([]) },
        cache: { stats: vi.fn().mockResolvedValue({ entries: 0, bytes: 0 }) },
        history: { list: vi.fn().mockResolvedValue([]) },
      },
    } as unknown as EngineAPI;
    const setSettings = vi.spyOn(useAppStore.getState(), 'setResolverSettings');
    let oldOwns = true;
    const oldRefresh = refreshResolverState(engine, () => oldOwns);
    const strictModeRefresh = refreshResolverState(engine, () => true);
    oldOwns = false;
    resolveSettings({ enabled: true });
    await Promise.all([oldRefresh, strictModeRefresh]);
    expect(engine.resolver.settings.get).toHaveBeenCalledOnce();
    expect(setSettings).toHaveBeenCalledOnce();
    setSettings.mockRestore();
  });

  it('starts a fresh event-owned snapshot instead of reusing a stale bootstrap', async () => {
    const settingsResolvers: Array<(value: { enabled: boolean }) => void> = [];
    const engine = {
      resolver: {
        settings: {
          get: vi.fn(() => new Promise((resolve) => settingsResolvers.push(resolve))),
        },
        sources: { list: vi.fn().mockResolvedValue([]) },
        cache: { stats: vi.fn().mockResolvedValue({ entries: 0, bytes: 0 }) },
        history: { list: vi.fn().mockResolvedValue([]) },
      },
    } as unknown as EngineAPI;
    const setSettings = vi.spyOn(useAppStore.getState(), 'setResolverSettings');
    const bootstrap = refreshResolverState(engine);
    const eventRefresh = refreshResolverState(engine, () => true, true);
    settingsResolvers[1]?.({ enabled: true });
    await eventRefresh;
    settingsResolvers[0]?.({ enabled: false });
    await bootstrap;
    expect(engine.resolver.settings.get).toHaveBeenCalledTimes(2);
    expect(setSettings).toHaveBeenCalledOnce();
    expect(setSettings).toHaveBeenCalledWith({ enabled: true });
    setSettings.mockRestore();
  });

  it('keeps a newer forced snapshot cached when the older snapshot settles first', async () => {
    const settingsResolvers: Array<(value: { enabled: boolean }) => void> = [];
    const engine = {
      resolver: {
        settings: {
          get: vi.fn(() => new Promise((resolve) => settingsResolvers.push(resolve))),
        },
        sources: { list: vi.fn().mockResolvedValue([]) },
        cache: { stats: vi.fn().mockResolvedValue({ entries: 0, bytes: 0 }) },
        history: { list: vi.fn().mockResolvedValue([]) },
      },
    } as unknown as EngineAPI;
    const older = refreshResolverState(engine);
    const forced = refreshResolverState(engine, () => true, true);
    settingsResolvers[0]?.({ enabled: false });
    await older;
    const joinedForced = refreshResolverState(engine);
    expect(engine.resolver.settings.get).toHaveBeenCalledTimes(2);
    settingsResolvers[1]?.({ enabled: true });
    await Promise.all([forced, joinedForced]);
    expect(engine.resolver.settings.get).toHaveBeenCalledTimes(2);
  });

  it('does not let cache stats started before a clear overwrite the confirmed empty cache', async () => {
    let resolveStaleStats!: (value: { entries: number; bytes: number }) => void;
    const cacheStats = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveStaleStats = resolve)))
      .mockResolvedValue({ entries: 0, bytes: 0 });
    const engine = {
      resolver: {
        settings: { get: vi.fn().mockResolvedValue({ enabled: true }) },
        sources: { list: vi.fn().mockResolvedValue([]) },
        cache: { stats: cacheStats, clear: vi.fn().mockResolvedValue(undefined) },
        history: { list: vi.fn().mockResolvedValue([]) },
      },
    } as unknown as EngineAPI;
    useAppStore.getState().setResolverCache({ entries: 4, bytes: 40 });

    const staleRefresh = refreshResolverState(engine);
    await clearResolverCache(engine);
    resolveStaleStats({ entries: 4, bytes: 40 });
    await staleRefresh;

    expect(useAppStore.getState().resolverCache).toEqual({ entries: 0, bytes: 0 });
    expect(resolverCacheClearController(engine).snapshot()).toMatchObject({
      phase: 'success',
      confirmed: { entries: 0, bytes: 0 },
    });
    disposeResolverCacheClearController(engine);
  });
});
