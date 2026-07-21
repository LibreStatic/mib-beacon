import type {
  DensityMode,
  Theme,
  ThemeComponentStates,
  ThemeDescriptor,
  ThemeMode,
  ThemePalette,
  ThemeScheme,
} from './theme-types';
import { colorContrast, opaqueColor } from './vscode-theme';

export type {
  DensityMode,
  Theme,
  ThemeDescriptor,
  ThemeComponentStates,
  ThemeMode,
  ThemePalette,
  ThemeScheme,
  ThemeSource,
} from './theme-types';

const dark: ThemePalette = {
  scheme: 'dark',
  bg: '#0b0e13',
  surface: '#141924',
  surfaceAlt: '#1b2231',
  border: '#526079',
  text: '#e8ecf3',
  textDim: '#aeb8c8',
  accent: '#72a7ff',
  accentText: '#07101f',
  accentSoft: 'rgba(114,167,255,0.18)',
  ok: '#5ee0ae',
  warn: '#ffd166',
  error: '#ff9696',
  errorSoft: 'rgba(255,150,150,0.15)',
  mono: '#c7d5ec',
  focus: '#f8d34f',
  semantic: {
    status: { up: '#5ee0ae', down: '#ff9696', unknown: '#b7c0cf' },
    diff: { added: '#5ee0ae', removed: '#ff9696', changed: '#ffd166', equal: '#b7c0cf' },
    severity: { info: '#89b4ff', warning: '#ffd166', error: '#ff9696', critical: '#ffb0dc' },
  },
  kind: {
    table: '#d8a7ff',
    entry: '#ffd166',
    column: '#89b4ff',
    scalar: '#5ee0ae',
    notification: '#ff9696',
    subtree: '#b7c0cf',
    module: '#67e8f9',
  },
  chart: {
    series: [
      '#5aa9ff',
      '#4ade80',
      '#fbbf24',
      '#f87171',
      '#c084fc',
      '#38bdf8',
      '#f472b6',
      '#a3e635',
    ],
  },
  workbench: {
    activityBarBackground: '#181818',
    activityBarForeground: '#d7d7d7',
    sideBarBackground: '#181818',
    sideBarForeground: '#cccccc',
    panelBackground: '#1f1f1f',
    panelBorder: '#2b2b2b',
    titleBarBackground: '#181818',
    titleBarForeground: '#cccccc',
    statusBarBackground: '#181818',
    statusBarForeground: '#cccccc',
    inputBackground: '#313131',
    inputForeground: '#cccccc',
    selectionBackground: '#04395e',
    hoverBackground: '#2a2d2e',
  },
};
const light: ThemePalette = {
  scheme: 'light',
  bg: '#f4f6f9',
  surface: '#ffffff',
  surfaceAlt: '#eef1f6',
  border: '#697386',
  text: '#131720',
  textDim: '#4b5565',
  accent: '#1d4ed8',
  accentText: '#ffffff',
  accentSoft: 'rgba(29,78,216,0.11)',
  ok: '#067647',
  warn: '#854d0e',
  error: '#b42318',
  errorSoft: 'rgba(180,35,24,0.09)',
  mono: '#1e293b',
  focus: '#7c3aed',
  semantic: {
    status: { up: '#067647', down: '#b42318', unknown: '#4b5565' },
    diff: { added: '#067647', removed: '#b42318', changed: '#854d0e', equal: '#4b5565' },
    severity: { info: '#1d4ed8', warning: '#854d0e', error: '#b42318', critical: '#9d174d' },
  },
  kind: {
    table: '#6d28d9',
    entry: '#854d0e',
    column: '#1d4ed8',
    scalar: '#067647',
    notification: '#b42318',
    subtree: '#4b5565',
    module: '#0e7490',
  },
  chart: {
    series: [
      '#1d4ed8',
      '#047857',
      '#b45309',
      '#b91c1c',
      '#7c3aed',
      '#0e7490',
      '#be185d',
      '#4d7c0f',
    ],
  },
  workbench: {
    activityBarBackground: '#f8f8f8',
    activityBarForeground: '#1f1f1f',
    sideBarBackground: '#f8f8f8',
    sideBarForeground: '#3b3b3b',
    panelBackground: '#ffffff',
    panelBorder: '#e5e5e5',
    titleBarBackground: '#f8f8f8',
    titleBarForeground: '#3b3b3b',
    statusBarBackground: '#f8f8f8',
    statusBarForeground: '#3b3b3b',
    inputBackground: '#ffffff',
    inputForeground: '#3b3b3b',
    selectionBackground: '#0060c0',
    hoverBackground: '#e8e8e8',
  },
};

