import { describe, expect, it } from 'vitest';
import {
  THEME_PALETTES,
  consolePalette,
  contrastRatio,
  createTheme,
  resolveThemeProviderTheme,
  type ThemeDescriptor,
} from '@mibbeacon/ui/theme-values';
import { CODE_OSS_DEFAULT_THEMES } from '@mibbeacon/ui/default-themes';
import { opaqueColor } from '@mibbeacon/ui/vscode-theme';

function expectComponentStatesToMeetWcag(theme: ReturnType<typeof createTheme>) {
  const { components } = theme;
  for (const foreground of [
    components.selected.foreground,
    components.selected.mutedForeground,
    components.selected.icon,
  ]) {
    expect(contrastRatio(foreground, components.selected.background)).toBeGreaterThanOrEqual(4.5);
  }
  expect(
    contrastRatio(components.selected.border, components.selected.background),
  ).toBeGreaterThanOrEqual(3);
  expect(
    contrastRatio(components.primaryButton.foreground, components.primaryButton.background),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(components.primaryButton.foreground, components.primaryButton.pressedBackground),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(components.primaryButton.focusInner, components.primaryButton.background),
  ).toBeGreaterThanOrEqual(3);
  for (const background of [
    components.primaryButton.background,
    components.primaryButton.pressedBackground,
  ]) {
    for (const exterior of [
      theme.bg,
      theme.surface,
      theme.surfaceAlt,
      theme.workbench.activityBarBackground,
      theme.workbench.sideBarBackground,
      theme.workbench.panelBackground,
      theme.workbench.titleBarBackground,
      theme.workbench.statusBarBackground,
      theme.workbench.inputBackground,
    ]) {
      expect(opaqueColor(background, exterior)).toBe(background);
    }
  }
  for (const exterior of [
    theme.bg,
    theme.surface,
    theme.surfaceAlt,
    theme.workbench.activityBarBackground,
    theme.workbench.sideBarBackground,
    theme.workbench.panelBackground,
    theme.workbench.titleBarBackground,
    theme.workbench.statusBarBackground,
    theme.workbench.inputBackground,
  ]) {
    expect(contrastRatio(components.primaryButton.focusOuter, exterior)).toBeGreaterThanOrEqual(3);
  }
  expect(
    contrastRatio(components.badge.foreground, components.badge.background),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(components.disabled.foreground, components.disabled.background),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(components.disabled.border, components.disabled.background),
  ).toBeGreaterThanOrEqual(3);
  expect(
    contrastRatio(components.hover.foreground, components.hover.background),
  ).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(components.hover.icon, components.hover.background)).toBeGreaterThanOrEqual(
    3,
  );
  expect(
    contrastRatio(components.hover.border, components.hover.background),
  ).toBeGreaterThanOrEqual(3);
}

