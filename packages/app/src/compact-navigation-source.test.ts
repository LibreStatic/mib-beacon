import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');

describe('compact bottom navigation accessibility', () => {
  it('exposes bottom destinations and More as selectable tabs', () => {
    expect(source).toContain('nativeID="app-bottom-navigation"');
    expect(source).toContain('accessibilityRole="tablist"');
    expect(source).toContain('accessibilityRole="tab"');
    expect(source).toContain('accessibilityState={{ selected: active }}');
    expect(source).toContain('aria-selected={active}');
  });
});