/**
 * Fixed-dark palette for the packet console / terminal surfaces. Intentionally
 * theme-independent — the console reads as a hardware terminal in both light
 * and dark app themes. Centralized here so the literals stay contrast-tested.
 */
export const consolePalette = {
  bg: '#061014',
  panel: '#0a171c',
  line: '#18343d',
  text: '#d4ece7',
  dim: '#6f9995',
  ok: '#39e58c',
  error: '#ff5c67',
  pending: '#f2c94c',
  dotIdle: '#365057',
  grip: '#486870',
  shadow: '#000000',
  warnBg: '#2a1115',
  rowSelected: '#10282f',
} as const;

export const THEME_PALETTES = { light, dark } as const;

const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
const TYPE = { caption: 11, label: 12, body: 13, base: 14, title: 16 } as const;

function readableOn(
  candidate: string,
  backgrounds: readonly string[],
  fallback: string,
  minimum: number,
): string {
  const candidates = [candidate, fallback, '#ffffff', '#000000'];
  for (const color of candidates) {
    if (backgrounds.every((background) => colorContrast(color, background) >= minimum)) {
      return color;
    }
  }
  throw new Error(`Theme contrast normalization could not satisfy ${minimum}:1`);
}

function backgroundBehind(
  candidate: string,
  foreground: string,
  fallback: string,
  minimum: number,
): string {
  for (const color of [candidate, fallback, '#000000', '#ffffff']) {
    if (colorContrast(foreground, color) >= minimum) return color;
  }
  throw new Error(`Theme background normalization could not satisfy ${minimum}:1`);
}

function distinctBackgroundBehind(
  candidates: readonly string[],
  foreground: string,
  avoid: string,
  minimum: number,
): string {
  for (const color of [...candidates, '#f2f2f2', '#121212', '#000000', '#ffffff']) {
    const opaque = opaqueColor(color, avoid);
    if (
      opaque.toLowerCase() !== avoid.toLowerCase() &&
      colorContrast(foreground, opaque) >= minimum
    ) {
      return opaque;
    }
  }
  throw new Error(
    `Theme pressed-state normalization could not satisfy ${minimum}:1 for ${foreground} away from ${avoid}`,
  );
}

