import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('release build inputs', () => {
  it('keeps shared icons and the notarization hook in tracked source locations', () => {
    const desktop = JSON.parse(
      readFileSync(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'),
    );
    const mobile = JSON.parse(
      readFileSync(new URL('../apps/mobile/app.json', import.meta.url), 'utf8'),
    );

    expect(desktop.build.icon).toBe('../../assets/brand/mib-beacon.png');
    expect(desktop.build.afterSign).toBe('scripts/notarize.cjs');
    expect(mobile.expo.icon).toBe('../../assets/brand/mib-beacon.png');
    expect(mobile.expo.android.adaptiveIcon.foregroundImage).toBe(
      '../../assets/brand/mib-beacon-adaptive-foreground.png',
    );
    expect(existsSync(new URL('../assets/brand/mib-beacon.png', import.meta.url))).toBe(true);
    expect(
      existsSync(new URL('../assets/brand/mib-beacon-adaptive-foreground.png', import.meta.url)),
    ).toBe(true);
    expect(existsSync(new URL('../apps/desktop/scripts/notarize.cjs', import.meta.url))).toBe(true);
  });
});
