import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function alphaBounds(path: string) {
  const png = readFileSync(new URL(`../${path}`, import.meta.url));
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const chunks: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
    } else if (type === 'IDAT') chunks.push(data);
    offset += length + 12;
  }

  expect(bitDepth).toBe(8);
  expect(colorType).toBe(6);
  const stride = width * 4;
  const source = inflateSync(Buffer.concat(chunks));
  const previous = Buffer.alloc(stride);
  let cursor = 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let safeInsetAlpha = -1;
  for (let y = 0; y < height; y += 1) {
    const filter = source[cursor++]!;
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const value = source[cursor++]!;
      const a = x >= 4 ? row[x - 4]! : 0;
      const b = previous[x]!;
      const c = x >= 4 ? previous[x - 4]! : 0;
      const prediction =
        filter === 1
          ? a
          : filter === 2
            ? b
            : filter === 3
              ? Math.floor((a + b) / 2)
              : filter === 4
                ? paeth(a, b, c)
                : 0;
      row[x] = (value + prediction) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      if (x === 212 && y === 212) safeInsetAlpha = row[x * 4 + 3]!;
      if (!row[x * 4 + 3]) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
    row.copy(previous);
  }
  return {
    width: right - left + 1,
    height: bottom - top + 1,
    left,
    top,
    right,
    bottom,
    safeInsetAlpha,
  };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

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
      backgroundColor: '#F8FAFC',
    });
    expect(existsSync(new URL('../assets/brand/mib-beacon.png', import.meta.url))).toBe(true);
    expect(
      existsSync(new URL('../assets/brand/mib-beacon-adaptive-foreground.png', import.meta.url)),
    ).toBe(true);
  });

  it('keeps Android adaptive foreground artwork inside the Material 66dp safe zone', () => {
    const bounds = alphaBounds('assets/brand/mib-beacon-adaptive-foreground.png');

    expect(bounds.width).toBeLessThanOrEqual(626);
    expect(bounds.height).toBeLessThanOrEqual(626);
    expect(bounds.left).toBeGreaterThanOrEqual(199);
    expect(bounds.top).toBeGreaterThanOrEqual(199);
    expect(1023 - bounds.right).toBeGreaterThanOrEqual(199);
    expect(1023 - bounds.bottom).toBeGreaterThanOrEqual(199);
    expect(bounds.safeInsetAlpha).toBe(0);
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
