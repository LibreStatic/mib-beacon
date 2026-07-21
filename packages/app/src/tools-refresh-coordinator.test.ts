import { describe, expect, it, vi } from 'vitest';
import { ToolsRefreshCoordinator } from './tools-refresh-coordinator';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe('ToolsRefreshCoordinator', () => {
  it('only applies the newer refresh when the older one completes last', async () => {
    const coordinator = new ToolsRefreshCoordinator();
    const old = deferred<string>();
    const next = deferred<string>();
    const apply = vi.fn();
    const first = coordinator.run(
      () => old.promise,
      () => true,
      apply,
    );
    const second = coordinator.run(
      () => next.promise,
      () => true,
      apply,
    );
    next.resolve('new');
    await second;
    old.resolve('old');
    await first;
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith('new');
  });

  it('suppresses an older refresh error after a newer refresh succeeds', async () => {
    const coordinator = new ToolsRefreshCoordinator();
    const old = deferred<string>();
    const apply = vi.fn();
    const first = coordinator.run(
      () => old.promise,
      () => true,
      apply,
    );
    await coordinator.run(
      async () => 'new',
      () => true,
      apply,
    );
    old.reject(new Error('stale failure'));
    await expect(first).resolves.toBeUndefined();
    expect(apply).toHaveBeenLastCalledWith('new');
  });

  it('suppresses completion after ownership loss or disposal', async () => {
    const coordinator = new ToolsRefreshCoordinator();
    const pending = deferred<string>();
    let owned = true;
    const apply = vi.fn();
    const running = coordinator.run(
      () => pending.promise,
      () => owned,
      apply,
    );
    owned = false;
    coordinator.dispose();
    pending.resolve('stale');
    await running;
    expect(apply).not.toHaveBeenCalled();
  });

  it('invalidates an older refresh before merging a direct pattern event', async () => {
    const coordinator = new ToolsRefreshCoordinator();
    const patterns = deferred<string[]>();
    const apply = vi.fn();
    const running = coordinator.run(
      () => patterns.promise,
      () => true,
      apply,
    );
    coordinator.invalidate();
    patterns.resolve(['stale-list-event']);
    await running;
    expect(apply).not.toHaveBeenCalled();
  });
});
