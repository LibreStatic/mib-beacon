import { describe, expect, it } from 'vitest';
import { THEME_PALETTES, type ThemeDescriptor } from '@mibbeacon/ui/theme-values';
import {
  isOpenVsxCatalogEnabled,
  isStoredThemeDescriptor,
  parseStoredThemes,
} from './theme-storage';

const descriptor: ThemeDescriptor = {
  id: 'imported-abc123',
  label: 'Imported',
  scheme: 'dark',
  source: 'imported',
  highContrast: false,
  palette: THEME_PALETTES.dark,
  provenance: {
    kind: 'json',
    fileName: 'theme.json',
    importedAt: '2026-07-20T00:00:00.000Z',
  },
};

describe('installed theme storage validation', () => {
  it('enables Open VSX by default while preserving an explicit opt-out', () => {
    expect(isOpenVsxCatalogEnabled(null)).toBe(true);
    expect(isOpenVsxCatalogEnabled('true')).toBe(true);
    expect(isOpenVsxCatalogEnabled('false')).toBe(false);
  });

  it('round-trips valid serializable imported descriptors', () => {
    expect(isStoredThemeDescriptor(descriptor)).toBe(true);
    expect(parseStoredThemes(JSON.stringify([descriptor]))).toEqual([descriptor]);
  });

  it('rejects built-ins, executable color strings, malformed palettes, and invalid JSON', () => {
    expect(isStoredThemeDescriptor({ ...descriptor, source: 'code-oss' })).toBe(false);
    expect(
      isStoredThemeDescriptor({
        ...descriptor,
        palette: { ...descriptor.palette, bg: 'url(javascript:alert(1))' },
      }),
    ).toBe(false);
    expect(isStoredThemeDescriptor({ ...descriptor, palette: {} })).toBe(false);
    expect(parseStoredThemes('{nope')).toEqual([]);
  });

  it('filters invalid entries and caps the installed theme collection', () => {
    const values = Array.from({ length: 55 }, (_, index) => ({
      ...descriptor,
      id: `imported-${index.toString(36)}`,
    }));
    values.splice(3, 0, { ...descriptor, id: 'not allowed' });
    const parsed = parseStoredThemes(JSON.stringify(values));
    expect(parsed).toHaveLength(50);
    expect(parsed.every(({ id }) => /^imported-[a-z0-9]+$/i.test(id))).toBe(true);
  });
});
