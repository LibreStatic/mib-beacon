import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  EngineAPI,
  NotificationPayload,
  TrapRule,
  TrapRuleDraft,
  TrapSavedFilter,
  TrapSendPreset,
  TrapV3UserDraft,
  TrapV3UserProfile,
} from '@mibbeacon/core/client';
import {
  TrapPersistentCollectionsController,
  trapCollectionStatusText,
} from './trap-persistent-collections';

const filter = (id: string, name = id, query = {}): TrapSavedFilter => ({
  id,
  name,
  query,
  createdAt: 1,
  updatedAt: 1,
});
const user = (name: string, patch: Partial<TrapV3UserProfile> = {}): TrapV3UserProfile => ({
  name,
  level: 'authNoPriv',
  authProtocol: 'sha',
  hasAuthKey: true,
  hasPrivKey: false,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});
const rule = (id: string, patch: Partial<TrapRule> = {}): TrapRule => ({
  id,
  name: id,
  enabled: true,
  priority: 10,
  condition: { trapOidGlob: '*' },
  actions: { severity: 'warning' },
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});
const payload: NotificationPayload = { kind: 'trap', trapOid: '1.3.6.1', varbinds: [] };
const preset = (id: string, name = id): TrapSendPreset => ({
  id,
  name,
  agentId: 'agent',
  payload,
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
  let filters = [filter('f')];
  let users = [user('u')];
  let rules = [rule('r')];
  let presets = [preset('p')];
  const savedFilters = {
    list: vi.fn(async () => filters),
    save: vi.fn(async (name: string, query: TrapSavedFilter['query']) => {
      const current = filters.find((item) => item.name === name.trim());
      const saved = filter(current?.id ?? `f-${name}`, name.trim(), query);
      filters = [...filters.filter((item) => item.name !== saved.name), saved];
      return saved;
    }),
    remove: vi.fn(async (id: string) => {
      filters = filters.filter((item) => item.id !== id);
    }),
  };
  const v3Users = {
    list: vi.fn(async () => users),
    upsert: vi.fn(async (draft: TrapV3UserDraft) => {
      const current = users.find((item) => item.name === draft.name.trim());
      const saved = user(draft.name.trim(), {
        ...current,
        level: draft.level,
        authProtocol: draft.authProtocol,
        privProtocol: draft.privProtocol,
        hasAuthKey:
          draft.authKey !== undefined
            ? Boolean(draft.authKey)
            : draft.clearAuthKey
              ? false
              : Boolean(current?.hasAuthKey),
        hasPrivKey:
          draft.privKey !== undefined
            ? Boolean(draft.privKey)
            : draft.clearPrivKey
              ? false
              : Boolean(current?.hasPrivKey),
      });
      users = [...users.filter((item) => item.name !== saved.name), saved];
      return saved;
    }),
    remove: vi.fn(async (name: string) => {
      users = users.filter((item) => item.name !== name);
    }),
  };
  const ruleApi = {
    list: vi.fn(async () => rules),
    create: vi.fn(async (draft: TrapRuleDraft) => {
      const saved = rule(`r-${draft.name}`, {
        ...draft,
        name: draft.name.trim(),
        priority: Math.trunc(draft.priority),
      });
      rules = [...rules, saved];
      return saved;
    }),
    update: vi.fn(async (id: string, patch: Partial<TrapRuleDraft>) => {
      rules = rules.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              name: patch.name?.trim() ?? item.name,
              priority: patch.priority === undefined ? item.priority : Math.trunc(patch.priority),
            }
          : item,
      );
      return rules.find((item) => item.id === id)!;
    }),
    remove: vi.fn(async (id: string) => {
      rules = rules.filter((item) => item.id !== id);
    }),
  };
  const presetApi = {
    list: vi.fn(async () => presets),
    save: vi.fn(async (name: string, agentId: string, nextPayload: NotificationPayload) => {
      const current = presets.find((item) => item.name === name.trim());
      const saved = {
        ...preset(current?.id ?? `p-${name}`, name.trim()),
        agentId,
        payload: nextPayload,
      };
      presets = [...presets.filter((item) => item.name !== saved.name), saved];
      return saved;
    }),
    remove: vi.fn(async (id: string) => {
      presets = presets.filter((item) => item.id !== id);
    }),
  };
  const engine = {
    traps: { savedFilters, v3Users, rules: ruleApi, presets: presetApi },
  } as unknown as EngineAPI;
  return {
    engine,
    api: { savedFilters, v3Users, rules: ruleApi, presets: presetApi },
    get: () => ({ savedFilters: filters, v3Users: users, rules, presets }),
    set: (next: Partial<ReturnType<typeof emptyRemote>>) => {
      filters = next.savedFilters ?? filters;
      users = next.v3Users ?? users;
      rules = next.rules ?? rules;
      presets = next.presets ?? presets;
    },
  };
}
function emptyRemote() {
  return {
    savedFilters: [] as TrapSavedFilter[],
    v3Users: [] as TrapV3UserProfile[],
    rules: [] as TrapRule[],
    presets: [] as TrapSendPreset[],
  };
}

