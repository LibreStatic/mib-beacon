import { describe, expect, it, vi } from 'vitest';
import type { EngineAPI } from '@mibbeacon/core/client';
import toolsSource from './screens/ToolsScreen.tsx?raw';
import querySource from './screens/QueryScreen.tsx?raw';
import appRootSource from './AppRoot.tsx?raw';
import primitivesSource from '../../ui/src/primitives.tsx?raw';
import { createGraphPollSeries } from './graph-poll-series';
import graphPollSource from './graph-poll-series.ts?raw';

describe('persistent Tools collection integration', () => {
  it('routes every mounted poll, watch, and chart write through the controller', () => {
    const mountedSource = `${toolsSource}\n${querySource}`;
    expect(mountedSource).not.toMatch(
      /engine\.tools\.(?:polls\.(?:create|update|remove)|watches\.(?:save|remove)|charts\.(?:save|remove))\s*\(/,
    );
    expect(toolsSource).toContain('useSyncExternalStore');
    expect(querySource).toContain('createGraphPollSeries');
    expect(graphPollSource).toMatch(
      /const controller = toolsPersistentCollectionsController[\s\S]*await controller\.load\(\)[\s\S]*const snapshot = controller\.snapshot\(\)[\s\S]*const admitted = controller\.createPoll/,
    );
    expect(querySource).toContain('error instanceof ToolsCollectionRecoveryRequiredError');
    expect(querySource).toContain("state.setTab('tools')");
  });

  it('reactivates and disposes the per-engine controller across AppRoot effect replay', () => {
    expect(appRootSource).toContain('toolsPersistentCollectionsController(engine, ownsEngine)');
    expect(appRootSource).toContain('disposeToolsPersistentCollectionsController(engine)');
    expect(toolsSource).toContain('persistent.activate()');
    expect(toolsSource).toMatch(
      /event\.kind === 'pattern-event'[\s\S]*refreshCoordinator\.invalidate\(\)/,
    );
  });

  it('makes blocked mutation chips truly disabled and accessibility-visible', () => {
    expect(toolsSource).toContain('disabled={persistentBlocked}');
    expect(primitivesSource).toContain(
      'accessibilityState={{ selected: Boolean(active), disabled }}',
    );
  });

  it('reports initial graph authority failure without enqueueing a write', async () => {
    const create = vi.fn();
    const engine = {
      tools: {
        polls: {
          list: vi.fn(async () => {
            throw new Error('tools offline');
          }),
          create,
        },
        watches: { list: vi.fn(async () => []) },
        charts: { list: vi.fn(async () => []) },
      },
    } as unknown as EngineAPI;
    await expect(
      createGraphPollSeries(
        engine,
        { name: 'Graph me', agentId: 'agent', oid: '1.3.6.1', intervalMs: 5000, mode: 'raw' },
        () => true,
      ),
    ).rejects.toThrow('tools offline');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects graph creation immediately while saved Tools recovery is blocked', async () => {
    const create = vi.fn();
    const remove = vi.fn(async () => {
      throw new Error('validation rejected');
    });
    const engine = {
      tools: {
        polls: {
          list: vi.fn(async () => [
            {
              id: 'a',
              name: 'a',
              agentId: 'agent',
              oid: '1',
              intervalMs: 1000,
              mode: 'raw',
              counterBits: 32,
              retention: 10,
              paused: false,
              errorCount: 0,
              nextDueAt: 0,
              createdAt: 1,
              updatedAt: 1,
            },
          ]),
          create,
          remove,
        },
        watches: { list: vi.fn(async () => []) },
        charts: { list: vi.fn(async () => []) },
      },
    } as unknown as EngineAPI;
    const { toolsPersistentCollectionsController } = await import('./tools-persistent-collections');
    const controller = toolsPersistentCollectionsController(engine, () => true);
    await controller.load();
    await expect(controller.removePoll('a')).rejects.toThrow('validation rejected');
    const queuedBefore = controller.snapshot().queued;
    await expect(
      createGraphPollSeries(
        engine,
        { name: 'blocked', agentId: 'agent', oid: '1', intervalMs: 5000, mode: 'raw' },
        () => true,
      ),
    ).rejects.toThrow('recovery');
    expect(create).not.toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({ phase: 'error-reverted', queued: queuedBefore });
  });

  it('atomically rejects graph admission while an earlier Tools update is active', async () => {
    let rejectUpdate!: (cause: unknown) => void;
    const update = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectUpdate = reject;
        }),
    );
    const create = vi.fn();
    const poll = {
      id: 'a',
      name: 'a',
      agentId: 'agent',
      oid: '1',
      intervalMs: 1000,
      mode: 'raw',
      counterBits: 32,
      retention: 10,
      paused: false,
      errorCount: 0,
      nextDueAt: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const engine = {
      tools: {
        polls: { list: vi.fn(async () => [poll]), create, update },
        watches: { list: vi.fn(async () => []) },
        charts: { list: vi.fn(async () => []) },
      },
    } as unknown as EngineAPI;
    const { toolsPersistentCollectionsController } = await import('./tools-persistent-collections');
    const controller = toolsPersistentCollectionsController(engine, () => true);
    await controller.load();
    const earlier = controller.updatePoll('a', { paused: true });
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    const queuedBefore = controller.snapshot().queued;
    await expect(
      createGraphPollSeries(
        engine,
        { name: 'overlap', agentId: 'agent', oid: '2', intervalMs: 5000, mode: 'raw' },
        () => true,
      ),
    ).rejects.toThrow('recovery');
    expect(create).not.toHaveBeenCalled();
    expect(controller.snapshot().queued).toBe(queuedBefore);
    rejectUpdate(new Error('validation rejected'));
    await expect(earlier).rejects.toThrow('validation rejected');
  });
});
