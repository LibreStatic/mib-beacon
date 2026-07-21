import { describe, expect, it, vi } from 'vitest';
import type { EngineAPI } from '@omc/core/client';
import {
  deleteTrap,
  browseVendorMibs,
  cancelImport,
  importReviewedFiles,
  getFromNode,
  lookupUnknownOid,
  openQuerySnapshot,
  markTrapRead,
  openGlobalCatalogObject,
  openTableView,
  refreshTrapRecords,
  repeatNotification,
  respondResolverConsent,
  resolveOidHint,
  runGet,
  runTableView,
  sendNotification,
  stopWalk,
  testResolverSource,
  trapFromNode,
  walkFromNode,
  updateResolverSettings,
  previewResolverSource,
  saveResolverSource,
  removeResolverSource,
  toggleResolverSource,
  moveResolverSource,
  dragResolverSource,
  cancelResolverSourcePreview,
} from './actions';
import { clearPacketHistory, resumePacketHistory } from './engine-manual-actions';
import { runEngineOwnedContinuation } from './engine-owned-continuation';
import { useAppStore } from './store';

describe('remaining engine lifetime actions', () => {
  it('does not enqueue or mutate source actions entered without engine ownership', async () => {
    const create = vi.fn();
    const update = vi.fn();
    const remove = vi.fn();
    const reorder = vi.fn();
    const engine = {
      resolver: { sources: { create, update, remove, reorder, list: vi.fn() } },
    } as unknown as EngineAPI;
    const existing = {
      id: 'source-a',
      kind: 'http-template',
      name: 'A',
      enabled: true,
      priority: 1,
      authKind: 'none',
      urlTemplate: 'https://a/{module}',
    } as const;
    useAppStore.setState({ resolverError: 'current', resolverSources: [existing] });
    await saveResolverSource(engine, { config: existing }, undefined, () => false);
    await removeResolverSource(engine, existing.id, () => false);
    await toggleResolverSource(engine, existing, () => false);
    await moveResolverSource(engine, existing.id, 1, () => false);
    await dragResolverSource(engine, existing.id, 0, () => false);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(reorder).not.toHaveBeenCalled();
    expect(useAppStore.getState().resolverError).toBe('current');
  });

  it.each(['resolve', 'reject'] as const)(
    'invalidates a pending preview before cancel/clear when the start later %s',
    async (outcome) => {
      let resolveStart!: (value: { handleId: string }) => void;
      let rejectStart!: (error: Error) => void;
      const cancel = vi.fn().mockResolvedValue(undefined);
      const engine = {
        resolver: {
          cancel,
          sources: {
            preview: () =>
              new Promise<{ handleId: string }>((resolve, reject) => {
                resolveStart = resolve;
                rejectStart = reject;
              }),
          },
        },
      } as unknown as EngineAPI;
      useAppStore.setState({ sourcePreviewHandle: null, sourcePreview: null });
      const preview = previewResolverSource(engine, {
        config: { id: 'x', kind: 'cache', name: 'Cache', enabled: true, priority: 0 },
      });
      await cancelResolverSourcePreview(engine);
      if (outcome === 'resolve') resolveStart({ handleId: 'late-preview' });
      else rejectStart(new Error('late rejection'));
      await preview;
      expect(useAppStore.getState()).toMatchObject({
        sourcePreviewHandle: null,
        sourcePreview: null,
      });
      if (outcome === 'resolve') expect(cancel).toHaveBeenCalledWith('late-preview');
    },
  );
  it.each([
    ['test', 'older resolves first', [0, 1]],
    ['test', 'newer resolves first', [1, 0]],
    ['preview', 'older resolves first', [0, 1]],
    ['preview', 'newer resolves first', [1, 0]],
  ] as const)('arbitrates resolver source %s starts when %s', async (kind, _orderLabel, order) => {
    const starts: Array<{
      resolve: (value: { handleId: string }) => void;
      reject: (error: Error) => void;
    }> = [];
    const start = vi.fn(
      () =>
        new Promise<{ handleId: string }>((resolve, reject) => starts.push({ resolve, reject })),
    );
    const cancel = vi.fn().mockResolvedValue(undefined);
    const engine = {
      resolver: {
        cancel,
        status: vi.fn().mockResolvedValue({ state: 'started' }),
        sources: { test: start, preview: start },
      },
    } as unknown as EngineAPI;
    useAppStore.setState({
      sourceTestHandles: {},
      sourceTestResults: {},
      sourcePreviewHandle: null,
      sourcePreview: null,
    });
    const invoke = () =>
      kind === 'test'
        ? testResolverSource(engine, 'source-a', 'IF-MIB')
        : previewResolverSource(engine, {
            config: {
              id: 'source-a',
              kind: 'cache',
              name: 'Cache',
              enabled: true,
              priority: 0,
            },
          });
    const old = invoke();
    const current = invoke();
    await vi.waitFor(() => expect(starts).toHaveLength(2));
    for (const index of order) starts[index]!.resolve({ handleId: index ? 'new' : 'old' });
    await Promise.all([old, current]);
    expect(cancel).toHaveBeenCalledWith('old');
    if (kind === 'test') expect(useAppStore.getState().sourceTestHandles['source-a']).toBe('new');
    else expect(useAppStore.getState().sourcePreviewHandle).toBe('new');
  });

  it.each(['test', 'preview'] as const)(
    'does not let a stale resolver source %s start rejection clear newer state',
    async (kind) => {
      const starts: Array<{
        resolve: (value: { handleId: string }) => void;
        reject: (error: Error) => void;
      }> = [];
      const start = vi.fn(
        () =>
          new Promise<{ handleId: string }>((resolve, reject) => starts.push({ resolve, reject })),
      );
      const engine = {
        resolver: {
          cancel: vi.fn().mockResolvedValue(undefined),
          status: vi.fn().mockResolvedValue({ state: 'started' }),
          sources: { test: start, preview: start },
        },
      } as unknown as EngineAPI;
      useAppStore.setState({
        sourceTestHandles: {},
        sourceTestResults: {},
        sourcePreviewHandle: null,
        sourcePreview: null,
      });
      const invoke = () =>
        kind === 'test'
          ? testResolverSource(engine, 'source-a', 'IF-MIB')
          : previewResolverSource(engine, {
              config: {
                id: 'source-a',
                kind: 'cache',
                name: 'Cache',
                enabled: true,
                priority: 0,
              },
            });
      const old = invoke();
      const current = invoke();
      await vi.waitFor(() => expect(starts).toHaveLength(2));
      starts[1]!.resolve({ handleId: 'new' });
      starts[0]!.reject(new Error('old rejected'));
      await Promise.all([old, current]);
      if (kind === 'test') expect(useAppStore.getState().sourceTestHandles['source-a']).toBe('new');
      else expect(useAppStore.getState().sourcePreviewHandle).toBe('new');
    },
  );

  it.each(['test', 'preview'] as const)(
    'cancels an already accepted resolver source %s handle before its replacement starts',
    async (kind) => {
      const starts: Array<(value: { handleId: string }) => void> = [];
      const start = vi.fn(
        () => new Promise<{ handleId: string }>((resolve) => starts.push(resolve)),
      );
      const cancel = vi.fn().mockResolvedValue(undefined);
      const engine = {
        resolver: {
          cancel,
          status: vi.fn().mockResolvedValue({ state: 'started' }),
          sources: { test: start, preview: start },
        },
      } as unknown as EngineAPI;
      useAppStore.setState({
        sourceTestHandles: {},
        sourceTestResults: {},
        sourcePreviewHandle: null,
        sourcePreview: null,
      });
      const invoke = () =>
        kind === 'test'
          ? testResolverSource(engine, 'source-a', 'IF-MIB')
          : previewResolverSource(engine, {
              config: {
                id: 'source-a',
                kind: 'cache',
                name: 'Cache',
                enabled: true,
                priority: 0,
              },
            });
      const first = invoke();
      await vi.waitFor(() => expect(starts).toHaveLength(1));
      starts[0]!({ handleId: 'accepted-old' });
      await first;
      const replacement = invoke();
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('accepted-old'));
      await vi.waitFor(() => expect(starts).toHaveLength(2));
      starts[1]!({ handleId: 'accepted-new' });
      await replacement;
      if (kind === 'test')
        expect(useAppStore.getState().sourceTestHandles['source-a']).toBe('accepted-new');
      else expect(useAppStore.getState().sourcePreviewHandle).toBe('accepted-new');
    },
  );
  it.each(['test', 'preview'] as const)(
    'cancels a stale resolver source %s handle on its originating engine',
    async (kind) => {
      let resolveStart!: (value: { handleId: string }) => void;
      const cancel = vi.fn().mockResolvedValue(undefined);
      const engine = {
        resolver: {
          cancel,
          sources: {
            test: () => new Promise((resolve) => (resolveStart = resolve)),
            preview: () => new Promise((resolve) => (resolveStart = resolve)),
          },
        },
      } as unknown as EngineAPI;
      useAppStore.setState({
        sourceTestHandles: {},
        sourceTestResults: {},
        sourcePreviewHandle: null,
        sourcePreview: null,
      });
      let owns = true;
      const running =
        kind === 'test'
          ? testResolverSource(engine, 'source-a', 'IF-MIB', () => owns)
          : previewResolverSource(
              engine,
              {
                config: {
                  id: 'source-a',
                  kind: 'cache',
                  name: 'Cache',
                  enabled: true,
                  priority: 0,
                },
              },
              () => owns,
            );
      owns = false;
      resolveStart({ handleId: `${kind}-old` });
      await running;
      expect(cancel).toHaveBeenCalledWith(`${kind}-old`);
    },
  );
  it('does not let stale synchronous node wrappers replace current query navigation', () => {
    const startWalk = vi.fn();
    const start = vi.fn();
    const engine = { ops: { startWalk, start } } as unknown as EngineAPI;
    useAppStore.setState({ tab: 'browse', oid: '1.4', oidName: 'current' });
    walkFromNode(engine, '1.3', () => false);
    getFromNode(engine, { oid: '1.3', name: 'old', kind: 'scalar' } as never, () => false);
    expect(useAppStore.getState()).toMatchObject({ tab: 'browse', oid: '1.4', oidName: 'current' });
    expect(startWalk).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('does not cancel B through A or apply a stale resolver enable completion', async () => {
    const cancel = vi.fn();
    let resolveUpdate!: (value: unknown) => void;
    const engine = {
      resolver: {
        cancel,
        settings: { update: () => new Promise((resolve) => (resolveUpdate = resolve)) },
      },
    } as unknown as EngineAPI;
    useAppStore.setState({ importHandle: 'b-handle', resolverSettings: null });
    await cancelImport(engine, () => false);
    expect(cancel).not.toHaveBeenCalled();
    let owns = true;
    const updating = updateResolverSettings(engine, { enabled: true }, () => owns);
    owns = false;
    resolveUpdate({ enabled: true });
    await updating;
    expect(useAppStore.getState().resolverSettings).toBeNull();
  });

  it('does not let a stale snapshot replace B results, stats, or result tabs', async () => {
    let resolveSnapshot!: (value: unknown) => void;
    const engine = {
      ops: { snapshots: { get: () => new Promise((resolve) => (resolveSnapshot = resolve)) } },
    } as unknown as EngineAPI;
    let owns = true;
    const opening = openQuerySnapshot(engine, 'old', () => owns);
    owns = false;
    useAppStore.setState({
      results: [{ oid: '1.4' }] as never,
      stats: { count: 1, batches: 1, ms: 2 },
      queryTabs: [],
    });
    resolveSnapshot({ agentName: 'A', baseOid: '1.3', results: [{ oid: '1.3' }] });
    await opening;
    expect(useAppStore.getState()).toMatchObject({
      results: [{ oid: '1.4' }],
      stats: { count: 1, batches: 1, ms: 2 },
      queryTabs: [],
    });
  });

  it('does not mutate current query state when an old helper enters already unowned', async () => {
    const start = vi.fn();
    const engine = { ops: { start } } as unknown as EngineAPI;
    useAppStore.setState({
      tableView: { entryOid: '1.3', selectedColumnOids: [] } as never,
      queryError: 'current',
      results: [{ oid: '1.4' }] as never,
    });
    await runTableView(engine, () => false);
    expect(start).not.toHaveBeenCalled();
    expect(useAppStore.getState()).toMatchObject({
      queryError: 'current',
      results: [{ oid: '1.4' }],
    });
  });

  it('suppresses stale open-file success and error continuations', async () => {
    let resolve!: (value: string) => void;
    let reject!: (reason: Error) => void;
    let owns = true;
    const apply = vi.fn();
    const onError = vi.fn();
    const success = runEngineOwnedContinuation(
      () => new Promise<string>((ok, no) => ((resolve = ok), (reject = no))),
      () => owns,
      apply,
      onError,
    );
    owns = false;
    resolve('old review');
    await success;
    expect(apply).not.toHaveBeenCalled();

    owns = true;
    const failure = runEngineOwnedContinuation(
      () => new Promise<string>((ok, no) => ((resolve = ok), (reject = no))),
      () => owns,
      apply,
      onError,
    );
    owns = false;
    reject(new Error('old error'));
    await failure;
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not let an old catalog completion replace current browse state', async () => {
    let resolveTrees!: (value: never[]) => void;
    const trees = new Promise<never[]>((resolve) => (resolveTrees = resolve));
    const engine = {
      mibs: {
        node: vi.fn().mockResolvedValue({ oid: '1.3', name: 'old', kind: 'scalar' }),
        tree: () => trees,
      },
    } as unknown as EngineAPI;
    let owns = true;
    const opening = openGlobalCatalogObject(engine, '1.3', () => owns);
    await Promise.resolve();
    owns = false;
    useAppStore.getState().setSelected({ oid: '1.4', name: 'current', kind: 'scalar' } as never);
    resolveTrees([]);
    await opening;
    expect(useAppStore.getState().selected?.oid).toBe('1.4');
  });

  it('suppresses stale OID hint success and catch writes', async () => {
    let resolve!: (value: { name: string; definitionOid: string } | null) => void;
    let reject!: (reason: Error) => void;
    const engine = {
      mibs: { resolve: () => new Promise((ok, no) => ((resolve = ok), (reject = no))) },
    } as unknown as EngineAPI;
    useAppStore.setState({ oid: '1.3', oidName: 'current' });
    let owns = true;
    const success = resolveOidHint(engine, '1.3', () => owns);
    owns = false;
    resolve({ name: 'old', definitionOid: '1.3' });
    await success;
    expect(useAppStore.getState().oidName).toBe('current');

    owns = true;
    const failure = resolveOidHint(engine, '1.3', () => owns);
    owns = false;
    reject(new Error('old failure'));
    await failure;
    expect(useAppStore.getState().oidName).toBe('current');
  });

  it('suppresses stale query handles, errors, cancellation, and table navigation', async () => {
    let resolveStart!: (value: { handleId: string }) => void;
    let rejectStart!: (reason: Error) => void;
    let resolveCancel!: () => void;
    let resolveNode!: (value: unknown) => void;
    const start = vi.fn(() => new Promise((ok, no) => ((resolveStart = ok), (rejectStart = no))));
    const engine = {
      mibs: {
        node: () => new Promise((resolve) => (resolveNode = resolve)),
      },
      ops: {
        start,
        cancel: () => new Promise<void>((resolve) => (resolveCancel = resolve)),
      },
    } as unknown as EngineAPI;
    useAppStore.setState({
      oid: '1.3',
      agent: { ...useAppStore.getState().agent, host: 'host' },
      queryError: null,
    });
    let owns = true;
    const running = runGet(engine, () => owns);
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    owns = false;
    useAppStore.setState({
      running: 'current-handle',
      queryError: 'current-error',
      results: [{ oid: '1.4', value: 'current' }] as never,
    });
    resolveStart({ handleId: 'old-handle' });
    await vi.waitFor(() => expect(resolveCancel).toBeTypeOf('function'));
    resolveCancel();
    await running;
    expect(useAppStore.getState()).toMatchObject({
      running: 'current-handle',
      queryError: 'current-error',
      results: [{ oid: '1.4', value: 'current' }],
    });

    owns = true;
    const failing = runGet(engine, () => owns);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    owns = false;
    useAppStore.setState({ queryError: 'current-error' });
    rejectStart(new Error('old failure'));
    await failing;
    expect(useAppStore.getState().queryError).toBe('current-error');

    owns = true;
    const stopping = stopWalk(engine, () => owns);
    owns = false;
    resolveCancel();
    await stopping;
    expect(useAppStore.getState().running).toBe('current-handle');

    owns = true;
    const opening = openTableView(
      engine,
      { oid: '1.3.6.1', name: 'column', kind: 'column' } as never,
      () => owns,
    );
    owns = false;
    resolveNode({ oid: '1.3.6', name: 'entry', kind: 'entry' });
    await opening;
    expect(useAppStore.getState().liveMibScopeOid).not.toBe('1.3.6');
  });

  it('suppresses stale packet and trap manual-action writes', async () => {
    let clearPackets!: () => void;
    let historyPackets!: (value: never[]) => void;
    let queryTraps!: (value: never[]) => void;
    let markRead!: () => void;
    const markReadRemote = vi.fn(() => new Promise<void>((resolve) => (markRead = resolve)));
    const deleteRemote = vi.fn(async () => undefined);
    const engine = {
      packets: {
        clear: () => new Promise<void>((resolve) => (clearPackets = resolve)),
        history: () => new Promise<never[]>((resolve) => (historyPackets = resolve)),
      },
      traps: {
        query: () => new Promise<never[]>((resolve) => (queryTraps = resolve)),
        markRead: markReadRemote,
        delete: deleteRemote,
      },
    } as unknown as EngineAPI;
    let owns = true;
    const clear = clearPacketHistory(engine, () => owns);
    const resume = resumePacketHistory(engine, () => owns);
    const refresh = refreshTrapRecords(engine, {}, () => owns);
    const mark = markTrapRead(engine, 'old', true, () => owns);
    const remove = deleteTrap(engine, 'old', () => owns);
    await vi.waitFor(() => expect(markReadRemote).toHaveBeenCalledOnce());
    expect(deleteRemote).not.toHaveBeenCalled();
    owns = false;
    const clearPacketEvents = vi.spyOn(useAppStore.getState(), 'clearPacketEvents');
    const setPacketEvents = vi.spyOn(useAppStore.getState(), 'setPacketEvents');
    const setTrapRecords = vi.spyOn(useAppStore.getState(), 'setTrapRecords');
    const markTrap = vi.spyOn(useAppStore.getState(), 'markTrapRead');
    const removeTrap = vi.spyOn(useAppStore.getState(), 'removeTrap');
    const markRejected = expect(mark).rejects.toThrow('ownership');
    const removeRejected = expect(remove).rejects.toThrow('ownership');
    clearPackets();
    historyPackets([]);
    queryTraps([]);
    markRead();
    await Promise.all([clear, resume, refresh, markRejected, removeRejected]);
    expect(deleteRemote).not.toHaveBeenCalled();
    expect(clearPacketEvents).not.toHaveBeenCalled();
    expect(setPacketEvents).not.toHaveBeenCalled();
    expect(setTrapRecords).not.toHaveBeenCalled();
    expect(markTrap).not.toHaveBeenCalled();
    expect(removeTrap).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('does not let stale notification sends publish history, errors, toasts, or clear busy', async () => {
    let resolveSend!: (value: unknown) => void;
    const engine = {
      traps: { send: () => new Promise((resolve) => (resolveSend = resolve)) },
    } as unknown as EngineAPI;
    useAppStore.setState({
      notification: {
        ...useAppStore.getState().notification,
        target: { ...useAppStore.getState().notification.target, host: 'host' },
      },
      sendHistory: [],
      toasts: [],
    });
    let owns = true;
    const sending = sendNotification(engine, () => owns);
    owns = false;
    useAppStore.setState({ sendBusy: true, sendError: 'current' });
    resolveSend({ acknowledged: true });
    await sending;
    expect(useAppStore.getState()).toMatchObject({
      sendBusy: true,
      sendError: 'current',
      sendHistory: [],
      toasts: [],
    });

    owns = true;
    const repeating = repeatNotification(
      engine,
      {
        target: { host: 'host', version: 'v2c' },
        kind: 'trap',
        trapOid: '1.3',
        varbinds: [],
      } as never,
      () => owns,
    );
    owns = false;
    useAppStore.setState({ sendBusy: true, sendError: 'current' });
    resolveSend({ acknowledged: true });
    await repeating;
    expect(useAppStore.getState()).toMatchObject({
      sendBusy: true,
      sendError: 'current',
      sendHistory: [],
    });
  });

  it('keeps engine B vendor lookup liveness independent from a pending engine A start', async () => {
    const never = new Promise<never>(() => undefined);
    const browseB = vi.fn().mockResolvedValue({ handleId: 'b' });
    const engineA = {
      resolver: { settings: { get: () => never }, browseVendorMibs: vi.fn() },
    } as unknown as EngineAPI;
    const engineB = {
      resolver: {
        settings: { get: vi.fn().mockResolvedValue({ enabled: true }) },
        browseVendorMibs: browseB,
        status: vi.fn().mockResolvedValue({ state: 'running' }),
      },
    } as unknown as EngineAPI;
    void browseVendorMibs(engineA, '1.3.6.1.4.1.9', 'Cisco', () => false);
    await browseVendorMibs(engineB, '1.3.6.1.4.1.9', 'Cisco', () => true);
    expect(browseB).toHaveBeenCalledOnce();
  });

  it('suppresses stale trap composer navigation after object resolution', async () => {
    let resolveNode!: (value: unknown) => void;
    const engine = {
      mibs: { node: () => new Promise((resolve) => (resolveNode = resolve)) },
    } as unknown as EngineAPI;
    let owns = true;
    const preparing = trapFromNode(
      engine,
      { oid: '1.3', name: 'old trap', kind: 'notification', objects: ['sysName'] } as never,
      () => owns,
    );
    owns = false;
    useAppStore.setState({ tab: 'browse', trapComposerOpen: false });
    resolveNode({ oid: '1.3.6', kind: 'scalar', syntax: 'OCTET STRING' });
    await preparing;
    expect(useAppStore.getState()).toMatchObject({ tab: 'browse', trapComposerOpen: false });
  });

  it('suppresses stale import, consent, and OID lookup ownership claims', async () => {
    let resolveImport!: (value: { handleId: string }) => void;
    let resolveConsent!: () => void;
    let resolveLookup!: (value: { handleId: string }) => void;
    const engine = {
      mibs: { startImport: () => new Promise((resolve) => (resolveImport = resolve)) },
      resolver: {
        respondConsent: () => new Promise<void>((resolve) => (resolveConsent = resolve)),
        lookupOid: () => new Promise((resolve) => (resolveLookup = resolve)),
      },
    } as unknown as EngineAPI;
    let owns = true;
    useAppStore.setState({ importHandle: null, importStatus: null, lookupHandles: {} });
    const importing = importReviewedFiles(engine, [], [], 'old', () => owns);
    useAppStore.setState({
      consent: { handleId: 'old-consent', missingModules: [], sourceHosts: [] } as never,
    });
    const consenting = respondResolverConsent(engine, true, false, () => owns);
    const lookingUp = lookupUnknownOid(engine, '1.3.6', () => owns);
    owns = false;
    useAppStore.setState({
      importHandle: 'current-import',
      resolverError: 'current-error',
      consent: { handleId: 'current-consent', missingModules: [], sourceHosts: [] } as never,
    });
    resolveImport({ handleId: 'old-import' });
    resolveConsent();
    resolveLookup({ handleId: 'old-lookup' });
    await Promise.all([importing, consenting, lookingUp]);
    expect(useAppStore.getState()).toMatchObject({
      importHandle: 'current-import',
      resolverError: 'current-error',
      consent: { handleId: 'current-consent' },
    });
    expect(useAppStore.getState().lookupHandles['1.3.6']).toBeUndefined();
  });

  it('cancels an older same-engine import start and stores only the newest handle', async () => {
    let resolveOld!: (value: { handleId: string }) => void;
    let resolveNew!: (value: { handleId: string }) => void;
    const starts = [
      new Promise<{ handleId: string }>((resolve) => (resolveOld = resolve)),
      new Promise<{ handleId: string }>((resolve) => (resolveNew = resolve)),
    ];
    const cancel = vi.fn().mockResolvedValue(undefined);
    const engine = {
      mibs: { startImport: vi.fn().mockImplementation(() => starts.shift()!) },
      resolver: { cancel, status: vi.fn().mockResolvedValue({ state: 'running' }) },
    } as unknown as EngineAPI;
    useAppStore.setState({ importHandle: null, importStatus: null });
    const oldStart = importReviewedFiles(engine, [], [], 'old');
    const newStart = importReviewedFiles(engine, [], [], 'new');
    resolveOld({ handleId: 'old-handle' });
    await oldStart;
    resolveNew({ handleId: 'new-handle' });
    await newStart;
    expect(cancel).toHaveBeenCalledWith('old-handle');
    expect(useAppStore.getState().importHandle).toBe('new-handle');
  });

  it('cancels an older same-engine query start and stores only the newest handle', async () => {
    let resolveOld!: (value: { handleId: string }) => void;
    let resolveNew!: (value: { handleId: string }) => void;
    const starts = [
      new Promise<{ handleId: string }>((resolve) => (resolveOld = resolve)),
      new Promise<{ handleId: string }>((resolve) => (resolveNew = resolve)),
    ];
    const cancel = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn().mockImplementation(() => starts.shift()!);
    const engine = { ops: { start, cancel } } as unknown as EngineAPI;
    useAppStore.setState({
      agent: { ...useAppStore.getState().agent, host: 'host' },
      oid: '1.3',
      running: null,
    });
    const oldStart = runGet(engine);
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    const newStart = runGet(engine);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    resolveOld({ handleId: 'old-query' });
    await oldStart;
    resolveNew({ handleId: 'new-query' });
    await newStart;
    expect(cancel).toHaveBeenCalledWith('old-query');
    expect(useAppStore.getState().running).toBe('new-query');
  });
});
