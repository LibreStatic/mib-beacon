import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ActionRegistry } from './action-registry';
import { createResolverCacheClearAction } from './resolver-cache-action';

describe('resolver cache clear action', () => {
  it('routes the Settings pointer control through the confirmed registered action', () => {
    const source = readFileSync(new URL('./screens/SettingsScreen.tsx', import.meta.url), 'utf8');
    expect(source).toContain("executeAction('settings:clear-resolver-cache')");
    expect(source).not.toMatch(/onPress=\{\(\) => void clearResolverCache\(/);
  });

  it('is palette-exposed with destructive confirmation and executes only after authorization', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const action = createResolverCacheClearAction({
      entries: 2,
      phase: 'confirmed',
      execute,
    });
    expect(action).toMatchObject({
      id: 'settings:clear-resolver-cache',
      keyboard: { suitable: true },
      palette: { exposed: true },
      enabled: { value: true },
      confirmation: { kind: 'destructive' },
    });
    const registry = new ActionRegistry();
    registry.register(action);
    await registry.execute(action.id, 'web', async () => true);
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each([
    [0, 'confirmed', /empty/i],
    [2, 'queued', /progress/i],
    [2, 'updating', /progress/i],
    [2, 'uncertain', /reconcile/i],
  ] as const)('is disabled for entries=%s phase=%s', (entries, phase, reason) => {
    const action = createResolverCacheClearAction({ entries, phase, execute: vi.fn() });
    expect(action.enabled).toEqual({ value: false, reason: expect.stringMatching(reason) });
  });
});
