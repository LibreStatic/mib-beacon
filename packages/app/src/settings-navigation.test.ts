import { describe, expect, it } from 'vitest';
import { getActiveSettingsSection } from './settings-navigation';

describe('getActiveSettingsSection', () => {
  const offsets = {
    appearance: 0,
    updates: 220,
    privacy: 440,
    cache: 720,
    sources: 870,
    transfer: 1200,
    activity: 1480,
    about: 1700,
  } as const;

  it('tracks the last section above the viewport threshold', () => {
    expect(getActiveSettingsSection(offsets, 0)).toBe('appearance');
    expect(getActiveSettingsSection(offsets, 250)).toBe('updates');
    expect(getActiveSettingsSection(offsets, 1160)).toBe('transfer');
    expect(getActiveSettingsSection(offsets, 2000)).toBe('about');
  });

  it('falls back to appearance while section layouts are incomplete', () => {
    expect(getActiveSettingsSection({}, 500)).toBe('appearance');
  });

  it('keeps the final category active when the page reaches its maximum scroll', () => {
    expect(getActiveSettingsSection(offsets, 700, 48, true)).toBe('about');
  });
});
