export type ThemeMode = 'system' | 'light' | 'dark';
export type DensityMode = 'compact' | 'comfortable';
export type ThemeScheme = 'light' | 'dark';
export type ThemeSource = 'mibbeacon' | 'code-oss' | 'imported';

export interface ThemeDensity {
  mode: DensityMode;
  controlMinHeight: number;
  rowMinHeight: number;
  gap: number;
  fontScale: number;
}

export interface ThemePalette {
  scheme: ThemeScheme;
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
  chart: {
    series: readonly string[];
  };
  workbench: {
    activityBarBackground: string;
    activityBarForeground: string;
    sideBarBackground: string;
    sideBarForeground: string;
    panelBackground: string;
    panelBorder: string;
    titleBarBackground: string;
    titleBarForeground: string;
    statusBarBackground: string;
    statusBarForeground: string;
    inputBackground: string;
    inputForeground: string;
    selectionBackground: string;
    hoverBackground: string;
  };
}

export interface Theme extends ThemePalette {
  id: string;
  label: string;
  source: ThemeSource;
  highContrast: boolean;
  density: ThemeDensity;
  /** Nominal spacing scale (px). Additive — coexists with existing literals. */
  space: { xs: number; sm: number; md: number; lg: number; xl: number };
  /** Nominal font-size ramp (px). */
  type: { caption: number; label: number; body: number; base: number; title: number };
}

export interface ThemeDescriptor {
  id: string;
  label: string;
  scheme: ThemeScheme;
  source: ThemeSource;
  highContrast: boolean;
  palette: ThemePalette;
  upstream?: {
    repository: string;
    revision: string;
    path: string;
    license: string;
  };
  provenance?: {
    kind: 'json' | 'vsix' | 'open-vsx';
    fileName?: string;
    extensionId?: string;
    version?: string;
    publisher?: string;
    license?: string;
    importedAt: string;
  };
}
