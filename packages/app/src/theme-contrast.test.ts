import { describe, expect, it } from 'vitest';
import { contrastRatio, createTheme } from '@mibbeacon/ui/theme-values';

describe('semantic theme contrast', () => {
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
  }

  it('uses density tokens rather than per-screen touch sizing', () => {
    expect(createTheme('light', 'comfortable').density.controlMinHeight).toBe(44);
    expect(createTheme('light', 'compact').density.controlMinHeight).toBe(36);
  });
});
