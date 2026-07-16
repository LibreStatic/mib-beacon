import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('branding refresh', () => {
  it('keeps the supplied mark synchronized across application and Flatpak vectors', () => {
    const canonical = read('assets/brand/mib-beacon.svg').trim();

    expect(read('packages/app/src/mib-beacon-mark.ts')).toContain(canonical);
    expect(read('packaging/flatpak/com.librestatic.mibbeacon.svg').trim()).toBe(canonical);
  });

  it('uses platform-safe shared launcher inputs', () => {
    const desktop = JSON.parse(read('apps/desktop/package.json'));
    const mobile = JSON.parse(read('apps/mobile/app.json'));

    expect(desktop.build.icon).toBe('../../assets/brand/mib-beacon.png');
    expect(mobile.expo.icon).toBe('../../assets/brand/mib-beacon.png');
    expect(mobile.expo.android.adaptiveIcon).toEqual({
      foregroundImage: '../../assets/brand/mib-beacon-adaptive-foreground.png',
      backgroundColor: '#020617',
    });
    expect(existsSync(new URL('../assets/brand/mib-beacon.png', import.meta.url))).toBe(true);
    expect(
      existsSync(new URL('../assets/brand/mib-beacon-adaptive-foreground.png', import.meta.url)),
    ).toBe(true);
  });

  it('shows the mark while the browser bundle loads and installs an SVG favicon', () => {
    const html = read('apps/server/src/web/index.html');

    expect(existsSync(new URL('../apps/server/src/web/public/favicon.svg', import.meta.url))).toBe(true);
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(html).toContain('class="boot-screen"');
    expect(html).toContain('class="boot-logo"');
    expect(html).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('matches the static loading screen to the saved or system theme before React mounts', () => {
    const html = read('apps/server/src/web/index.html');

    expect(html).toContain("localStorage.getItem('mibbeacon:theme')");
    expect(html).toContain('document.documentElement.dataset.bootTheme');
    expect(html).toContain("html[data-boot-theme='light'] .boot-screen");
    expect(html).toContain("html[data-boot-theme='dark'] .boot-screen");
  });

  it('briefly fades out the loading shell after the application mounts', () => {
    const html = read('apps/server/src/web/index.html');
    const main = read('apps/server/src/web/main.tsx');

    expect(html).toContain('.boot-screen--exit');
    expect(html).toContain('transition: opacity 120ms ease-out');
    expect(main).toContain("bootScreen?.classList.add('boot-screen--exit')");
    expect(main).toContain('window.setTimeout(() => bootScreen?.remove(), 120);');
  });

  it('uses the horizontal mark-and-copy lockup in every app header', () => {
    const appRoot = read('packages/app/src/AppRoot.tsx');

    expect(appRoot).toContain('styles.brandLockup');
    expect(appRoot).toContain('styles.compactBrand');
    expect(appRoot).toContain('>Network workbench</Text>');
    expect(appRoot).toContain("flexDirection: 'row'");
  });

  it('centers the canonical mark beneath the README title', () => {
    expect(read('README.md')).toContain(
      '<p align="center">\n  <img src="assets/brand/mib-beacon.svg" width="220" alt="MIB Beacon logo" />\n</p>',
    );
  });
});