export function normalizeThemePaletteContrast(palette: ThemePalette): ThemePalette {
  const input = palette;
  const fallback = THEME_PALETTES[palette.scheme];
  const coherentBackground = (color: string, fallbackColor: string) => {
    const opaque = opaqueColor(color, fallbackColor);
    const familyForeground = palette.scheme === 'dark' ? '#ffffff' : '#000000';
    return colorContrast(familyForeground, opaque) >= 4.5 ? opaque : fallbackColor;
  };
  const bg = coherentBackground(input.bg, fallback.bg);
  const surface = coherentBackground(input.surface, fallback.surface);
  const surfaceAlt = coherentBackground(input.surfaceAlt, fallback.surfaceAlt);
  palette = {
    ...input,
    bg,
    surface,
    surfaceAlt,
    workbench: {
      ...input.workbench,
      activityBarBackground: coherentBackground(
        input.workbench.activityBarBackground,
        fallback.workbench.activityBarBackground,
      ),
      sideBarBackground: coherentBackground(
        input.workbench.sideBarBackground,
        fallback.workbench.sideBarBackground,
      ),
      panelBackground: coherentBackground(
        input.workbench.panelBackground,
        fallback.workbench.panelBackground,
      ),
      titleBarBackground: coherentBackground(
        input.workbench.titleBarBackground,
        fallback.workbench.titleBarBackground,
      ),
      statusBarBackground: coherentBackground(
        input.workbench.statusBarBackground,
        fallback.workbench.statusBarBackground,
      ),
      inputBackground: coherentBackground(
        input.workbench.inputBackground,
        fallback.workbench.inputBackground,
      ),
    },
  };
  const accentSoft =
    colorContrast(
      palette.scheme === 'dark' ? '#ffffff' : '#000000',
      opaqueColor(input.accentSoft, surfaceAlt),
    ) >= 4.5
      ? input.accentSoft
      : fallback.accentSoft;
  const errorSoft =
    colorContrast(
      palette.scheme === 'dark' ? '#ffffff' : '#000000',
      opaqueColor(input.errorSoft, surfaceAlt),
    ) >= 4.5
      ? input.errorSoft
      : fallback.errorSoft;
  palette = { ...palette, accentSoft, errorSoft };
  const accentSoftBackground = opaqueColor(accentSoft, palette.surfaceAlt);
  const errorSoftBackground = opaqueColor(errorSoft, palette.surfaceAlt);
  const contentBackgrounds = [
    palette.bg,
    palette.surface,
    palette.surfaceAlt,
    palette.workbench.inputBackground,
  ];
  const text = readableOn(palette.text, contentBackgrounds, fallback.text, 4.5);
  const textDim = readableOn(palette.textDim, contentBackgrounds, fallback.textDim, 4.5);
  const mono = readableOn(palette.mono, contentBackgrounds, fallback.mono, 4.5);
  const accent = readableOn(
    palette.accent,
    [...contentBackgrounds, accentSoftBackground],
    fallback.accent,
    4.5,
  );
  const error = readableOn(
    palette.error,
    [...contentBackgrounds, errorSoftBackground],
    fallback.error,
    4.5,
  );
  const normalizeSemantic = (values: Record<string, string>, defaults: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        readableOn(value, contentBackgrounds, defaults[key] ?? text, 4.5),
      ]),
    );
  return {
    ...palette,
    border: readableOn(palette.border, contentBackgrounds, fallback.border, 3),
    text,
    textDim,
    accent,
    accentText: readableOn(palette.accentText, [accent], fallback.accentText, 4.5),
    ok: readableOn(palette.ok, contentBackgrounds, fallback.ok, 4.5),
    warn: readableOn(palette.warn, contentBackgrounds, fallback.warn, 4.5),
    error,
    mono,
    focus: readableOn(
      palette.focus,
      [
        palette.bg,
        palette.surface,
        palette.surfaceAlt,
        palette.workbench.activityBarBackground,
        palette.workbench.sideBarBackground,
        palette.workbench.panelBackground,
        palette.workbench.titleBarBackground,
        palette.workbench.statusBarBackground,
        palette.workbench.inputBackground,
      ],
      fallback.focus,
      3,
    ),
    semantic: {
      status: normalizeSemantic(
        palette.semantic.status,
        fallback.semantic.status,
      ) as ThemePalette['semantic']['status'],
      diff: normalizeSemantic(
        palette.semantic.diff,
        fallback.semantic.diff,
      ) as ThemePalette['semantic']['diff'],
      severity: normalizeSemantic(
        palette.semantic.severity,
        fallback.semantic.severity,
      ) as ThemePalette['semantic']['severity'],
    },
    kind: normalizeSemantic(palette.kind, fallback.kind) as ThemePalette['kind'],
    chart: {
      series: palette.chart.series.map((color, index) =>
        readableOn(
          color,
          [palette.bg, palette.surface],
          fallback.chart.series[index % fallback.chart.series.length]!,
          3,
        ),
      ),
    },
    workbench: {
      ...palette.workbench,
      activityBarForeground: readableOn(
        palette.workbench.activityBarForeground,
        [palette.workbench.activityBarBackground],
        fallback.workbench.activityBarForeground,
        4.5,
      ),
      sideBarForeground: readableOn(
        palette.workbench.sideBarForeground,
        [palette.workbench.sideBarBackground],
        fallback.workbench.sideBarForeground,
        4.5,
      ),
      panelBorder: readableOn(
        palette.workbench.panelBorder,
        [palette.workbench.panelBackground],
        fallback.workbench.panelBorder,
        3,
      ),
      titleBarForeground: readableOn(
        palette.workbench.titleBarForeground,
        [palette.workbench.titleBarBackground],
        fallback.workbench.titleBarForeground,
        4.5,
      ),
      statusBarForeground: readableOn(
        palette.workbench.statusBarForeground,
        [palette.workbench.statusBarBackground],
        fallback.workbench.statusBarForeground,
        4.5,
      ),
      inputForeground: readableOn(
        palette.workbench.inputForeground,
        [palette.workbench.inputBackground],
        fallback.workbench.inputForeground,
        4.5,
      ),
      selectionBackground: backgroundBehind(
        palette.workbench.selectionBackground,
        text,
        fallback.workbench.selectionBackground,
        4.5,
      ),
      hoverBackground: backgroundBehind(
        palette.workbench.hoverBackground,
        text,
        fallback.workbench.hoverBackground,
        4.5,
      ),
    },
  };
}

