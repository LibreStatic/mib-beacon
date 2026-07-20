import { describe, expect, it } from 'vitest';
import type { ThemeDescriptor } from '@mibbeacon/ui/theme-values';
import {
  buildThemeQuickPickEntries,
  resolveThemePressIntent,
  shouldPreviewBeforeThemeApply,
} from './theme-quick-pick';

const theme = (
  id: string,
  label: string,
  scheme: 'light' | 'dark',
  highContrast = false,
): ThemeDescriptor =>
  ({
    id,
    label,
    scheme,
    highContrast,
    source: 'code-oss',
    palette: { scheme },
  }) as ThemeDescriptor;

describe('theme quick pick', () => {
  const themes = [
    theme('dark-modern', 'Dark Modern', 'dark'),
    theme('light-modern', 'Light Modern', 'light'),
    theme('hc-black', 'Dark High Contrast', 'dark', true),
  ];

  it('keeps Browse Additional Color Themes first and groups regular and high contrast themes', () => {
    const entries = buildThemeQuickPickEntries(themes, '', {
      light: 'light-modern',
      dark: 'dark-modern',
    });
    expect(entries.map(({ key }) => key)).toEqual([
      'browse-additional-themes',
      'theme:light-modern',
      'theme:dark-modern',
      'theme:hc-black',
    ]);
    expect(entries.map(({ section }) => section)).toEqual([
      'Actions',
      'Light themes',
      'Dark themes',
      'High contrast themes',
    ]);
    expect(entries.filter((entry) => entry.kind === 'theme' && entry.current)).toHaveLength(2);
  });

  it('filters themes without hiding the browse action', () => {
    const entries = buildThemeQuickPickEntries(themes, 'dark', {
      light: 'light-modern',
      dark: 'dark-modern',
    });
    expect(entries.map(({ key }) => key)).toEqual([
      'browse-additional-themes',
      'theme:dark-modern',
      'theme:hc-black',
    ]);
  });

  it('requires a first preview tap on native and touch web without delaying mouse clicks', () => {
    expect(shouldPreviewBeforeThemeApply('ios')).toBe(true);
    expect(shouldPreviewBeforeThemeApply('android')).toBe(true);
    expect(shouldPreviewBeforeThemeApply('web', 'touch')).toBe(true);
    expect(shouldPreviewBeforeThemeApply('web', 'pen')).toBe(true);
    expect(shouldPreviewBeforeThemeApply('web', 'mouse')).toBe(false);
    expect(shouldPreviewBeforeThemeApply('web')).toBe(false);
  });

  it('arms touch apply independently from hover or focus previews', () => {
    expect(resolveThemePressIntent(true, null, 'theme:dark')).toBe('preview');
    expect(resolveThemePressIntent(true, 'theme:dark', 'theme:dark')).toBe('apply');
    expect(resolveThemePressIntent(true, 'theme:light', 'theme:dark')).toBe('preview');
    expect(resolveThemePressIntent(false, null, 'theme:dark')).toBe('apply');
  });
});
