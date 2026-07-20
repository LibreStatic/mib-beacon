import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser/lib/esm/main.js';
import type { ThemePalette, ThemeScheme, ThemeSource } from './theme-types';

export const VSCODE_THEME_MAX_BYTES = 2 * 1024 * 1024;
export const VSCODE_THEME_MAX_INCLUDE_DEPTH = 8;

export interface VscodeColorTheme {
  $schema?: string;
  name?: string;
  type?: 'light' | 'dark' | 'hc' | 'hcLight';
  include?: string;
  colors?: Record<string, unknown>;
  tokenColors?: unknown;
  semanticHighlighting?: boolean;
  semanticTokenColors?: unknown;
}

export interface ParsedVscodeTheme {
  document: VscodeColorTheme;
  warnings: string[];
}

export interface ResolvedVscodeTheme {
  name: string;
  scheme: ThemeScheme;
  highContrast: boolean;
  colors: Record<string, string>;
  warnings: string[];
}

export interface VscodeThemeResolver {
  load(path: string): VscodeColorTheme | undefined;
  canonicalize?(path: string, fromPath?: string): string;
}

export interface VscodeThemeDescriptorOptions {
  id: string;
  label?: string;
  source?: ThemeSource;
  uiTheme?: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  path?: string;
  fallback: ThemePalette;
}

const COLOR_PATTERN = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
const SAFE_INCLUDE_PATTERN = /^(?![a-z][a-z\d+.-]*:)(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$)).+$/i;

function parseMessage(error: ParseError): string {
  return `${printParseErrorCode(error.error)} at offset ${error.offset}`;
}

export function parseVscodeThemeJsonc(source: string): ParsedVscodeTheme {
  if (new TextEncoder().encode(source).byteLength > VSCODE_THEME_MAX_BYTES) {
    throw new Error(`Theme exceeds the ${VSCODE_THEME_MAX_BYTES}-byte safety limit.`);
  }
  const errors: ParseError[] = [];
  const value = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length)
    throw new Error(`Invalid theme JSONC: ${errors.map(parseMessage).join(', ')}.`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A VS Code theme must be a JSON object.');
  }
  const document = value as VscodeColorTheme;
  const warnings: string[] = [];
  if (document.name != null && (typeof document.name !== 'string' || document.name.length > 120)) {
    throw new Error('Theme name must be a string no longer than 120 characters.');
  }
  if (document.include != null) {
    if (typeof document.include !== 'string' || !SAFE_INCLUDE_PATTERN.test(document.include)) {
      throw new Error('Theme include must be a safe relative path.');
    }
  }
  if (
    document.colors != null &&
    (typeof document.colors !== 'object' || Array.isArray(document.colors))
  ) {
    throw new Error('Theme colors must be an object.');
  }
  for (const [key, color] of Object.entries(document.colors ?? {})) {
    if (typeof color !== 'string' || !COLOR_PATTERN.test(color)) {
      warnings.push(`Ignored unsupported color ${key}.`);
    }
  }
  return { document, warnings };
}

function normalizedColors(colors: Record<string, unknown> | undefined, warnings: string[]) {
  const output: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(colors ?? {})) {
    if (typeof value === 'string' && COLOR_PATTERN.test(value)) output[key] = value;
    else warnings.push(`Ignored unsupported color ${key}.`);
  }
  return output;
}

function inferScheme(
  document: VscodeColorTheme,
  colors: Record<string, string>,
  uiTheme?: VscodeThemeDescriptorOptions['uiTheme'],
): ThemeScheme {
  if (
    document.type === 'light' ||
    document.type === 'hcLight' ||
    uiTheme === 'vs' ||
    uiTheme === 'hc-light'
  ) {
    return 'light';
  }
  if (
    document.type === 'dark' ||
    document.type === 'hc' ||
    uiTheme === 'vs-dark' ||
    uiTheme === 'hc-black'
  ) {
    return 'dark';
  }
  const background = colors['editor.background'];
  if (background) return relativeLuminance(background) > 0.45 ? 'light' : 'dark';
  return /light/i.test(document.name ?? '') ? 'light' : 'dark';
}

