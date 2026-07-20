import { describe, expect, it } from 'vitest';
import {
  CODE_OSS_DEFAULT_THEMES,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
} from '@mibbeacon/ui/default-themes';
import { THEME_PALETTES, createTheme } from '@mibbeacon/ui/theme-values';
import {
  colorContrast,
  createVscodeThemeDescriptor,
  parseVscodeThemeJsonc,
  resolveVscodeTheme,
  type VscodeColorTheme,
} from '@mibbeacon/ui/vscode-theme';

describe('Code-OSS default themes', () => {
  it('bundles every default light, dark, and high-contrast color theme', () => {
    expect(CODE_OSS_DEFAULT_THEMES).toHaveLength(10);
    expect(new Set(CODE_OSS_DEFAULT_THEMES.map(({ id }) => id)).size).toBe(10);
    expect(CODE_OSS_DEFAULT_THEMES.some(({ highContrast }) => highContrast)).toBe(true);
    expect(CODE_OSS_DEFAULT_THEMES.find(({ id }) => id === DEFAULT_DARK_THEME_ID)?.label).toBe(
      'Dark Modern',
    );
    expect(CODE_OSS_DEFAULT_THEMES.find(({ id }) => id === DEFAULT_LIGHT_THEME_ID)?.label).toBe(
      'Light Modern',
    );
  });

  for (const descriptor of CODE_OSS_DEFAULT_THEMES) {
    it(`${descriptor.label} resolves to accessible application tokens`, () => {
      const theme = createTheme(descriptor.scheme, 'comfortable', descriptor);
      expect(theme.source).toBe('code-oss');
      expect(colorContrast(theme.text, theme.surface)).toBeGreaterThanOrEqual(4.5);
      expect(colorContrast(theme.textDim, theme.surface)).toBeGreaterThanOrEqual(4.5);
      expect(colorContrast(theme.accentText, theme.accent)).toBeGreaterThanOrEqual(4.5);
      expect(colorContrast(theme.focus, theme.bg)).toBeGreaterThanOrEqual(3);
      expect(
        colorContrast(theme.workbench.activityBarForeground, theme.workbench.activityBarBackground),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        colorContrast(theme.workbench.sideBarForeground, theme.workbench.sideBarBackground),
      ).toBeGreaterThanOrEqual(4.5);
      if (descriptor.highContrast) {
        expect(
          colorContrast(theme.workbench.panelBorder, theme.workbench.panelBackground),
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe('VS Code color theme compatibility', () => {
  it('parses JSONC comments and trailing commas without executing content', () => {
    const parsed = parseVscodeThemeJsonc(`{
      // VS Code themes are JSON with comments.
      "name": "Imported",
      "type": "dark",
      "colors": {
        "editor.background": "#101010",
        "foreground": "#f0f0f0",
      },
    }`);
    expect(parsed.document.name).toBe('Imported');
    expect(parsed.document.colors?.['editor.background']).toBe('#101010');
  });

  it('merges safe relative includes and lets the child override its parent', () => {
    const parent: VscodeColorTheme = {
      name: 'Parent',
      colors: { 'editor.background': '#111111', foreground: '#eeeeee' },
    };
    const child: VscodeColorTheme = {
      name: 'Child',
      type: 'dark',
      include: './parent.json',
      colors: { foreground: '#ffffff' },
    };
    const resolved = resolveVscodeTheme(child, {
      load: (path) => (path === './parent.json' ? parent : undefined),
    });
    expect(resolved.colors).toMatchObject({
      'editor.background': '#111111',
      foreground: '#ffffff',
    });
  });

  it('rejects unsafe includes and detects cycles', () => {
    expect(() => parseVscodeThemeJsonc('{"include":"../outside.json"}')).toThrow(/safe relative/);
    const cyclic: VscodeColorTheme = { include: './same.json' };
    expect(() =>
      resolveVscodeTheme(cyclic, {
        load: () => cyclic,
      }),
    ).toThrow(/cycle/);
  });

  it('ignores unsupported color expressions and preserves safe semantic fallbacks', () => {
    const parsed = parseVscodeThemeJsonc(`{
      "name": "Unsafe colors",
      "type": "light",
      "colors": {
        "editor.background": "url(javascript:alert(1))",
        "foreground": "#111111"
      }
    }`);
    expect(parsed.warnings).toContain('Ignored unsupported color editor.background.');
    const descriptor = createVscodeThemeDescriptor(parsed.document, undefined, {
      id: 'imported-unsafe-colors',
      source: 'imported',
      fallback: THEME_PALETTES.light,
    });
    expect(descriptor.palette.bg).toBe(THEME_PALETTES.light.bg);
    expect(
      colorContrast(descriptor.palette.text, descriptor.palette.surface),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('chooses an accessible emergency color when both imported and fallback text fail', () => {
    const descriptor = createVscodeThemeDescriptor(
      {
        type: 'dark',
        colors: {
          'editor.background': '#ffffff',
          'sideBar.background': '#ffffff',
          foreground: '#eeeeee',
        },
      },
      undefined,
      {
        id: 'contradictory-dark-theme',
        source: 'imported',
        fallback: THEME_PALETTES.dark,
      },
    );
    expect(
      colorContrast(descriptor.palette.text, descriptor.palette.surface),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