function createComponentStates(palette: ThemePalette): ThemeComponentStates {
  const selectedBackground = opaqueColor(palette.workbench.selectionBackground, palette.surfaceAlt);
  const selectedForeground = readableOn(palette.text, [selectedBackground], palette.text, 4.5);
  const primaryBackground = opaqueColor(palette.accent, palette.surfaceAlt);
  const primaryForeground = readableOn(
    palette.accentText,
    [primaryBackground],
    palette.accentText,
    4.5,
  );
  const pressedBackground = distinctBackgroundBehind(
    [palette.workbench.selectionBackground, palette.surfaceAlt, palette.bg],
    primaryForeground,
    primaryBackground,
    4.5,
  );
  const disabledBackground = palette.surfaceAlt;
  const hoverBackground = opaqueColor(palette.workbench.hoverBackground, palette.surfaceAlt);
  const dangerBackground = opaqueColor(palette.errorSoft, palette.surfaceAlt);
  const dangerForeground = readableOn(palette.error, [dangerBackground], palette.text, 4.5);
  const dangerPressedBackground = opaqueColor(palette.error, palette.surfaceAlt);
  const dangerPressedForeground = readableOn(
    palette.accentText,
    [dangerPressedBackground],
    palette.text,
    4.5,
  );
  return {
    selected: {
      background: selectedBackground,
      foreground: selectedForeground,
      mutedForeground: readableOn(palette.textDim, [selectedBackground], selectedForeground, 4.5),
      icon: readableOn(palette.accent, [selectedBackground], selectedForeground, 4.5),
      border: readableOn(palette.accent, [selectedBackground], selectedForeground, 3),
    },
    primaryButton: {
      background: primaryBackground,
      foreground: primaryForeground,
      pressedBackground,
      focusInner: readableOn(palette.focus, [primaryBackground], palette.focus, 3),
      focusOuter: palette.focus,
    },
    badge: {
      background: primaryBackground,
      foreground: primaryForeground,
    },
    disabled: {
      background: disabledBackground,
      foreground: readableOn(palette.textDim, [disabledBackground], palette.text, 4.5),
      border: readableOn(palette.border, [disabledBackground], palette.text, 3),
    },
    hover: {
      background: hoverBackground,
      foreground: readableOn(palette.text, [hoverBackground], palette.text, 4.5),
      icon: readableOn(palette.accent, [hoverBackground], palette.text, 3),
      border: readableOn(palette.border, [hoverBackground], palette.text, 3),
      focusInner: readableOn(palette.focus, [hoverBackground], palette.text, 3),
    },
    dangerButton: {
      background: dangerBackground,
      foreground: dangerForeground,
      pressedBackground: dangerPressedBackground,
      pressedForeground: dangerPressedForeground,
      border: readableOn(palette.border, [dangerBackground], dangerForeground, 3),
      focusInner: readableOn(palette.focus, [dangerBackground], dangerForeground, 3),
      pressedFocusInner: readableOn(
        palette.focus,
        [dangerPressedBackground],
        dangerPressedForeground,
        3,
      ),
    },
  };
}

export function resolveThemeProviderTheme({
  mode,
  systemScheme,
  density,
  lightTheme,
  darkTheme,
}: {
  mode: ThemeMode;
  systemScheme: ThemeScheme;
  density: DensityMode;
  lightTheme?: ThemeDescriptor;
  darkTheme?: ThemeDescriptor;
}): Theme {
  const scheme = mode === 'system' ? systemScheme : mode;
  return createTheme(scheme, density, scheme === 'dark' ? darkTheme : lightTheme);
}

export function createTheme(
  scheme: 'light' | 'dark',
  density: DensityMode,
  descriptor?: ThemeDescriptor,
): Theme {
  const selected = descriptor?.scheme === scheme ? descriptor : undefined;
  const palette = normalizeThemePaletteContrast(selected?.palette ?? THEME_PALETTES[scheme]);
  return {
    ...palette,
    id: selected?.id ?? `mibbeacon-${scheme}`,
    label: selected?.label ?? `MIB Beacon ${scheme === 'dark' ? 'Dark' : 'Light'}`,
    source: selected?.source ?? 'mibbeacon',
    highContrast: selected?.highContrast ?? false,
    density:
      density === 'compact'
        ? { mode: density, controlMinHeight: 36, rowMinHeight: 36, gap: 6, fontScale: 0.92 }
        : { mode: density, controlMinHeight: 44, rowMinHeight: 44, gap: 8, fontScale: 1 },
    space: { ...SPACE },
    type: { ...TYPE },
    components: createComponentStates(palette),
  };
}
export function contrastRatio(foreground: string, background: string): number {
  return colorContrast(foreground, background);
}
