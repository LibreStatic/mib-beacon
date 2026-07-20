import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  THEME_IMPORT_LIMITS,
  importVscodeThemeJson,
  importVscodeThemeJsonFiles,
  importVscodeThemeVsix,
  prepareThemeImport,
} from './theme-import';

const file = (name: string, source: string) => ({ name, bytes: strToU8(source) });

describe('raw VS Code theme imports', () => {
  it('prepares a JSONC theme as a serializable imported descriptor', () => {
    const imported = importVscodeThemeJson(
      file(
        'night.jsonc',
        `{
          // A comment accepted by VS Code.
          "name": "Night",
          "type": "dark",
          "colors": {
            "editor.background": "#101010",
            "foreground": "#f0f0f0",
          },
        }`,
      ),
    );
    expect(imported.themes).toHaveLength(1);
    expect(imported.themes[0]).toMatchObject({
      label: 'Night',
      scheme: 'dark',
      source: 'imported',
      provenance: { kind: 'json', fileName: 'night.jsonc' },
    });
    expect(() => JSON.stringify(imported.themes[0])).not.toThrow();
  });

  it('rejects unsupported files and oversized raw themes', () => {
    expect(() => prepareThemeImport(file('theme.js', '{}'))).toThrow(/json/);
    expect(() =>
      importVscodeThemeJson({
        name: 'huge.json',
        bytes: new Uint8Array(2 * 1024 * 1024 + 1),
      }),
    ).toThrow(/safety limit/);
  });

  it('resolves includes across a multi-file JSON/JSONC selection', () => {
    const imported = importVscodeThemeJsonFiles([
      file(
        'base.json',
        JSON.stringify({
          colors: { 'editor.background': '#121212', foreground: '#eeeeee' },
        }),
      ),
      file(
        'child.jsonc',
        `{
          "name": "Inherited",
          "type": "dark",
          "include": "./base.json",
          "colors": { "button.background": "#0066aa" },
        }`,
      ),
    ]);
    expect(imported.themes).toHaveLength(1);
    expect(imported.themes[0]).toMatchObject({
      label: 'Inherited',
      palette: { bg: '#121212' },
    });
    expect(imported.warnings).toEqual([]);
  });
});

describe('sandboxed theme-only VSIX imports', () => {
  it('reads only declared color themes, inheritance, and package provenance', () => {
    const bytes = zipSync({
      'extension/package.json': strToU8(
        JSON.stringify({
          name: 'safe-themes',
          displayName: 'Safe themes',
          publisher: 'example',
          version: '1.2.3',
          license: 'MIT',
          main: './extension.js',
          scripts: { postinstall: 'never-run-this' },
          contributes: {
            themes: [
              {
                id: 'safe-night',
                label: 'Safe Night',
                uiTheme: 'vs-dark',
                path: './themes/night.json',
              },
            ],
          },
        }),
      ),
      'extension/themes/base.json': strToU8(
        JSON.stringify({
          colors: { 'editor.background': '#101010', foreground: '#eeeeee' },
        }),
      ),
      'extension/themes/night.json': strToU8(
        JSON.stringify({
          include: './base.json',
          colors: { 'button.background': '#0066aa', 'button.foreground': '#ffffff' },
        }),
      ),
      'extension/extension.js': strToU8('throw new Error("must never execute")'),
    });
    const imported = importVscodeThemeVsix({ name: 'safe-themes.vsix', bytes });
    expect(imported.package).toMatchObject({
      extensionId: 'example.safe-themes',
      version: '1.2.3',
      license: 'MIT',
    });
    expect(imported.themes[0]).toMatchObject({
      label: 'Safe Night',
      scheme: 'dark',
      provenance: {
        kind: 'vsix',
        extensionId: 'example.safe-themes',
        license: 'MIT',
      },
      palette: { bg: '#101010' },
    });
  });

  it('rejects path traversal, absent theme contributions, and archive bombs', () => {
    const traversal = zipSync({
      'extension/package.json': strToU8(
        JSON.stringify({
          contributes: {
            themes: [{ label: 'Escape', uiTheme: 'vs-dark', path: '../../escape.json' }],
          },
        }),
      ),
      'escape.json': strToU8('{}'),
    });
    expect(() => importVscodeThemeVsix({ name: 'escape.vsix', bytes: traversal })).toThrow(
      /Unsafe archive path/,
    );

    const noThemes = zipSync({
      'extension/package.json': strToU8(JSON.stringify({ contributes: {} })),
    });
    expect(() => importVscodeThemeVsix({ name: 'empty.vsix', bytes: noThemes })).toThrow(
      /no color theme/,
    );

    const tooManyEntries: Record<string, Uint8Array> = {
      'extension/package.json': strToU8('{}'),
    };
    for (let index = 0; index < THEME_IMPORT_LIMITS.maxEntries; index += 1) {
      tooManyEntries[`extension/${index}.txt`] = new Uint8Array();
    }
    expect(() =>
      importVscodeThemeVsix({ name: 'many.vsix', bytes: zipSync(tooManyEntries) }),
    ).toThrow(/more than/);
  });

  it('warns rather than inventing a license for local VSIX files', () => {
    const bytes = zipSync({
      'extension/package.json': strToU8(
        JSON.stringify({
          name: 'unlicensed',
          contributes: {
            themes: [{ label: 'Theme', uiTheme: 'vs', path: './theme.json' }],
          },
        }),
      ),
      'extension/theme.json': strToU8(
        JSON.stringify({
          type: 'light',
          colors: { 'editor.background': '#ffffff', foreground: '#111111' },
        }),
      ),
    });
    expect(importVscodeThemeVsix({ name: 'unlicensed.vsix', bytes }).warnings).toContain(
      'The extension does not declare a license.',
    );
  });

  it('uses the contribution uiTheme when choosing a sparse theme fallback', () => {
    const bytes = zipSync({
      'extension/package.json': strToU8(
        JSON.stringify({
          contributes: {
            themes: [{ label: 'Sparse Light', uiTheme: 'vs', path: './theme.json' }],
          },
        }),
      ),
      'extension/theme.json': strToU8('{}'),
    });
    const theme = importVscodeThemeVsix({ name: 'sparse-light.vsix', bytes }).themes[0]!;
    expect(theme.scheme).toBe('light');
    expect(theme.palette.bg).toBe('#f4f6f9');
    expect(theme.palette.text).toBe('#131720');
  });

  it('rejects highly compressed expanded data using ZIP metadata preflight', () => {
    const bytes = zipSync({
      'extension/package.json': strToU8('{}'),
      'extension/bomb.bin': new Uint8Array(THEME_IMPORT_LIMITS.maxExpandedBytes + 1),
    });
    expect(bytes.byteLength).toBeLessThan(THEME_IMPORT_LIMITS.maxArchiveBytes);
    expect(() => importVscodeThemeVsix({ name: 'bomb.vsix', bytes })).toThrow(
      /expanded data exceeds/,
    );
  });
});
