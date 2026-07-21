import { describe, expect, it } from 'vitest';
import {
  PREFERENCE_CATALOG,
  assertPreferenceCatalogCoverage,
  settingsBackedPreferenceIds,
} from './settings-preference-catalog';

describe('settings preference catalog', () => {
  it('classifies recurring user-facing preferences with a settings exposure decision', () => {
    expect(() => assertPreferenceCatalogCoverage(PREFERENCE_CATALOG)).not.toThrow();
    expect(settingsBackedPreferenceIds(PREFERENCE_CATALOG)).toEqual(
      expect.arrayContaining([
        'appearance.theme-mode',
        'notifications.trap-rules',
        'layout.split-panes',
        'activity.packet-retention',
      ]),
    );
  });
});
