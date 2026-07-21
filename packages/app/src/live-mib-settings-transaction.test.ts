import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { LiveMibSettings } from '@mibbeacon/core/client';
import {
  LiveMibSettingsController,
  createLiveMibNumericFormDraft,
  editLiveMibNumericFormDraft,
  liveMibAgentScopeKey,
  LIVE_MIB_GLOBAL_SCOPE,
  normalizeLiveMibScopeDraft,
  resolveConfirmedLiveMibSettingsForScope,
  resolveLiveMibSettingsForScope,
  validateLiveMibNumericFormDraft,
} from './live-mib-settings-transaction';
import { DEFAULT_LIVE_MIB_SETTINGS } from './live-mibs-model';

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('LiveMibSettingsController', () => {
  it('keeps the Settings UI staged and exposes recovery actions', () => {
    const source = readFileSync(new URL('./screens/SettingsScreen.tsx', import.meta.url), 'utf8');
    const liveSection = source
      .split('<SectionTitle>Live MIBs</SectionTitle>')[1]
      ?.split('<SectionTitle>Desktop updates</SectionTitle>')[0];
    expect(liveSection).toContain('title="Save changes"');
    expect(liveSection).toContain('title="Cancel / revert"');
    expect(liveSection).toContain('title="Retry"');
    expect(liveSection).toContain('title="Acknowledge"');
    expect(liveSection).toContain('title="Check remote value"');
    expect(liveSection).toContain('title="Retry loading"');
    expect(liveSection).toContain('liveNumericForm.values.refreshIntervalMs');
    expect(liveSection).toContain('!liveNumericValidation.valid');
    expect(source).toContain('new LiveMibSettingsController(), []');
    expect(source).toContain(
      '() => resolveLiveMibSettingsForScope(globalLiveState, agentLiveState)',
    );
    expect(liveSection).not.toContain('updateLiveSetting');
    expect(liveSection).not.toContain('agentOverrides.update');
  });

  it('retains empty, negative intermediate, and multi-digit numeric text without writes', async () => {
    const controller = new LiveMibSettingsController();
    const write = vi.fn(async (value: LiveMibSettings) => value);
    controller.seed(LIVE_MIB_GLOBAL_SCOPE, DEFAULT_LIVE_MIB_SETTINGS);

    let form = createLiveMibNumericFormDraft(DEFAULT_LIVE_MIB_SETTINGS);
    form = editLiveMibNumericFormDraft(form, 'refreshIntervalMs', '');
    expect(form.values.refreshIntervalMs).toBe('');
    expect(validateLiveMibNumericFormDraft(form)).toEqual({
      valid: false,
      reason: 'Refresh interval must be a whole number.',
    });
    form = editLiveMibNumericFormDraft(form, 'refreshIntervalMs', '-');
    expect(form.values.refreshIntervalMs).toBe('-');
    form = editLiveMibNumericFormDraft(form, 'refreshIntervalMs', '1');
    form = editLiveMibNumericFormDraft(form, 'refreshIntervalMs', '12');
    form = editLiveMibNumericFormDraft(form, 'refreshIntervalMs', '1200');
    expect(write).not.toHaveBeenCalled();
    const validated = validateLiveMibNumericFormDraft(form);
    expect(validated).toEqual({ valid: true, patch: { refreshIntervalMs: 1200 } });
    if (!validated.valid) throw new Error(validated.reason);
    controller.edit(LIVE_MIB_GLOBAL_SCOPE, {
      ...DEFAULT_LIVE_MIB_SETTINGS,
      ...validated.patch,
    });
    await controller.save(LIVE_MIB_GLOBAL_SCOPE, { write, read: write });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0].refreshIntervalMs).toBe(1200);
  });

  it('serializes a rapid edit and second submit without clearing the newer request early', async () => {
    const controller = new LiveMibSettingsController();
    controller.seed(LIVE_MIB_GLOBAL_SCOPE, DEFAULT_LIVE_MIB_SETTINGS);
    const resolvers: Array<(value: LiveMibSettings) => void> = [];
    const write = vi.fn(
      (value: LiveMibSettings) =>
        new Promise<LiveMibSettings>((resolve) => resolvers.push(() => resolve(value))),
    );
    const transport = { write, read: async () => DEFAULT_LIVE_MIB_SETTINGS };

    controller.edit(LIVE_MIB_GLOBAL_SCOPE, { ...DEFAULT_LIVE_MIB_SETTINGS, scanConcurrency: 2 });
    const first = controller.save(LIVE_MIB_GLOBAL_SCOPE, transport);
    controller.edit(LIVE_MIB_GLOBAL_SCOPE, { ...DEFAULT_LIVE_MIB_SETTINGS, scanConcurrency: 4 });
    const second = controller.save(LIVE_MIB_GLOBAL_SCOPE, transport);

    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('queued');
    expect(write).toHaveBeenCalledTimes(1);
    resolvers.shift()?.(DEFAULT_LIVE_MIB_SETTINGS);
    await flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('updating');
    resolvers.shift()?.({ ...DEFAULT_LIVE_MIB_SETTINGS, scanConcurrency: 4 });
    await Promise.all([first, second]);
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('success');
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).confirmed.scanConcurrency).toBe(4);
  });

  it('does not cancel a newer draft while an older write remains active', async () => {
    const controller = new LiveMibSettingsController();
    controller.seed(LIVE_MIB_GLOBAL_SCOPE, DEFAULT_LIVE_MIB_SETTINGS);
    let resolveWrite!: (settings: LiveMibSettings) => void;
    controller.edit(LIVE_MIB_GLOBAL_SCOPE, {
      ...DEFAULT_LIVE_MIB_SETTINGS,
      scanConcurrency: 2,
    });
    const saving = controller.save(LIVE_MIB_GLOBAL_SCOPE, {
      write: () => new Promise((resolve) => (resolveWrite = resolve)),
      read: async () => DEFAULT_LIVE_MIB_SETTINGS,
    });
    await flush();
    controller.edit(LIVE_MIB_GLOBAL_SCOPE, {
      ...DEFAULT_LIVE_MIB_SETTINGS,
      scanConcurrency: 4,
    });
    controller.cancel(LIVE_MIB_GLOBAL_SCOPE);
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).activeRequest).toBeDefined();
    resolveWrite({ ...DEFAULT_LIVE_MIB_SETTINGS, scanConcurrency: 2 });
    await saving;
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE)).toMatchObject({
      phase: 'dirty',
      confirmed: { scanConcurrency: 2 },
      draft: { scanConcurrency: 4 },
    });
  });

  it('retries and drains a queued newer request while the rejected runner finalizes', async () => {
    const controller = new LiveMibSettingsController();
    controller.seed(LIVE_MIB_GLOBAL_SCOPE, DEFAULT_LIVE_MIB_SETTINGS);
    let rejectFirst!: (error: Error) => void;
    const write = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<LiveMibSettings>((_, reject) => (rejectFirst = reject)),
      )
      .mockImplementation(async (value: LiveMibSettings) => value);
    const transport = { write, read: async () => DEFAULT_LIVE_MIB_SETTINGS };
    let retrying: Promise<void> | undefined;
    controller.subscribe(() => {
      if (controller.get(LIVE_MIB_GLOBAL_SCOPE).phase === 'error-reverted' && !retrying)
        retrying = controller.retry(LIVE_MIB_GLOBAL_SCOPE, transport);
    });
    controller.edit(LIVE_MIB_GLOBAL_SCOPE, {
      ...DEFAULT_LIVE_MIB_SETTINGS,
      scanConcurrency: 2,
    });
    const first = controller.save(LIVE_MIB_GLOBAL_SCOPE, transport);
    controller.edit(LIVE_MIB_GLOBAL_SCOPE, {
      ...DEFAULT_LIVE_MIB_SETTINGS,
      scanConcurrency: 4,
    });
    void controller.save(LIVE_MIB_GLOBAL_SCOPE, transport);

    rejectFirst(new Error('permission denied'));
    await first;
    await retrying;
    expect(write).toHaveBeenCalledTimes(2);
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('success');
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).confirmed.scanConcurrency).toBe(4);
  });

  it('restores confirmed display on authoritative rejection and supports retry', async () => {
    const controller = new LiveMibSettingsController();
    controller.seed(LIVE_MIB_GLOBAL_SCOPE, DEFAULT_LIVE_MIB_SETTINGS);
    const rejected = vi.fn().mockRejectedValueOnce(new Error('permission denied'));
    controller.edit(LIVE_MIB_GLOBAL_SCOPE, { ...DEFAULT_LIVE_MIB_SETTINGS, showReadOnly: true });
    await controller.save(LIVE_MIB_GLOBAL_SCOPE, {
      write: rejected,
      read: async () => DEFAULT_LIVE_MIB_SETTINGS,
    });
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('error-reverted');
    expect(controller.display(LIVE_MIB_GLOBAL_SCOPE).showReadOnly).toBe(false);

    const accepted = vi.fn(async (value: LiveMibSettings) => value);
    await controller.retry(LIVE_MIB_GLOBAL_SCOPE, {
      write: accepted,
      read: async () => DEFAULT_LIVE_MIB_SETTINGS,
    });
    expect(accepted).toHaveBeenCalledWith(expect.objectContaining({ showReadOnly: true }));
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('success');
  });

  it('marks timeout uncertain, reads back, and reconciles the submitted value', async () => {
    const controller = new LiveMibSettingsController();
    controller.seed(LIVE_MIB_GLOBAL_SCOPE, DEFAULT_LIVE_MIB_SETTINGS);
    const submitted = { ...DEFAULT_LIVE_MIB_SETTINGS, verifyWrites: false };
    const phases: string[] = [];
    controller.subscribe(() => phases.push(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase));
    controller.edit(LIVE_MIB_GLOBAL_SCOPE, submitted);
    await controller.save(LIVE_MIB_GLOBAL_SCOPE, {
      write: async () => {
        throw new Error('request timeout: outcome unknown');
      },
      read: async () => submitted,
    });
    expect(phases).toContain('uncertain');
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('success');
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).confirmed.verifyWrites).toBe(false);
  });

  it('ignores later stale reconcile reads after the first authoritative result wins', async () => {
    const controller = new LiveMibSettingsController();
    controller.seed(LIVE_MIB_GLOBAL_SCOPE, DEFAULT_LIVE_MIB_SETTINGS);
    const submitted = { ...DEFAULT_LIVE_MIB_SETTINGS, verifyWrites: false };
    const readResolvers: Array<(value: LiveMibSettings) => void> = [];
    const read = () =>
      new Promise<LiveMibSettings>((resolve) => {
        readResolvers.push(resolve);
      });
    controller.edit(LIVE_MIB_GLOBAL_SCOPE, submitted);
    const saving = controller.save(LIVE_MIB_GLOBAL_SCOPE, {
      write: async () => {
        throw new Error('request timeout');
      },
      read,
    });
    await flush();
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('uncertain');
    const firstManual = controller.reconcile(LIVE_MIB_GLOBAL_SCOPE, read);
    const secondManual = controller.reconcile(LIVE_MIB_GLOBAL_SCOPE, read);
    expect(readResolvers).toHaveLength(3);

    readResolvers[2]?.(submitted);
    await secondManual;
    readResolvers[1]?.(DEFAULT_LIVE_MIB_SETTINGS);
    readResolvers[0]?.(DEFAULT_LIVE_MIB_SETTINGS);
    await Promise.all([firstManual, saving]);
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('success');
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).confirmed.verifyWrites).toBe(false);
  });

  it('keeps uncertain when an older auto-reconcile resolves after a newer read starts', async () => {
    const controller = new LiveMibSettingsController();
    controller.seed(LIVE_MIB_GLOBAL_SCOPE, DEFAULT_LIVE_MIB_SETTINGS);
    const submitted = { ...DEFAULT_LIVE_MIB_SETTINGS, showReadOnly: true };
    const readResolvers: Array<(value: LiveMibSettings) => void> = [];
    const read = () =>
      new Promise<LiveMibSettings>((resolve) => {
        readResolvers.push(resolve);
      });
    controller.edit(LIVE_MIB_GLOBAL_SCOPE, submitted);
    const saving = controller.save(LIVE_MIB_GLOBAL_SCOPE, {
      write: async () => {
        throw new Error('network timeout');
      },
      read,
    });
    await flush();
    const newer = controller.reconcile(LIVE_MIB_GLOBAL_SCOPE, read);
    expect(readResolvers).toHaveLength(2);

    readResolvers[0]?.(DEFAULT_LIVE_MIB_SETTINGS);
    await saving;
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('uncertain');
    readResolvers[1]?.(submitted);
    await newer;
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('success');
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).confirmed.showReadOnly).toBe(true);
  });

  it('binds load and save payload types to their scope keys', () => {
    const controller = new LiveMibSettingsController();
    const typecheckOnly = Date.now() < 0;
    if (typecheckOnly) {
      // @ts-expect-error Global settings cannot load an agent null override.
      void controller.load(LIVE_MIB_GLOBAL_SCOPE, async () => null);
      // @ts-expect-error Global settings cannot use an agent override transport.
      void controller.save(LIVE_MIB_GLOBAL_SCOPE, {
        write: async (_value: Partial<LiveMibSettings> | null) => null,
        read: async () => null,
      });
    }
    expect(controller.readiness(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('unloaded');
  });

  it('gates edits and saves until the authoritative scope load succeeds', async () => {
    const controller = new LiveMibSettingsController();
    const agentScope = liveMibAgentScopeKey('agent-a');
    const write = vi.fn(async (value: Partial<LiveMibSettings> | null) => value);
    let resolveLoad!: (value: Partial<LiveMibSettings> | null) => void;
    const loading = controller.load(
      agentScope,
      () => new Promise((resolve) => (resolveLoad = resolve)),
    );
    controller.edit(agentScope, { scanConcurrency: 4 });
    await controller.save(agentScope, { write, read: async () => null });
    expect(controller.readiness(agentScope).phase).toBe('loading');
    expect(write).not.toHaveBeenCalled();
    resolveLoad({ scanConcurrency: 2, refreshIntervalMs: 9000 });
    await loading;
    expect(controller.readiness(agentScope).phase).toBe('ready');
    expect(controller.get(agentScope).confirmed).toEqual({
      scanConcurrency: 2,
      refreshIntervalMs: 9000,
    });
  });

  it('keeps a failed initial load gated until a retry returns remote values', async () => {
    const controller = new LiveMibSettingsController();
    await expect(
      controller.load(LIVE_MIB_GLOBAL_SCOPE, async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(controller.readiness(LIVE_MIB_GLOBAL_SCOPE)).toEqual({
      phase: 'error',
      error: 'offline',
    });
    controller.edit(LIVE_MIB_GLOBAL_SCOPE, {
      ...DEFAULT_LIVE_MIB_SETTINGS,
      refreshIntervalMs: 1234,
    });
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('confirmed');

    const remote = { ...DEFAULT_LIVE_MIB_SETTINGS, refreshIntervalMs: 9876 };
    await controller.load(LIVE_MIB_GLOBAL_SCOPE, async () => remote);
    expect(controller.readiness(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('ready');
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).confirmed.refreshIntervalMs).toBe(9876);
  });

  it('deduplicates a synchronous subscriber load during the loading notification', async () => {
    const controller = new LiveMibSettingsController();
    const remote = { ...DEFAULT_LIVE_MIB_SETTINGS, refreshIntervalMs: 7654 };
    const read = vi.fn(async () => remote);
    let reentrant: Promise<LiveMibSettings> | undefined;
    controller.subscribe(() => {
      if (controller.readiness(LIVE_MIB_GLOBAL_SCOPE).phase === 'loading' && !reentrant)
        reentrant = controller.load(LIVE_MIB_GLOBAL_SCOPE, read);
    });

    const initial = controller.load(LIVE_MIB_GLOBAL_SCOPE, read);
    await Promise.all([initial, reentrant]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).confirmed.refreshIntervalMs).toBe(7654);
  });

  it('preserves a ready dirty agent draft when re-entry attempts another load', async () => {
    const controller = new LiveMibSettingsController();
    const scope = liveMibAgentScopeKey('agent-a');
    controller.seed(scope, { scanConcurrency: 2 });
    controller.edit(scope, { scanConcurrency: 4 });
    const read = vi.fn(async () => ({ scanConcurrency: 1 }));

    await controller.load(scope, read);

    expect(read).not.toHaveBeenCalled();
    expect(controller.get(scope).phase).toBe('dirty');
    expect(controller.get(scope).draft).toEqual({ scanConcurrency: 4 });
  });

  it('does not orphan an active save when re-entry attempts another load', async () => {
    const controller = new LiveMibSettingsController();
    const scope = liveMibAgentScopeKey('agent-a');
    controller.seed(scope, { scanConcurrency: 2 });
    controller.edit(scope, { scanConcurrency: 4 });
    let resolveWrite!: (value: Partial<LiveMibSettings>) => void;
    const saving = controller.save(scope, {
      write: () => new Promise((resolve) => (resolveWrite = resolve)),
      read: async () => ({ scanConcurrency: 4 }),
    });
    const reentryRead = vi.fn(async () => ({ scanConcurrency: 1 }));

    await controller.load(scope, reentryRead);
    expect(reentryRead).not.toHaveBeenCalled();
    expect(controller.get(scope).phase).toBe('updating');
    resolveWrite({ scanConcurrency: 4 });
    await saving;
    expect(controller.get(scope).phase).toBe('success');
    expect(controller.get(scope).confirmed).toEqual({ scanConcurrency: 4 });
  });

  it('does not allow cancel to leave an uncertain state', async () => {
    const controller = new LiveMibSettingsController();
    controller.seed(LIVE_MIB_GLOBAL_SCOPE, DEFAULT_LIVE_MIB_SETTINGS);
    controller.edit(LIVE_MIB_GLOBAL_SCOPE, {
      ...DEFAULT_LIVE_MIB_SETTINGS,
      scanConcurrency: 2,
    });
    await controller.save(LIVE_MIB_GLOBAL_SCOPE, {
      write: async () => {
        throw new Error('network disconnected');
      },
      read: async () => {
        throw new Error('still offline');
      },
    });
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('uncertain');
    controller.cancel(LIVE_MIB_GLOBAL_SCOPE);
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('uncertain');
  });

  it('refuses cancel while a write is active and accepts its authoritative completion', async () => {
    const controller = new LiveMibSettingsController();
    controller.seed(LIVE_MIB_GLOBAL_SCOPE, DEFAULT_LIVE_MIB_SETTINGS);
    let resolveWrite!: (value: LiveMibSettings) => void;
    controller.edit(LIVE_MIB_GLOBAL_SCOPE, {
      ...DEFAULT_LIVE_MIB_SETTINGS,
      scanConcurrency: 8,
    });
    const saving = controller.save(LIVE_MIB_GLOBAL_SCOPE, {
      write: () => new Promise((resolve) => (resolveWrite = resolve)),
      read: async () => DEFAULT_LIVE_MIB_SETTINGS,
    });
    controller.cancel(LIVE_MIB_GLOBAL_SCOPE);
    resolveWrite({ ...DEFAULT_LIVE_MIB_SETTINGS, scanConcurrency: 8 });
    await saving;
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).phase).toBe('success');
    expect(controller.get(LIVE_MIB_GLOBAL_SCOPE).confirmed.scanConcurrency).toBe(8);
  });

  it('resets an agent override through the same transaction and preserves inheritance', async () => {
    const controller = new LiveMibSettingsController();
    const scope = liveMibAgentScopeKey('agent-a');
    controller.seed(scope, { scanConcurrency: 4 });
    const reset = vi.fn(async () => null);
    controller.edit(scope, null);
    await controller.save(scope, { write: reset, read: async () => null });
    expect(reset).toHaveBeenCalledWith(null);
    expect(controller.get(scope).confirmed).toBeNull();
    expect(normalizeLiveMibScopeDraft(scope, { showReadOnly: true })).toEqual({
      showReadOnly: true,
    });
  });

  it('uses confirmed globals for agent inheritance and numeric reset while globals are dirty', () => {
    const controller = new LiveMibSettingsController();
    const scope = liveMibAgentScopeKey('agent-a');
    controller.seed(LIVE_MIB_GLOBAL_SCOPE, DEFAULT_LIVE_MIB_SETTINGS);
    controller.seed(scope, { scanConcurrency: 4 });
    controller.edit(LIVE_MIB_GLOBAL_SCOPE, {
      ...DEFAULT_LIVE_MIB_SETTINGS,
      refreshIntervalMs: 9876,
    });
    const globalState = controller.get(LIVE_MIB_GLOBAL_SCOPE);
    const agentState = controller.get(scope);

    expect(resolveLiveMibSettingsForScope(globalState, agentState)).toMatchObject({
      refreshIntervalMs: DEFAULT_LIVE_MIB_SETTINGS.refreshIntervalMs,
      scanConcurrency: 4,
    });
    expect(resolveConfirmedLiveMibSettingsForScope(globalState, agentState)).toMatchObject({
      refreshIntervalMs: DEFAULT_LIVE_MIB_SETTINGS.refreshIntervalMs,
      scanConcurrency: 4,
    });
    expect(resolveLiveMibSettingsForScope(globalState).refreshIntervalMs).toBe(9876);
  });
});
