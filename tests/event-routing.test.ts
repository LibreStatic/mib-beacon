import { describe, expect, it } from 'vitest';
import { getEventRecipientIds } from '../apps/desktop/src/main/event-routing';

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
