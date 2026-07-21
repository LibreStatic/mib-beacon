import { describe, expect, it } from 'vitest';
import { EngineOwnershipSlot } from './engine-ownership-slot';

describe('EngineProvider ownership', () => {
  it('replaces ownership synchronously by engine identity and refreshes after Strict Mode cleanup', () => {
    const slot = new EngineOwnershipSlot<object>();
    const engineA = {};
    const engineB = {};
    const a = slot.claim(engineA);
    const aToken = a.capture('provider-lifetime');
    const b = slot.claim(engineB);
    const bToken = b.capture('provider-lifetime');
    expect(a.owns(aToken)).toBe(false);
    expect(b.owns(bToken)).toBe(true);

    b.dispose();
    b.activate();
    const strictReplay = b.capture('provider-lifetime');
    expect(b.owns(bToken)).toBe(false);
    expect(b.owns(strictReplay)).toBe(true);
  });
});