export function resolveVscodeTheme(
  entry: VscodeColorTheme,
  resolver?: VscodeThemeResolver,
  uiTheme?: VscodeThemeDescriptorOptions['uiTheme'],
  entryPath?: string,
): ResolvedVscodeTheme {
  const warnings: string[] = [];
  const visited = new Set<string>();

  const visit = (
    document: VscodeColorTheme,
    depth: number,
    currentPath?: string,
  ): Record<string, string> => {
    if (depth > VSCODE_THEME_MAX_INCLUDE_DEPTH) {
      throw new Error(`Theme include depth exceeds ${VSCODE_THEME_MAX_INCLUDE_DEPTH}.`);
    }
    let inherited: Record<string, string> = Object.create(null) as Record<string, string>;
    if (document.include) {
      if (!SAFE_INCLUDE_PATTERN.test(document.include)) throw new Error('Theme include is unsafe.');
      if (!resolver) {
        warnings.push(`Could not resolve include ${document.include}.`);
      } else {
        const canonical =
          resolver.canonicalize?.(document.include, currentPath) ?? document.include;
        if (visited.has(canonical)) throw new Error('Theme include cycle detected.');
        visited.add(canonical);
        const parent = resolver.load(canonical);
        if (parent) inherited = visit(parent, depth + 1, canonical);
        else warnings.push(`Could not resolve include ${document.include}.`);
      }
    }
    return { ...inherited, ...normalizedColors(document.colors, warnings) };
  };

  if (entryPath) visited.add(entryPath);
  const colors = visit(entry, 0, entryPath);
  const scheme = inferScheme(entry, colors, uiTheme);
  return {
    name: entry.name?.trim() || 'Imported VS Code theme',
    scheme,
    highContrast:
      entry.type === 'hc' ||
      entry.type === 'hcLight' ||
      uiTheme === 'hc-black' ||
      uiTheme === 'hc-light',
    colors,
    warnings: [...new Set(warnings)],
  };
}

function expandHex(color: string): string {
  const value = color.slice(1);
  if (value.length === 3 || value.length === 4) {
    return `#${[...value].map((part) => `${part}${part}`).join('')}`;
  }
  return color;
}

export function opaqueColor(color: string, background: string): string {
  const functional = color.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*\.?\d+))?\s*\)$/i,
  );
  if (functional) {
    const alpha = Math.min(1, Math.max(0, Number(functional[4] ?? 1)));
    const behind = expandHex(background);
    const blend = [1, 2, 3]
      .map((index, channel) => {
        const foreground = Math.min(255, Math.max(0, Number(functional[index])));
        const backgroundChannel = Number.parseInt(
          behind.slice(channel * 2 + 1, channel * 2 + 3),
          16,
        );
        return Math.round(foreground * alpha + backgroundChannel * (1 - alpha))
          .toString(16)
          .padStart(2, '0');
      })
      .join('');
    return `#${blend}`;
  }
  const expanded = expandHex(color);
  if (expanded.length !== 9) return expanded.slice(0, 7);
  const alpha = Number.parseInt(expanded.slice(7, 9), 16) / 255;
  const blend = [1, 3, 5]
    .map((offset) => {
      const foreground = Number.parseInt(expanded.slice(offset, offset + 2), 16);
      const behind = Number.parseInt(expandHex(background).slice(offset, offset + 2), 16);
      return Math.round(foreground * alpha + behind * (1 - alpha))
        .toString(16)
        .padStart(2, '0');
    })
    .join('');
  return `#${blend}`;
}

const opaque = opaqueColor;

