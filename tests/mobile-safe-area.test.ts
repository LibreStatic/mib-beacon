import { describe, expect, it } from 'vitest';
import { getMobileSafeAreaPaddingTop } from '../apps/mobile/src/safe-area';

describe('mobile safe-area padding', () => {
  it('uses the Android status-bar inset when edge-to-edge content is enabled', () => {
    expect(getMobileSafeAreaPaddingTop('android', 48)).toBe(48);
  });

  it('leaves iOS and web safe-area handling to their host containers', () => {
    expect(getMobileSafeAreaPaddingTop('ios', 48)).toBe(0);
    expect(getMobileSafeAreaPaddingTop('web', 48)).toBe(0);
  });

  it('falls back safely when Android does not report a status-bar height', () => {
    expect(getMobileSafeAreaPaddingTop('android', undefined)).toBe(0);
  });
});
