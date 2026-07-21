import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { HostUpdateStatus } from './AppRoot';
import {
  AutomaticUpdatePreferenceController,
  UpdateStatusCoordinator,
  type UpdatePreferenceSnapshot,
} from './update-preference-transaction';

const idleStatus: HostUpdateStatus = { phase: 'idle', currentVersion: '0.5.0' };
const initial: UpdatePreferenceSnapshot = { automaticChecks: false, status: idleStatus };
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('AutomaticUpdatePreferenceController', () => {
  it('does not cancel a newer draft while an older write remains active', async () => {
    const controller = new AutomaticUpdatePreferenceController();
    await controller.load(async () => initial);
    let resolveWrite!: (snapshot: UpdatePreferenceSnapshot) => void;
    controller.edit(true);
    const saving = controller.save({
      write: () => new Promise((resolve) => (resolveWrite = resolve)),
      read: async () => initial,
    });
    await flush();
    controller.edit(false);
    expect(controller.get()).toMatchObject({ phase: 'dirty', confirmed: false, draft: false });
    controller.cancel();
    expect(controller.get().activeRequest).toBeDefined();
    resolveWrite({ automaticChecks: true, status: idleStatus });
    await saving;
    expect(controller.get()).toMatchObject({ phase: 'dirty', confirmed: true, draft: false });
  });

  it('gates edits until an authoritative load completes', async () => {
    let resolveLoad!: (value: UpdatePreferenceSnapshot) => void;
    const controller = new AutomaticUpdatePreferenceController();
    const loading = controller.load(() => new Promise((resolve) => (resolveLoad = resolve)));
    controller.edit(true);
    expect(controller.readiness().phase).toBe('loading');
    expect(controller.display()).toBe(false);
    await Promise.resolve();
    resolveLoad(initial);
    await loading;
    controller.edit(true);
    expect(controller.display()).toBe(true);
    expect(controller.get().phase).toBe('dirty');
  });

  it('keeps status side effects out of the preference controller', () => {
    expect(AutomaticUpdatePreferenceController.length).toBe(0);
  });

  it('disposal suppresses stale load, write, and reconciliation callbacks', async () => {
    const listener = vi.fn();
    const old = new AutomaticUpdatePreferenceController();
    old.subscribe(listener);
    let resolveLoad!: (value: UpdatePreferenceSnapshot) => void;
    const loading = old.load(() => new Promise((resolve) => (resolveLoad = resolve)));
    await flush();
    listener.mockClear();
    old.dispose();
    resolveLoad(initial);
    await loading;
    expect(listener).not.toHaveBeenCalled();
    expect(old.readiness().phase).toBe('unloaded');

    const current = new AutomaticUpdatePreferenceController();
    await current.load(async () => ({
      automaticChecks: true,
      status: { ...idleStatus, currentVersion: '0.6.0' },
    }));
    expect(current.confirmed()).toBe(true);
  });

  it('reactivates the memoized controller after a React effect cleanup', async () => {
    const controller = new AutomaticUpdatePreferenceController();
    controller.dispose();
    controller.activate();
    await controller.load(async () => initial);
    expect(controller.readiness().phase).toBe('ready');
  });

  it('stages the preference and writes only on explicit save', async () => {
    const controller = new AutomaticUpdatePreferenceController();
    await controller.load(async () => initial);
    const saved = {
      automaticChecks: true,
      status: { ...idleStatus, phase: 'not-available' as const },
    };
    const write = vi.fn(async () => saved);
    controller.edit(true);
    expect(write).not.toHaveBeenCalled();
    await controller.save({ write, read: async () => saved });
    expect(write).toHaveBeenCalledOnce();
    expect(controller.get().phase).toBe('success');
    expect(controller.confirmed()).toBe(true);
  });

  it('treats a null write response as an authoritative rejection and restores confirmed', async () => {
    const controller = new AutomaticUpdatePreferenceController();
    await controller.load(async () => initial);
    controller.edit(true);
    await controller.save({ write: async () => null, read: async () => initial });
    expect(controller.get().phase).toBe('error-reverted');
    expect(controller.display()).toBe(false);
    controller.edit(true);
    expect(controller.display()).toBe(false);
    controller.acknowledge();
    expect(controller.get().phase).toBe('confirmed');
  });

  it('serializes newer edits and double submits so stale completions cannot win', async () => {
    const controller = new AutomaticUpdatePreferenceController();
    await controller.load(async () => initial);
    const pending: Array<(value: UpdatePreferenceSnapshot | null) => void> = [];
    const write = vi.fn(
      (automaticChecks: boolean) =>
        new Promise<UpdatePreferenceSnapshot | null>((resolve) =>
          pending.push((value) => resolve(value ?? { automaticChecks, status: idleStatus })),
        ),
    );
    const transport = { write, read: async () => initial };
    controller.edit(true);
    const first = controller.save(transport);
    await flush();
    controller.edit(false);
    const second = controller.save(transport);
    expect(controller.get().phase).toBe('queued');
    pending.shift()?.({ automaticChecks: true, status: idleStatus });
    await flush();
    expect(write).toHaveBeenCalledTimes(2);
    pending.shift()?.({ automaticChecks: false, status: idleStatus });
    await Promise.all([first, second]);
    expect(controller.confirmed()).toBe(false);
    expect(controller.get().phase).toBe('success');
  });

  it('keeps queued newer intent after rejection and resumes it on acknowledgement', async () => {
    const controller = new AutomaticUpdatePreferenceController();
    await controller.load(async () => initial);
    let rejectFirst!: (cause: Error) => void;
    let calls = 0;
    const write = vi.fn((automaticChecks: boolean) => {
      calls += 1;
      if (calls === 1)
        return new Promise<UpdatePreferenceSnapshot | null>((_resolve, reject) => {
          rejectFirst = reject;
        });
      return Promise.resolve({ automaticChecks, status: idleStatus });
    });
    const transport = { write, read: async () => initial };
    controller.edit(true);
    const first = controller.save(transport);
    await flush();
    controller.edit(false);
    const second = controller.save(transport);
    rejectFirst(new Error('validation rejected'));
    await Promise.all([first, second]);
    expect(controller.get().phase).toBe('error-reverted');
    expect(controller.get().queuedRequest?.submitted).toBe(false);
    await controller.acknowledgeAndResume();
    expect(write).toHaveBeenCalledTimes(2);
    expect(controller.get().phase).toBe('success');
  });

  it('reads back ambiguous failures and allows manual reconciliation to supersede a hung read', async () => {
    const controller = new AutomaticUpdatePreferenceController();
    await controller.load(async () => initial);
    let rejectWrite!: (cause: Error) => void;
    let resolveHungRead!: (value: UpdatePreferenceSnapshot | null) => void;
    const write = vi.fn(
      () =>
        new Promise<UpdatePreferenceSnapshot | null>((_resolve, reject) => {
          rejectWrite = reject;
        }),
    );
    const hungRead = vi.fn(
      () =>
        new Promise<UpdatePreferenceSnapshot | null>((resolve) => {
          resolveHungRead = resolve;
        }),
    );
    controller.edit(true);
    const saving = controller.save({ write, read: hungRead });
    await flush();
    rejectWrite(new Error('network timeout'));
    await flush();
    expect(controller.get().phase).toBe('uncertain');
    expect(hungRead).toHaveBeenCalledOnce();
    await controller.reconcile(async () => ({ automaticChecks: true, status: idleStatus }));
    expect(controller.get().phase).toBe('success');
    resolveHungRead(initial);
    await saving;
    expect(controller.confirmed()).toBe(true);
  });

  it('keeps uncertainty when authoritative read-back returns null', async () => {
    const controller = new AutomaticUpdatePreferenceController();
    await controller.load(async () => initial);
    controller.edit(true);
    await controller.save({
      write: async () => {
        throw new Error('transport disconnected');
      },
      read: async () => null,
    });
    expect(controller.get().phase).toBe('uncertain');
  });

  it('keeps a newer status event when an older async response completes afterward', async () => {
    const applied = vi.fn();
    const coordinator = new UpdateStatusCoordinator(applied);
    let resolveResponse!: (status: HostUpdateStatus | null) => void;
    const pending = coordinator.run(
      () => new Promise<HostUpdateStatus | null>((resolve) => (resolveResponse = resolve)),
      (status) => status,
    );
    await Promise.resolve();
    const eventStatus: HostUpdateStatus = { phase: 'downloading', currentVersion: '0.5.0' };
    coordinator.event(eventStatus);
    resolveResponse({ phase: 'checking', currentVersion: '0.5.0' });
    await pending;
    expect(applied).toHaveBeenCalledTimes(1);
    expect(applied).toHaveBeenLastCalledWith(eventStatus);
  });

  it('suppresses responses from a disposed adapter lifetime', async () => {
    const applied = vi.fn();
    const old = new UpdateStatusCoordinator(applied);
    let resolveOld!: (status: HostUpdateStatus | null) => void;
    const pending = old.run(
      () => new Promise<HostUpdateStatus | null>((resolve) => (resolveOld = resolve)),
      (status) => status,
    );
    await Promise.resolve();
    old.dispose();
    const current = new UpdateStatusCoordinator(applied);
    current.event({ phase: 'available', currentVersion: '0.5.0', availableVersion: '0.6.0' });
    resolveOld({ phase: 'idle', currentVersion: '0.5.0' });
    await pending;
    expect(applied).toHaveBeenCalledTimes(1);
    expect(applied.mock.calls[0]?.[0].phase).toBe('available');
  });

  it('wires Settings to one controller per update-adapter lifetime and explicit recovery UI', () => {
    const source = readFileSync(new URL('./screens/SettingsScreen.tsx', import.meta.url), 'utf8');
    const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const section = source
      .split('<SectionTitle>Desktop updates</SectionTitle>')[1]
      ?.split("captureSection('privacy')")[0];
    expect(source).toContain('new AutomaticUpdatePreferenceController(');
    expect(source).toContain('[updates],');
    expect(source).toContain('updatePreferenceController.dispose()');
    expect(source).toContain('updateStatusCoordinator.dispose()');
    expect(source).not.toContain('const [automaticChecks, setAutomaticChecks]');
    expect(section).toContain('Loading the authoritative update preference');
    expect(section).toContain('title="Save preference"');
    expect(section).toContain('title="Cancel / revert"');
    expect(section).toContain('title="Retry"');
    expect(section).toContain('title="Acknowledge"');
    expect(section).toContain('title="Check remote value"');
    expect(section).toContain('title="Retry loading"');
    expect(section).toContain('updateStatusCoordinator.run(');
    expect(section).not.toContain(
      '.load(async () => toUpdatePreferenceSnapshot(await host.updates?.get()))',
    );
    expect(section).not.toContain('status && setUpdateStatus(status)');
    expect(index).toContain('AutomaticUpdatePreferenceController');
  });
});
