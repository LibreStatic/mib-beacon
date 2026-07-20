import { describe, expect, it } from 'vitest';
import {
  THEME_PALETTES,
  consolePalette,
  contrastRatio,
  createTheme,
  type ThemeDescriptor,
} from '@mibbeacon/ui/theme-values';

describe('semantic theme contrast', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`${scheme} semantic foregrounds meet WCAG AA on surfaces`, () => {
      const theme = createTheme(scheme, 'comfortable');
      const colors = [
        theme.text,
        theme.textDim,
        theme.mono,
        theme.ok,
        theme.warn,
        theme.error,
        ...Object.values(theme.semantic.status),
        ...Object.values(theme.semantic.diff),
        ...Object.values(theme.semantic.severity),
      ];
      for (const color of colors)
        expect(contrastRatio(color, theme.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.accentText, theme.accent)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${scheme} chart series are distinct and readable as graphical marks`, () => {
      const theme = createTheme(scheme, 'comfortable');
      const series = theme.chart.series;
      expect(series.length).toBeGreaterThanOrEqual(8);
      // Unique hues.
      expect(new Set(series).size).toBe(series.length);
      // Non-text graphical objects only need the 3:1 bar (WCAG 1.4.11), not 4.5.
      for (const color of series) {
        expect(contrastRatio(color, theme.surface)).toBeGreaterThanOrEqual(3.0);
        expect(contrastRatio(color, theme.bg)).toBeGreaterThanOrEqual(3.0);
      }
    });
  }

  it('packet console palette stays legible on its own fixed-dark background', () => {
    // Primary text meets AA; decorative state colors meet the 3:1 graphical bar.
    expect(contrastRatio(consolePalette.text, consolePalette.bg)).toBeGreaterThanOrEqual(4.5);
    for (const color of [
      consolePalette.dim,
      consolePalette.ok,
      consolePalette.error,
      consolePalette.pending,
    ])
      expect(contrastRatio(color, consolePalette.bg)).toBeGreaterThanOrEqual(3.0);
  });

  it('uses density tokens rather than per-screen touch sizing', () => {
    expect(createTheme('light', 'comfortable').density.controlMinHeight).toBe(44);
    expect(createTheme('light', 'compact').density.controlMinHeight).toBe(36);
  });

  it('automatically repairs unreadable imported theme field and workbench colors', () => {
    const nearlyBlack = '#080808';
    const descriptor: ThemeDescriptor = {
      id: 'imported-unreadable',
      label: 'Unreadable',
      scheme: 'dark',
      source: 'imported',
      highContrast: false,
      palette: {
        ...THEME_PALETTES.dark,
        bg: '#000000',
        surface: '#010101',
        surfaceAlt: '#020202',
        border: '#050505',
        text: nearlyBlack,
        textDim: nearlyBlack,
        accent: nearlyBlack,
        accentText: nearlyBlack,
        mono: nearlyBlack,
        focus: nearlyBlack,
        workbench: {
          ...THEME_PALETTES.dark.workbench,
          activityBarBackground: '#000000',
          activityBarForeground: nearlyBlack,
          sideBarBackground: '#000000',
          sideBarForeground: nearlyBlack,
          panelBackground: '#000000',
          panelBorder: nearlyBlack,
          titleBarBackground: '#000000',
          titleBarForeground: nearlyBlack,
          statusBarBackground: '#000000',
          statusBarForeground: nearlyBlack,
          inputBackground: '#000000',
          inputForeground: nearlyBlack,
        },
      },
    };
    const theme = createTheme('dark', 'comfortable', descriptor);
    for (const foreground of [theme.text, theme.textDim, theme.mono, theme.accent]) {
      expect(contrastRatio(foreground, theme.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(foreground, theme.surfaceAlt)).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrastRatio(theme.workbench.inputForeground, theme.workbench.inputBackground),
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.text, theme.workbench.selectionBackground)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastRatio(theme.border, theme.surfaceAlt)).toBeGreaterThanOrEqual(3);
    expect(
      contrastRatio(theme.workbench.activityBarForeground, theme.workbench.activityBarBackground),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(theme.workbench.sideBarForeground, theme.workbench.sideBarBackground),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('repairs a theme whose declared scheme conflicts with inverse workbench backgrounds', () => {
    const descriptor: ThemeDescriptor = {
      id: 'imported-inverse',
      label: 'Inverse',
      scheme: 'dark',
      source: 'imported',
      highContrast: false,
      palette: {
        ...THEME_PALETTES.dark,
        bg: '#ffffff',
        surface: '#000000',
        surfaceAlt: '#000000',
        text: '#ffffff',
        textDim: '#ffffff',
        accent: '#72a7ff',
        border: '#ffffff',
      },
    };
    const theme = createTheme('dark', 'comfortable', descriptor);
    expect(contrastRatio(theme.text, theme.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.textDim, theme.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.accent, theme.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.border, theme.bg)).toBeGreaterThanOrEqual(3);
  });

  it('exposes a monotonic spacing scale and font ramp', () => {
    const t = createTheme('dark', 'comfortable');
    const space = [t.space.xs, t.space.sm, t.space.md, t.space.lg, t.space.xl];
    expect(space).toEqual([...space].sort((a, b) => a - b));
    expect(new Set(space).size).toBe(space.length);
    const type = [t.type.caption, t.type.label, t.type.body, t.type.base, t.type.title];
    expect(type).toEqual([...type].sort((a, b) => a - b));
  });
});
