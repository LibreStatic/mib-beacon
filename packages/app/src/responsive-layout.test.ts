import { describe, expect, it } from 'vitest';
import {
  adjustSplitRatio,
  clampSplitRatio,
  getResponsiveMode,
  getWorkspaceDefaultRatio,
} from './responsive-layout';

describe('getResponsiveMode', () => {
  it('keeps phone-sized views compact', () => {
    expect(getResponsiveMode(719)).toBe('compact');
  });

  it('uses the navigation rail at tablet widths', () => {
    expect(getResponsiveMode(720)).toBe('medium');
    expect(getResponsiveMode(1099)).toBe('medium');
  });

  it('uses the expanded sidebar at desktop widths', () => {
    expect(getResponsiveMode(1100)).toBe('expanded');
  });
});

describe('split workspace sizing', () => {
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
  it('uses screen-specific proportions', () => {
    expect(getWorkspaceDefaultRatio('browse')).toBe(0.38);
    expect(getWorkspaceDefaultRatio('query')).toBe(0.36);
    expect(getWorkspaceDefaultRatio('traps')).toBe(0.42);
    expect(getWorkspaceDefaultRatio('mibs')).toBe(0.36);
    expect(getWorkspaceDefaultRatio('settings')).toBe(0.28);
  });
});
