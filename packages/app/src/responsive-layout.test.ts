import { describe, expect, it } from 'vitest';
import * as responsiveLayout from './responsive-layout';
import {
  adjustSplitRatio,
  BROWSE_CATALOG_SPLIT_MINIMUMS,
  BROWSE_NAVIGATOR_SPLIT_MINIMUMS,
  canFitSplit,
  clampSplitRatio,
  getResponsiveMode,
  getSplitPaneSizes,
  splitAccessibilityDelta,
  shouldUseEmbeddedQuerySplit,
  getWindowScopedStorageKey,
  getWorkspaceDefaultRatio,
} from './responsive-layout';

describe('getResponsiveMode', () => {
  it('keeps phone-sized views compact', () => {
    expect(getResponsiveMode(639)).toBe('compact');
  });

  it('uses the navigation rail at tablet widths', () => {
    expect(getResponsiveMode(640)).toBe('medium');
    expect(getResponsiveMode(1023)).toBe('medium');
  });

  it('uses the expanded sidebar at desktop widths', () => {
    expect(getResponsiveMode(1024)).toBe('expanded');
  });
});

describe('embedded query layout', () => {
  it('keeps the phone operation sheet in one column', () => {
    expect(shouldUseEmbeddedQuerySplit(true, false)).toBe(false);
  });

  it('uses the console split only when the viewport supports it', () => {
    expect(shouldUseEmbeddedQuerySplit(true, true)).toBe(true);
    expect(shouldUseEmbeddedQuerySplit(false, true)).toBe(false);
  });
});

describe('split workspace sizing', () => {
  it('maps only supported accessibility actions to resize deltas', () => {
    expect(splitAccessibilityDelta('increment')).toBe(24);
    expect(splitAccessibilityDelta('decrement')).toBe(-24);
    expect(splitAccessibilityDelta('activate')).toBeNull();
    expect(splitAccessibilityDelta('escape')).toBeNull();
  });

  it('includes the divider when deciding whether declared pane minimums fit', () => {
    expect(canFitSplit(768, { minPrimary: 340, minSecondary: 420 })).toBe(false);
    expect(canFitSplit(769, { minPrimary: 340, minSecondary: 420 })).toBe(true);
  });

  it('subtracts the divider before assigning exact pane sizes', () => {
    expect(getSplitPaneSizes(769, 0.5, { minPrimary: 340, minSecondary: 420 })).toEqual({
      primary: 340,
      secondary: 420,
      ratio: 340 / 760,
    });
  });

  it('uses measured post-chrome width rather than the viewport breakpoint', () => {
    expect(getResponsiveMode(640)).toBe('medium');
    expect(canFitSplit(576, { minPrimary: 340, minSecondary: 420 })).toBe(false);
    expect(getResponsiveMode(1023)).toBe('medium');
    expect(canFitSplit(747, { minPrimary: 340, minSecondary: 420 })).toBe(false);
    expect(getResponsiveMode(1024)).toBe('expanded');
    expect(canFitSplit(804, { minPrimary: 340, minSecondary: 420 })).toBe(true);
  });

  it('re-evaluates viability when an expanded desktop window is resized', () => {
    expect(canFitSplit(900, { minPrimary: 340, minSecondary: 420 })).toBe(true);
    expect(canFitSplit(720, { minPrimary: 340, minSecondary: 420 })).toBe(false);
  });

  it('accounts for the complete nested Browse split in the outer secondary minimum', () => {
    expect(BROWSE_NAVIGATOR_SPLIT_MINIMUMS).toEqual({ minPrimary: 300, minSecondary: 380 });
    expect(BROWSE_CATALOG_SPLIT_MINIMUMS.minSecondary).toBe(689);
    expect(canFitSplit(857, BROWSE_CATALOG_SPLIT_MINIMUMS)).toBe(false);
    expect(canFitSplit(858, BROWSE_CATALOG_SPLIT_MINIMUMS)).toBe(true);
    expect(canFitSplit(688, BROWSE_NAVIGATOR_SPLIT_MINIMUMS)).toBe(false);
    expect(canFitSplit(689, BROWSE_NAVIGATOR_SPLIT_MINIMUMS)).toBe(true);
  });

  it('clamps the primary pane to its minimum width', () => {
    expect(
      clampSplitRatio({ containerSize: 1000, ratio: 0.1, minPrimary: 280, minSecondary: 360 }),
    ).toBeCloseTo(0.28);
  });

  it('clamps the secondary pane to its minimum width', () => {
    expect(
      clampSplitRatio({ containerSize: 1000, ratio: 0.9, minPrimary: 280, minSecondary: 360 }),
    ).toBeCloseTo(0.64);
  });

  it('falls back to an even split when both minimums cannot fit', () => {
    expect(
      clampSplitRatio({ containerSize: 500, ratio: 0.8, minPrimary: 320, minSecondary: 320 }),
    ).toBe(0.5);
  });

  it('moves the divider by pixels while preserving minimums', () => {
    expect(
      adjustSplitRatio({
        containerSize: 1000,
        ratio: 0.38,
        delta: 100,
        minPrimary: 280,
        minSecondary: 360,
      }),
    ).toBeCloseTo(0.48);
  });
});

describe('workspace defaults', () => {
  it('preserves the expanded Browse ratio once the complete nested minimum fits', () => {
    const minimums = (
      responsiveLayout as typeof responsiveLayout & {
        BROWSE_CATALOG_SPLIT_MINIMUMS?: { minPrimary: number; minSecondary: number };
      }
    ).BROWSE_CATALOG_SPLIT_MINIMUMS;

    expect(minimums).toEqual({ minPrimary: 160, minSecondary: 689 });
    expect(
      clampSplitRatio({
        containerSize: 900,
        ratio: getWorkspaceDefaultRatio('mibModules'),
        ...minimums!,
      }),
    ).toBeCloseTo(0.2);
  });

  it('uses a 20/40/40 default for the expanded Browse workspace', () => {
    const catalogRatio = getWorkspaceDefaultRatio('mibModules');
    const navigatorRatio = (1 - catalogRatio) * getWorkspaceDefaultRatio('browse');
    const inspectorRatio = 1 - catalogRatio - navigatorRatio;

    expect(catalogRatio).toBeCloseTo(0.2);
    expect(navigatorRatio).toBeCloseTo(0.4);
    expect(inspectorRatio).toBeCloseTo(0.4);
  });

  it('splits the tablet Browse navigator and inspector evenly', () => {
    expect(getWorkspaceDefaultRatio('browse')).toBe(0.5);
  });

  it('uses screen-specific proportions for the other workspaces', () => {
    expect(getWorkspaceDefaultRatio('query')).toBe(0.36);
    expect(getWorkspaceDefaultRatio('traps')).toBe(0.42);
    expect(getWorkspaceDefaultRatio('mibs')).toBe(0.36);
    expect(getWorkspaceDefaultRatio('settings')).toBe(0.28);
  });
});

describe('window-scoped workspace persistence', () => {
  it('keeps pane and dock preferences independent between Electron windows', () => {
    expect(getWindowScopedStorageKey('window-2', 'dock:mib-navigation')).toBe(
      'mibbeacon:window-2:dock:mib-navigation',
    );
  });
});
