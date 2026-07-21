import { describe, expect, it, vi } from 'vitest';
import type { EngineAPI, PatternTraceEvent, PatternTraceSession } from '@mibbeacon/core/client';
import { PatternPersistentCollectionsController } from './pattern-persistent-collections';

const session = (patch: Partial<PatternTraceSession> = {}): PatternTraceSession => ({
  id: 'session-1',
  requestId: 'request-1',
  operationHandleId: 'handle-1',
  name: 'Trace',
  mode: 'active',
  seriesIds: ['series-1'],
  cadenceMs: 500,
  startAt: 1,
  endAt: 60_001,
  color: '#ef4444',
  status: 'running',
  hitCount: 0,
  successCount: 0,
  errorCount: 0,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

function fixture() {
  let sessions: PatternTraceSession[] = [];
  const events = new Map<string, PatternTraceEvent[]>();
  const patterns = {
    list: vi.fn(async () => sessions),
    events: vi.fn(async (id: string) => events.get(id) ?? []),
    start: vi.fn(async (input: Parameters<EngineAPI['tools']['patterns']['start']>[0]) => {
      const created = session({ requestId: input.requestId, name: input.name ?? 'Trace' });
      sessions = [created];
      return { handleId: created.operationHandleId!, sessionId: created.id };
    }),
    annotate: vi.fn(),
    cancel: vi.fn(async (handleId: string) => {
      sessions = sessions.map((item) =>
        item.operationHandleId === handleId ? { ...item, status: 'cancelled' } : item,
      );
    }),
    remove: vi.fn(async (id: string) => {
      sessions = sessions.filter((item) => item.id !== id);
    }),
  };
  return {
    engine: { tools: { patterns } } as unknown as EngineAPI,
    patterns,
    sessions: () => sessions,
  };
}

describe('PatternPersistentCollectionsController', () => {
  it('recovers a lost start response into confirmed authority with a usable control handle', async () => {
    const { engine, patterns, sessions } = fixture();
    patterns.start.mockImplementationOnce(async (input) => {
      const created = session({ requestId: input.requestId });
      sessions().splice(0, sessions().length, created);
      throw new Error('connection outcome unknown');
    });
    const controller = new PatternPersistentCollectionsController(engine, () => 'request-1');
    await controller.load();

    await expect(
      controller.start({
        name: 'Trace',
        seriesIds: ['series-1'],
        cadenceMs: 500,
        durationMs: 60_000,
        color: '#ef4444',
      }),
    ).resolves.toMatchObject({ sessionId: 'session-1', handleId: 'handle-1' });
    expect(controller.snapshot()).toMatchObject({
      phase: 'success',
      sessions: [
        expect.objectContaining({ requestId: 'request-1', operationHandleId: 'handle-1' }),
      ],
    });
  });

  it('coalesces identical queued start intent and prevents duplicate submits', async () => {
    const { engine, patterns } = fixture();
    let release!: () => void;
    patterns.start.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          release = () => {
            const created = session({ requestId: input.requestId });
            // The mutation result and subsequent authoritative read describe the same commit.
            patterns.list.mockResolvedValueOnce([created]);
            resolve({ handleId: 'handle-1', sessionId: created.id });
          };
        }),
    );
    const controller = new PatternPersistentCollectionsController(engine, () => 'request-1');
    await controller.load();
    const input = {
      name: 'Trace',
      seriesIds: ['series-1'],
      cadenceMs: 500,
      durationMs: 60_000,
      color: '#ef4444',
    };

    const first = controller.start(input);
    const second = controller.start({ ...input, seriesIds: [...input.seriesIds] });
    expect(controller.snapshot()).toMatchObject({ phase: 'updating', active: 'pattern:start' });
    expect(patterns.start).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(patterns.start).toHaveBeenCalledTimes(1);
  });

  it('reconciles ambiguous cancel and remove outcomes from authoritative sessions', async () => {
    const { engine, patterns, sessions } = fixture();
    sessions().push(session());
    const controller = new PatternPersistentCollectionsController(engine, () => 'request-2');
    await controller.load();
    patterns.cancel.mockImplementationOnce(async () => {
      sessions()[0] = session({ status: 'cancelled' });
      throw new Error('network timeout');
    });
    await expect(controller.cancel('handle-1')).resolves.toBeUndefined();
    patterns.remove.mockImplementationOnce(async () => {
      sessions().splice(0);
      throw new Error('transport disconnected');
    });
    await expect(controller.remove('session-1')).resolves.toBeUndefined();
    expect(controller.snapshot()).toMatchObject({ phase: 'success', sessions: [] });
  });

  it('enters conflict when an ambiguous cancel is not present in remote authority', async () => {
    const { engine, patterns, sessions } = fixture();
    sessions().push(session());
    const controller = new PatternPersistentCollectionsController(engine);
    await controller.load();
    patterns.cancel.mockRejectedValueOnce(new Error('network timeout'));

    await expect(controller.cancel('handle-1')).rejects.toThrow(/does not confirm/i);
    expect(controller.snapshot()).toMatchObject({ phase: 'conflict' });
  });

  it('does not recover a terminal session as an active lost-start control', async () => {
    const { engine, patterns, sessions } = fixture();
    patterns.start.mockImplementationOnce(async (input) => {
      sessions().push(
        session({
          requestId: input.requestId,
          status: 'failed',
          operationHandleId: undefined,
        }),
      );
      throw new Error('connection outcome unknown');
    });
    const controller = new PatternPersistentCollectionsController(engine, () => 'request-1');
    await controller.load();

    await expect(
      controller.start({
        seriesIds: ['series-1'],
        cadenceMs: 500,
        durationMs: 60_000,
        color: '#ef4444',
      }),
    ).rejects.toThrow(/does not confirm/i);
    expect(controller.snapshot()).toMatchObject({ phase: 'conflict' });
  });

  it('requires authoritative request identity confirmation for passive annotations', async () => {
    const { engine, patterns } = fixture();
    patterns.annotate.mockResolvedValueOnce(
      session({
        mode: 'passive',
        status: 'completed',
        operationHandleId: undefined,
      }),
    );
    const controller = new PatternPersistentCollectionsController(engine, () => 'request-1');
    await controller.load();

    await expect(
      controller.annotate({
        seriesIds: ['series-1'],
        cadenceMs: 500,
        startAt: 1_000,
        endAt: 2_000,
        color: '#ef4444',
      }),
    ).rejects.toThrow(/does not confirm/i);
    expect(controller.snapshot()).toMatchObject({ phase: 'conflict', sessions: [] });
  });

  it('rejects queued commands instead of running them after a blocking failure', async () => {
    const { engine, patterns } = fixture();
    let rejectStart!: (cause: Error) => void;
    patterns.start.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectStart = reject)),
    );
    const controller = new PatternPersistentCollectionsController(engine, () => 'request-1');
    await controller.load();

    const failed = controller.start({
      seriesIds: ['series-1'],
      cadenceMs: 500,
      durationMs: 60_000,
      color: '#ef4444',
    });
    const discarded = controller.remove('session-2');
    rejectStart(new Error('authoritative rejection'));

    await expect(failed).rejects.toThrow('authoritative rejection');
    await expect(discarded).rejects.toThrow(/discarded|recover/i);
    expect(patterns.remove).not.toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({ phase: 'error-reverted', queued: 0 });
  });

  it('starts a fresh load after immediate retained-controller reactivation', async () => {
    const { engine, patterns } = fixture();
    let releaseOldLoad!: (sessions: PatternTraceSession[]) => void;
    patterns.list
      .mockImplementationOnce(() => new Promise((resolve) => (releaseOldLoad = resolve)))
      .mockResolvedValueOnce([]);
    const controller = new PatternPersistentCollectionsController(engine);
    const oldLoad = controller.load();

    controller.dispose();
    controller.activate();
    const freshLoad = controller.load();
    releaseOldLoad([session()]);
    await Promise.all([oldLoad, freshLoad]);

    expect(patterns.list).toHaveBeenCalledTimes(2);
    expect(controller.snapshot()).toMatchObject({ readiness: { phase: 'ready' }, sessions: [] });
  });

  it('starts a fresh drain after immediate retained-controller reactivation', async () => {
    const { engine, patterns } = fixture();
    let releaseOldStart!: (value: { handleId: string; sessionId: string }) => void;
    patterns.start.mockImplementationOnce(
      () => new Promise((resolve) => (releaseOldStart = resolve)),
    );
    const controller = new PatternPersistentCollectionsController(engine, () => 'request-1');
    await controller.load();
    const oldStart = controller.start({
      seriesIds: ['series-1'],
      cadenceMs: 500,
      durationMs: 60_000,
      color: '#ef4444',
    });
    await vi.waitFor(() => expect(patterns.start).toHaveBeenCalledTimes(1));

    controller.dispose();
    await expect(oldStart).rejects.toThrow(/disposed/i);
    controller.activate();
    await controller.load();
    const freshRemove = controller.remove('absent-session');
    await vi.waitFor(() => expect(patterns.remove).toHaveBeenCalledTimes(1));
    await expect(freshRemove).resolves.toBeUndefined();
    releaseOldStart({ handleId: 'stale-handle', sessionId: 'stale-session' });
  });

  it('does not let an old drain discard a new lifecycle queue when the old mutation settles', async () => {
    const { engine, patterns } = fixture();
    let releaseOldStart!: (value: { handleId: string; sessionId: string }) => void;
    let releaseFreshLoad!: (sessions: PatternTraceSession[]) => void;
    patterns.start.mockImplementationOnce(
      () => new Promise((resolve) => (releaseOldStart = resolve)),
    );
    const controller = new PatternPersistentCollectionsController(engine, () => 'request-1');
    await controller.load();
    const oldStart = controller.start({
      seriesIds: ['series-1'],
      cadenceMs: 500,
      durationMs: 60_000,
      color: '#ef4444',
    });
    await vi.waitFor(() => expect(patterns.start).toHaveBeenCalledTimes(1));

    controller.dispose();
    await expect(oldStart).rejects.toThrow(/disposed/i);
    controller.activate();
    patterns.list
      .mockImplementationOnce(() => new Promise((resolve) => (releaseFreshLoad = resolve)))
      .mockResolvedValueOnce([]);
    const freshLoad = controller.load();
    const freshRemove = controller.remove('absent-session');

    releaseOldStart({ handleId: 'stale-handle', sessionId: 'stale-session' });
    await Promise.resolve();
    await Promise.resolve();
    expect(patterns.list).toHaveBeenCalledTimes(2);
    expect(controller.snapshot()).toMatchObject({
      readiness: { phase: 'loading' },
      phase: 'queued',
      queued: 1,
    });

    releaseFreshLoad([]);
    await freshLoad;
    await expect(freshRemove).resolves.toBeUndefined();
    expect(patterns.remove).toHaveBeenCalledTimes(1);
    expect(controller.snapshot()).toMatchObject({ phase: 'success', queued: 0 });
  });

  it('accepts only the latest authority read when an older load completes first', async () => {
    const { engine, patterns } = fixture();
    let releaseOlder!: (sessions: PatternTraceSession[]) => void;
    let releaseLatest!: (sessions: PatternTraceSession[]) => void;
    patterns.list
      .mockImplementationOnce(() => new Promise((resolve) => (releaseOlder = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (releaseLatest = resolve)));
    const controller = new PatternPersistentCollectionsController(engine);

    const older = controller.load();
    const latest = controller.refresh();
    releaseOlder([session({ id: 'older' })]);
    await older;
    expect(controller.snapshot()).toMatchObject({
      readiness: { phase: 'loading' },
      sessions: [],
    });

    releaseLatest([session({ id: 'latest' })]);
    await latest;
    expect(controller.snapshot()).toMatchObject({
      readiness: { phase: 'ready' },
      sessions: [expect.objectContaining({ id: 'latest' })],
    });
  });

  it('accepts only the latest authority read when a newer refresh completes first', async () => {
    const { engine, patterns } = fixture();
    let releaseOlder!: (sessions: PatternTraceSession[]) => void;
    let releaseLatest!: (sessions: PatternTraceSession[]) => void;
    patterns.list
      .mockImplementationOnce(() => new Promise((resolve) => (releaseOlder = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (releaseLatest = resolve)));
    const controller = new PatternPersistentCollectionsController(engine);

    const older = controller.load();
    const latest = controller.refresh();
    releaseLatest([session({ id: 'latest' })]);
    await latest;
    releaseOlder([session({ id: 'older' })]);
    await older;

    expect(controller.snapshot()).toMatchObject({
      readiness: { phase: 'ready' },
      sessions: [expect.objectContaining({ id: 'latest' })],
    });
  });

  it('resumes a queued drain after refresh restores authoritative readiness', async () => {
    const { engine, patterns } = fixture();
    patterns.list.mockRejectedValueOnce(new Error('initial authority unavailable'));
    const controller = new PatternPersistentCollectionsController(engine);
    const pending = controller.remove('absent-session');
    await vi.waitFor(() =>
      expect(controller.snapshot()).toMatchObject({ readiness: { phase: 'error' }, queued: 1 }),
    );

    await controller.refresh();
    await expect(pending).resolves.toBeUndefined();
    expect(patterns.remove).toHaveBeenCalledTimes(1);
    expect(controller.snapshot()).toMatchObject({ phase: 'success', queued: 0 });
  });

  it('reconciles an uncertain lost response and blocks new writes until recovery', async () => {
    const { engine, patterns, sessions } = fixture();
    patterns.start.mockImplementationOnce(async (input) => {
      sessions().push(session({ requestId: input.requestId }));
      patterns.list.mockRejectedValueOnce(new Error('authority temporarily unavailable'));
      throw new Error('connection outcome unknown');
    });
    const controller = new PatternPersistentCollectionsController(engine, () => 'request-1');
    await controller.load();
    await expect(
      controller.start({
        seriesIds: ['series-1'],
        cadenceMs: 500,
        durationMs: 60_000,
        color: '#ef4444',
      }),
    ).rejects.toThrow(/authority temporarily unavailable/i);
    expect(controller.snapshot()).toMatchObject({ phase: 'uncertain' });
    await expect(controller.remove('anything')).rejects.toThrow(/recover/i);

    await controller.reconcile();
    expect(controller.snapshot()).toMatchObject({ phase: 'success' });
  });

  it('rejects stale continuations after ownership loss or disposal', async () => {
    const { engine, patterns } = fixture();
    let owns = true;
    let release!: (value: { handleId: string; sessionId: string }) => void;
    patterns.start.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const controller = new PatternPersistentCollectionsController(engine, () => 'request-1');
    await controller.load();
    const pending = controller.start(
      {
        seriesIds: ['series-1'],
        cadenceMs: 500,
        durationMs: 60_000,
        color: '#ef4444',
      },
      () => owns,
    );
    owns = false;
    controller.dispose();
    release({ handleId: 'handle-1', sessionId: 'session-1' });
    await expect(pending).rejects.toThrow(/disposed|ownership/i);
  });
});