describe('semantic theme contrast', () => {
  it('normalizes component state pairs for every bundled theme', () => {
    expect(CODE_OSS_DEFAULT_THEMES).toHaveLength(10);
    for (const descriptor of CODE_OSS_DEFAULT_THEMES) {
      expectComponentStatesToMeetWcag(createTheme(descriptor.scheme, 'comfortable', descriptor));
    }
  });

  for (const scheme of ['light', 'dark'] as const) {
    it(`repairs hostile ${scheme} mixed-midpoint surfaces and component states`, () => {
      const fallback = THEME_PALETTES[scheme];
      const descriptor: ThemeDescriptor = {
        id: `hostile-${scheme}`,
        label: `Hostile ${scheme}`,
        scheme,
        source: 'imported',
        highContrast: false,
        palette: {
          ...fallback,
          bg: '#000000',
          surface: '#aaaaaa',
          surfaceAlt: '#ffffff',
          text: '#777777',
          textDim: '#777777',
          accent: '#888888',
          accentText: '#888888',
          border: '#888888',
          focus: '#888888',
          workbench: {
            ...fallback.workbench,
            activityBarBackground: '#aaaaaa',
            activityBarForeground: '#777777',
            sideBarBackground: '#000000',
            sideBarForeground: '#777777',
            selectionBackground: '#888888',
          },
        },
      };
      const theme = createTheme(scheme, 'comfortable', descriptor);
      for (const background of [theme.bg, theme.surface, theme.surfaceAlt]) {
        expect(contrastRatio(theme.text, background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(theme.textDim, background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(theme.border, background)).toBeGreaterThanOrEqual(3);
      }
      expectComponentStatesToMeetWcag(theme);
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    it(`normalizes a hostile ${scheme} descriptor through the ThemeProvider preview path`, () => {
      const fallback = THEME_PALETTES[scheme];
      const descriptor: ThemeDescriptor = {
        id: `preview-hostile-${scheme}`,
        label: `Preview hostile ${scheme}`,
        scheme,
        source: 'imported',
        highContrast: false,
        palette: {
          ...fallback,
          bg: scheme === 'dark' ? '#000000' : '#ffffff',
          surface: '#aaaaaa',
          surfaceAlt: scheme === 'dark' ? '#ffffff' : '#000000',
          text: '#777777',
          textDim: '#777777',
          accent: '#888888',
          accentText: '#888888',
          focus: '#888888',
        },
      };
      const theme = resolveThemeProviderTheme({
        mode: scheme,
        systemScheme: scheme,
        density: 'comfortable',
        lightTheme: scheme === 'light' ? descriptor : undefined,
        darkTheme: scheme === 'dark' ? descriptor : undefined,
      });
      expect(theme.id).toBe(descriptor.id);
      expectComponentStatesToMeetWcag(theme);
    });
  }

  it('covers placeholder and alpha-composited soft-state contrast', () => {
    for (const descriptor of CODE_OSS_DEFAULT_THEMES) {
      const theme = createTheme(descriptor.scheme, 'comfortable', descriptor);
      expect(
        contrastRatio(theme.workbench.inputForeground, theme.workbench.inputBackground),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.accent, opaqueColor(theme.accentSoft, theme.surfaceAlt)),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.error, opaqueColor(theme.errorSoft, theme.surfaceAlt)),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('repairs hostile light workbench exteriors and alpha selected/hover states', () => {
    const fallback = THEME_PALETTES.light;
    const descriptor: ThemeDescriptor = {
      id: 'hostile-light-workbench-exteriors',
      label: 'Hostile light workbench exteriors',
      scheme: 'light',
      source: 'imported',
      highContrast: false,
      palette: {
        ...fallback,
        bg: '#ffffff',
        surface: '#ffffff',
        surfaceAlt: '#ffffff',
        accent: '#0000001a',
        accentText: '#777777',
        focus: '#777777',
        workbench: {
          ...fallback.workbench,
          activityBarBackground: '#777777',
          sideBarBackground: '#777777',
          titleBarBackground: '#777777',
          statusBarBackground: '#777777',
          panelBackground: '#ffffff',
          inputBackground: '#ffffff',
          selectionBackground: '#ffffff1a',
          hoverBackground: '#0000001a',
        },
      },
    };
    const theme = createTheme('light', 'comfortable', descriptor);
    expectComponentStatesToMeetWcag(theme);
    const exteriors = [
      theme.bg,
      theme.surface,
      theme.surfaceAlt,
      theme.workbench.activityBarBackground,
      theme.workbench.sideBarBackground,
      theme.workbench.titleBarBackground,
      theme.workbench.statusBarBackground,
      theme.workbench.panelBackground,
      theme.workbench.inputBackground,
    ];
    for (const exterior of exteriors) {
      expect(
        contrastRatio(theme.components.primaryButton.focusOuter, exterior),
      ).toBeGreaterThanOrEqual(3);
      for (const state of [theme.components.selected, theme.components.hover]) {
        const actualBackground = opaqueColor(state.background, exterior);
        expect(actualBackground).toBe(state.background);
        expect(contrastRatio(state.foreground, actualBackground)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(state.icon, actualBackground)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(state.border, actualBackground)).toBeGreaterThanOrEqual(3);
      }
    }
  });

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
