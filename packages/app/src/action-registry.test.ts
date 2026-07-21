import { describe, expect, it, vi } from 'vitest';
import {
  ActionRegistry,
  ActionConfirmationRequiredError,
  ActionRegistrationChangedError,
  ActionUnavailableError,
  assertActionExposureInvariants,
  type AppAction,
} from './action-registry';

function action(overrides: Partial<AppAction> = {}): AppAction {
  return {
    id: 'query:run-current',
    label: 'Run current query',
    group: 'Query',
    glyph: '▶',
    keywords: ['query', 'run'],
    keyboard: { suitable: true, shortcutIds: ['query:repeat'] },
    palette: { exposed: true },
    enabled: { value: true },
    confirmation: { kind: 'none' },
    platforms: ['web', 'desktop', 'native'],
    execute: vi.fn(),
    ...overrides,
  };
}

describe('ActionRegistry', () => {
  it('rejects duplicate IDs and ignores an unregister closure after its registration is stale', () => {
    const registry = new ActionRegistry();
    const unregisterFirst = registry.register(action());
    expect(() => registry.register(action())).toThrow(/duplicate action id/i);

    unregisterFirst();
    const replacement = action({ label: 'Replacement' });
    registry.register(replacement);
    unregisterFirst();

    expect(registry.get('query:run-current')).toBe(replacement);
  });

  it('does not execute disabled actions and preserves their reason for palette consumers', async () => {
    const execute = vi.fn();
    const registry = new ActionRegistry();
    registry.register(
      action({
        enabled: { value: false, reason: 'Choose an agent profile first.' },
        execute,
      }),
    );

    await expect(registry.execute('query:run-current', 'web')).rejects.toEqual(
      new ActionUnavailableError('query:run-current', 'Choose an agent profile first.'),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(registry.paletteActions('web')[0]?.enabled.reason).toBe(
      'Choose an agent profile first.',
    );
  });

  it('filters platform-constrained actions from the active palette', () => {
    const registry = new ActionRegistry();
    registry.register(action({ platforms: ['desktop'] }));
    expect(registry.paletteActions('web')).toEqual([]);
    expect(registry.paletteActions('desktop')).toHaveLength(1);
  });

  it('keeps snapshot identity stable until registrations change', () => {
    const registry = new ActionRegistry();
    const empty = registry.snapshot();
    expect(registry.snapshot()).toBe(empty);
    registry.register(action());
    expect(registry.snapshot()).not.toBe(empty);
    expect(registry.snapshot()).toBe(registry.snapshot());
  });

  it('requires explicit authorization before destructive or remote execution', async () => {
    const execute = vi.fn();
    const registry = new ActionRegistry();
    registry.register(
      action({
        confirmation: { kind: 'remote', title: 'Apply remote change' },
        execute,
      }),
    );
    await expect(registry.execute('query:run-current', 'web')).rejects.toBeInstanceOf(
      ActionConfirmationRequiredError,
    );
    await expect(
      registry.execute('query:run-current', 'web', async () => false),
    ).rejects.toBeInstanceOf(ActionConfirmationRequiredError);
    expect(execute).not.toHaveBeenCalled();
    await registry.execute('query:run-current', 'web', async () => true);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('fails closed when confirmation replaces the authorized registration', async () => {
    const oldHandler = vi.fn();
    const newHandler = vi.fn();
    const registry = new ActionRegistry();
    const unregister = registry.register(
      action({
        confirmation: { kind: 'destructive', title: 'Delete' },
        execute: oldHandler,
      }),
    );

    await expect(
      registry.execute('query:run-current', 'web', async () => {
        unregister();
        registry.register(
          action({
            enabled: { value: false, reason: 'No longer available.' },
            confirmation: { kind: 'destructive', title: 'Delete replacement' },
            execute: newHandler,
          }),
        );
        return true;
      }),
    ).rejects.toBeInstanceOf(ActionRegistrationChangedError);
    expect(oldHandler).not.toHaveBeenCalled();
    expect(newHandler).not.toHaveBeenCalled();
  });

  it('fails closed when an action unregisters while confirmation is pending', async () => {
    let resolveAuthorization: (approved: boolean) => void = () => undefined;
    const handler = vi.fn();
    const registry = new ActionRegistry();
    const unregister = registry.register(
      action({
        confirmation: { kind: 'remote', title: 'Apply' },
        execute: handler,
      }),
    );
    const execution = registry.execute(
      'query:run-current',
      'web',
      () => new Promise<boolean>((resolve) => (resolveAuthorization = resolve)),
    );
    unregister();
    resolveAuthorization(true);

    await expect(execution).rejects.toBeInstanceOf(ActionRegistrationChangedError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('runtime-validates discriminated enabled states including JavaScript callers', () => {
    const registry = new ActionRegistry();
    expect(() =>
      registry.register(action({ enabled: { value: false, reason: '   ' } })),
    ).toThrow(/disabled action.*nonblank reason/i);
    expect(() =>
      registry.register(
        action({ enabled: { value: true, reason: 'should not exist' } as never }),
      ),
    ).toThrow(/enabled action.*must not have a reason/i);
  });

  it('atomically replaces an owner batch with one emission and stale-cleanup safety', () => {
    const registry = new ActionRegistry();
    const owner = Symbol('query-actions');
    const listener = vi.fn();
    registry.subscribe(listener);
    const cleanupFirst = registry.replaceMany(owner, [action()]);
    expect(listener).toHaveBeenCalledTimes(1);
    const replacement = action({ enabled: { value: false, reason: 'Busy.' } });
    const cleanupSecond = registry.replaceMany(owner, [replacement]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.get(replacement.id)).toBe(replacement);
    cleanupFirst();
    expect(registry.get(replacement.id)).toBe(replacement);
    cleanupSecond();
    expect(registry.snapshot()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('prevalidates owner batches without partial mutation', () => {
    const registry = new ActionRegistry();
    const existing = action();
    registry.register(existing);
    const snapshot = registry.snapshot();
    expect(() =>
      registry.replaceMany(Symbol('bad'), [
        action({ id: 'new:valid' }),
        action({ id: existing.id }),
      ]),
    ).toThrow(/duplicate action id/i);
    expect(registry.snapshot()).toBe(snapshot);
    expect(registry.get('new:valid')).toBeUndefined();
  });

  it('keeps persistent actions across simulated screen owner changes and refreshes state', async () => {
    const registry = new ActionRegistry();
    const persistentOwner = Symbol('persistent-query');
    const screenOwner = Symbol('screen');
    const handler = vi.fn();
    registry.replaceMany(persistentOwner, [action({ execute: handler })]);
    const leaveBrowse = registry.replaceMany(screenOwner, [action({ id: 'browse:local' })]);
    leaveBrowse();
    await registry.execute('query:run-current', 'web');
    expect(handler).toHaveBeenCalledOnce();
    registry.replaceMany(persistentOwner, [
      action({ execute: handler, enabled: { value: false, reason: 'Busy.' } }),
    ]);
    await expect(registry.execute('query:run-current', 'web')).rejects.toMatchObject({
      reason: 'Busy.',
    });
  });
});

describe('action exposure invariants', () => {
  it('requires every keyboard-suitable action and every shortcut binding to be palette-exposed', () => {
    expect(() =>
      assertActionExposureInvariants(
        [action({ palette: { exposed: false } })],
        [{ shortcutId: 'query:repeat', actionId: 'query:run-current' }],
      ),
    ).toThrow(/keyboard-suitable.*palette-exposed/i);

    expect(() =>
      assertActionExposureInvariants(
        [action({ keyboard: { suitable: false }, palette: { exposed: false } })],
        [{ shortcutId: 'query:repeat', actionId: 'query:run-current' }],
      ),
    ).toThrow(/shortcut.*palette-exposed/i);
  });

  it('accepts complete metadata including remote confirmation and shortcut exposure', () => {
    expect(() =>
      assertActionExposureInvariants(
        [
          action({
            id: 'query:stage-set',
            keyboard: { suitable: true, shortcutIds: ['query:set'] },
            confirmation: {
              kind: 'remote',
              title: 'Confirm Set request',
              description: 'This changes state on the remote agent.',
            },
          }),
        ],
        [{ shortcutId: 'query:set', actionId: 'query:stage-set' }],
      ),
    ).not.toThrow();
  });

  it('requires shortcut bindings and action declarations to agree bidirectionally', () => {
    const declared = action({
      id: 'query:get',
      keyboard: { suitable: true, shortcutIds: ['query:get'] },
    });
    expect(() => assertActionExposureInvariants([declared], [])).toThrow(
      /declared shortcut.*no matching binding/i,
    );
    expect(() =>
      assertActionExposureInvariants(
        [declared, action({ id: 'query:walk', keyboard: { suitable: true } })],
        [{ shortcutId: 'query:get', actionId: 'query:walk' }],
      ),
    ).toThrow(/does not match/i);
    expect(() =>
      assertActionExposureInvariants(
        [action({ keyboard: { suitable: false }, palette: { exposed: true } })],
        [{ shortcutId: 'query:repeat', actionId: 'query:run-current' }],
      ),
    ).toThrow(/must be keyboard-suitable/i);
  });

  it('rejects duplicate shortcut bindings and duplicate declarations', () => {
    expect(() =>
      assertActionExposureInvariants(
        [action()],
        [
          { shortcutId: 'query:repeat', actionId: 'query:run-current' },
          { shortcutId: 'query:repeat', actionId: 'query:run-current' },
        ],
      ),
    ).toThrow(/duplicate shortcut binding/i);
    expect(() =>
      assertActionExposureInvariants(
        [action({ keyboard: { suitable: true, shortcutIds: ['same', 'same'] } })],
        [{ shortcutId: 'same', actionId: 'query:run-current' }],
      ),
    ).toThrow(/duplicate shortcut declaration/i);
  });
});
