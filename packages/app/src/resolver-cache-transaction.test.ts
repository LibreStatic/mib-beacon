import { describe, expect, it, vi } from 'vitest';
import { ResolverCacheClearController } from './resolver-cache-transaction';

const stats = (entries: number, bytes = entries * 10) => ({ entries, bytes });

describe('ResolverCacheClearController', () => {
  it('publishes queued/updating/success and confirms the authoritative empty cache', async () => {
    let release!: () => void;
    const controller = new ResolverCacheClearController({
      clear: () => new Promise<void>((resolve) => (release = resolve)),
      stats: vi.fn().mockResolvedValue(stats(0, 0)),
    });
    await controller.load(() => Promise.resolve(stats(2)));
    const clearing = controller.clear(() => true);
    expect(controller.snapshot().phase).toBe('queued');
    await Promise.resolve();
    expect(controller.snapshot().phase).toBe('updating');
    release();
    await clearing;
    expect(controller.snapshot()).toMatchObject({ phase: 'success', confirmed: stats(0, 0) });
  });

  it('restores last-confirmed stats after an authoritative rejection and supports retry', async () => {
    const transport = {
      clear: vi
        .fn()
        .mockRejectedValueOnce(new Error('permission denied'))
        .mockResolvedValueOnce(undefined),
      stats: vi.fn().mockResolvedValue(stats(0, 0)),
    };
    const controller = new ResolverCacheClearController(transport);
    await controller.load(() => Promise.resolve(stats(3)));
    await expect(controller.clear(() => true)).rejects.toThrow('permission denied');
    expect(controller.snapshot()).toMatchObject({ phase: 'error-reverted', confirmed: stats(3) });
    await controller.retry(() => true);
    expect(controller.snapshot()).toMatchObject({ phase: 'success', confirmed: stats(0, 0) });
  });

  it('keeps an ambiguous outcome uncertain until reconciliation distinguishes success or conflict', async () => {
    const transport = {
      clear: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('connection lost'), { code: 'ETIMEDOUT' })),
      stats: vi.fn().mockResolvedValue(stats(1)),
    };
    const controller = new ResolverCacheClearController(transport);
    await controller.load(() => Promise.resolve(stats(4)));
    await expect(controller.clear(() => true)).rejects.toThrow('connection lost');
    expect(controller.snapshot().phase).toBe('uncertain');
    await controller.reconcile(() => true);
    expect(controller.snapshot()).toMatchObject({ phase: 'conflict', confirmed: stats(1) });
  });

  it('does not publish stale completion after ownership loss or disposal', async () => {
    let release!: () => void;
    let owns = true;
    const controller = new ResolverCacheClearController({
      clear: () => new Promise<void>((resolve) => (release = resolve)),
      stats: () => Promise.resolve(stats(0, 0)),
    });
    await controller.load(() => Promise.resolve(stats(2)));
    const clearing = controller.clear(() => owns);
    await Promise.resolve();
    owns = false;
    controller.dispose();
    release();
    await expect(clearing).rejects.toThrow(/disposed|ownership/i);
    expect(controller.snapshot().phase).not.toBe('success');
  });

  it('does not let an older initial load overwrite an updating clear', async () => {
    let releaseLoad!: (value: ReturnType<typeof stats>) => void;
    let releaseClear!: () => void;
    const controller = new ResolverCacheClearController({
      clear: () => new Promise<void>((resolve) => (releaseClear = resolve)),
      stats: () => Promise.resolve(stats(0, 0)),
    });
    const loading = controller.load(() => new Promise((resolve) => (releaseLoad = resolve)));
    const clearing = controller.clear(() => true);
    await Promise.resolve();
    releaseLoad(stats(9));
    await loading;
    expect(controller.snapshot().phase).toBe('updating');
    releaseClear();
    await clearing;
    expect(controller.snapshot()).toMatchObject({ phase: 'success', confirmed: stats(0, 0) });
  });

  it('accepts only the latest-started load even when an older load resolves first', async () => {
    let releaseOlder!: (value: ReturnType<typeof stats>) => void;
    let releaseNewer!: (value: ReturnType<typeof stats>) => void;
    const controller = new ResolverCacheClearController({
      clear: () => Promise.resolve(),
      stats: () => Promise.resolve(stats(0, 0)),
    });
    const older = controller.load(() => new Promise((resolve) => (releaseOlder = resolve)));
    const newer = controller.load(() => new Promise((resolve) => (releaseNewer = resolve)));

    releaseOlder(stats(9));
    await older;
    expect(controller.snapshot()).toMatchObject({ readiness: 'loading' });
    expect(controller.snapshot().confirmed).toBeUndefined();

    releaseNewer(stats(2));
    await newer;
    expect(controller.snapshot()).toMatchObject({ phase: 'confirmed', confirmed: stats(2) });
  });

  it('accepts only the latest-started reconciliation read', async () => {
    let releaseOlder!: (value: ReturnType<typeof stats>) => void;
    let releaseNewer!: (value: ReturnType<typeof stats>) => void;
    const reads = [
      new Promise<ReturnType<typeof stats>>((resolve) => (releaseOlder = resolve)),
      new Promise<ReturnType<typeof stats>>((resolve) => (releaseNewer = resolve)),
    ];
    const controller = new ResolverCacheClearController({
      clear: () =>
        Promise.reject(Object.assign(new Error('connection lost'), { code: 'ETIMEDOUT' })),
      stats: vi.fn().mockImplementation(() => reads.shift()),
    });
    await controller.load(() => Promise.resolve(stats(4)));
    await expect(controller.clear(() => true)).rejects.toThrow('connection lost');
    const older = controller.reconcile(() => true);
    const newer = controller.reconcile(() => true);

    releaseOlder(stats(0, 0));
    await older;
    expect(controller.snapshot()).toMatchObject({ phase: 'uncertain', confirmed: stats(4) });

    releaseNewer(stats(1));
    await newer;
    expect(controller.snapshot()).toMatchObject({ phase: 'conflict', confirmed: stats(1) });
  });

  it('does not let a load started during an active clear overwrite mutation state', async () => {
    let releaseClear!: () => void;
    const read = vi.fn().mockResolvedValue(stats(7));
    const controller = new ResolverCacheClearController({
      clear: () => new Promise<void>((resolve) => (releaseClear = resolve)),
      stats: () => Promise.resolve(stats(0, 0)),
    });
    await controller.load(() => Promise.resolve(stats(3)));
    const clearing = controller.clear(() => true);
    await Promise.resolve();
    expect(controller.snapshot().phase).toBe('updating');

    await controller.load(read);
    expect(read).not.toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({ phase: 'updating', confirmed: stats(3) });

    releaseClear();
    await clearing;
    expect(controller.snapshot()).toMatchObject({ phase: 'success', confirmed: stats(0, 0) });
  });

  it('rejects an external authority read that started before a successful clear', async () => {
    const controller = new ResolverCacheClearController({
      clear: () => Promise.resolve(),
      stats: () => Promise.resolve(stats(0, 0)),
    });
    await controller.load(() => Promise.resolve(stats(3)));
    const staleToken = controller.beginAuthorityRead();

    await controller.clear(() => true);
    expect(controller.applyAuthority(stats(9), staleToken)).toBe(false);
    expect(controller.snapshot()).toMatchObject({ phase: 'success', confirmed: stats(0, 0) });
  });
});
