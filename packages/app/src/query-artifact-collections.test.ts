import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineAPI, OperationBookmark, WalkSnapshotSummary } from '@mibbeacon/core/client';
import { QueryArtifactCollectionsController } from './query-artifact-collections';

const bookmark = (id: string, name = id): OperationBookmark => ({
  id,
  name,
  agentId: 'agent',
  oid: '1.3.6.1',
  operation: 'walk',
  createdAt: 1,
  updatedAt: 1,
});
const snapshot = (id: string, name = id): WalkSnapshotSummary => ({
  id,
  name,
  agentName: 'agent',
  baseOid: '1.3.6.1',
  resultCount: 0,
  createdAt: 1,
});

function fixture() {
  let bookmarks = [bookmark('a')];
  let snapshots = [snapshot('s')];
  const engine = {
    ops: {
      bookmarks: {
        list: vi.fn(async () => bookmarks),
        create: vi.fn(async (input) => {
          const value = bookmark('b', input.name.trim());
          bookmarks = [value, ...bookmarks];
          return value;
        }),
        delete: vi.fn(async (id) => {
          bookmarks = bookmarks.filter((item) => item.id !== id);
        }),
      },
      snapshots: {
        list: vi.fn(async () => snapshots),
        create: vi.fn(async (input) => {
          const value = snapshot('t', input.name.trim());
          snapshots = [value, ...snapshots];
          return value;
        }),
        delete: vi.fn(async (id) => {
          snapshots = snapshots.filter((item) => item.id !== id);
        }),
      },
    },
  } as unknown as EngineAPI;
  return { engine, setBookmarks: (value: OperationBookmark[]) => (bookmarks = value) };
}

