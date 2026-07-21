import { describe, expect, it } from 'vitest';
import { CODE_OSS_DEFAULT_THEMES } from '@mibbeacon/ui/default-themes';
import {
  THEME_PALETTES,
  contrastRatio,
  createTheme,
  type ThemeDescriptor,
} from '@mibbeacon/ui/theme-values';
import { opaqueColor } from '@mibbeacon/ui/vscode-theme';
import {
  resolveButtonVisualState,
  resolveChipVisualState,
  type ButtonVisualVariant,
} from '../../ui/src/component-states';

const exteriors = (theme: ReturnType<typeof createTheme>) => [
  theme.bg,
  theme.surface,
  theme.surfaceAlt,
  theme.workbench.activityBarBackground,
  theme.workbench.sideBarBackground,
  theme.workbench.panelBackground,
  theme.workbench.titleBarBackground,
  theme.workbench.statusBarBackground,
  theme.workbench.inputBackground,
];

describe('component visual state resolution', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`makes hostile ${scheme} alpha action fills composition-independent`, () => {
      const fallback = THEME_PALETTES[scheme];
      const alpha = scheme === 'light' ? '#00000090' : '#ffffff90';
      const descriptor: ThemeDescriptor = {
        id: `alpha-actions-${scheme}`,
        label: `Alpha actions ${scheme}`,
        scheme,
        source: 'imported',
        highContrast: false,
        palette: {
          ...fallback,
          accent: alpha,
          accentText: scheme === 'light' ? '#ffffff' : '#000000',
          error: alpha,
          errorSoft: alpha,
        },
      };
      const theme = createTheme(scheme, 'comfortable', descriptor);
      const states = [
        resolveButtonVisualState(theme, 'primary', {}),
        resolveButtonVisualState(theme, 'primary', { pressed: true }),
        resolveButtonVisualState(theme, 'danger', {}),
        resolveButtonVisualState(theme, 'danger', { pressed: true }),
      ];
      for (const state of states) {
        for (const exterior of exteriors(theme)) {
          expect(opaqueColor(state.background, exterior)).toBe(state.background);
        }
        expect(contrastRatio(state.foreground, state.background)).toBeGreaterThanOrEqual(4.5);
      }
      for (const variant of ['primary', 'ghost', 'danger'] as const) {
        const state = resolveButtonVisualState(theme, variant, { pressed: true, focused: true });
        expect(contrastRatio(state.foreground, state.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(state.focusInner, state.background)).toBeGreaterThanOrEqual(3);
        for (const exterior of exteriors(theme)) {
          expect(opaqueColor(state.background, exterior)).toBe(state.background);
          expect(contrastRatio(state.focusOuter, exterior)).toBeGreaterThanOrEqual(3);
        }
      }
      for (const exterior of exteriors(theme)) {
        expect(opaqueColor(theme.components.badge.background, exterior)).toBe(
          theme.components.badge.background,
        );
      }
      expect(
        contrastRatio(theme.components.badge.foreground, theme.components.badge.background),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('gives an active focused Chip a visible contrast-safe outer indicator', () => {
    for (const descriptor of CODE_OSS_DEFAULT_THEMES) {
      const theme = createTheme(descriptor.scheme, 'comfortable', descriptor);
      const state = resolveChipVisualState(theme, { active: true, focused: true });
      expect(state.background).toBe(theme.components.selected.background);
      expect(state.focusOuter).not.toBe('transparent');
      expect(contrastRatio(state.border, state.background)).toBeGreaterThanOrEqual(3);
      for (const exterior of exteriors(theme)) {
        expect(contrastRatio(state.focusOuter, exterior)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('keeps every Button variant pressed, focused, and disabled without opacity', () => {
    const variants: ButtonVisualVariant[] = ['primary', 'ghost', 'danger'];
    for (const descriptor of CODE_OSS_DEFAULT_THEMES) {
      const theme = createTheme(descriptor.scheme, 'comfortable', descriptor);
      for (const variant of variants) {
        const normal = resolveButtonVisualState(theme, variant, {});
        const pressed = resolveButtonVisualState(theme, variant, { pressed: true });
        const focused = resolveButtonVisualState(theme, variant, { focused: true });
        const disabled = resolveButtonVisualState(theme, variant, { disabled: true });

        expect(pressed.background).not.toBe(normal.background);
        expect(contrastRatio(pressed.foreground, pressed.background)).toBeGreaterThanOrEqual(4.5);
        expect(focused.focusInner).not.toBe('transparent');
        if (focused.background === 'transparent') {
          for (const exterior of exteriors(theme)) {
            expect(contrastRatio(focused.focusInner, exterior)).toBeGreaterThanOrEqual(3);
          }
        } else {
          expect(contrastRatio(focused.focusInner, focused.background)).toBeGreaterThanOrEqual(3);
        }
        expect(focused.focusOuter).not.toBe('transparent');
        expect(disabled).toMatchObject({
          background: theme.components.disabled.background,
          foreground: theme.components.disabled.foreground,
          border: theme.components.disabled.border,
        });
        expect(disabled).not.toHaveProperty('opacity');
      }
    }
  });

  it('uses opaque primary fills whose actual composition is independent of exterior', () => {
    for (const descriptor of CODE_OSS_DEFAULT_THEMES) {
      const theme = createTheme(descriptor.scheme, 'comfortable', descriptor);
      for (const pressed of [false, true]) {
        const state = resolveButtonVisualState(theme, 'primary', { pressed });
        for (const exterior of exteriors(theme)) {
          expect(opaqueColor(state.background, exterior)).toBe(state.background);
          expect(contrastRatio(state.foreground, state.background)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
