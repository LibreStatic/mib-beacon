import { describe, expect, it } from 'vitest';
import { resolveButtonState } from '@mibbeacon/ui/button-state';

describe('button loading/busy state', () => {
  it('is idle by default and shows the plain title', () => {
    expect(resolveButtonState({ title: 'Create profile' })).toEqual({
      isBusy: false,
      isDisabled: false,
      label: 'Create profile',
    });
  });

  it('marks busy and swaps to the loading title while loading', () => {
    expect(
      resolveButtonState({ title: 'Create profile', loading: true, loadingTitle: 'Creating…' }),
    ).toEqual({ isBusy: true, isDisabled: true, label: 'Creating…' });
  });

  it('keeps the title when loading without a loadingTitle', () => {
    expect(resolveButtonState({ title: 'Send trap', loading: true })).toMatchObject({
      isBusy: true,
      isDisabled: true,
      label: 'Send trap',
    });
  });

  it('disables when explicitly disabled even if not loading', () => {
    expect(resolveButtonState({ title: 'Import', disabled: true })).toMatchObject({
      isBusy: false,
      isDisabled: true,
    });
  });
});
