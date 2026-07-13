import { describe, expect, it } from 'vitest';
import { getActiveSettingsSection } from './settings-navigation';

describe('getActiveSettingsSection', () => {
  const offsets = {
    privacy: 0,
    cache: 280,
    sources: 430,
    transfer: 760,
    activity: 1040,
  } as const;

  it('tracks the last section above the viewport threshold', () => {
    expect(getActiveSettingsSection(offsets, 0)).toBe('privacy');
    expect(getActiveSettingsSection(offsets, 250)).toBe('cache');
    expect(getActiveSettingsSection(offsets, 720)).toBe('transfer');
    expect(getActiveSettingsSection(offsets, 2000)).toBe('activity');
  });

  it('falls back to privacy while section layouts are incomplete', () => {
    expect(getActiveSettingsSection({}, 500)).toBe('privacy');
  });

  it('keeps the final category active when the page reaches its maximum scroll', () => {
    expect(getActiveSettingsSection(offsets, 700, 48, true)).toBe('activity');
  });
});
