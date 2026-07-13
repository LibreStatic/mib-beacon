import { describe, expect, it } from 'vitest';
import {
  getEventRecipientIds,
  isSharedStateMutation,
} from '../apps/desktop/src/main/event-routing';

describe('isSharedStateMutation', () => {
  it('broadcasts only resolver configuration mutations', () => {
    expect(isSharedStateMutation('resolver.settings.update')).toBe(true);
    expect(isSharedStateMutation('resolver.sources.create')).toBe(true);
    expect(isSharedStateMutation('resolver.sources.update')).toBe(true);
    expect(isSharedStateMutation('resolver.sources.remove')).toBe(true);
    expect(isSharedStateMutation('resolver.sources.reorder')).toBe(true);
    expect(isSharedStateMutation('resolver.sources.importCustom')).toBe(true);
    expect(isSharedStateMutation('resolver.cache.clear')).toBe(true);
  });

  it('never rebroadcasts resolver reads or transient operations', () => {
    expect(isSharedStateMutation('resolver.settings.get')).toBe(false);
    expect(isSharedStateMutation('resolver.sources.list')).toBe(false);
    expect(isSharedStateMutation('resolver.sources.exportCustom')).toBe(false);
    expect(isSharedStateMutation('resolver.sources.test')).toBe(false);
    expect(isSharedStateMutation('resolver.sources.preview')).toBe(false);
    expect(isSharedStateMutation('resolver.cache.stats')).toBe(false);
    expect(isSharedStateMutation('resolver.history.list')).toBe(false);
  });
});

describe('getEventRecipientIds', () => {
  it('broadcasts ordinary engine events to every window', () => {
    expect(
      getEventRecipientIds({ kind: 'batch', handleId: 'walk-1' }, [1, 2, 3], new Map(), 2),
    ).toEqual([1, 2, 3]);
  });

  it('routes consent to the window that started the operation', () => {
    expect(
      getEventRecipientIds(
        { kind: 'consent-required', handleId: 'resolve-1' },
        [1, 2, 3],
        new Map([['resolve-1', 3]]),
        2,
      ),
    ).toEqual([3]);
  });

  it('falls back to the focused window when the owner has closed', () => {
    expect(
      getEventRecipientIds(
        { kind: 'consent-required', handleId: 'resolve-1' },
        [1, 2],
        new Map([['resolve-1', 3]]),
        2,
      ),
    ).toEqual([2]);
  });
});
