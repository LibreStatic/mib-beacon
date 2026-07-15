import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('tablet navigation tooltips', () => {
  it('layers the compact rail above the adjacent workbench body', () => {
    const source = readFileSync(
      new URL('../packages/app/src/AppRoot.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toMatch(/sidebar:\s*\{[^}]*zIndex:\s*1[^}]*\}/s);
  });

  it('separates rail tooltips from their buttons and centers their labels', () => {
    const source = readFileSync(
      new URL('../packages/app/src/AppRoot.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toMatch(
      /navTooltip:\s*\{[^}]*left:\s*56[^}]*alignItems:\s*'center'[^}]*\}/s,
    );
    expect(source).toMatch(/navTooltipText:\s*\{[^}]*textAlign:\s*'center'[^}]*\}/s);
  });
});
