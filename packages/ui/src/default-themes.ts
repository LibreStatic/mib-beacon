import dark2026 from './vscode-default-themes/2026-dark.json';
import light2026 from './vscode-default-themes/2026-light.json';
import darkModern from './vscode-default-themes/dark_modern.json';
import darkPlus from './vscode-default-themes/dark_plus.json';
import darkVisualStudio from './vscode-default-themes/dark_vs.json';
import highContrastDark from './vscode-default-themes/hc_black.json';
import highContrastLight from './vscode-default-themes/hc_light.json';
import lightModern from './vscode-default-themes/light_modern.json';
import lightPlus from './vscode-default-themes/light_plus.json';
import lightVisualStudio from './vscode-default-themes/light_vs.json';
import { THEME_PALETTES } from './theme-values';
import type { ThemeDescriptor, ThemeScheme } from './theme-types';
import {
  createVscodeThemeDescriptor,
  type VscodeColorTheme,
  type VscodeThemeResolver,
} from './vscode-theme';

const CODE_OSS_REVISION = 'da20a6d0ddd819136575cd284741993a9e724c2f';
const CODE_OSS_REPOSITORY = 'https://github.com/microsoft/vscode';

interface Definition {
  id: string;
  label: string;
  uiTheme: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  path: string;
  document: VscodeColorTheme;
}

const definitions: Definition[] = [
  {
    id: 'code-oss-dark-modern',
    label: 'Dark Modern',
    uiTheme: 'vs-dark',
    path: './dark_modern.json',
    document: darkModern as VscodeColorTheme,
  },
  {
    id: 'code-oss-light-modern',
    label: 'Light Modern',
    uiTheme: 'vs',
    path: './light_modern.json',
    document: lightModern as VscodeColorTheme,
  },
  {
    id: 'code-oss-dark-2026',
    label: 'Dark 2026',
    uiTheme: 'vs-dark',
    path: './2026-dark.json',
    document: dark2026 as VscodeColorTheme,
  },
  {
    id: 'code-oss-light-2026',
    label: 'Light 2026',
    uiTheme: 'vs',
    path: './2026-light.json',
    document: light2026 as VscodeColorTheme,
  },
  {
    id: 'code-oss-dark-plus',
    label: 'Dark+',
    uiTheme: 'vs-dark',
    path: './dark_plus.json',
    document: darkPlus as VscodeColorTheme,
  },
  {
    id: 'code-oss-light-plus',
    label: 'Light+',
    uiTheme: 'vs',
    path: './light_plus.json',
    document: lightPlus as VscodeColorTheme,
  },
  {
    id: 'code-oss-visual-studio-dark',
    label: 'Visual Studio Dark',
    uiTheme: 'vs-dark',
    path: './dark_vs.json',
    document: darkVisualStudio as VscodeColorTheme,
  },
  {
    id: 'code-oss-visual-studio-light',
    label: 'Visual Studio Light',
    uiTheme: 'vs',
    path: './light_vs.json',
    document: lightVisualStudio as VscodeColorTheme,
  },
  {
    id: 'code-oss-high-contrast-dark',
    label: 'Default High Contrast',
    uiTheme: 'hc-black',
    path: './hc_black.json',
    document: highContrastDark as VscodeColorTheme,
  },
  {
    id: 'code-oss-high-contrast-light',
    label: 'Default High Contrast Light',
    uiTheme: 'hc-light',
    path: './hc_light.json',
    document: highContrastLight as VscodeColorTheme,
  },
];

const documents = new Map(definitions.map(({ path, document }) => [path, document]));
const resolver: VscodeThemeResolver = {
  load(path) {
    const normalized = path.startsWith('./') ? path : `./${path}`;
    return documents.get(normalized);
  },
};

export const CODE_OSS_DEFAULT_THEMES: readonly ThemeDescriptor[] = definitions.map((definition) => {
  const scheme: ThemeScheme =
    definition.uiTheme === 'vs' || definition.uiTheme === 'hc-light' ? 'light' : 'dark';
  const descriptor = createVscodeThemeDescriptor(definition.document, resolver, {
    id: definition.id,
    label: definition.label,
    source: 'code-oss',
    uiTheme: definition.uiTheme,
    path: definition.path,
    fallback: THEME_PALETTES[scheme],
  });
  return {
    id: descriptor.id,
    label: descriptor.label,
    scheme: descriptor.scheme,
    source: descriptor.source,
    highContrast: descriptor.highContrast,
    palette: descriptor.palette,
    upstream: {
      repository: CODE_OSS_REPOSITORY,
      revision: CODE_OSS_REVISION,
      path: `extensions/theme-defaults/themes/${definition.path.replace('./', '')}`,
      license: 'MIT',
    },
  };
});

export const DEFAULT_DARK_THEME_ID = 'code-oss-dark-modern';
export const DEFAULT_LIGHT_THEME_ID = 'code-oss-light-modern';

const codeOssThemeById = new Map(CODE_OSS_DEFAULT_THEMES.map((theme) => [theme.id, theme]));

export function getCodeOssDefaultTheme(id: string): ThemeDescriptor | undefined {
  return codeOssThemeById.get(id);
}

export function getDefaultThemeForScheme(scheme: ThemeScheme): ThemeDescriptor {
  return codeOssThemeById.get(scheme === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID)!;
}
