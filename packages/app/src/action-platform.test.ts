import { describe, expect, it } from 'vitest';
import { resolveActionPlatform } from './action-registry';

describe('resolveActionPlatform', () => {
  it('distinguishes desktop-hosted web from browser web and native', () => {
    expect(resolveActionPlatform('web', false)).toBe('web');
    expect(resolveActionPlatform('web', true)).toBe('desktop');
    expect(resolveActionPlatform('android', false)).toBe('native');
    expect(resolveActionPlatform('ios', false)).toBe('native');
  });
});
