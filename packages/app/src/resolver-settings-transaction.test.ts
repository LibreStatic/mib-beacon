import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ResolverSettings } from '@mibbeacon/core/client';
import { ResolverSettingsController } from './resolver-settings-transaction';

const initial: ResolverSettings = {
  enabled: true,
  autoResolveImports: false,
  externalConsentRemembered: true,
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('ResolverSettingsController', () => {
  it('gates editing until an authoritative load and ignores stale loads across controller lifetimes', async () => {
    let resolveOld!: (value: ResolverSettings) => void;
    const old = new ResolverSettingsController();
    const loading = old.load(() => new Promise((resolve) => (resolveOld = resolve)));
    old.edit({ enabled: false });
    expect(old.readiness().phase).toBe('loading');
    expect(old.get().phase).toBe('confirmed');

    const confirmed = vi.fn();
    const current = new ResolverSettingsController(confirmed);
    await current.load(async () => ({ ...initial, enabled: false }));
    resolveOld(initial);
    await loading;
    expect(current.get().confirmed.enabled).toBe(false);
    expect(confirmed).toHaveBeenLastCalledWith({ ...initial, enabled: false });
  });

  it('disposal invalidates a pending load without emitting or confirming into a replacement store', async () => {
    let resolveLoad!: (value: ResolverSettings) => void;
    const confirmed = vi.fn();
    const listener = vi.fn();
    const old = new ResolverSettingsController(confirmed);
    old.subscribe(listener);
    const loading = old.load(() => new Promise((resolve) => (resolveLoad = resolve)));
    await Promise.resolve();
    listener.mockClear();
    old.dispose();
    resolveLoad(initial);
    await loading;
    expect(confirmed).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(old.readiness().phase).not.toBe('ready');
  });

  it('shares the in-flight promise before loading subscribers can reenter load', async () => {
    const controller = new ResolverSettingsController();
    const read = vi.fn(async () => initial);
    let reentered: Promise<ResolverSettings> | undefined;
    controller.subscribe(() => {
      if (controller.readiness().phase === 'loading') reentered = controller.load(read);
    });
    const original = controller.load(read);
    expect(reentered).toBe(original);
    await original;
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'rejection'] as const)(
    'disposal invalidates pending write %s without state, emission, or confirmation',
    async (outcome) => {
      const confirmed = vi.fn();
      const listener = vi.fn();
      const controller = new ResolverSettingsController(confirmed);
      await controller.load(async () => initial);
      controller.subscribe(listener);
      let settle!: (value?: ResolverSettings) => void;
      const write = vi.fn(
        () =>
          new Promise<ResolverSettings>((resolve, reject) => {
            settle = (value) =>
              outcome === 'success'
                ? resolve(value ?? { ...initial, enabled: false })
                : reject(new Error('validation rejected'));
          }),
      );
      controller.edit({ enabled: false });
      const saving = controller.save({ write, read: async () => initial });
      await flush();
      listener.mockClear();
      confirmed.mockClear();
      const beforeDispose = controller.get();
      controller.dispose();
      settle();
      await saving;
      expect(controller.get()).toBe(beforeDispose);
      expect(confirmed).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    },
  );

  it('disposal invalidates a pending reconciliation and the old callback never reaches Zustand', async () => {
    const confirmed = vi.fn();
    const listener = vi.fn();
    const controller = new ResolverSettingsController(confirmed);
    await controller.load(async () => initial);
    controller.edit({ enabled: false });
    let resolveRead!: (value: ResolverSettings) => void;
    const saving = controller.save({
      write: async () => {
        throw new Error('network timeout');
      },
      read: () => new Promise((resolve) => (resolveRead = resolve)),
    });
    await flush();
    expect(controller.get().phase).toBe('uncertain');
    controller.subscribe(listener);
    listener.mockClear();
    confirmed.mockClear();
    const beforeDispose = controller.get();
    controller.dispose();
    resolveRead({ ...initial, enabled: false });
    await saving;
    expect(controller.get()).toBe(beforeDispose);
    expect(confirmed).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('stages dependent toggles and writes only on explicit save', async () => {
    const controller = new ResolverSettingsController();
    await controller.load(async () => initial);
    const write = vi.fn(async (value: ResolverSettings) => value);
    controller.edit({ enabled: false });
    controller.edit({ autoResolveImports: true });
    expect(controller.display()).toMatchObject({ enabled: false, autoResolveImports: true });
    expect(write).not.toHaveBeenCalled();
    await controller.save({ write, read: async () => initial });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('serializes rapid edits and double submits without stale writes winning', async () => {
    const confirmed = vi.fn();
    const controller = new ResolverSettingsController(confirmed);
    await controller.load(async () => initial);
    const pending: Array<(value: ResolverSettings) => void> = [];
    const write = vi.fn(
      (value: ResolverSettings) =>
        new Promise<ResolverSettings>((resolve) => pending.push(() => resolve(value))),
    );
    const transport = { write, read: async () => initial };
    controller.edit({ enabled: false });
    const first = controller.save(transport);
    await flush();
    controller.edit({ autoResolveImports: true });
    const second = controller.save(transport);
    expect(controller.get().phase).toBe('queued');
    pending.shift()?.({ ...initial, enabled: false });
    await flush();
    expect(write).toHaveBeenCalledTimes(2);
    pending.shift()?.({
      enabled: false,
      autoResolveImports: true,
      externalConsentRemembered: true,
    });
    await Promise.all([first, second]);
    expect(controller.get().confirmed).toMatchObject({ enabled: false, autoResolveImports: true });
    expect(confirmed).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, autoResolveImports: true }),
    );
  });

  it('does not cancel a newer draft while an older write remains active', async () => {
    const controller = new ResolverSettingsController();
    await controller.load(async () => initial);
    let resolveWrite!: (settings: ResolverSettings) => void;
    controller.edit({ enabled: false });
    const saving = controller.save({
      write: () => new Promise((resolve) => (resolveWrite = resolve)),
      read: async () => initial,
    });
    await flush();
    controller.edit({ autoResolveImports: true });
    controller.cancel();
    expect(controller.get().activeRequest).toBeDefined();
    resolveWrite({ ...initial, enabled: false });
    await saving;
    expect(controller.get()).toMatchObject({
      phase: 'dirty',
      confirmed: { ...initial, enabled: false },
      draft: { ...initial, enabled: false, autoResolveImports: true },
    });
  });

  it('acknowledges a rejected request and automatically drains its queued newer intent', async () => {
    const controller = new ResolverSettingsController();
    await controller.load(async () => initial);
    let rejectFirst!: (cause: Error) => void;
    const writes: ResolverSettings[] = [];
    const write = vi.fn((value: ResolverSettings) => {
      writes.push(value);
      if (writes.length === 1)
        return new Promise<ResolverSettings>((_resolve, reject) => (rejectFirst = reject));
      return Promise.resolve(value);
    });
    const transport = { write, read: async () => initial };
    controller.edit({ enabled: false });
    const first = controller.save(transport);
    await flush();
    controller.edit({ autoResolveImports: true });
    const second = controller.save(transport);
    rejectFirst(new Error('validation rejected'));
    await Promise.all([first, second]);
    expect(controller.get().phase).toBe('error-reverted');
    expect(controller.get().queuedRequest?.submitted).toMatchObject({
      enabled: false,
      autoResolveImports: true,
    });
    await controller.acknowledgeAndResume();
    expect(write).toHaveBeenCalledTimes(2);
    expect(controller.get().phase).toBe('success');
    expect(controller.get().confirmed).toMatchObject({
      enabled: false,
      autoResolveImports: true,
    });
  });

  it('manual reconciliation resumes a queued newer write after automatic read-back failed', async () => {
    const controller = new ResolverSettingsController();
    await controller.load(async () => initial);
    let rejectFirst!: (cause: Error) => void;
    const writes: ResolverSettings[] = [];
    const write = vi.fn((value: ResolverSettings) => {
      writes.push(value);
      if (writes.length === 1)
        return new Promise<ResolverSettings>((_resolve, reject) => (rejectFirst = reject));
      return Promise.resolve(value);
    });
    const read = vi.fn(async () => {
      throw new Error('still offline');
    });
    const transport = { write, read };
    controller.edit({ enabled: false });
    const first = controller.save(transport);
    await flush();
    controller.edit({ autoResolveImports: true });
    const second = controller.save(transport);
    rejectFirst(new Error('network timeout'));
    await Promise.all([first, second]);
    expect(controller.get().phase).toBe('uncertain');
    expect(controller.get().queuedRequest).toBeDefined();
    await controller.reconcile(async () => ({ ...initial, enabled: false }));
    expect(write).toHaveBeenCalledTimes(2);
    expect(controller.get().phase).toBe('success');
    expect(controller.get().confirmed).toMatchObject({
      enabled: false,
      autoResolveImports: true,
    });
  });

  it('manual reconciliation supersedes a hung automatic read without blocking or double-running the queued write', async () => {
    const controller = new ResolverSettingsController();
    await controller.load(async () => initial);
    let rejectFirst!: (cause: Error) => void;
    const writes: ResolverSettings[] = [];
    const write = vi.fn((value: ResolverSettings) => {
      writes.push(value);
      if (writes.length === 1)
        return new Promise<ResolverSettings>((_resolve, reject) => (rejectFirst = reject));
      return Promise.resolve(value);
    });
    let resolveOldRead!: (value: ResolverSettings) => void;
    const oldAutomaticRead = vi.fn(
      () => new Promise<ResolverSettings>((resolve) => (resolveOldRead = resolve)),
    );
    const transport = { write, read: oldAutomaticRead };

    controller.edit({ enabled: false });
    const first = controller.save(transport);
    await flush();
    controller.edit({ autoResolveImports: true });
    const second = controller.save(transport);
    rejectFirst(new Error('network timeout'));
    await flush();
    expect(controller.get().phase).toBe('uncertain');
    expect(oldAutomaticRead).toHaveBeenCalledTimes(1);

    await controller.reconcile(async () => ({ ...initial, enabled: false }));
    expect(write).toHaveBeenCalledTimes(2);
    expect(controller.get().phase).toBe('success');

    resolveOldRead(initial);
    await Promise.all([first, second]);
    expect(write).toHaveBeenCalledTimes(2);
    expect(controller.get().confirmed).toMatchObject({
      enabled: false,
      autoResolveImports: true,
    });
  });

  it('restores confirmed values on known rejection and requires acknowledgement before editing', async () => {
    const controller = new ResolverSettingsController();
    await controller.load(async () => initial);
    controller.edit({ enabled: false });
    await controller.save({
      write: async () => {
        throw new Error('validation rejected');
      },
      read: async () => initial,
    });
    expect(controller.get().phase).toBe('error-reverted');
    expect(controller.display()).toEqual(initial);
    controller.edit({ autoResolveImports: true });
    expect(controller.display()).toEqual(initial);
    controller.acknowledge();
    expect(controller.get().phase).toBe('confirmed');
  });

  it('reads back ambiguous failures and cannot falsely dismiss unresolved uncertainty', async () => {
    const controller = new ResolverSettingsController();
    await controller.load(async () => initial);
    controller.edit({ enabled: false });
    await controller.save({
      write: async () => {
        throw new Error('network timeout');
      },
      read: async () => {
        throw new Error('still offline');
      },
    });
    expect(controller.get().phase).toBe('uncertain');
    controller.cancel();
    controller.acknowledge();
    expect(controller.get().phase).toBe('uncertain');
    await controller.reconcile(async () => ({ ...initial, enabled: false }));
    expect(controller.get().phase).toBe('success');
  });

  it('surfaces a conflict and accepts authoritative remote state on cancel', async () => {
    const controller = new ResolverSettingsController();
    await controller.load(async () => initial);
    controller.edit({ enabled: false });
    await controller.save({
      write: async () => {
        throw new Error('transport disconnected');
      },
      read: async () => ({ ...initial, autoResolveImports: true }),
    });
    expect(controller.get().phase).toBe('conflict');
    controller.cancel();
    expect(controller.get().confirmed.autoResolveImports).toBe(true);
  });

  it('wires the resolver UI to a per-engine staged controller and recovery actions', () => {
    const source = readFileSync(new URL('./screens/SettingsScreen.tsx', import.meta.url), 'utf8');
    const section = source
      .split('<SectionTitle>Privacy & automation</SectionTitle>')[1]
      ?.split("captureSection('cache')")[0];
    expect(source).toContain('new ResolverSettingsController(');
    expect(source).toContain('[engine],');
    expect(source).toContain('resolverController.dispose()');
    expect(source).toContain('resolverController.acknowledgeAndResume()');
    expect(source).toContain('engine.resolver.settings.get()');
    expect(section).toContain('title="Save changes"');
    expect(section).toContain('title="Cancel / revert"');
    expect(section).toContain('title="Retry"');
    expect(section).toContain('title="Acknowledge"');
    expect(section).toContain('title="Check remote value"');
    expect(section).toContain('title="Retry loading"');
    expect(section).not.toContain('updateResolverSettings');
  });
});