export function relativeLuminance(color: string): number {
  const expanded = expandHex(color);
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255,
  );
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function colorContrast(foreground: string, background: string): number {
  const backgroundOpaque = opaque(background, '#ffffff');
  const foregroundOpaque = opaque(foreground, backgroundOpaque);
  const a = relativeLuminance(foregroundOpaque);
  const b = relativeLuminance(backgroundOpaque);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function first(colors: Record<string, string>, fallback: string, ...keys: string[]): string {
  for (const key of keys) if (colors[key]) return colors[key]!;
  return fallback;
}

function accessible(
  candidate: string,
  background: string,
  fallback: string,
  minimum = 4.5,
): string {
  if (colorContrast(candidate, background) >= minimum) return candidate;
  if (colorContrast(fallback, background) >= minimum) return fallback;
  const black = '#000000';
  const white = '#ffffff';
  return colorContrast(black, background) >= colorContrast(white, background) ? black : white;
}

export function mapVscodeThemeToPalette(
  resolved: ResolvedVscodeTheme,
  fallback: ThemePalette,
): ThemePalette {
  const colors = resolved.colors;
  const bg = opaque(first(colors, fallback.bg, 'editor.background'), fallback.bg);
  const surface = opaque(
    first(colors, fallback.surface, 'sideBar.background', 'panel.background', 'editor.background'),
    bg,
  );
  const surfaceAlt = opaque(
    first(
      colors,
      fallback.surfaceAlt,
      'input.background',
      'dropdown.background',
      'editorWidget.background',
    ),
    surface,
  );
  const textCandidate = first(colors, fallback.text, 'foreground', 'editor.foreground');
  const text = accessible(textCandidate, surface, fallback.text);
  const textDimCandidate = first(
    colors,
    fallback.textDim,
    'descriptionForeground',
    'sideBar.foreground',
    'editorCodeLens.foreground',
  );
  const textDim = accessible(textDimCandidate, surface, fallback.textDim);
  const accent = opaque(
    first(
      colors,
      fallback.accent,
      'button.background',
      'focusBorder',
      'list.activeSelectionBackground',
      'activityBar.activeBorder',
    ),
    surface,
  );
  const accentText = accessible(
    first(colors, fallback.accentText, 'button.foreground', 'list.activeSelectionForeground'),
    accent,
    fallback.accentText,
  );
  const error = accessible(
    first(colors, fallback.error, 'errorForeground', 'editorError.foreground'),
    surface,
    fallback.error,
  );
  const warn = accessible(
    first(colors, fallback.warn, 'editorWarning.foreground', 'notificationsWarningIcon.foreground'),
    surface,
    fallback.warn,
  );
  const ok = accessible(
    first(colors, fallback.ok, 'testing.iconPassed', 'terminal.ansiGreen'),
    surface,
    fallback.ok,
  );
  const mono = accessible(
    first(colors, fallback.mono, 'textPreformat.foreground', 'editor.foreground'),
    surface,
    fallback.mono,
  );
  const border = opaque(
    first(
      colors,
      fallback.border,
      'contrastBorder',
      'sideBar.border',
      'panel.border',
      'input.border',
    ),
    surface,
  );
  const panelBackground = opaque(
    first(colors, fallback.workbench.panelBackground, 'panel.background', 'editor.background'),
    bg,
  );
  const panelBorder = opaque(
    first(colors, fallback.workbench.panelBorder, 'panel.border', 'contrastBorder'),
    panelBackground,
  );

  return {
    ...fallback,
    scheme: resolved.scheme,
    bg,
    surface,
    surfaceAlt,
    border: resolved.highContrast ? accessible(border, surface, fallback.focus, 3) : border,
    text,
    textDim,
    accent,
    accentText,
    accentSoft: first(
      colors,
      fallback.accentSoft,
      'list.activeSelectionBackground',
      'list.inactiveSelectionBackground',
      'editor.selectionBackground',
    ),
    ok,
    warn,
    error,
    errorSoft: first(colors, fallback.errorSoft, 'inputValidation.errorBackground'),
    mono,
    focus: accessible(
      first(colors, fallback.focus, 'focusBorder', 'contrastActiveBorder'),
      bg,
      fallback.focus,
      3,
    ),
    workbench: {
      activityBarBackground: opaque(
        first(colors, fallback.workbench.activityBarBackground, 'activityBar.background'),
        bg,
      ),
      activityBarForeground: accessible(
        first(colors, fallback.workbench.activityBarForeground, 'activityBar.foreground'),
        opaque(
          first(colors, fallback.workbench.activityBarBackground, 'activityBar.background'),
          bg,
        ),
        fallback.workbench.activityBarForeground,
      ),
      sideBarBackground: opaque(
        first(colors, fallback.workbench.sideBarBackground, 'sideBar.background'),
        bg,
      ),
      sideBarForeground: accessible(
        first(colors, fallback.workbench.sideBarForeground, 'sideBar.foreground', 'foreground'),
        opaque(first(colors, fallback.workbench.sideBarBackground, 'sideBar.background'), bg),
        fallback.workbench.sideBarForeground,
      ),
      panelBackground,
      panelBorder: resolved.highContrast
        ? accessible(panelBorder, panelBackground, fallback.focus, 3)
        : panelBorder,
      titleBarBackground: opaque(
        first(
          colors,
          fallback.workbench.titleBarBackground,
          'titleBar.activeBackground',
          'activityBar.background',
        ),
        bg,
      ),
      titleBarForeground: accessible(
        first(
          colors,
          fallback.workbench.titleBarForeground,
          'titleBar.activeForeground',
          'foreground',
        ),
        opaque(
          first(
            colors,
            fallback.workbench.titleBarBackground,
            'titleBar.activeBackground',
            'activityBar.background',
          ),
          bg,
        ),
        fallback.workbench.titleBarForeground,
      ),
      statusBarBackground: opaque(
        first(colors, fallback.workbench.statusBarBackground, 'statusBar.background'),
        bg,
      ),
      statusBarForeground: accessible(
        first(colors, fallback.workbench.statusBarForeground, 'statusBar.foreground', 'foreground'),
        opaque(first(colors, fallback.workbench.statusBarBackground, 'statusBar.background'), bg),
        fallback.workbench.statusBarForeground,
      ),
      inputBackground: surfaceAlt,
      inputForeground: accessible(
        first(colors, text, 'input.foreground', 'foreground'),
        surfaceAlt,
        text,
      ),
      selectionBackground: first(
        colors,
        fallback.workbench.selectionBackground,
        'list.activeSelectionBackground',
        'editor.selectionBackground',
      ),
      hoverBackground: first(
        colors,
        fallback.workbench.hoverBackground,
        'list.hoverBackground',
        'toolbar.hoverBackground',
      ),
    },
  };
}

export function createVscodeThemeDescriptor(
  entry: VscodeColorTheme,
  resolver: VscodeThemeResolver | undefined,
  options: VscodeThemeDescriptorOptions,
) {
  const resolved = resolveVscodeTheme(entry, resolver, options.uiTheme, options.path);
  return {
    id: options.id,
    label: options.label ?? resolved.name,
    scheme: resolved.scheme,
    source: options.source ?? 'imported',
    highContrast: resolved.highContrast,
    palette: mapVscodeThemeToPalette(resolved, options.fallback),
    warnings: resolved.warnings,
    path: options.path,
  };
}
