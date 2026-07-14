export type ThemeMode = 'system' | 'light' | 'dark';
export type DensityMode = 'compact' | 'comfortable';

export interface Theme {
  scheme: 'light' | 'dark';
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  ok: string;
  warn: string;
  error: string;
  errorSoft: string;
  mono: string;
  focus: string;
  density: {
    mode: DensityMode;
    controlMinHeight: number;
    rowMinHeight: number;
    gap: number;
    fontScale: number;
  };
  semantic: {
    status: { up: string; down: string; unknown: string };
    diff: { added: string; removed: string; changed: string; equal: string };
    severity: { info: string; warning: string; error: string; critical: string };
  };
  kind: {
    table: string;
    entry: string;
    column: string;
    scalar: string;
    notification: string;
    subtree: string;
    module: string;
  };
}

type Palette = Omit<Theme, 'density'>;
const dark: Palette = {
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
};
const light: Palette = {
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
};

export const THEME_PALETTES = { light, dark } as const;
export function createTheme(scheme: 'light' | 'dark', density: DensityMode): Theme {
  return {
    ...THEME_PALETTES[scheme],
    density:
      density === 'compact'
        ? { mode: density, controlMinHeight: 36, rowMinHeight: 36, gap: 6, fontScale: 0.92 }
        : { mode: density, controlMinHeight: 44, rowMinHeight: 44, gap: 8, fontScale: 1 },
  };
}
export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(
      (index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255,
    );
    const [r, g, b] = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
