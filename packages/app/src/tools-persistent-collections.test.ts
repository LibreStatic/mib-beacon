import { describe, expect, it, vi } from 'vitest';
import type {
  EngineAPI,
  PollChart,
  PollSeries,
  PollSeriesDraft,
  PollWatch,
} from '@mibbeacon/core/client';
import {
  ToolsPersistentCollectionsController,
  toolsCollectionStatusText,
} from './tools-persistent-collections';

const series = (id: string, patch: Partial<PollSeries> = {}): PollSeries => ({
  id,
  name: id,
  agentId: 'agent',
  oid: '1.3.6.1.2.1.1.3.0',
  intervalMs: 5000,
  mode: 'raw',
  counterBits: 32,
  retention: 100,
  paused: false,
  errorCount: 0,
  nextDueAt: 0,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});
const watch = (id: string): PollWatch => ({
  id,
  seriesId: 'a',
  name: id,
  operator: '>',
  threshold: 10,
  thresholdMode: 'value',
  breaching: false,
});
const chart = (id: string): PollChart => ({
  id,
  name: id,
  seriesIds: ['a'],
  hiddenSeriesIds: [],
  hiddenPatternSessionIds: [],
  createdAt: 1,
  updatedAt: 1,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function fixture() {
  let polls = [series('a')];
  let watches = [watch('w')];
  let charts = [chart('c')];
  const tools = {
    polls: {
      list: vi.fn(async () => polls),
      create: vi.fn(async (draft: PollSeriesDraft) => {
        const created = series(draft.name, draft);
        polls = [...polls, created];
        return created;
      }),
      update: vi.fn(async (id: string, patch: Partial<PollSeriesDraft>) => {
        polls = polls.map((item) => (item.id === id ? { ...item, ...patch } : item));
        return polls.find((item) => item.id === id)!;
      }),
      remove: vi.fn(async (id: string) => {
        polls = polls.filter((item) => item.id !== id);
      }),
      samples: vi.fn(),
      sampleNow: vi.fn(),
      exportCsv: vi.fn(),
    },
    watches: {
      list: vi.fn(async () => watches),
      save: vi.fn(async (input: Parameters<EngineAPI['tools']['watches']['save']>[0]) => {
        const saved = watch(input.id ?? input.name);
        watches = [...watches.filter((item) => item.id !== saved.id), saved];
        return saved;
      }),
      remove: vi.fn(async (id: string) => {
        watches = watches.filter((item) => item.id !== id);
      }),
    },
    charts: {
      list: vi.fn(async () => charts),
      save: vi.fn(async (input: Parameters<EngineAPI['tools']['charts']['save']>[0]) => {
        const saved = { ...chart(input.id ?? input.name), ...input } as PollChart;
        charts = [...charts.filter((item) => item.id !== saved.id), saved];
        return saved;
      }),
      remove: vi.fn(async (id: string) => {
        charts = charts.filter((item) => item.id !== id);
      }),
    },
  };
  return {
    engine: { tools } as unknown as EngineAPI,
    tools,
    getRemote: () => ({ polls, watches, charts }),
    setRemote: (
      next: Partial<{ polls: PollSeries[]; watches: PollWatch[]; charts: PollChart[] }>,
    ) => {
      polls = next.polls ?? polls;
      watches = next.watches ?? watches;
      charts = next.charts ?? charts;
    },
  };
}

describe('ToolsPersistentCollectionsController', () => {
  it('renders the active persistent write and global queued count together', () => {
    expect(
      toolsCollectionStatusText({
        readiness: { phase: 'ready' },
        phase: 'updating',
        polls: [],
        watches: [],
        charts: [],
        active: 'chart:save:c',
        queued: 3,
      }),
    ).toBe('Updating chart:save:c… · 3 queued');
  });
  it('gates writes on the initial authoritative load and serializes mixed commands', async () => {
    const api = fixture();
    const load = deferred<PollSeries[]>();
    api.tools.polls.list.mockImplementationOnce(() => load.promise);
    const controller = new ToolsPersistentCollectionsController(api.engine);
    const created = controller.createPoll({
      name: 'b',
      agentId: 'agent',
      oid: '1',
      intervalMs: 1000,
      mode: 'raw',
    });
    const saved = controller.saveWatch({
      seriesId: 'a',
      name: 'next',
      operator: '>',
      threshold: 1,
      thresholdMode: 'value',
    });
    expect(api.tools.polls.create).not.toHaveBeenCalled();
    load.resolve([series('a')]);
    await controller.load();
    await Promise.all([created, saved]);
    expect(api.tools.polls.create.mock.invocationCallOrder[0]).toBeLessThan(
      api.tools.watches.save.mock.invocationCallOrder[0]!,
    );
  });

  it('surfaces an initial refresh failure as retryable readiness error', async () => {
    const api = fixture();
    api.tools.polls.list.mockRejectedValueOnce(new Error('offline'));
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await expect(controller.refresh()).rejects.toThrow('offline');
    expect(controller.snapshot().readiness).toEqual({ phase: 'error', error: 'offline' });
    await controller.load();
    expect(controller.snapshot().readiness.phase).toBe('ready');
  });

  it('reports commands queued behind an active write', async () => {
    const api = fixture();
    const pending = deferred<PollSeries>();
    api.tools.polls.update.mockImplementationOnce(() => pending.promise);
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    const active = controller.updatePoll('a', { paused: true });
    const queued = controller.removeWatch('w');
    expect(controller.snapshot()).toMatchObject({ phase: 'updating', queued: 1 });
    api.setRemote({ polls: [series('a', { paused: true })] });
    pending.resolve(series('a', { paused: true }));
    await Promise.all([active, queued]);
  });

  it('does not apply a pre-write refresh that completes after a rejected write', async () => {
    const api = fixture();
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    const staleToken = controller.beginAuthorityRead();
    api.tools.polls.update.mockRejectedValueOnce(new Error('rejected'));
    await expect(controller.updatePoll('a', { paused: true })).rejects.toThrow('rejected');
    controller.applyAuthority(
      { polls: [series('stale')], watches: [], charts: [] },
      'refresh',
      staleToken,
    );
    expect(controller.snapshot().polls.map((item) => item.id)).toEqual(['a']);
  });

  it('returns the currently accepted collection rather than a stale refresh payload', async () => {
    const api = fixture();
    const oldPolls = deferred<PollSeries[]>();
    api.tools.polls.list.mockImplementationOnce(() => oldPolls.promise);
    const controller = new ToolsPersistentCollectionsController(api.engine);
    const stale = controller.refresh();
    controller.applyAuthority(
      { polls: [series('fresh')], watches: [watch('w')], charts: [chart('c')] },
      'event',
    );
    oldPolls.resolve([series('stale')]);
    const accepted = await stale;
    expect(accepted.polls.map((item) => item.id)).toEqual(['fresh']);
  });

  it('does not apply a refresh rejected by the mounted pipeline generation', async () => {
    const api = fixture();
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    api.setRemote({ polls: [series('stale-pipeline')] });
    const accepted = await controller.refresh('refresh', () => false);
    expect(accepted.polls.map((item) => item.id)).toEqual(['a']);
    expect(controller.snapshot().polls.map((item) => item.id)).toEqual(['a']);
  });

  it('does not publish a stale initial refresh error rejected by the pipeline generation', async () => {
    const api = fixture();
    const stale = deferred<PollSeries[]>();
    api.tools.polls.list.mockImplementationOnce(() => stale.promise);
    const controller = new ToolsPersistentCollectionsController(api.engine);
    let accepted = true;
    const oldRefresh = controller.refresh('refresh', () => accepted);
    accepted = false;
    await controller.refresh();
    stale.reject(new Error('stale offline'));
    await expect(oldRefresh).rejects.toThrow('stale offline');
    expect(controller.snapshot().readiness.phase).toBe('ready');
  });

  it('rolls back an authoritative rejection and correlates retry with the failed command', async () => {
    const api = fixture();
    api.tools.polls.remove.mockRejectedValueOnce(new Error('validation rejected'));
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    await expect(controller.removePoll('a')).rejects.toThrow('validation rejected');
    expect(controller.snapshot()).toMatchObject({
      phase: 'error-reverted',
      failedCommand: 'poll:remove:a',
      polls: [series('a')],
    });
    await controller.retryFailed();
    expect(controller.snapshot().polls).toEqual([]);
  });

  it('keeps commands queued behind a failure until explicit recovery', async () => {
    const api = fixture();
    api.tools.polls.remove.mockRejectedValueOnce(new Error('validation rejected'));
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    await expect(controller.removePoll('a')).rejects.toThrow('validation rejected');
    const queued = controller.removeWatch('w');
    expect(controller.snapshot()).toMatchObject({ phase: 'error-reverted', queued: 1 });
    expect(api.tools.watches.remove).not.toHaveBeenCalled();
    controller.acknowledge();
    await queued;
    expect(api.tools.watches.remove).toHaveBeenCalledOnce();
  });

  it('updates confirmed runtime authority without clearing an explicit failure gate', async () => {
    const api = fixture();
    api.tools.polls.remove.mockRejectedValueOnce(new Error('validation rejected'));
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    await expect(controller.removePoll('a')).rejects.toThrow('validation rejected');
    controller.applyAuthority(
      { polls: [series('a', { errorCount: 2 })], watches: [watch('w')], charts: [chart('c')] },
      'event',
    );
    expect(controller.snapshot()).toMatchObject({
      phase: 'error-reverted',
      failedCommand: 'poll:remove:a',
      error: 'validation rejected',
    });
    expect(controller.snapshot().polls[0]?.errorCount).toBe(2);
  });

  it('does not let ordinary refresh authority resolve an uncertain write', async () => {
    const api = fixture();
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    api.tools.charts.list.mockRejectedValueOnce(new Error('read disconnected'));
    await expect(controller.saveChart({ name: 'new', seriesIds: ['a'] })).rejects.toThrow();
    controller.applyAuthority(api.getRemote(), 'refresh');
    expect(controller.snapshot()).toMatchObject({
      phase: 'uncertain',
      failedCommand: 'chart:save:new',
    });
  });

  it('reconciles an ambiguous write that committed remotely', async () => {
    const api = fixture();
    api.tools.polls.update.mockImplementationOnce(async (id, patch) => {
      api.setRemote({ polls: [series(id, patch)] });
      throw new Error('network outcome unknown');
    });
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    await controller.updatePoll('a', { paused: true });
    expect(controller.snapshot()).toMatchObject({ phase: 'success' });
    expect(controller.snapshot().polls[0]?.paused).toBe(true);
  });

  it('recognizes ambiguous create, watch, chart, and cascading poll removal outcomes', async () => {
    const api = fixture();
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    api.tools.polls.create.mockImplementationOnce(async (draft) => {
      api.setRemote({
        polls: [
          ...api.getRemote().polls,
          series('server-id', { ...draft, counterBits: 64, retention: 10_000, paused: false }),
        ],
      });
      throw new Error('connection lost');
    });
    await controller.createPoll({
      name: 'created',
      agentId: 'agent',
      oid: '1.9',
      intervalMs: 250,
      mode: 'delta',
    });
    api.tools.watches.save.mockImplementationOnce(async (input) => {
      api.setRemote({
        watches: [
          ...api.getRemote().watches,
          { ...watch('server-watch'), ...input, operator: undefined, threshold: undefined },
        ],
      });
      throw new Error('timeout');
    });
    await controller.saveWatch({ seriesId: 'a', name: 'created-watch', thresholdMode: 'raw' });
    api.tools.charts.save.mockImplementationOnce(async (input) => {
      api.setRemote({
        charts: [...api.getRemote().charts, { ...chart('server-chart'), ...input }],
      });
      throw new Error('network disconnected');
    });
    await controller.saveChart({ name: 'created-chart', seriesIds: ['a'] });
    api.tools.polls.remove.mockImplementationOnce(async (id) => {
      api.setRemote({ polls: api.getRemote().polls.filter((item) => item.id !== id), watches: [] });
      throw new Error('outcome unknown');
    });
    await controller.removePoll('a');
    expect(controller.snapshot().phase).toBe('success');
  });

  it('does not mistake a pre-existing identical resource for an applied ID-less timeout', async () => {
    const pollApi = fixture();
    pollApi.setRemote({
      polls: [
        series('existing', {
          name: 'same',
          oid: '1.3.6.1',
          intervalMs: 1000,
          mode: 'raw',
          counterBits: 64,
          retention: 10_000,
        }),
      ],
    });
    pollApi.tools.polls.create.mockRejectedValueOnce(new Error('timeout'));
    const polls = new ToolsPersistentCollectionsController(pollApi.engine);
    await polls.load();
    await expect(
      polls.createPoll({
        name: 'same',
        agentId: 'agent',
        oid: '1.3.6.1',
        intervalMs: 1000,
        mode: 'raw',
      }),
    ).rejects.toThrow('timeout');
    expect(polls.snapshot().phase).toBe('conflict');

    const watchApi = fixture();
    watchApi.setRemote({
      watches: [
        { ...watch('existing-watch'), name: 'same', operator: undefined, threshold: undefined },
      ],
    });
    watchApi.tools.watches.save.mockRejectedValueOnce(new Error('timeout'));
    const watches = new ToolsPersistentCollectionsController(watchApi.engine);
    await watches.load();
    await expect(
      watches.saveWatch({ seriesId: 'a', name: 'same', thresholdMode: 'value' }),
    ).rejects.toThrow('timeout');
    expect(watches.snapshot().phase).toBe('conflict');

    const chartApi = fixture();
    chartApi.setRemote({ charts: [{ ...chart('existing-chart'), name: 'same' }] });
    chartApi.tools.charts.save.mockRejectedValueOnce(new Error('timeout'));
    const charts = new ToolsPersistentCollectionsController(chartApi.engine);
    await charts.load();
    await expect(charts.saveChart({ name: 'same', seriesIds: ['a'] })).rejects.toThrow('timeout');
    expect(charts.snapshot().phase).toBe('conflict');
  });

  it('recognizes committed ambiguous creates after service normalization', async () => {
    const pollApi = fixture();
    pollApi.tools.polls.create.mockImplementationOnce(async () => {
      pollApi.setRemote({
        polls: [
          ...pollApi.getRemote().polls,
          series('normalized', {
            name: 'normalized',
            oid: '1.3.6.1',
            intervalMs: 999,
            counterBits: 64,
            retention: 10_000,
            paused: false,
          }),
        ],
      });
      throw new Error('timeout');
    });
    const polls = new ToolsPersistentCollectionsController(pollApi.engine);
    await polls.load();
    await polls.createPoll({
      name: '  normalized  ',
      agentId: 'agent',
      oid: ' .1.3.6.1 ',
      intervalMs: 999.9,
      mode: 'raw',
    });
    expect(polls.snapshot().phase).toBe('success');

    const watchApi = fixture();
    watchApi.tools.watches.save.mockImplementationOnce(async () => {
      watchApi.setRemote({
        watches: [
          ...watchApi.getRemote().watches,
          {
            ...watch('normalized-watch'),
            name: 'normalized',
            operator: undefined,
            threshold: undefined,
          },
        ],
      });
      throw new Error('timeout');
    });
    const watches = new ToolsPersistentCollectionsController(watchApi.engine);
    await watches.load();
    await watches.saveWatch({ seriesId: 'a', name: ' normalized ', thresholdMode: 'value' });
    expect(watches.snapshot().phase).toBe('success');

    const chartApi = fixture();
    chartApi.tools.charts.save.mockImplementationOnce(async () => {
      chartApi.setRemote({
        charts: [
          ...chartApi.getRemote().charts,
          {
            ...chart('normalized-chart'),
            name: 'normalized',
            seriesIds: ['a'],
            hiddenSeriesIds: [],
            hiddenPatternSessionIds: ['p'],
          },
        ],
      });
      throw new Error('timeout');
    });
    const charts = new ToolsPersistentCollectionsController(chartApi.engine);
    await charts.load();
    await charts.saveChart({
      name: ' normalized ',
      seriesIds: ['a', 'a'],
      hiddenPatternSessionIds: ['p', 'p'],
    });
    expect(charts.snapshot().phase).toBe('success');
  });

  it('accepts known-success raw authority even when runtime fields changed concurrently', async () => {
    const api = fixture();
    api.tools.polls.update.mockImplementationOnce(async (id, patch) => {
      const saved = series(id, patch);
      api.setRemote({ polls: [{ ...saved, errorCount: 3, nextDueAt: 99 }] });
      return saved;
    });
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    await controller.updatePoll('a', { paused: true });
    expect(controller.snapshot()).toMatchObject({ phase: 'success' });
    expect(controller.snapshot().polls[0]).toMatchObject({
      paused: true,
      errorCount: 3,
      nextDueAt: 99,
    });
  });

  it('marks a successful write with failed raw-list reconciliation uncertain', async () => {
    const api = fixture();
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    api.tools.charts.list.mockRejectedValueOnce(new Error('read disconnected'));
    await expect(controller.saveChart({ name: 'new', seriesIds: ['a'] })).rejects.toThrow(
      'read disconnected',
    );
    expect(controller.snapshot()).toMatchObject({
      phase: 'uncertain',
      failedCommand: 'chart:save:new',
    });
    expect(controller.snapshot().charts.map((item) => item.id)).toEqual(['c']);
    await controller.reconcile();
    expect(controller.snapshot().phase).toBe('success');
  });

  it('settles state when ownership is lost before a queued command runs', async () => {
    const api = fixture();
    const first = deferred<PollSeries>();
    api.tools.polls.update.mockImplementationOnce(() => first.promise);
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    let owned = true;
    const active = controller.updatePoll('a', { paused: true });
    const lost = controller.removeWatch('w', () => owned);
    owned = false;
    api.setRemote({ polls: [series('a', { paused: true })] });
    first.resolve(series('a', { paused: true }));
    await active;
    await expect(lost).rejects.toThrow('ownership');
    expect(controller.snapshot()).toMatchObject({ phase: 'success', queued: 0, active: undefined });
  });

  it('settles state when ownership is lost after a command returns', async () => {
    const api = fixture();
    let owned = true;
    api.tools.polls.update.mockImplementationOnce(async () => {
      owned = false;
      return series('a', { paused: true });
    });
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    await expect(controller.updatePoll('a', { paused: true }, () => owned)).rejects.toThrow(
      'ownership',
    );
    expect(controller.snapshot()).toMatchObject({
      phase: 'confirmed',
      queued: 0,
      active: undefined,
    });
  });

  it('restores stable state when ownership is lost during ambiguous reconciliation', async () => {
    const api = fixture();
    const reconciliation = deferred<PollSeries[]>();
    let owned = true;
    api.tools.polls.update.mockRejectedValueOnce(new Error('network outcome unknown'));
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    api.tools.polls.list.mockImplementationOnce(() => reconciliation.promise);
    const mutation = controller.updatePoll('a', { paused: true }, () => owned);
    await vi.waitFor(() => expect(api.tools.polls.list).toHaveBeenCalledTimes(2));
    owned = false;
    reconciliation.resolve([series('a', { paused: true })]);
    await expect(mutation).rejects.toThrow('ownership');
    expect(controller.snapshot()).toMatchObject({
      phase: 'confirmed',
      active: undefined,
      queued: 0,
      polls: [series('a')],
    });
  });

  it('reconcile only succeeds when the uncertain chart intent is authoritative', async () => {
    const api = fixture();
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    api.tools.charts.list.mockRejectedValueOnce(new Error('read disconnected'));
    await expect(
      controller.saveChart({ id: 'c', name: 'changed', seriesIds: ['a'] }),
    ).rejects.toThrow();
    api.setRemote({ charts: [chart('c')] });
    await expect(controller.reconcile()).rejects.toThrow('does not contain');
    expect(controller.snapshot()).toMatchObject({
      phase: 'conflict',
      failedCommand: 'chart:save:c',
    });
  });

  it('does not clear failure from a stale reconcile read', async () => {
    const api = fixture();
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    api.tools.charts.list.mockRejectedValueOnce(new Error('read disconnected'));
    await expect(controller.saveChart({ name: 'new', seriesIds: ['a'] })).rejects.toThrow();
    const reconcilePolls = deferred<PollSeries[]>();
    api.tools.polls.list.mockImplementationOnce(() => reconcilePolls.promise);
    const reconciling = controller.reconcile();
    controller.applyAuthority(api.getRemote(), 'event');
    reconcilePolls.resolve(api.getRemote().polls);
    await reconciling;
    expect(controller.snapshot()).toMatchObject({
      phase: 'uncertain',
      failedCommand: 'chart:save:new',
    });
  });

  it('defers event refresh authority until the active write completes and ignores stale reads', async () => {
    const api = fixture();
    const write = deferred<PollSeries>();
    api.tools.polls.update.mockImplementationOnce(() => write.promise);
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    const mutation = controller.updatePoll('a', { paused: true });
    const staleToken = controller.beginAuthorityRead();
    controller.applyAuthority(
      { polls: [series('stale')], watches: [], charts: [] },
      'event',
      staleToken,
    );
    api.setRemote({ polls: [series('a', { paused: true })] });
    write.resolve(series('a', { paused: true }));
    await mutation;
    expect(controller.snapshot().polls.map((item) => item.id)).toEqual(['a']);
    expect(controller.snapshot().polls[0]?.paused).toBe(true);
  });

  it('applies a newer event authority captured after the post-write read began', async () => {
    const api = fixture();
    const postWrite = deferred<PollSeries[]>();
    api.tools.polls.list.mockImplementationOnce(async () => [series('a')]);
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    api.tools.polls.list.mockImplementationOnce(() => postWrite.promise);
    const mutation = controller.updatePoll('a', { paused: true });
    await vi.waitFor(() => expect(api.tools.polls.update).toHaveBeenCalled());
    const eventToken = controller.beginAuthorityRead();
    controller.applyAuthority(
      {
        polls: [series('a', { paused: true, errorCount: 4 })],
        watches: [watch('w')],
        charts: [chart('c')],
      },
      'event',
      eventToken,
    );
    postWrite.resolve([series('a', { paused: true })]);
    await mutation;
    expect(controller.snapshot().polls[0]?.errorCount).toBe(4);
  });

  it('flushes authority applied immediately after the mutation promise resolves', async () => {
    const api = fixture();
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    await controller.updatePoll('a', { paused: true });
    controller.applyAuthority(
      {
        polls: [series('a', { paused: true, errorCount: 7 })],
        watches: [watch('w')],
        charts: [chart('c')],
      },
      'event',
    );
    await Promise.resolve();
    expect(controller.snapshot().polls[0]?.errorCount).toBe(7);
  });

  it('rejects queued commands whose captured ownership is lost', async () => {
    const api = fixture();
    const first = deferred<PollSeries>();
    api.tools.polls.update.mockImplementationOnce(() => first.promise);
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    let owned = true;
    const active = controller.updatePoll('a', { paused: true });
    const queued = controller.saveWatch(
      { seriesId: 'a', name: 'lost', thresholdMode: 'value' },
      () => owned,
    );
    owned = false;
    first.resolve(series('a', { paused: true }));
    api.setRemote({ polls: [series('a', { paused: true })] });
    await active;
    await expect(queued).rejects.toThrow('ownership');
    expect(api.tools.watches.save).not.toHaveBeenCalled();
  });

  it('disposal immediately rejects active and queued work without waiting for the remote', async () => {
    const api = fixture();
    const pending = deferred<PollSeries>();
    api.tools.polls.update.mockImplementationOnce(() => pending.promise);
    const sink = vi.fn();
    const controller = new ToolsPersistentCollectionsController(api.engine, sink);
    await controller.load();
    const active = controller.updatePoll('a', { paused: true });
    const queued = controller.removeWatch('w');
    const activeResult = expect(active).rejects.toThrow('disposed');
    const queuedResult = expect(queued).rejects.toThrow('disposed');
    controller.dispose();
    await activeResult;
    await queuedResult;
    expect(sink).toHaveBeenCalledTimes(1);
    pending.resolve(series('a', { paused: true }));
  });

  it('reactivates cleanly after Strict Mode effect replay', async () => {
    const api = fixture();
    const controller = new ToolsPersistentCollectionsController(api.engine);
    await controller.load();
    controller.dispose();
    controller.activate();
    await controller.load();
    await controller.updatePoll('a', { paused: true });
    expect(controller.snapshot().polls[0]?.paused).toBe(true);
  });

  it('ignores a coalesced pre-cleanup load after replay activation loads fresh authority', async () => {
    const api = fixture();
    const oldLoad = deferred<PollSeries[]>();
    api.tools.polls.list.mockImplementationOnce(() => oldLoad.promise);
    const controller = new ToolsPersistentCollectionsController(api.engine);
    const stale = controller.load();
    controller.dispose();
    controller.activate();
    api.setRemote({ polls: [series('fresh')] });
    await controller.load();
    oldLoad.resolve([series('stale')]);
    await stale;
    expect(controller.snapshot().polls.map((item) => item.id)).toEqual(['fresh']);
  });
});
