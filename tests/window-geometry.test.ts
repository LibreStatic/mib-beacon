import { describe, expect, it } from 'vitest';
import {
  getNextWindowBounds,
  getVisibleWindowBounds,
} from '../apps/desktop/src/main/window-geometry';

const display = { x: 0, y: 0, width: 1920, height: 1080 };

describe('getVisibleWindowBounds', () => {
  it('keeps valid saved bounds unchanged', () => {
    expect(getVisibleWindowBounds({ x: 100, y: 80, width: 1200, height: 800 }, [display])).toEqual({
      x: 100,
      y: 80,
      width: 1200,
      height: 800,
    });
  });

  it('moves off-screen bounds onto an active display', () => {
    expect(
      getVisibleWindowBounds({ x: 2500, y: 100, width: 1100, height: 780 }, [display]),
    ).toEqual({ x: 410, y: 150, width: 1100, height: 780 });
  });

  it('shrinks oversized bounds to the active work area', () => {
    expect(getVisibleWindowBounds({ x: 0, y: 0, width: 2500, height: 1400 }, [display])).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });
});

describe('getNextWindowBounds', () => {
  it('offsets a new window from the focused window', () => {
    expect(getNextWindowBounds({ x: 100, y: 80, width: 1100, height: 780 }, display)).toEqual({
      x: 128,
      y: 108,
      width: 1100,
      height: 780,
    });
  });

  it('wraps back into the display when an offset would overflow', () => {
    expect(getNextWindowBounds({ x: 810, y: 300, width: 1100, height: 780 }, display)).toEqual({
      x: 410,
      y: 150,
      width: 1100,
      height: 780,
    });
  });
});
