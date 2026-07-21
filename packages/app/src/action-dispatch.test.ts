import { describe, expect, it, vi } from 'vitest';
import { ActionRegistry, type AppAction } from './action-registry';
import { dispatchRegisteredAction } from './action-dispatch';

const action = (execute: AppAction['execute']): AppAction => ({
  id: 'query:get',
  label: 'Get',
  group: 'Query',
  glyph: '⇄',
  keywords: ['get'],
  keyboard: { suitable: true },
  palette: { exposed: true },
  enabled: { value: false, reason: 'Choose an agent first.' },
  confirmation: { kind: 'none' },
  platforms: ['web'],
  execute,
});

describe('dispatchRegisteredAction', () => {
  it('surfaces disabled and handler failures without rejected promises escaping', async () => {
    const registry = new ActionRegistry();
    const onError = vi.fn();
    const unregister = registry.register(action(vi.fn()));
    await expect(
      dispatchRegisteredAction(registry, 'query:get', 'web', onError),
    ).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith('Choose an agent first.');
    unregister();
    registry.register({
      ...action(async () => {
        throw new Error('Engine unavailable.');
      }),
      enabled: { value: true },
    });
    await expect(
      dispatchRegisteredAction(registry, 'query:get', 'web', onError),
    ).resolves.toBe(false);
    expect(onError).toHaveBeenLastCalledWith('Engine unavailable.');
  });
});
