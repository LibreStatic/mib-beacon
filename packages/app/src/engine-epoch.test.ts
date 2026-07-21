import { describe, expect, it } from 'vitest';
import { EngineEpochSlot } from './engine-epoch';

describe('engine epoch subtree identity', () => {
  it('keeps the epoch for the same engine and changes it for A to B', () => {
    const slot = new EngineEpochSlot<object>();
    const a = {};
    const b = {};
    expect(slot.key(a)).toBe(slot.key(a));
    expect(slot.key(b)).not.toBe(slot.key(a));
  });
});
