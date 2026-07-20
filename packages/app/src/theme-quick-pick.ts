import type { ThemeDescriptor } from '@mibbeacon/ui/theme-values';

export type ThemeQuickPickEntry =
  | {
      key: 'browse-additional-themes';
      kind: 'browse';
      section: 'Actions';
      label: string;
    }
  | {
      key: `theme:${string}`;
      kind: 'theme';
      section: 'Light themes' | 'Dark themes' | 'High contrast themes';
      label: string;
      theme: ThemeDescriptor;
      current: boolean;
    };

export function shouldPreviewBeforeThemeApply(
  platform: 'web' | 'ios' | 'android' | string,
  pointerType?: string,
): boolean {
  return platform !== 'web' || pointerType === 'touch' || pointerType === 'pen';
}

export function resolveThemePressIntent(
  previewBeforeApply: boolean,
  touchArmedKey: string | null,
  entryKey: string,
): 'preview' | 'apply' {
  return previewBeforeApply && touchArmedKey !== entryKey ? 'preview' : 'apply';
}

export function buildThemeQuickPickEntries(
  themes: readonly ThemeDescriptor[],
  query: string,
  current: { light: string; dark: string },
): ThemeQuickPickEntry[] {
  const normalized = query.trim().toLowerCase();
  const matches = themes.filter(
    ({ id, label, provenance }) =>
      !normalized ||
      label.toLowerCase().includes(normalized) ||
      id.toLowerCase().includes(normalized) ||
      provenance?.extensionId?.toLowerCase().includes(normalized),
  );
  const entries: ThemeQuickPickEntry[] = [
    {
      key: 'browse-additional-themes',
      kind: 'browse',
      section: 'Actions',
      label: '+ Browse Additional Color Themes...',
    },
  ];
  for (const section of ['light', 'dark', 'high-contrast'] as const) {
    for (const theme of matches) {
      if (section === 'high-contrast' ? !theme.highContrast : theme.highContrast) continue;
      if (section !== 'high-contrast' && theme.scheme !== section) continue;
      entries.push({
        key: `theme:${theme.id}`,
        kind: 'theme',
        section:
          section === 'light'
            ? 'Light themes'
            : section === 'dark'
              ? 'Dark themes'
              : 'High contrast themes',
        label: theme.label,
        theme,
        current: current[theme.scheme] === theme.id,
      });
    }
  }
  return entries;
}
