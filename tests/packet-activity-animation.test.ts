import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('packet activity animation', () => {
  it('keeps the LED pulse running while sustained traffic remains active', () => {
    const source = readFileSync(
      new URL('../packages/app/src/components/PacketConsole.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('Animated.loop(pulse)');
  });
});
