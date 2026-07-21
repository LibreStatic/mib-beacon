import { describe, expect, it, vi } from 'vitest';
import type { EngineAPI, ResolverSourceDraft, SourceConfig } from '@mibbeacon/core/client';
import {
  ResolverSourceCollectionController,
  resolverSourceEditorRecovery,
} from './resolver-source-collection';

const cache = (priority = 0): SourceConfig => ({
  id: 'cache',
  kind: 'cache',
  name: 'Cache',
  enabled: true,
  priority,
  builtIn: true,
});
const source = (id: string, priority: number, enabled = true): SourceConfig => ({
  id,
  kind: 'http-template',
  name: id,
  enabled,
  priority,
  urlTemplate: `https://${id}/{module}`,
  builtIn: false,
  authKind: 'none',
});
const draft = (id: string, secrets = false): ResolverSourceDraft => ({
  config: source(id, 1),
  ...(secrets ? { secrets: { token: 'TOP-SECRET', password: 'PASSWORD' } } : {}),
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function engine(overrides: Partial<EngineAPI['resolver']['sources']> = {}) {
  const list = vi.fn(async () => [cache(), source('a', 1)]);
  const sources = {
    list,
    create: vi.fn(async (value: ResolverSourceDraft) => value.config),
    update: vi.fn(async (_id: string, value: ResolverSourceDraft) => value.config),
    remove: vi.fn(async () => undefined),
    reorder: vi.fn(async (ids: string[]) =>
      ids.map((id, index) => (id === 'cache' ? cache(index) : source(id, index))),
    ),
    importCustom: vi.fn(async () => [source('imported', 1)]),
    test: vi.fn(),
    preview: vi.fn(),
    exportCustom: vi.fn(),
    ...overrides,
  };
  return { resolver: { sources } } as unknown as EngineAPI;
}

describe('ResolverSourceCollectionController', () => {
  it('gates mutations until an authoritative initial load succeeds', async () => {
    const pending = deferred<SourceConfig[]>();
    const api = engine({ list: vi.fn(() => pending.promise) });
    const controller = new ResolverSourceCollectionController(api);
    const mutation = controller.create(draft('b'));
    expect(controller.snapshot().readiness.phase).toBe('unloaded');
    expect(api.resolver.sources.create).not.toHaveBeenCalled();
    pending.resolve([cache(), source('a', 1)]);
    await controller.load();
    await mutation;
    expect(api.resolver.sources.create).toHaveBeenCalledTimes(1);
  });

  it('serializes rapid mixed mutations and computes reorder from the latest confirmed collection', async () => {
    const first = deferred<SourceConfig>();
    let remote = [cache(), source('a', 1)];
    const api = engine({
      list: vi.fn(async () => remote),
      create: vi.fn(async (value) => {
        const created = await first.promise;
        remote = [...remote, created];
        return value.config;
      }),
      update: vi.fn(async (id, value) => {
        remote = remote.map((item) => (item.id === id ? value.config : item));
        return value.config;
      }),
      reorder: vi.fn(async (ids) => {
        remote = ids.map((id, index) => ({
          ...remote.find((item) => item.id === id)!,
          priority: index,
        }));
        return remote;
      }),
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    const one = controller.create(draft('b'));
    const two = controller.toggle('a');
    const three = controller.move('a', 1);
    expect(controller.snapshot().phase).toBe('updating');
    expect(controller.snapshot().queued).toBe(2);
    expect(api.resolver.sources.update).not.toHaveBeenCalled();
    first.resolve(source('b', 2));
    await Promise.all([one, two, three]);
    expect(api.resolver.sources.update).toHaveBeenCalledTimes(1);
    expect(api.resolver.sources.reorder).toHaveBeenCalledWith(['cache', 'b', 'a']);
  });

  it('restores confirmed sources after an authoritative rejection and requires acknowledgement', async () => {
    const api = engine({
      remove: vi.fn(async () => {
        throw new Error('validation rejected');
      }),
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    await expect(controller.remove('a')).rejects.toThrow('validation rejected');
    expect(controller.snapshot()).toMatchObject({
      phase: 'error-reverted',
      confirmed: [cache(), source('a', 1)],
    });
    controller.acknowledge();
    expect(controller.snapshot().phase).toBe('confirmed');
  });

  it('prepends a rebuilt retry ahead of commands queued behind a rejected mutation', async () => {
    let attempts = 0;
    let remote = [cache(), source('a', 1), source('b', 2)];
    const order: string[] = [];
    const api = engine({
      list: vi.fn(async () => remote),
      remove: vi.fn(async () => {
        attempts += 1;
        order.push(`remove-${attempts}`);
        if (attempts === 1) throw new Error('rejected');
        remote = remote.filter((item) => item.id !== 'a');
      }),
      update: vi.fn(async (id, value) => {
        order.push(`toggle-${id}`);
        remote = remote.map((item) => (item.id === id ? value.config : item));
        return value.config;
      }),
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    const rejected = controller.remove('a');
    const queued = controller.toggle('b');
    await expect(rejected).rejects.toThrow('rejected');
    controller.prepareRetry();
    await controller.remove('a', true);
    await queued;
    expect(order).toEqual(['remove-1', 'remove-2', 'toggle-b']);
  });

  it('reconciles an ambiguous success by reading the raw authoritative list', async () => {
    let remote = [cache(), source('a', 1)];
    const api = engine({
      list: vi.fn(async () => remote),
      update: vi.fn(async (_id, value) => {
        remote = [cache(), value.config];
        throw new Error('network disconnected');
      }),
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    await controller.toggle('a');
    expect(controller.snapshot().phase).toBe('success');
    expect(controller.snapshot().confirmed.find((item) => item.id === 'a')?.enabled).toBe(false);
  });

  it('matches ambiguous create and import outcomes against their projected collections', async () => {
    let remote = [cache(), source('a', 1)];
    const api = engine({
      list: vi.fn(async () => remote),
      create: vi.fn(async (value) => {
        remote = [...remote, value.config];
        throw new Error('connection outcome unknown');
      }),
      importCustom: vi.fn(async (serialized) => {
        const parsed = JSON.parse(serialized) as { sources: SourceConfig[] };
        remote = [
          ...remote.filter((item) => !parsed.sources.some((next) => next.id === item.id)),
          ...parsed.sources,
        ];
        throw new Error('network disconnected');
      }),
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    await controller.create(draft('b'));
    expect(controller.snapshot().phase).toBe('success');
    await controller.importCustom(JSON.stringify({ sources: [source('c', 3)] }));
    expect(controller.snapshot().phase).toBe('success');
    expect(controller.snapshot().confirmed.map((item) => item.id)).toEqual([
      'cache',
      'a',
      'b',
      'c',
    ]);
  });

  it('matches ambiguous move and drag outcomes against projected ordering', async () => {
    let remote = [cache(), source('a', 1), source('b', 2)];
    const api = engine({
      list: vi.fn(async () => remote),
      reorder: vi.fn(async (ids) => {
        remote = ids.map((id, priority) => ({
          ...remote.find((item) => item.id === id)!,
          priority,
        }));
        throw new Error('transport outcome unknown');
      }),
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    await controller.move('a', 1);
    expect(controller.snapshot()).toMatchObject({ phase: 'success' });
    expect(controller.snapshot().confirmed.map((item) => item.id)).toEqual(['cache', 'b', 'a']);
    await controller.drag('a', 0);
    expect(controller.snapshot()).toMatchObject({ phase: 'success' });
    expect(controller.snapshot().confirmed.map((item) => item.id)).toEqual(['cache', 'a', 'b']);
  });

  it('exposes conflict when ambiguous reconciliation differs, and uncertainty when reconciliation fails', async () => {
    let reads = 0;
    const api = engine({
      list: vi.fn(async () => {
        reads += 1;
        if (reads === 1) return [cache(), source('a', 1)];
        return [cache(), source('remote', 1)];
      }),
      remove: vi.fn(async () => {
        throw new Error('timeout');
      }),
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    await controller.remove('a');
    expect(controller.snapshot().phase).toBe('conflict');

    const broken = engine({
      list: vi
        .fn()
        .mockResolvedValueOnce([cache(), source('a', 1)])
        .mockRejectedValue(new Error('offline')),
      remove: vi.fn(async () => {
        throw new Error('timeout');
      }),
    });
    const uncertain = new ResolverSourceCollectionController(broken);
    await uncertain.load();
    await uncertain.remove('a');
    expect(uncertain.snapshot().phase).toBe('uncertain');
  });

  it('defers an event during a write and does not let a stale refresh overwrite the post-write authority', async () => {
    const write = deferred<void>();
    let remote = [cache(), source('a', 1)];
    const api = engine({
      list: vi.fn(async () => remote),
      remove: vi.fn(async () => {
        await write.promise;
        remote = [cache()];
      }),
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    const removing = controller.remove('a');
    controller.applyAuthority([cache(), source('stale-event', 1)], 'event');
    write.resolve();
    await removing;
    expect(controller.snapshot().confirmed).toEqual([cache()]);
  });

  it('rejects a refresh begun before a mutation when it settles after the post-write authority', async () => {
    let remote = [cache(), source('a', 1)];
    const api = engine({
      list: vi.fn(async () => remote),
      remove: vi.fn(async () => {
        remote = [cache()];
      }),
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    const staleToken = controller.beginAuthorityRead();
    const stale = [cache(), source('a', 1), source('stale', 2)];
    await controller.remove('a');
    controller.applyAuthority(stale, 'refresh', staleToken);
    expect(controller.snapshot().confirmed).toEqual([cache()]);
  });

  it('settles with the newest authority when lists arrive while the post-write read is pending', async () => {
    const postWrite = deferred<SourceConfig[]>();
    let reads = 0;
    const api = engine({
      list: vi.fn(async () => {
        reads += 1;
        return reads === 1 ? [cache(), source('a', 1)] : postWrite.promise;
      }),
      remove: vi.fn(async () => undefined),
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    const removing = controller.remove('a');
    await vi.waitFor(() => expect(api.resolver.sources.list).toHaveBeenCalledTimes(2));
    controller.applyAuthority([cache(), source('event-newer', 1)], 'event');
    postWrite.resolve([cache()]);
    await removing;
    expect(controller.snapshot()).toMatchObject({ phase: 'success', queued: 0 });
    expect(controller.snapshot().confirmed.map((item) => item.id)).toEqual([
      'cache',
      'event-newer',
    ]);

    const oldPostWrite = deferred<SourceConfig[]>();
    reads = 0;
    const olderApi = engine({
      list: vi.fn(async () => {
        reads += 1;
        return reads === 1 ? [cache(), source('a', 1)] : oldPostWrite.promise;
      }),
      remove: vi.fn(async () => undefined),
    });
    const older = new ResolverSourceCollectionController(olderApi);
    await older.load();
    const staleToken = older.beginAuthorityRead();
    const oldRemoving = older.remove('a');
    await vi.waitFor(() => expect(olderApi.resolver.sources.list).toHaveBeenCalledTimes(2));
    older.applyAuthority([cache(), source('stale', 1)], 'refresh', staleToken);
    oldPostWrite.resolve([cache()]);
    await oldRemoving;
    expect(older.snapshot()).toMatchObject({ phase: 'success', queued: 0 });
    expect(older.snapshot().confirmed).toEqual([cache()]);
  });

  it('flushes authority applied immediately after an awaited successful mutation', async () => {
    let remote = [cache(), source('a', 1)];
    const controller = new ResolverSourceCollectionController(
      engine({
        list: vi.fn(async () => remote),
        remove: vi.fn(async () => {
          remote = [cache()];
        }),
      }),
    );
    await controller.load();
    await controller.remove('a');
    controller.applyAuthority([cache(), source('after-await', 1)], 'event');
    await vi.waitFor(() =>
      expect(controller.snapshot().confirmed.map((item) => item.id)).toEqual([
        'cache',
        'after-await',
      ]),
    );
    expect(controller.snapshot()).toMatchObject({ phase: 'confirmed', queued: 0 });
  });

  it('does not let a stale initial load overwrite a newer resolver event', async () => {
    const pending = deferred<SourceConfig[]>();
    const controller = new ResolverSourceCollectionController(
      engine({ list: vi.fn(() => pending.promise) }),
    );
    const loading = controller.load();
    controller.applyAuthority([cache(), source('event', 1)], 'event');
    pending.resolve([cache(), source('stale-load', 1)]);
    await loading;
    expect(controller.snapshot().confirmed.map((item) => item.id)).toEqual(['cache', 'event']);
  });

  it('resumes queued commands after explicit reconciliation clears uncertainty', async () => {
    let reads = 0;
    let remote = [cache(), source('a', 1), source('b', 2)];
    const api = engine({
      list: vi.fn(async () => {
        reads += 1;
        if (reads === 2) throw new Error('offline');
        return remote;
      }),
      remove: vi.fn(async () => {
        remote = remote.filter((item) => item.id !== 'a');
        throw new Error('timeout');
      }),
      update: vi.fn(async (id, value) => {
        remote = remote.map((item) => (item.id === id ? value.config : item));
        return value.config;
      }),
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    const uncertain = controller.remove('a');
    const queued = controller.toggle('b');
    await uncertain;
    expect(controller.snapshot()).toMatchObject({ phase: 'uncertain', queued: 1 });
    await controller.reconcile();
    await queued;
    expect(controller.snapshot().phase).toBe('success');
    expect(controller.snapshot().confirmed.find((item) => item.id === 'b')?.enabled).toBe(false);
  });

  it('applies import results through the same queue and authoritative sink', async () => {
    let remote = [cache(), source('a', 1)];
    const api = engine({
      importCustom: vi.fn(async () => {
        remote = [cache(), source('a', 1), source('imported', 2)];
        return remote.slice(1);
      }),
      list: vi.fn(async () => remote),
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    await controller.importCustom('{"sources":[]}');
    expect(controller.snapshot().confirmed.map((item) => item.id)).toEqual([
      'cache',
      'a',
      'imported',
    ]);
  });

  it('reconciles a partial import even when the terminal error is authoritative', async () => {
    let remote = [cache(), source('a', 1)];
    const api = engine({
      list: vi.fn(async () => remote),
      importCustom: vi.fn(async () => {
        remote = [...remote, source('partial', 2)];
        throw new Error('second imported source rejected');
      }),
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    await expect(
      controller.importCustom(JSON.stringify({ sources: [source('partial', 2)] })),
    ).rejects.toThrow('second imported source rejected');
    expect(controller.snapshot()).toMatchObject({ phase: 'conflict' });
    expect(controller.snapshot().confirmed.map((item) => item.id)).toEqual([
      'cache',
      'a',
      'partial',
    ]);
  });

  it('keeps an authoritative import failure uncertain when reconciliation also fails', async () => {
    const api = engine({
      list: vi
        .fn()
        .mockResolvedValueOnce([cache(), source('a', 1)])
        .mockRejectedValueOnce(new Error('reconciliation offline')),
      importCustom: vi.fn(async () => {
        throw new Error('import rejected after possible partial write');
      }),
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    await expect(controller.importCustom('{"sources":[]}')).rejects.toThrow('import rejected');
    expect(controller.snapshot()).toMatchObject({ phase: 'uncertain' });
  });

  it('treats a failed mandatory post-write authority read as uncertain and preserves the queue', async () => {
    let reads = 0;
    let remote = [cache(), source('a', 1), source('b', 2)];
    const update = vi.fn(async (id, value) => {
      remote = remote.map((item) => (item.id === id ? value.config : item));
      return value.config;
    });
    const api = engine({
      list: vi.fn(async () => {
        reads += 1;
        if (reads === 2) throw new Error('authority read rejected');
        return remote;
      }),
      remove: vi.fn(async () => {
        remote = remote.filter((item) => item.id !== 'a');
      }),
      update,
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    const removed = controller.remove('a');
    const queued = controller.toggle('b');
    await removed;
    expect(controller.snapshot()).toMatchObject({ phase: 'uncertain', queued: 1 });
    expect(update).not.toHaveBeenCalled();
    await controller.reconcile();
    await queued;
    expect(controller.snapshot().phase).toBe('success');
  });

  it('drops queued commands whose captured ownership became stale without remote writes or hangs', async () => {
    const first = deferred<SourceConfig>();
    let remote = [cache(), source('a', 1)];
    const update = vi.fn();
    const api = engine({
      list: vi.fn(async () => remote),
      create: vi.fn(async () => {
        const created = await first.promise;
        remote = [...remote, created];
        return created;
      }),
      update,
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    const active = controller.create(draft('b'));
    let queuedOwns = true;
    const stale = controller.toggle('a', () => queuedOwns);
    queuedOwns = false;
    first.resolve(source('b', 2));
    await active;
    await expect(stale).rejects.toThrow(/ownership/i);
    expect(update).not.toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({ queued: 0 });
  });

  it('correlates editor retry only to its locally rejected command', async () => {
    const controller = new ResolverSourceCollectionController(engine());
    await controller.load();
    const state = {
      ...controller.snapshot(),
      phase: 'error-reverted' as const,
      failedCommand: 'toggle:other',
      error: 'toggle rejected',
      queued: 1,
    };
    expect(resolverSourceEditorRecovery(state, 'update:edited', true, false)).toBe(
      'acknowledge-queued',
    );
    expect(
      resolverSourceEditorRecovery(
        { ...state, failedCommand: 'update:edited' },
        'update:edited',
        true,
        false,
      ),
    ).toBe('retry-local');
    expect(resolverSourceEditorRecovery(state, 'update:edited', true, true)).toBe(
      'acknowledge-queued',
    );
  });

  it('acknowledges an unrelated toggle failure and resumes the original queued create once', async () => {
    let remote = [cache(), source('a', 1)];
    const create = vi.fn(async (value: ResolverSourceDraft) => {
      remote = [...remote, value.config];
      return value.config;
    });
    const api = engine({
      list: vi.fn(async () => remote),
      update: vi.fn(async () => {
        throw new Error('toggle rejected');
      }),
      create,
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    const toggle = controller.toggle('a');
    const queuedCreate = controller.create(draft('b'));
    await expect(toggle).rejects.toThrow('toggle rejected');
    expect(controller.snapshot()).toMatchObject({
      phase: 'error-reverted',
      failedCommand: 'toggle:a',
      queued: 1,
    });
    controller.acknowledge();
    await queuedCreate;
    expect(create).toHaveBeenCalledOnce();
    expect(controller.snapshot().confirmed.map((item) => item.id)).toContain('b');
  });

  it('disposal prevents an old engine response from reaching its sink', async () => {
    const pending = deferred<SourceConfig[]>();
    const sink = vi.fn();
    const controller = new ResolverSourceCollectionController(
      engine({ list: vi.fn(() => pending.promise) }),
      sink,
    );
    const loading = controller.load();
    controller.dispose();
    pending.resolve([cache(), source('old', 1)]);
    await loading;
    expect(sink).not.toHaveBeenCalled();
  });

  it('can reactivate the same retained controller after Strict Mode cleanup', async () => {
    const api = engine();
    const controller = new ResolverSourceCollectionController(api);
    controller.dispose();
    const replayListener = vi.fn();
    controller.subscribe(replayListener);
    controller.activate();
    await controller.load();
    expect(controller.snapshot().readiness.phase).toBe('ready');
    expect(controller.snapshot().confirmed.map((item) => item.id)).toEqual(['cache', 'a']);
    expect(replayListener).toHaveBeenCalled();
  });

  it('redacts secrets from snapshots and errors', async () => {
    const api = engine({
      create: vi.fn(async () => {
        throw new Error('failed TOP-SECRET PASSWORD');
      }),
    });
    const controller = new ResolverSourceCollectionController(api);
    await controller.load();
    await expect(controller.create(draft('secret', true))).rejects.toThrow();
    expect(JSON.stringify(controller.snapshot())).not.toMatch(/TOP-SECRET|PASSWORD/);

    const malformed = '{"token":"PASTED-SECRET", invalid';
    const importing = new ResolverSourceCollectionController(
      engine({
        importCustom: vi.fn(async () => {
          throw new Error(`invalid import ${malformed}`);
        }),
      }),
    );
    await importing.load();
    await expect(importing.importCustom(malformed)).rejects.toThrow('[REDACTED]');
    expect(JSON.stringify(importing.snapshot())).not.toContain('PASTED-SECRET');

    const nested = JSON.stringify({
      sources: [],
      secrets: { headers: { 'X-Api-Key': 'NESTED-HEADER-SECRET' } },
    });
    const nestedImport = new ResolverSourceCollectionController(
      engine({
        importCustom: vi.fn(async () => {
          throw new Error(`invalid ${nested}`);
        }),
      }),
    );
    await nestedImport.load();
    await expect(nestedImport.importCustom(nested)).rejects.toThrow('[REDACTED]');
    expect(JSON.stringify(nestedImport.snapshot())).not.toContain('NESTED-HEADER-SECRET');

    const malformedHeaders =
      '{"sources":[],"secrets":{"headers":{"X-Api-Key":"BROKEN-NESTED-SECRET"}, invalid';
    const malformedNested = new ResolverSourceCollectionController(
      engine({
        importCustom: vi.fn(async () => {
          throw new Error(`invalid ${malformedHeaders}`);
        }),
      }),
    );
    await malformedNested.load();
    await expect(malformedNested.importCustom(malformedHeaders)).rejects.toThrow('[REDACTED]');
    expect(JSON.stringify(malformedNested.snapshot())).not.toContain('BROKEN-NESTED-SECRET');

    const singleQuoted = "{'headers':{'X-Api-Key':'LEAK-SINGLE', invalid";
    const singleQuotedImport = new ResolverSourceCollectionController(
      engine({
        importCustom: vi.fn(async () => {
          throw new Error(`invalid ${singleQuoted}`);
        }),
      }),
    );
    await singleQuotedImport.load();
    await expect(singleQuotedImport.importCustom(singleQuoted)).rejects.toThrow('[REDACTED]');
    expect(JSON.stringify(singleQuotedImport.snapshot())).not.toContain('LEAK-SINGLE');
  });

  it('normalizes cache first and stable contiguous priorities for every authority input', async () => {
    const controller = new ResolverSourceCollectionController(engine());
    await controller.load();
    controller.applyAuthority([source('b', 9), cache(7), source('a', -2)], 'refresh');
    expect(controller.snapshot().confirmed.map(({ id, priority }) => [id, priority])).toEqual([
      ['cache', 0],
      ['b', 1],
      ['a', 2],
    ]);
  });
});
