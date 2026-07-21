import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, 'components', 'ToastHost.tsx'), 'utf8');

describe('ToastHost input behavior', () => {
  it('uses a non-modal pointer-transparent overlay on every platform', () => {
    expect(source).not.toMatch(/\bModal\b/);
    expect(source).toContain('StyleSheet.absoluteFill');
    expect(source.match(/pointerEvents="box-none"/g)).toHaveLength(2);
  });
});
