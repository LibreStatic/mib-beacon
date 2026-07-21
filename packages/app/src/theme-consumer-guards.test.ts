import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname);
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

describe('theme component-state consumers', () => {
  it('uses semantic selected and badge pairs in application navigation', () => {
    const source = read('AppRoot.tsx');
    expect(source).toContain('t.components.selected.background');
    expect(source).toContain('t.components.selected.foreground');
    expect(source).toContain('t.components.selected.icon');
    expect(source).toContain('t.components.badge.background');
    expect(source).toContain('t.components.badge.foreground');
    expect(source).not.toContain('style={styles.badgeText}');
  });

  it('keeps shared Button and Chip states opaque and contrast-normalized', () => {
    const source = read('../../ui/src/primitives.tsx');
    const button = source.slice(
      source.indexOf('export function Button'),
      source.indexOf('/** A pressable chip'),
    );
    const chip = source.slice(
      source.indexOf('export function Chip'),
      source.indexOf('export function Pill'),
    );
    expect(button).toContain('resolveButtonVisualState');
    expect(button).toContain('visual.focusInner');
    expect(button).toContain('visual.focusOuter');
    expect(button).toContain('styles.buttonFocusOuter');
    expect(button).not.toMatch(/opacity\s*:/);
    expect(chip).toContain('resolveChipVisualState');
    expect(chip).toContain('styles.chipFocusOuter');
  });

  it('uses opaque semantic states for palette, disabled query controls, and hidden chart legends', () => {
    const palette = read('components/CommandPalette.tsx');
    const query = read('screens/QueryScreen.tsx');
    const chart = read('components/ToolLineChart.tsx');
    expect(palette).toContain('t.components.selected.mutedForeground');
    expect(palette).toContain('t.components.disabled.foreground');
    expect(palette).not.toMatch(/opacity:\s*disabled\s*\?/);
    expect(query).toContain('t.components.disabled.foreground');
    expect(query).not.toContain('resultTabActionDisabled: { opacity:');
    expect(chart).toContain('t.components.disabled.foreground');
    expect(chart).not.toMatch(/opacity:\s*(?:hidden\.has\(item\.id\)|isHidden)\s*\?/);
  });

  it('does not let background-pair repair return a known failing fallback', () => {
    const source = read('../../ui/src/theme-values.ts');
    const repair = source.slice(
      source.indexOf('function backgroundBehind'),
      source.indexOf('export function normalizeThemePaletteContrast'),
    );
    expect(repair).not.toContain('return fallback;');
    expect(repair).toContain('throw new Error');
  });
});