describe('Query persistent artifact authority', () => {
  it('keeps mounted bookmark and snapshot writes out of QueryScreen', () => {
    const source = readFileSync(join(__dirname, 'screens', 'QueryScreen.tsx'), 'utf8');
    expect(source).not.toMatch(/engine\.ops\.(bookmarks|snapshots)\s*\.\s*(create|delete)\s*\(/);
  });

  it('serializes mixed writes and exposes queued/updating/success phases', async () => {
    const { engine } = fixture();
    const controller = new QueryArtifactCollectionsController(engine);
    const phases: string[] = [];
    controller.subscribe(() => phases.push(controller.snapshot().phase));
    await controller.load();
    await Promise.all([
      controller.createBookmark({
        name: 'b',
        agentId: 'agent',
        oid: '1.3.6.1',
        operation: 'walk',
      }),
      controller.deleteSnapshot('s'),
    ]);
    expect(controller.snapshot()).toMatchObject({
      bookmarks: [expect.objectContaining({ id: 'b' }), expect.objectContaining({ id: 'a' })],
      snapshots: [],
      phase: 'success',
    });
    expect(phases).toEqual(expect.arrayContaining(['queued', 'updating', 'success']));
  });

  it('restores confirmed collections after an authoritative rejection', async () => {
    const { engine } = fixture();
    vi.mocked(engine.ops.bookmarks.delete).mockRejectedValueOnce(new Error('permission denied'));
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();

    await expect(controller.deleteBookmark('a')).rejects.toThrow('permission denied');
    expect(controller.snapshot()).toMatchObject({
      bookmarks: [expect.objectContaining({ id: 'a' })],
      phase: 'error-reverted',
      failedCommand: 'bookmark:delete:a',
    });
  });

  it('reconciles an ambiguous create that reached the engine', async () => {
    const { engine, setBookmarks } = fixture();
    vi.mocked(engine.ops.bookmarks.create).mockImplementationOnce(async (input) => {
      setBookmarks([bookmark('late', input.name), bookmark('a')]);
      throw new Error('Request timed out');
    });
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();

    await expect(
      controller.createBookmark({
        name: 'late',
        agentId: 'agent',
        oid: '1.3.6.1',
        operation: 'walk',
      }),
    ).resolves.toBeUndefined();
    expect(controller.snapshot()).toMatchObject({
      phase: 'success',
      bookmarks: [expect.objectContaining({ id: 'late' }), expect.objectContaining({ id: 'a' })],
    });
  });

  it('rejects queued work after engine ownership is lost', async () => {
    const { engine } = fixture();
    let owns = true;
    let release!: () => void;
    vi.mocked(engine.ops.bookmarks.list).mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([bookmark('a')]))),
    );
    const controller = new QueryArtifactCollectionsController(engine);
    const pending = controller.deleteBookmark('a', () => owns);
    owns = false;
    release();
    await expect(pending).rejects.toThrow(/ownership/);
    expect(engine.ops.bookmarks.delete).not.toHaveBeenCalled();
  });

  it('settles an active write on disposal and ignores its late result', async () => {
    const { engine } = fixture();
    let release!: () => void;
    vi.mocked(engine.ops.bookmarks.delete).mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();
    const pending = controller.deleteBookmark('a');
    await Promise.resolve();
    controller.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
    release();
  });

  it('does not let an old lifecycle detach a newer active command', async () => {
    const { engine } = fixture();
    let releaseOld!: () => void;
    let releaseNew!: () => void;
    vi.mocked(engine.ops.bookmarks.delete)
      .mockImplementationOnce(() => new Promise((resolve) => (releaseOld = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (releaseNew = resolve)));
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();

    const oldCommand = controller.deleteBookmark('a');
    await vi.waitFor(() => expect(controller.snapshot().phase).toBe('updating'));
    controller.dispose();
    await expect(oldCommand).rejects.toThrow(/disposed/);

    controller.activate();
    await controller.load();
    const newCommand = controller.deleteBookmark('a');
    await vi.waitFor(() => expect(controller.snapshot().phase).toBe('updating'));

    releaseOld();
    await Promise.resolve();
    controller.dispose();
    await expect(newCommand).rejects.toThrow(/disposed/);
    const disposedState = controller.snapshot();

    releaseNew();
    await Promise.resolve();
    expect(controller.snapshot()).toBe(disposedState);
  });

  it('drops a queued mutation when initial authority loading fails', async () => {
    const { engine } = fixture();
    vi.mocked(engine.ops.bookmarks.list).mockRejectedValueOnce(new Error('load failed'));
    const controller = new QueryArtifactCollectionsController(engine);

    await expect(controller.deleteBookmark('a')).rejects.toThrow('load failed');
    expect(controller.snapshot().queued).toBe(0);
    await controller.load();
    expect(engine.ops.bookmarks.delete).not.toHaveBeenCalled();
  });

  it('does not let an older authority read overwrite a newer refresh', async () => {
    const { engine } = fixture();
    let resolveBookmarks!: (value: OperationBookmark[]) => void;
    let resolveSnapshots!: (value: WalkSnapshotSummary[]) => void;
    vi.mocked(engine.ops.bookmarks.list)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveBookmarks = resolve)))
      .mockResolvedValueOnce([bookmark('new')]);
    vi.mocked(engine.ops.snapshots.list)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSnapshots = resolve)))
      .mockResolvedValueOnce([snapshot('new')]);
    const controller = new QueryArtifactCollectionsController(engine);

    const older = controller.load();
    await controller.refresh();
    resolveBookmarks([bookmark('old')]);
    resolveSnapshots([snapshot('old')]);
    await older;

    expect(controller.snapshot()).toMatchObject({
      bookmarks: [expect.objectContaining({ id: 'new' })],
      snapshots: [expect.objectContaining({ id: 'new' })],
    });
  });

  it('does not drain queued work when a stale initial load resolves before a newer refresh', async () => {
    const { engine } = fixture();
    let resolveInitialBookmarks!: (value: OperationBookmark[]) => void;
    let resolveInitialSnapshots!: (value: WalkSnapshotSummary[]) => void;
    let resolveRefreshBookmarks!: (value: OperationBookmark[]) => void;
    let resolveRefreshSnapshots!: (value: WalkSnapshotSummary[]) => void;
    vi.mocked(engine.ops.bookmarks.list)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveInitialBookmarks = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveRefreshBookmarks = resolve)));
    vi.mocked(engine.ops.snapshots.list)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveInitialSnapshots = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveRefreshSnapshots = resolve)));
    const controller = new QueryArtifactCollectionsController(engine);

    const mutation = controller.deleteBookmark('a');
    const staleLoad = controller.load();
    await vi.waitFor(() => expect(engine.ops.bookmarks.list).toHaveBeenCalledTimes(1));
    const refresh = controller.refresh();
    await vi.waitFor(() => expect(engine.ops.bookmarks.list).toHaveBeenCalledTimes(2));
    resolveInitialBookmarks([bookmark('old')]);
    resolveInitialSnapshots([snapshot('old')]);
    await staleLoad;
    expect(engine.ops.bookmarks.delete).not.toHaveBeenCalled();

    resolveRefreshBookmarks([bookmark('a')]);
    resolveRefreshSnapshots([snapshot('s')]);
    await refresh;
    await mutation;
    expect(engine.ops.bookmarks.delete).toHaveBeenCalledWith('a');
  });

  it('coalesces exact bookmark and snapshot create intents before a rerender', async () => {
    const { engine } = fixture();
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();
    const bookmarkInput = {
      name: 'same',
      agentId: 'agent',
      oid: '1.3.6.1',
      operation: 'walk' as const,
    };
    const sharedResults: [] = [];
    const snapshotInput = {
      name: 'same',
      agentName: 'agent',
      baseOid: '1.3.6.1',
      results: sharedResults,
    };

    await Promise.all([
      controller.createBookmark(bookmarkInput),
      controller.createBookmark({ ...bookmarkInput }),
    ]);
    await Promise.all([
      controller.createSnapshot(snapshotInput),
      controller.createSnapshot({ ...snapshotInput, results: sharedResults }),
    ]);

    expect(engine.ops.bookmarks.create).toHaveBeenCalledTimes(1);
    expect(engine.ops.snapshots.create).toHaveBeenCalledTimes(1);
  });

  it('does not coalesce equal-count snapshots with different result content', async () => {
    const { engine } = fixture();
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();
    const input = {
      name: 'same metadata',
      agentName: 'agent',
      baseOid: '1.3.6.1',
    };
    const result = (value: string) => ({
      oid: '1.3.6.1.0',
      type: 4,
      typeName: 'OctetString',
      value,
      rawValue: value,
      isError: false,
    });

    await Promise.all([
      controller.createSnapshot({ ...input, results: [result('first')] }),
      controller.createSnapshot({ ...input, results: [result('second')] }),
    ]);

    expect(engine.ops.snapshots.create).toHaveBeenCalledTimes(2);
  });

  it('does not structurally coalesce distinct snapshot result arrays', async () => {
    const { engine } = fixture();
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();
    const metadata = {
      name: 'same metadata',
      agentName: 'agent',
      baseOid: '1.3.6.1',
    };
    const first = {
      oid: '1.3.6.1.0',
      type: 4,
      typeName: 'OctetString',
      value: 'same',
      rawValue: 'same',
      isError: false,
    };
    const second = {
      isError: false,
      rawValue: 'same',
      value: 'same',
      typeName: 'OctetString',
      type: 4,
      oid: '1.3.6.1.0',
    };

    await Promise.all([
      controller.createSnapshot({ ...metadata, results: [first] }),
      controller.createSnapshot({ ...metadata, results: [second] }),
    ]);

    expect(engine.ops.snapshots.create).toHaveBeenCalledTimes(2);
  });

  it('uses bounded results-array identity without traversing a large snapshot', async () => {
    const { engine } = fixture();
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();
    const large = new Array(100_000).fill(undefined);
    const results = new Proxy(large, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property))
          throw new Error('snapshot results were traversed');
        return Reflect.get(target, property, receiver);
      },
    });
    const input = {
      name: 'large',
      agentName: 'agent',
      baseOid: '1.3.6.1',
      results: results as never,
    };

    await Promise.all([controller.createSnapshot(input), controller.createSnapshot(input)]);

    expect(engine.ops.snapshots.create).toHaveBeenCalledTimes(1);
    const source = readFileSync(join(__dirname, 'query-artifact-collections.ts'), 'utf8');
    expect(source).toContain('WeakMap');
    expect(source).toContain(':results:${resultsId}');
    expect(source).not.toContain('stableSerialize(exactIntent)');
  });

  it('coalesces rapid duplicate bookmark and snapshot deletes before rerender', async () => {
    const { engine } = fixture();
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();

    await Promise.all([controller.deleteBookmark('a'), controller.deleteBookmark('a')]);
    await Promise.all([controller.deleteSnapshot('s'), controller.deleteSnapshot('s')]);

    expect(engine.ops.bookmarks.delete).toHaveBeenCalledTimes(1);
    expect(engine.ops.snapshots.delete).toHaveBeenCalledTimes(1);
  });

  it('rejects every queued command when the active command blocks the controller', async () => {
    const { engine } = fixture();
    vi.mocked(engine.ops.bookmarks.delete).mockRejectedValueOnce(new Error('permission denied'));
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();

    const first = controller.deleteBookmark('a');
    const second = controller.deleteSnapshot('s');
    await expect(first).rejects.toThrow('permission denied');
    await expect(second).rejects.toThrow(/blocked|rejected|permission denied/i);
    expect(controller.snapshot()).toMatchObject({ phase: 'error-reverted', queued: 0 });
    expect(engine.ops.snapshots.delete).not.toHaveBeenCalled();
  });

  it('restores confirmed state and clears active when ownership is lost during a write', async () => {
    const { engine } = fixture();
    let release!: () => void;
    let owns = true;
    vi.mocked(engine.ops.bookmarks.delete).mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();
    const pending = controller.deleteBookmark('a', () => owns);
    await vi.waitFor(() => expect(controller.snapshot().phase).toBe('updating'));
    owns = false;
    release();

    await expect(pending).rejects.toThrow(/ownership/);
    expect(controller.snapshot()).toMatchObject({
      bookmarks: [expect.objectContaining({ id: 'a' })],
      phase: 'confirmed',
      queued: 0,
      active: undefined,
    });
  });

  it('removes a queued ownership-lost command from visible state after the active write', async () => {
    const { engine, setBookmarks } = fixture();
    let release!: () => void;
    let ownsQueued = true;
    vi.mocked(engine.ops.bookmarks.delete).mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();
    const active = controller.deleteBookmark('a');
    await vi.waitFor(() => expect(controller.snapshot().phase).toBe('updating'));
    const queued = controller.deleteSnapshot('s', () => ownsQueued);
    expect(controller.snapshot().queued).toBe(1);
    ownsQueued = false;
    setBookmarks([]);
    release();

    await active;
    await expect(queued).rejects.toThrow(/ownership/);
    expect(controller.snapshot()).toMatchObject({ phase: 'success', queued: 0, active: undefined });
    expect(engine.ops.snapshots.delete).not.toHaveBeenCalled();
  });

  it('uses a returned create ID for confirmation despite backend normalization', async () => {
    const { engine } = fixture();
    const normalized = bookmark('server-id', 'SERVER NORMALIZED');
    vi.mocked(engine.ops.bookmarks.create).mockResolvedValueOnce(normalized);
    vi.mocked(engine.ops.bookmarks.list)
      .mockResolvedValueOnce([bookmark('a')])
      .mockResolvedValueOnce([normalized, bookmark('a')]);
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();

    await expect(
      controller.createBookmark({
        name: 'client value',
        agentId: 'agent',
        oid: '1.3.6.1',
        operation: 'walk',
      }),
    ).resolves.toBeUndefined();
    expect(controller.snapshot()).toMatchObject({ phase: 'success' });
  });

  it('does not attribute a concurrent equivalent to a different returned create ID', async () => {
    const { engine } = fixture();
    const returned = bookmark('returned', 'same');
    const concurrent = bookmark('concurrent', 'same');
    vi.mocked(engine.ops.bookmarks.create).mockResolvedValueOnce(returned);
    vi.mocked(engine.ops.bookmarks.list)
      .mockResolvedValueOnce([bookmark('a')])
      .mockResolvedValueOnce([concurrent, bookmark('a')]);
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();

    await expect(
      controller.createBookmark({
        name: 'same',
        agentId: 'agent',
        oid: '1.3.6.1',
        operation: 'walk',
      }),
    ).rejects.toThrow('Engine confirmation mismatch');
    expect(controller.snapshot()).toMatchObject({
      phase: 'conflict',
      bookmarks: expect.arrayContaining([expect.objectContaining({ id: 'concurrent' })]),
    });
  });

  it('preserves freshly read remote changes when an ambiguous intent is absent', async () => {
    const { engine } = fixture();
    const unrelated = bookmark('remote', 'unrelated');
    vi.mocked(engine.ops.bookmarks.create).mockRejectedValueOnce(new Error('Request timed out'));
    vi.mocked(engine.ops.bookmarks.list)
      .mockResolvedValueOnce([bookmark('a')])
      .mockResolvedValueOnce([unrelated, bookmark('a')]);
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();

    await expect(
      controller.createBookmark({
        name: 'missing',
        agentId: 'agent',
        oid: '1.3.6.1',
        operation: 'walk',
      }),
    ).rejects.toThrow('Request timed out');
    expect(controller.snapshot()).toMatchObject({
      phase: 'error-reverted',
      bookmarks: [expect.objectContaining({ id: 'remote' }), expect.objectContaining({ id: 'a' })],
    });
  });

  it('does not accept a stale normal confirmation read', async () => {
    const { engine } = fixture();
    let resolveOld!: (value: OperationBookmark[]) => void;
    vi.mocked(engine.ops.bookmarks.list)
      .mockResolvedValueOnce([bookmark('a')])
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce([bookmark('newer')]);
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();
    const pending = controller.createBookmark({
      name: 'b',
      agentId: 'agent',
      oid: '1.3.6.1',
      operation: 'walk',
    });
    await vi.waitFor(() => expect(engine.ops.bookmarks.list).toHaveBeenCalledTimes(2));
    await controller.refresh();
    resolveOld([bookmark('old-confirmation')]);

    await expect(pending).rejects.toThrow(/stale/i);
    expect(controller.snapshot()).toMatchObject({
      phase: 'uncertain',
      bookmarks: [expect.objectContaining({ id: 'newer' })],
    });
  });

  it('does not accept a stale ambiguous confirmation read', async () => {
    const { engine } = fixture();
    let resolveOld!: (value: OperationBookmark[]) => void;
    vi.mocked(engine.ops.bookmarks.create).mockRejectedValueOnce(new Error('Request timed out'));
    vi.mocked(engine.ops.bookmarks.list)
      .mockResolvedValueOnce([bookmark('a')])
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce([bookmark('newer')]);
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();
    const pending = controller.createBookmark({
      name: 'late',
      agentId: 'agent',
      oid: '1.3.6.1',
      operation: 'walk',
    });
    await vi.waitFor(() => expect(engine.ops.bookmarks.list).toHaveBeenCalledTimes(2));
    await controller.refresh();
    resolveOld([bookmark('late', 'late'), bookmark('a')]);

    await expect(pending).rejects.toThrow(/stale/i);
    expect(controller.snapshot()).toMatchObject({
      phase: 'uncertain',
      bookmarks: [expect.objectContaining({ id: 'newer' })],
    });
  });

  it('does not let a stale reconcile failure overwrite a newer refresh', async () => {
    const { engine } = fixture();
    vi.mocked(engine.ops.bookmarks.create).mockRejectedValueOnce(new Error('Request timed out'));
    vi.mocked(engine.ops.bookmarks.list)
      .mockResolvedValueOnce([bookmark('a')])
      .mockRejectedValueOnce(new Error('confirmation unavailable'));
    const controller = new QueryArtifactCollectionsController(engine);
    await controller.load();
    await expect(
      controller.createBookmark({
        name: 'late',
        agentId: 'agent',
        oid: '1.3.6.1',
        operation: 'walk',
      }),
    ).rejects.toThrow();
    let rejectOld!: (cause: unknown) => void;
    vi.mocked(engine.ops.bookmarks.list)
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectOld = reject)))
      .mockResolvedValueOnce([bookmark('newer')]);

    const reconcile = controller.reconcile();
    await vi.waitFor(() => expect(engine.ops.bookmarks.list).toHaveBeenCalledTimes(3));
    await controller.refresh();
    rejectOld(new Error('old reconcile failed'));
    await expect(reconcile).rejects.toThrow('old reconcile failed');

    expect(controller.snapshot().bookmarks).toEqual([bookmark('newer')]);
    expect(controller.snapshot().error).not.toBe('old reconcile failed');
  });

  it('announces saved-work transaction status through a polite live region', () => {
    const source = readFileSync(join(__dirname, 'screens', 'QueryScreen.tsx'), 'utf8');
    expect(source).toContain('accessibilityLiveRegion="polite"');
    expect(source).toContain('role="status"');
  });

  it('captures mounted engine ownership for creates and gates effect activation', () => {
    const source = readFileSync(join(__dirname, 'screens', 'QueryScreen.tsx'), 'utf8');
    expect(source).toMatch(/\.createBookmark\(\s*\{[\s\S]*?\}\s*,\s*ownsEngine\s*,?\s*\)/);
    expect(source).toMatch(/\.createSnapshot\(\s*\{[\s\S]*?\}\s*,\s*ownsEngine\s*,?\s*\)/);
    expect(source).toContain('artifactController.activate(ownsEngine)');
  });

  it('cannot reactivate a disposed controller without engine ownership', async () => {
    const { engine } = fixture();
    const controller = new QueryArtifactCollectionsController(engine);
    controller.dispose();

    controller.activate(() => false);
    await controller.load();

    await expect(
      controller.createBookmark(
        { name: 'late', agentId: 'agent', oid: '1.3.6.1', operation: 'walk' },
        () => false,
      ),
    ).rejects.toThrow(/ownership|disposed/);
    expect(engine.ops.bookmarks.list).not.toHaveBeenCalled();
    expect(engine.ops.bookmarks.create).not.toHaveBeenCalled();
  });
});
