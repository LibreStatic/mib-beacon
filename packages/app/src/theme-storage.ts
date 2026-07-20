import type { ThemeDescriptor } from '@mibbeacon/ui/theme-values';

export function isOpenVsxCatalogEnabled(storedValue: string | null): boolean {
  return storedValue !== 'false';
}

export interface ThemeStorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}

export const THEME_STORAGE_KEYS = {
  mode: 'mibbeacon:theme',
  light: 'mibbeacon:theme-light',
  dark: 'mibbeacon:theme-dark',
  density: 'mibbeacon:density',
  installed: 'mibbeacon:installed-themes-v1',
  openVsxEnabled: 'mibbeacon:open-vsx-themes-enabled',
} as const;

const COLOR_PATTERN =
  /^(?:#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function color(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && COLOR_PATTERN.test(value);
}

function validateColorRecord(value: unknown, keys: readonly string[]): boolean {
  return record(value) && keys.every((key) => color(value[key]));
}

export function isStoredThemeDescriptor(value: unknown): value is ThemeDescriptor {
  if (!record(value) || value.source !== 'imported') return false;
  if (
    typeof value.id !== 'string' ||
    !/^imported-[a-z0-9]+$/i.test(value.id) ||
    typeof value.label !== 'string' ||
    value.label.length > 160 ||
    (value.scheme !== 'light' && value.scheme !== 'dark') ||
    typeof value.highContrast !== 'boolean' ||
    !record(value.palette)
  ) {
    return false;
  }
  const palette = value.palette;
  if (
    !validateColorRecord(palette, [
      'bg',
      'surface',
      'surfaceAlt',
      'border',
      'text',
      'textDim',
      'accent',
      'accentText',
      'accentSoft',
      'ok',
      'warn',
      'error',
      'errorSoft',
      'mono',
      'focus',
    ]) ||
    palette.scheme !== value.scheme ||
    !validateColorRecord(palette.workbench, [
      'activityBarBackground',
      'activityBarForeground',
      'sideBarBackground',
      'sideBarForeground',
      'panelBackground',
      'panelBorder',
      'titleBarBackground',
      'titleBarForeground',
      'statusBarBackground',
      'statusBarForeground',
      'inputBackground',
      'inputForeground',
      'selectionBackground',
      'hoverBackground',
    ])
  ) {
    return false;
  }
  if (
    !record(palette.semantic) ||
    !validateColorRecord(palette.semantic.status, ['up', 'down', 'unknown']) ||
    !validateColorRecord(palette.semantic.diff, ['added', 'removed', 'changed', 'equal']) ||
    !validateColorRecord(palette.semantic.severity, ['info', 'warning', 'error', 'critical']) ||
    !validateColorRecord(palette.kind, [
      'table',
      'entry',
      'column',
      'scalar',
      'notification',
      'subtree',
      'module',
    ]) ||
    !record(palette.chart) ||
    !Array.isArray(palette.chart.series) ||
    palette.chart.series.length < 1 ||
    palette.chart.series.length > 32 ||
    !palette.chart.series.every(color)
  ) {
    return false;
  }
  return value.provenance == null || record(value.provenance);
}

export function parseStoredThemes(source: string | null): ThemeDescriptor[] {
  if (!source || source.length > 512 * 1024) return [];
  try {
    const value = JSON.parse(source) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(isStoredThemeDescriptor).slice(0, 50);
  } catch {
    return [];
  }
}

export function browserThemeStorage(): ThemeStorageAdapter | undefined {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!storage) return undefined;
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: (key) => storage.removeItem(key),
    };
  } catch {
    return undefined;
  }
}
