import { describe, expect, it } from 'vitest';
import { getActiveSettingsSection } from './settings-navigation';

describe('getActiveSettingsSection', () => {
  const offsets = {
    appearance: 0,
    liveMibs: 220,
    updates: 440,
    privacy: 660,
    cache: 940,
    sources: 1090,
    transfer: 1420,
    activity: 1700,
    about: 1920,
  } as const;

  it('tracks the last section above the viewport threshold', () => {
    expect(getActiveSettingsSection(offsets, 0)).toBe('appearance');
    expect(getActiveSettingsSection(offsets, 250)).toBe('liveMibs');
    expect(getActiveSettingsSection(offsets, 1380)).toBe('transfer');
    expect(getActiveSettingsSection(offsets, 2000)).toBe('about');
  });

  it('falls back to appearance while section layouts are incomplete', () => {
    expect(getActiveSettingsSection({}, 500)).toBe('appearance');
  });

  it('keeps the final category active when the page reaches its maximum scroll', () => {
    expect(getActiveSettingsSection(offsets, 700, 48, true)).toBe('about');
  });
});
