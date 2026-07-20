import { describe, expect, it } from 'vitest';
import { contrastRatio, createTheme } from '@mibbeacon/ui/theme-values';
import { relativeLuminance } from '@mibbeacon/ui/vscode-theme';
import { resolveSwitchColors } from '@mibbeacon/ui/switch-colors';

describe('themed switch colors', () => {
  const channels = (color: string) =>
    [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));

  for (const scheme of ['light', 'dark'] as const) {
    it(`${scheme} switch uses the theme with readable thumbs and visible tracks`, () => {
      const theme = createTheme(scheme, 'comfortable');
      const off = resolveSwitchColors(theme, false);
      const on = resolveSwitchColors(theme, true);
      expect(contrastRatio(off.track, theme.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(off.thumb, off.track)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(on.track, theme.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(on.thumb, on.track)).toBeGreaterThanOrEqual(3);
      expect(relativeLuminance(off.thumb)).toBeGreaterThan(relativeLuminance(off.track));
      expect(relativeLuminance(on.thumb)).toBeGreaterThan(relativeLuminance(on.track));
    });
  }

  it('keeps an rgb-formatted imported-theme track visible against a mid-tone surface', () => {
    const base = createTheme('dark', 'comfortable');
    const theme = {
      ...base,
      bg: 'rgb(119, 119, 119)',
      surface: 'rgb(119, 119, 119)',
      surfaceAlt: 'rgb(119, 119, 119)',
      textDim: 'rgb(0, 0, 0)',
    };
    const off = resolveSwitchColors(theme, false);

    expect(contrastRatio(off.track, theme.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(off.thumb, off.track)).toBeGreaterThanOrEqual(3);
    expect(relativeLuminance(off.thumb)).toBeGreaterThan(relativeLuminance(off.track));
  });

  it('lightens a black imported accent when a mid-dark surface makes dark fallbacks invisible', () => {
    const base = createTheme('dark', 'comfortable');
    const theme = {
      ...base,
      bg: 'rgb(63, 63, 63)',
      surface: 'rgb(63, 63, 63)',
      surfaceAlt: 'rgb(63, 63, 63)',
      accentSoft: 'rgba(0, 0, 0, 1)',
    };
    const on = resolveSwitchColors(theme, true);

    expect(contrastRatio(on.track, theme.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(on.thumb, on.track)).toBeGreaterThanOrEqual(3);
    expect(relativeLuminance(on.thumb)).toBeGreaterThan(relativeLuminance(on.track));
  });

  it('uses the theme interactive accent instead of an unrelated teal selection color', () => {
    const base = createTheme('dark', 'comfortable');
    const theme = {
      ...base,
      bg: '#000000',
      surface: '#000000',
      accent: '#6ea8fe',
      accentSoft: '#00a09a',
    };
    const on = resolveSwitchColors(theme, true);
    const [red, green, blue] = channels(on.track);

    expect(blue).toBeGreaterThan(green!);
    expect(green).toBeGreaterThan(red!);
    expect(contrastRatio(on.track, theme.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(on.thumb, on.track)).toBeGreaterThanOrEqual(3);
  });

  it('falls back from an achromatic accent to a bright interactive theme color', () => {
    const base = createTheme('dark', 'comfortable');
    const theme = {
      ...base,
      bg: '#000000',
      surface: '#000000',
      accent: '#ffffff',
      focus: '#ffffff',
      chart: { series: ['#6ea8fe', ...base.chart.series.slice(1)] },
    };
    const on = resolveSwitchColors(theme, true);
    const [red, green, blue] = channels(on.track);

    expect(blue).toBeGreaterThan(green!);
    expect(green).toBeGreaterThan(red!);
    expect(contrastRatio(on.track, theme.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(on.thumb, on.track)).toBeGreaterThanOrEqual(3);
  });

  it('adds a contrasting boundary when no track can contrast with both surface and thumb', () => {
    const base = createTheme('dark', 'comfortable');
    const theme = {
      ...base,
      bg: '#505050',
      surface: '#505050',
      surfaceAlt: '#505050',
      accent: '#6ea8fe',
    };
    const on = resolveSwitchColors(theme, true) as ReturnType<typeof resolveSwitchColors> & {
      outline?: string;
    };

    expect(on.outline).toBeDefined();
    expect(contrastRatio(on.outline!, theme.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(on.thumb, on.track)).toBeGreaterThanOrEqual(3);
    expect(relativeLuminance(on.thumb)).toBeGreaterThan(relativeLuminance(on.track));
  });
});
