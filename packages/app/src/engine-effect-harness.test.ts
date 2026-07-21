import { describe, expect, it, vi } from 'vitest';
import { EngineEffectHarness } from './engine-effect-harness';

describe('AppRoot engine effect harness', () => {
  it('suppresses deferred A after provider rerenders to B', async () => {
    let aOwns = true;
    let resolveA!: (value: string) => void;
    const writes = vi.fn();
    const a = new EngineEffectHarness(() => aOwns);
    const pendingA = a.runLatest(
      'modules',
      () => new Promise((resolve) => (resolveA = resolve)),
      writes,
    );
    aOwns = false;
    const b = new EngineEffectHarness(() => true);
    await b.runLatest('modules', async () => 'B', writes);
    resolveA('A');
    await pendingA;
    expect(writes.mock.calls).toEqual([['B']]);
  });

  it('handles Strict Mode cleanup/setup and same-engine terminal latest-wins ordering', () => {
    const firstSetup = new EngineEffectHarness(() => true);
    const stale = firstSetup.begin('resolver');
    firstSetup.dispose();
    const secondSetup = new EngineEffectHarness(() => true);
    const terminalA = secondSetup.begin('resolver');
    const terminalB = secondSetup.begin('resolver');
    const writes = vi.fn();
    firstSetup.apply(stale, () => writes('strict stale'));
    secondSetup.apply(terminalA, () => writes('terminal A'));
    secondSetup.apply(terminalB, () => writes('terminal B'));
    expect(writes.mock.calls).toEqual([['terminal B']]);
  });

  it('suppresses stale terminal errors after a newer terminal begins', async () => {
    const harness = new EngineEffectHarness(() => true);
    const staleError = harness.begin('resolver-terminal-error');
    let reject!: (error: Error) => void;
    const errors = vi.fn();
    const pending = harness.settle(
      staleError,
      () => new Promise((_resolve, fail) => (reject = fail)),
      vi.fn(),
      errors,
    );
    harness.begin('resolver-terminal-error');
    reject(new Error('stale'));
    await pending;
    expect(errors).not.toHaveBeenCalled();
  });
});
