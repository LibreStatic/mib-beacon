import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const APP_ID = 'com.librestatic.mibbeacon';
const PRODUCT_NAME = 'MIB Beacon';

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('release identity', () => {
  it('loads the preload bundle using electron-vite output filename', () => {
    const main = read('apps/desktop/src/main/index.ts');
    expect(main).toContain("../preload/index.js");
    expect(main).not.toContain("../preload/index.mjs");
    expect(main).toContain('!app.isPackaged && process.env.ELECTRON_RENDERER_URL');
  });

  it('uses the LibreStatic application id across mobile and desktop packaging', () => {
    const mobile = JSON.parse(read('apps/mobile/app.json')) as {
      expo: { android: { package: string }; ios: { bundleIdentifier: string } };
    };
    const desktop = JSON.parse(read('apps/desktop/package.json')) as {
      desktopName?: string;
      scripts?: Record<string, string>;
      build?: {
        appId?: string;
        executableName?: string;
        linux?: { syncDesktopName?: boolean };
        rpm?: { packageName?: string };
      };
    };

    expect(mobile.expo.android.package).toBe(APP_ID);
    expect(mobile.expo.ios.bundleIdentifier).toBe(APP_ID);
    expect(desktop.build?.appId).toBe(APP_ID);
    expect(desktop.desktopName).toBe(APP_ID);
    expect(desktop.build?.executableName).toBe('mib-beacon');
    expect(desktop.build?.linux?.syncDesktopName).toBe(true);
    expect(desktop.build?.rpm?.packageName).toBe('mib-beacon');
    expect(desktop.scripts?.['dist:linux']).toContain('--x64 --arm64');
    expect(desktop.scripts?.['dist:windows']).toContain('--x64');
    expect(desktop.scripts?.['dist:mac']).toContain('--x64 --arm64');
  });

  it('keeps Flatpak metadata aligned with the canonical application id', () => {
    expect(read(`packaging/flatpak/${APP_ID}.yml`)).toContain(
      `app-id: ${APP_ID}`,
    );
    expect(read(`packaging/flatpak/${APP_ID}.metainfo.xml`)).toContain(
      `<id>${APP_ID}</id>`,
    );
    expect(read(`packaging/flatpak/${APP_ID}.desktop`)).toContain(
      `X-Flatpak=${APP_ID}`,
    );
    expect(read(`packaging/flatpak/${APP_ID}.yml`)).toContain(
      `${APP_ID}.svg /app/share/icons/hicolor/scalable/apps/${APP_ID}.svg`,
    );
    expect(read(`packaging/flatpak/${APP_ID}.yml`)).toContain(
      '- --socket=x11',
    );
    expect(read(`packaging/flatpak/${APP_ID}.svg`)).toContain(`<title>${PRODUCT_NAME}</title>`);
  });

  it('does not retain the provisional application id in release configuration', () => {
    const releaseFiles = [
      'apps/mobile/app.json',
      'apps/desktop/package.json',
      `packaging/flatpak/${APP_ID}.yml`,
      `packaging/flatpak/${APP_ID}.metainfo.xml`,
      `packaging/flatpak/${APP_ID}.desktop`,
    ];

    for (const path of releaseFiles) {
      expect(read(path)).not.toContain('org.openmibcatalog.app');
      expect(read(path)).not.toContain('com.librestatic.openmibcatalog');
      expect(read(path)).not.toContain('Open MIB Catalog');
    }
  });

  it('uses the new product, package scope, scheme, and generic descriptor', () => {
    const mobile = JSON.parse(read('apps/mobile/app.json')) as {
      expo: { name: string; slug: string; scheme: string };
    };
    const desktop = JSON.parse(read('apps/desktop/package.json')) as {
      name: string;
      description: string;
      build?: { productName?: string; artifactName?: string };
    };

    expect(mobile.expo.name).toBe(PRODUCT_NAME);
    expect(mobile.expo.slug).toBe('mib-beacon');
    expect(mobile.expo.scheme).toBe('mibbeacon');
    expect(desktop.name).toBe('@mibbeacon/desktop');
    expect(desktop.description).toContain('SNMP toolkit');
    expect(desktop.build?.productName).toBe(PRODUCT_NAME);
    expect(desktop.build?.artifactName).toBe('MIB-Beacon-${version}-${os}-${arch}.${ext}');
  });
});
