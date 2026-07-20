import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineAPI } from '@mibbeacon/core/client';
import {
  handleResolverEvent,
  importUrl,
  importReviewedFiles,
  updateResolverSettings,
} from './actions';
import { useAppStore } from './store';

describe('reviewed file import handoff', () => {
  beforeEach(() => {
    useAppStore.setState({ importHandle: null, importStatus: null, importBusy: false, lastImport: null });
  });

  it('returns immediately after startImport accepts a handle without awaiting resolver status', async () => {
    const status = vi.fn(() => new Promise<never>(() => undefined));
    const engine = {
      mibs: { startImport: vi.fn(async () => ({ handleId: 'file-1' })) },
      resolver: { status, cancel: vi.fn() },
    } as unknown as EngineAPI;
    const result = await Promise.race([
      importReviewedFiles(engine, [{ name: 'one.mib', content: 'ONE-MIB DEFINITIONS ::= BEGIN\nEND' }], [], 'files'),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 50)),
    ]);
    expect(result).toBe('file-1');
    expect(status).toHaveBeenCalledWith('file-1');
    expect(useAppStore.getState().importHandle).toBe('file-1');
  });

  it('returns null on start failure so the caller can keep its review open', async () => {
    const engine = {
      mibs: { startImport: vi.fn(async () => { throw new Error('bridge unavailable'); }) },
      resolver: { cancel: vi.fn() },
    } as unknown as EngineAPI;
    await expect(importReviewedFiles(engine, [{ name: 'one.mib', content: 'x' }], [], 'files')).resolves.toBeNull();
    expect(useAppStore.getState().lastImport?.errors[0]?.message).toContain('bridge unavailable');
  });

  it('reopens a reviewed draft when started emits synchronously before the start RPC rejects', async () => {
    useAppStore.setState({
      fileImportDraft: {
        review: {} as never,
        selected: ['one.mib'],
        replacements: [],
        handleId: null,
        visible: true,
      },
    });
    const engine = {
      mibs: {
        startImport: vi.fn(async () => {
          await handleResolverEvent(engine as unknown as EngineAPI, {
            channel: 'resolver',
            handleId: 'claimed-1',
            kind: 'started',
            payload: { request: { files: [{ name: 'one.mib', bytes: 1 }] } },
          });
          throw new Error('start response lost');
        }),
      },
      resolver: { cancel: vi.fn() },
    };

    await expect(
      importReviewedFiles(
        engine as unknown as EngineAPI,
        [{ name: 'one.mib', content: 'x' }],
        [],
        'files',
      ),
    ).resolves.toBeNull();
    expect(useAppStore.getState().fileImportDraft).toEqual(
      expect.objectContaining({
        handleId: null,
        visible: true,
        reopenMessage: expect.stringContaining('start response lost'),
      }),
    );
  });

  it('hands importer modals off before showing resolver consent', async () => {
    useAppStore.setState({
      browserImportOpen: true,
      fileImportDraft: {
        review: {} as never,
        selected: ['one.mib'],
        replacements: [],
        handleId: null,
        visible: true,
      },
      consent: null,
      consentQueue: [],
    });
    const engine = {} as EngineAPI;

    await handleResolverEvent(engine, {
      channel: 'resolver',
      handleId: 'file-1',
      kind: 'started',
      payload: { request: { files: [{ name: 'one.mib', bytes: 10 }] } },
    });
    expect(useAppStore.getState().fileImportDraft).toEqual(
      expect.objectContaining({ handleId: 'file-1', visible: false }),
    );

    await handleResolverEvent(engine, {
      channel: 'resolver',
      handleId: 'file-1',
      kind: 'consent-required',
      payload: {
        missingModules: ['IF-MIB'],
        sourceHosts: ['mibs.example'],
        expiresAt: 123,
      },
    });
    expect(useAppStore.getState().browserImportOpen).toBe(false);
    expect(useAppStore.getState().consent).toEqual(
      expect.objectContaining({ handleId: 'file-1', missingModules: ['IF-MIB'] }),
    );
  });

  it('queues resolver consent until the file review dismissal finishes', async () => {
    const actionModule = (await import('./actions')) as unknown as Record<string, unknown>;
    expect(actionModule.dismissFileImportReviewForOperation).toBeTypeOf('function');
    const dismissFileImportReviewForOperation =
      actionModule.dismissFileImportReviewForOperation as (
        handleId: string,
        waitForDismissal: () => Promise<void>,
      ) => void;
    let releaseDismissal = () => undefined;
    const dismissal = new Promise<void>((resolve) => {
      releaseDismissal = resolve;
    });
    useAppStore.setState({
      importHandle: 'file-queued',
      fileImportDraft: {
        review: {} as never,
        selected: ['queued.mib'],
        replacements: [],
        handleId: null,
        visible: true,
      },
      consent: null,
      consentQueue: [],
    });
    dismissFileImportReviewForOperation('file-queued', () => dismissal);

    const handling = handleResolverEvent({} as EngineAPI, {
      channel: 'resolver',
      handleId: 'file-queued',
      kind: 'consent-required',
      payload: { missingModules: ['IF-MIB'], sourceHosts: ['mibs.example'] },
    });
    await Promise.resolve();
    expect(useAppStore.getState().consent).toBeNull();

    releaseDismissal();
    await handling;
    expect(useAppStore.getState().consent?.handleId).toBe('file-queued');
  });

  it('ignores a stale started event while a newer import owns the UI', async () => {
    useAppStore.setState({
      importHandle: 'new-2',
      importBusy: true,
      fileImportDraft: {
        review: {} as never,
        selected: ['new.mib'],
        replacements: [],
        handleId: 'new-2',
        visible: false,
      },
    });

    await handleResolverEvent({} as EngineAPI, {
      channel: 'resolver',
      handleId: 'old-1',
      kind: 'started',
      payload: { request: { files: [{ name: 'old.mib', bytes: 1 }] } },
    });

    expect(useAppStore.getState().importHandle).toBe('new-2');
    expect(useAppStore.getState().fileImportDraft).toEqual(
      expect.objectContaining({ handleId: 'new-2', selected: ['new.mib'] }),
    );
  });

  it('dismisses the importer before presenting a file review modal', async () => {
    const actionModule = (await import('./actions')) as unknown as Record<string, unknown>;
    expect(actionModule.presentFileImportReview).toBeTypeOf('function');
    const presentFileImportReview = actionModule.presentFileImportReview as (
      draft: NonNullable<ReturnType<typeof useAppStore.getState>['fileImportDraft']>,
      waitForDismissal: () => Promise<void>,
    ) => Promise<void>;
    let releaseDismissal = () => undefined;
    const dismissal = new Promise<void>((resolve) => {
      releaseDismissal = resolve;
    });
    useAppStore.setState({ browserImportOpen: true, fileImportDraft: null });

    const presenting = presentFileImportReview(
      {
        review: {} as never,
        selected: ['one.mib'],
        replacements: [],
        handleId: null,
        visible: true,
      },
      () => dismissal,
    );
    expect(useAppStore.getState().browserImportOpen).toBe(false);
    expect(useAppStore.getState().fileImportDraft).toBeNull();

    releaseDismissal();
    await presenting;
    expect(useAppStore.getState().fileImportDraft?.visible).toBe(true);

    const unnecessaryWait = vi.fn(async () => undefined);
    useAppStore.setState({ browserImportOpen: false, fileImportDraft: null });
    await presentFileImportReview(
      {
        review: {} as never,
        selected: ['inline.mib'],
        replacements: [],
        handleId: null,
        visible: true,
      },
      unnecessaryWait,
    );
    expect(unnecessaryWait).not.toHaveBeenCalled();
    expect(useAppStore.getState().fileImportDraft?.selected).toEqual(['inline.mib']);
  });

  it('clears stale resolver errors while an in-context settings update is pending', async () => {
    let rejectUpdate = (_error: Error) => undefined;
    const update = new Promise<never>((_resolve, reject) => {
      rejectUpdate = reject;
    });
    const engine = {
      resolver: { settings: { update: vi.fn(() => update) } },
    } as unknown as EngineAPI;
    useAppStore.setState({ resolverError: 'old failure' });

    const pending = updateResolverSettings(engine, { autoResolveImports: true });
    expect(useAppStore.getState().resolverError).toBeNull();
    rejectUpdate(new Error('settings bridge unavailable'));
    await pending;

    expect(useAppStore.getState().resolverError).toContain('settings bridge unavailable');
  });

  it('dismisses the importer before a direct URL import can emit resolver consent', async () => {
    useAppStore.setState({ browserImportOpen: true });
    const engine = {
      mibs: {
        startImport: vi.fn(async () => {
          expect(useAppStore.getState().browserImportOpen).toBe(false);
          return { handleId: 'url-1' };
        }),
      },
      resolver: {
        status: vi.fn(async () => ({
          handleId: 'url-1',
          state: 'resolving',
          startedAt: 1,
          updatedAt: 1,
          missingModules: [],
          sourceHosts: [],
          loadedModules: [],
          failures: [],
        })),
        cancel: vi.fn(),
      },
    } as unknown as EngineAPI;

    await importUrl(engine, 'https://example.test/ROOT-MIB');

    expect(engine.mibs.startImport).toHaveBeenCalledOnce();
    expect(useAppStore.getState().importHandle).toBe('url-1');
  });
});