describe('TrapPersistentCollectionsController', () => {
  it.each([
    ['error-reverted', 'reverted'],
    ['uncertain', 'uncertain'],
    ['conflict', 'conflict'],
  ] as const)('humanizes the %s collection status', (phase, expected) => {
    expect(
      trapCollectionStatusText({
        savedFilters: [],
        v3Users: [],
        rules: [],
        presets: [],
        readiness: { phase: 'ready' },
        phase,
        queued: 0,
        error: 'remote rejected the change',
      }),
    ).toContain(expected);
  });
  it('renders active and queued persistent changes together', () => {
    expect(
      trapCollectionStatusText({
        ...emptyRemote(),
        readiness: { phase: 'ready' },
        phase: 'updating',
        active: 'rule:update:r',
        queued: 2,
      }),
    ).toBe('Updating rule:update:r… · 2 queued');
  });

  it('keeps queued intent visible during initial loading and readiness failure', async () => {
    const api = fixture();
    const loading = deferred<TrapSavedFilter[]>();
    api.api.savedFilters.list.mockImplementationOnce(() => loading.promise);
    const controller = new TrapPersistentCollectionsController(api.engine);
    const queued = controller.removeFilter('f');
    expect(trapCollectionStatusText(controller.snapshot())).toContain('1 queued');
    loading.reject(new Error('offline'));
    await expect(controller.load()).rejects.toThrow('offline');
    expect(trapCollectionStatusText(controller.snapshot())).toBe('offline · 1 queued');
    await controller.load();
    await queued;
  });

  it('gates mixed-domain FIFO writes on the initial raw authority load', async () => {
    const api = fixture();
    const loading = deferred<TrapSavedFilter[]>();
    api.api.savedFilters.list.mockImplementationOnce(() => loading.promise);
    const controller = new TrapPersistentCollectionsController(api.engine);
    const first = controller.removeFilter('f');
    const second = controller.updateRule('r', { enabled: false });
    expect(api.api.savedFilters.remove).not.toHaveBeenCalled();
    loading.resolve([filter('f')]);
    await Promise.all([first, second]);
    expect(api.api.savedFilters.remove.mock.invocationCallOrder[0]).toBeLessThan(
      api.api.rules.update.mock.invocationCallOrder[0]!,
    );
  });

  it('does not let an older overlapping refresh replace newer event authority', async () => {
    const api = fixture();
    const stale = deferred<TrapSavedFilter[]>();
    api.api.savedFilters.list.mockImplementationOnce(() => stale.promise);
    const controller = new TrapPersistentCollectionsController(api.engine);
    const refresh = controller.refresh();
    controller.applyAuthority({ ...api.get(), savedFilters: [filter('newer')] }, 'event');
    stale.resolve([filter('stale')]);
    await refresh;
    expect(controller.snapshot().savedFilters.map((item) => item.id)).toEqual(['newer']);
  });

  it('does not publish older load or refresh errors over newer event authority', async () => {
    const loadApi = fixture();
    const loadFailure = deferred<TrapSavedFilter[]>();
    loadApi.api.savedFilters.list.mockImplementationOnce(() => loadFailure.promise);
    const loading = new TrapPersistentCollectionsController(loadApi.engine);
    const load = loading.load();
    loading.applyAuthority({ ...loadApi.get(), savedFilters: [filter('event')] }, 'event');
    loadFailure.reject(new Error('stale load failure'));
    await expect(load).rejects.toThrow('stale load failure');
    expect(loading.snapshot()).toMatchObject({ readiness: { phase: 'ready' } });
    expect(loading.snapshot().savedFilters.map((item) => item.id)).toEqual(['event']);

    const refreshApi = fixture();
    const controller = new TrapPersistentCollectionsController(refreshApi.engine);
    await controller.load();
    const refreshFailure = deferred<TrapSavedFilter[]>();
    refreshApi.api.savedFilters.list.mockImplementationOnce(() => refreshFailure.promise);
    const refresh = controller.refresh();
    controller.applyAuthority({ ...refreshApi.get(), savedFilters: [filter('event')] }, 'event');
    refreshFailure.reject(new Error('stale refresh failure'));
    await expect(refresh).rejects.toThrow('stale refresh failure');
    expect(controller.snapshot()).toMatchObject({ readiness: { phase: 'ready' } });
    expect(controller.snapshot().savedFilters.map((item) => item.id)).toEqual(['event']);
  });

  it('survives retained Strict replay order dispose then activate then load', async () => {
    const api = fixture();
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    controller.dispose();
    controller.activate();
    await controller.load();
    await controller.removeV3User('u');
    expect(controller.snapshot().v3Users).toEqual([]);
  });

  it('treats filter and preset saves as trimmed-name upserts, not duplicate creates', async () => {
    const api = fixture();
    api.set({
      savedFilters: [filter('same-id', 'named', { unread: true })],
      presets: [preset('same-preset', 'named')],
    });
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    await controller.saveFilter('named', { unread: false });
    await controller.savePreset('named', 'agent-2', payload);
    expect(controller.snapshot().savedFilters).toHaveLength(1);
    expect(controller.snapshot().savedFilters[0]).toMatchObject({
      id: 'same-id',
      name: 'named',
      query: { unread: false },
    });
    expect(controller.snapshot().presets).toHaveLength(1);
    expect(controller.snapshot().presets[0]).toMatchObject({
      id: 'same-preset',
      agentId: 'agent-2',
    });
  });

  it('rolls back an authoritative rejection and keeps the following command queued', async () => {
    const api = fixture();
    api.api.rules.remove.mockRejectedValueOnce(new Error('validation rejected'));
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    const failed = controller.removeRule('r');
    const queued = controller.removePreset('p');
    await expect(failed).rejects.toThrow('validation rejected');
    expect(controller.snapshot()).toMatchObject({
      phase: 'error-reverted',
      failedCommand: 'rule:remove:r',
      queued: 1,
    });
    expect(controller.snapshot().rules.map((item) => item.id)).toEqual(['r']);
    controller.acknowledge();
    await queued;
  });

  it('retries only the correlated failed non-secret command', async () => {
    const api = fixture();
    api.api.savedFilters.remove.mockRejectedValueOnce(new Error('validation rejected'));
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    await expect(controller.removeFilter('f')).rejects.toThrow('validation rejected');
    await controller.retryFailed();
    expect(api.api.savedFilters.remove).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().savedFilters).toEqual([]);
  });

  it('preserves confirmed state when a successful write is followed by a failed raw list', async () => {
    const api = fixture();
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    api.api.presets.list.mockRejectedValueOnce(new Error('read disconnected'));
    await expect(controller.removeRule('r')).rejects.toThrow('read disconnected');
    expect(controller.snapshot()).toMatchObject({
      phase: 'uncertain',
      failedCommand: 'rule:remove:r',
    });
    expect(controller.snapshot().rules.map((item) => item.id)).toEqual(['r']);
  });

  it('semantically reconciles an ambiguous generated-id rule create by multiplicity', async () => {
    const api = fixture();
    api.api.rules.create.mockImplementationOnce(async (draft) => {
      api.set({
        rules: [...api.get().rules, rule('server-id', { ...draft, name: draft.name.trim() })],
      });
      throw new Error('transport timeout');
    });
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    await controller.createRule({
      name: ' next ',
      enabled: true,
      priority: 20.8,
      condition: { sourcePrefixes: [' 192.0.2.0/24 '] },
      actions: {},
    });
    expect(controller.snapshot()).toMatchObject({ phase: 'success' });
    expect(controller.snapshot().rules.some((item) => item.id === 'server-id')).toBe(true);
  });

  it('matches JSON-persisted rules when undefined action properties are omitted', async () => {
    const api = fixture();
    api.api.rules.create.mockImplementationOnce(async (draft) => {
      api.set({
        rules: [
          ...api.get().rules,
          rule('json-rule', {
            ...draft,
            actions: { notify: false },
          }),
        ],
      });
      throw new Error('transport timeout');
    });
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    await controller.createRule({
      name: 'json rule',
      enabled: true,
      priority: 1,
      condition: {},
      actions: { severity: undefined, notify: false },
    });
    expect(controller.snapshot()).toMatchObject({ phase: 'success' });
  });

  it('matches JSON-persisted presets when undefined payload properties are omitted', async () => {
    const api = fixture();
    api.api.presets.save.mockImplementationOnce(async (name, agentId, intended) => {
      api.set({
        presets: [...api.get().presets, preset('json-preset', name.trim())].map((item) =>
          item.id === 'json-preset'
            ? { ...item, agentId, payload: JSON.parse(JSON.stringify(intended)) }
            : item,
        ),
      });
      throw new Error('transport timeout');
    });
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    await controller.savePreset('json preset', 'agent', { ...payload, upTime: undefined });
    expect(controller.snapshot()).toMatchObject({ phase: 'success' });
  });

  it('surfaces ambiguous mismatch as conflict and ambiguous read failure as uncertain', async () => {
    const mismatchApi = fixture();
    mismatchApi.api.rules.remove.mockRejectedValueOnce(new Error('transport timeout'));
    const mismatch = new TrapPersistentCollectionsController(mismatchApi.engine);
    await mismatch.load();
    await expect(mismatch.removeRule('r')).rejects.toThrow('transport timeout');
    expect(mismatch.snapshot()).toMatchObject({
      phase: 'conflict',
      failedCommand: 'rule:remove:r',
    });

    const unreadableApi = fixture();
    unreadableApi.api.rules.remove.mockRejectedValueOnce(new Error('transport timeout'));
    const unreadable = new TrapPersistentCollectionsController(unreadableApi.engine);
    await unreadable.load();
    unreadableApi.api.presets.list.mockRejectedValueOnce(new Error('connection lost'));
    await expect(unreadable.removeRule('r')).rejects.toThrow('connection lost');
    expect(unreadable.snapshot()).toMatchObject({
      phase: 'uncertain',
      failedCommand: 'rule:remove:r',
    });
  });

  it('does not publish read failures after ownership is lost mid-reconciliation', async () => {
    for (const ambiguous of [true, false]) {
      const api = fixture();
      let owned = true;
      const readFailure = deferred<TrapSendPreset[]>();
      const controller = new TrapPersistentCollectionsController(api.engine);
      await controller.load();
      api.api.presets.list.mockImplementationOnce(() => readFailure.promise);
      if (ambiguous) api.api.rules.remove.mockRejectedValueOnce(new Error('transport timeout'));
      const mutation = controller.removeRule('r', () => owned);
      await vi.waitFor(() => expect(api.api.presets.list).toHaveBeenCalledTimes(2));
      owned = false;
      readFailure.reject(new Error('late read failure'));
      await expect(mutation).rejects.toThrow('ownership');
      expect(controller.snapshot()).toMatchObject({
        phase: 'confirmed',
        active: undefined,
      });
      expect(controller.snapshot().failedCommand).toBeUndefined();
    }
  });

  it('does not let a pending event overwrite post-write raw authority', async () => {
    const api = fixture();
    const pending = deferred<TrapRule>();
    api.api.rules.update.mockImplementationOnce(() => pending.promise);
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    const write = controller.updateRule('r', { enabled: false });
    controller.applyAuthority(
      { ...api.get(), rules: [rule('event-copy', { enabled: true })] },
      'event',
    );
    api.set({ rules: [rule('r', { enabled: false })] });
    pending.resolve(rule('r', { enabled: false }));
    await write;
    expect(controller.snapshot().rules).toMatchObject([{ id: 'r', enabled: false }]);
  });

  it('keeps replacement of an existing write-only key uncertain and never leaks literals', async () => {
    const api = fixture();
    const authKey = 'literal-auth-value-8192';
    const privKey = 'literal-priv-value-4761';
    api.api.v3Users.upsert.mockImplementationOnce(async (draft) => {
      api.set({
        v3Users: [user('u', { level: 'authPriv', privProtocol: 'aes', hasPrivKey: true })],
      });
      throw new Error(`timeout ${draft.authKey} ${draft.privKey}`);
    });
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    await expect(
      controller.upsertV3User({
        name: 'u',
        level: 'authPriv',
        authProtocol: 'sha',
        authKey,
        privProtocol: 'aes',
        privKey,
      }),
    ).rejects.not.toThrow(authKey);
    expect(JSON.stringify(controller.snapshot())).not.toContain(authKey);
    expect(JSON.stringify(controller.snapshot())).not.toContain(privKey);
    expect(controller.snapshot()).toMatchObject({
      phase: 'uncertain',
      failedCommand: 'v3:upsert:u',
    });
    await expect(controller.reconcile()).rejects.toThrow('cannot be proven');
    expect(controller.snapshot()).toMatchObject({
      phase: 'uncertain',
      canAcknowledgeUncertainty: true,
      v3Users: [{ name: 'u', level: 'authPriv', hasPrivKey: true }],
    });
    controller.acknowledgeUncertainty();
    expect(controller.snapshot().phase).toBe('confirmed');
  });

  it('requires matching v3 identity and public fields before replacement can be unknown', async () => {
    const missingApi = fixture();
    missingApi.api.v3Users.upsert.mockImplementationOnce(async () => {
      missingApi.set({ v3Users: [] });
      throw new Error('timeout');
    });
    const missing = new TrapPersistentCollectionsController(missingApi.engine);
    await missing.load();
    await expect(
      missing.upsertV3User({
        name: 'u',
        level: 'authNoPriv',
        authProtocol: 'sha',
        authKey: 'replacement',
      }),
    ).rejects.toThrow();
    expect(missing.snapshot().phase).toBe('conflict');

    const mismatchApi = fixture();
    mismatchApi.api.v3Users.upsert.mockImplementationOnce(async () => {
      mismatchApi.set({ v3Users: [user('u', { level: 'authPriv', privProtocol: 'aes' })] });
      throw new Error('timeout');
    });
    const mismatch = new TrapPersistentCollectionsController(mismatchApi.engine);
    await mismatch.load();
    await expect(
      mismatch.upsertV3User({
        name: 'u',
        level: 'authNoPriv',
        authProtocol: 'sha',
        authKey: 'replacement',
      }),
    ).rejects.toThrow();
    expect(mismatch.snapshot().phase).toBe('conflict');

    const presenceApi = fixture();
    presenceApi.api.v3Users.upsert.mockImplementationOnce(async () => {
      presenceApi.set({ v3Users: [user('u', { hasAuthKey: false })] });
      throw new Error('timeout');
    });
    const presence = new TrapPersistentCollectionsController(presenceApi.engine);
    await presence.load();
    await expect(
      presence.upsertV3User({
        name: 'u',
        level: 'authNoPriv',
        authProtocol: 'sha',
        authKey: 'replacement',
      }),
    ).rejects.toThrow();
    expect(presence.snapshot().phase).toBe('conflict');
  });

  it('mirrors v3 key precedence and preserves explicitly supplied protocols', async () => {
    const api = fixture();
    api.set({ v3Users: [] });
    api.api.v3Users.upsert.mockImplementationOnce(async () => {
      api.set({
        v3Users: [
          user('new', {
            level: 'noAuthNoPriv',
            authProtocol: 'sha512',
            privProtocol: 'aes256b',
            hasAuthKey: true,
            hasPrivKey: true,
          }),
        ],
      });
      throw new Error('timeout');
    });
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    await controller.upsertV3User({
      name: 'new',
      level: 'noAuthNoPriv',
      authProtocol: 'sha512',
      privProtocol: 'aes256b',
      clearAuthKey: true,
      authKey: 'defined-wins',
      clearPrivKey: true,
      privKey: 'defined-wins-too',
    });
    expect(controller.snapshot().phase).toBe('success');
  });

  it('distinguishes absent rule conditions from explicitly stored empty strings', async () => {
    const api = fixture();
    api.set({ rules: [rule('r', { condition: {} })] });
    api.api.rules.update.mockImplementationOnce(async () => {
      throw new Error('timeout');
    });
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    await expect(controller.updateRule('r', { condition: { trapOidGlob: '' } })).rejects.toThrow();
    expect(controller.snapshot().phase).toBe('conflict');
  });

  it('accepts a normally successful replacement when the raw list matches the returned profile', async () => {
    const api = fixture();
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    await controller.upsertV3User({
      name: 'u',
      level: 'authNoPriv',
      authProtocol: 'sha256',
      authKey: 'replacement-not-retained',
    });
    expect(controller.snapshot()).toMatchObject({ phase: 'success' });
    expect(JSON.stringify(controller.snapshot())).not.toContain('replacement-not-retained');
  });

  it('uses a resolved write result to reconcile a later post-write list failure', async () => {
    const api = fixture();
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    api.api.presets.list.mockRejectedValueOnce(new Error('post-write list disconnected'));
    await expect(
      controller.upsertV3User({
        name: 'u',
        level: 'authNoPriv',
        authProtocol: 'sha512',
        authKey: 'resolved-replacement',
      }),
    ).rejects.toThrow();
    expect(controller.snapshot()).toMatchObject({
      phase: 'uncertain',
      canAcknowledgeUncertainty: undefined,
    });
    await controller.reconcile();
    expect(controller.snapshot()).toMatchObject({ phase: 'success' });
  });

  it('never retries a settled secret-bearing command through the controller API', async () => {
    const api = fixture();
    api.api.v3Users.upsert.mockRejectedValueOnce(new Error('rejected literal-secret'));
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    await expect(
      controller.upsertV3User({
        name: 'u',
        level: 'authNoPriv',
        authProtocol: 'sha',
        authKey: 'literal-secret',
      }),
    ).rejects.not.toThrow('literal-secret');
    expect(controller.snapshot()).toMatchObject({ phase: 'error-reverted', retryable: false });
    await expect(controller.retryFailed()).rejects.toThrow('Re-enter');
    expect(api.api.v3Users.upsert).toHaveBeenCalledOnce();
  });

  it.each(['upsert', 'remove'] as const)(
    'keeps v3 %s rollback-unknown outcomes uncertain despite public metadata',
    async (operation) => {
      const api = fixture();
      if (operation === 'upsert')
        api.api.v3Users.upsert.mockRejectedValueOnce(
          new Error('Secret rollback outcome unknown after trap-user update failure'),
        );
      else
        api.api.v3Users.remove.mockRejectedValueOnce(
          new Error('Secret rollback outcome unknown after trap-user removal failure'),
        );
      const controller = new TrapPersistentCollectionsController(api.engine);
      await controller.load();
      const request =
        operation === 'upsert'
          ? controller.upsertV3User({
              name: 'u',
              level: 'authNoPriv',
              authProtocol: 'sha',
              authKey: 'never-visible',
            })
          : controller.removeV3User('u');
      await expect(request).rejects.toThrow('secret-bearing');
      expect(controller.snapshot()).toMatchObject({
        phase: 'uncertain',
        canAcknowledgeUncertainty: true,
        retryable: false,
      });
    },
  );

  it('rejects stale pre-write authority and stale mounted ownership', async () => {
    const api = fixture();
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    const staleToken = controller.beginAuthorityRead();
    await controller.removePreset('p');
    controller.applyAuthority({ ...api.get(), presets: [preset('stale')] }, 'refresh', staleToken);
    expect(controller.snapshot().presets).toEqual([]);
    await expect(controller.removeFilter('f', () => false)).rejects.toThrow('ownership');
    expect(api.api.savedFilters.remove).not.toHaveBeenCalled();
  });

  it('captures ownership per queued command and exposes active row status', async () => {
    const api = fixture();
    const pending = deferred<void>();
    api.api.rules.remove.mockImplementationOnce(() => pending.promise);
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    let secondOwns = true;
    const active = controller.removeRule('r');
    const queued = controller.removePreset('p', () => secondOwns);
    expect(controller.statusFor('rule:remove:r')).toBe('updating');
    expect(controller.statusFor('preset:remove:p')).toBe('queued');
    secondOwns = false;
    api.set({ rules: [] });
    pending.resolve();
    await active;
    await expect(queued).rejects.toThrow('ownership');
    expect(api.api.presets.remove).not.toHaveBeenCalled();
  });

  it('settles active and queued promises on disposal without publishing late results', async () => {
    const api = fixture();
    const pending = deferred<void>();
    api.api.rules.remove.mockImplementationOnce(() => pending.promise);
    const controller = new TrapPersistentCollectionsController(api.engine);
    await controller.load();
    const active = controller.removeRule('r');
    const queued = controller.removePreset('p');
    controller.dispose();
    await expect(active).rejects.toThrow('disposed');
    await expect(queued).rejects.toThrow('disposed');
    pending.resolve();
  });

  it('has no mounted or cross-screen persistent trap API bypass', () => {
    const root = new URL('.', import.meta.url).pathname;
    const files = collectSourceFiles(root).filter(
      (file) =>
        !file.endsWith('trap-persistent-collections.ts') &&
        !file.endsWith('trap-persistent-collections.test.ts'),
    );
    const bypass =
      /traps\.(?:savedFilters|v3Users|rules|presets)\.(?:list|save|upsert|create|update|remove)\s*\(/;
    const violations = files.filter((file) => bypass.test(readFileSync(file, 'utf8')));
    expect(violations).toEqual([]);
    const screen = readFileSync(join(root, 'screens/TrapsScreen.tsx'), 'utf8');
    expect(screen).toContain('statusFor(`filter:remove:${filter.id}`)');
    expect(screen).toContain('statusFor(`v3:remove:${user.name}`)');
    expect(screen).toContain('statusFor(`preset:remove:${preset.id}`)');
    const sendWorkspace = screen.slice(
      screen.indexOf('function SendWorkspace'),
      screen.indexOf('function HistoryRow'),
    );
    expect(sendWorkspace).toContain("collection.readiness.phase === 'error'");
    expect(sendWorkspace).toContain('title="Retry load"');
    expect(screen).toContain("useState<'starting' | 'stopping' | null>(null)");
    expect(screen).toContain('editable={!receiver.running && !receiverPending}');
    expect(screen).toContain('type TrapCredentialIntent');
    expect(screen).toContain("intent === 'retain' ? 'Retain stored'");
    expect(screen).toContain("disabled={intent === 'replace' && userLevel === 'noAuthNoPriv'}");
    expect(screen).toContain("disabled={intent === 'replace' && userLevel !== 'authPriv'}");
    expect(screen).toContain(
      'if (pendingRecordIdsRef.current.size || clearPendingRef.current) return;',
    );
    expect(screen).toContain('disabled={clearPending || pendingRecordIds.length > 0}');
    expect(screen).toContain('disabled={clearPending || pendingRecordIds.includes(item.id)}');
  });
});

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}
