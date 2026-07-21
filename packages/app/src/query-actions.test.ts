import { describe, expect, it, vi } from 'vitest';
import { ActionRegistry, assertActionExposureInvariants } from './action-registry';
import {
  QUERY_SHORTCUT_BINDINGS,
  createQueryActions,
  queryShortcutActionId,
} from './query-actions';

function actions(overrides: Parameters<typeof createQueryActions>[0] = {}) {
  return createQueryActions({
    operation: 'get',
    running: false,
    setValidationError: undefined,
    selectOperation: vi.fn(),
    runGet: vi.fn(),
    runGetNext: vi.fn(),
    runGetBulk: vi.fn(),
    runWalk: vi.fn(),
    stageSet: vi.fn(),
    stop: vi.fn(),
    navigateToQuery: vi.fn(),
    ...overrides,
  });
}

describe('contextual Query actions', () => {
  it('exposes every direct, current, repeat, and stop action through the palette', () => {
    const result = actions();
    expect(result.map(({ id }) => id)).toEqual([
      'query:prepare-get',
      'query:prepare-get-next',
      'query:prepare-get-bulk',
      'query:prepare-walk',
      'query:prepare-set',
      'query:get',
      'query:get-next',
      'query:get-bulk',
      'query:walk',
      'query:stage-set',
      'query:run-current',
      'query:repeat',
      'query:stop',
    ]);
    expect(result.every(({ palette }) => palette.exposed)).toBe(true);
    expect(() => assertActionExposureInvariants(result, QUERY_SHORTCUT_BINDINGS)).not.toThrow();
  });

  it('keeps prepare actions select-only and navigates globally launched actions to Query', async () => {
    const selectOperation = vi.fn();
    const runWalk = vi.fn();
    const navigateToQuery = vi.fn();
    const result = actions({ selectOperation, runWalk, navigateToQuery });

    await result.find(({ id }) => id === 'query:prepare-walk')?.execute();
    expect(selectOperation).toHaveBeenCalledWith('walk');
    expect(runWalk).not.toHaveBeenCalled();
    expect(navigateToQuery).toHaveBeenCalledOnce();

    await result.find(({ id }) => id === 'query:walk')?.execute();
    expect(runWalk).toHaveBeenCalledOnce();
    expect(navigateToQuery).toHaveBeenCalledTimes(2);
  });

  it('uses the same action IDs for browser shortcut dispatch', () => {
    expect(queryShortcutActionId('get')).toBe('query:get');
    expect(queryShortcutActionId('getNext')).toBe('query:get-next');
    expect(queryShortcutActionId('getBulk')).toBe('query:get-bulk');
    expect(queryShortcutActionId('walk')).toBe('query:walk');
    expect(queryShortcutActionId('set')).toBe('query:stage-set');
    expect(queryShortcutActionId('repeat')).toBe('query:repeat');
    expect(queryShortcutActionId('stop')).toBe('query:stop');
  });

  it('direct actions select and execute their operation while current and repeat share execution', async () => {
    const selectOperation = vi.fn();
    const runGetNext = vi.fn();
    const runGet = vi.fn();
    const result = actions({ operation: 'get', selectOperation, runGetNext, runGet });

    await result.find(({ id }) => id === 'query:get-next')?.execute();
    await result.find(({ id }) => id === 'query:run-current')?.execute();
    await result.find(({ id }) => id === 'query:repeat')?.execute();

    expect(selectOperation).toHaveBeenCalledWith('getNext');
    expect(runGetNext).toHaveBeenCalledOnce();
    expect(runGet).toHaveBeenCalledTimes(2);
  });

  it('explains running, stop, and invalid Set disabled states', () => {
    const running = actions({ running: true });
    expect(running.find(({ id }) => id === 'query:run-current')?.enabled).toEqual({
      value: false,
      reason: 'A query operation is already running.',
    });
    expect(running.find(({ id }) => id === 'query:stop')?.enabled).toEqual({ value: true });

    const idle = actions();
    expect(idle.find(({ id }) => id === 'query:stop')?.enabled).toEqual({
      value: false,
      reason: 'No query operation is running.',
    });

    const invalidSet = actions({ operation: 'set', setValidationError: 'Value is required.' });
    expect(invalidSet.find(({ id }) => id === 'query:run-current')?.enabled).toEqual({
      value: false,
      reason: 'Value is required.',
    });
    expect(invalidSet.find(({ id }) => id === 'query:stage-set')?.confirmation.kind).toBe('none');
  });

  it('dispatches UI and shortcut IDs through the same registered handler', async () => {
    const runGet = vi.fn();
    const registry = new ActionRegistry();
    registry.replaceMany(Symbol('persistent-query'), actions({ runGet }));

    await registry.execute('query:repeat', 'web');
    await registry.execute(queryShortcutActionId('repeat'), 'web');

    expect(runGet).toHaveBeenCalledTimes(2);
  });
});
