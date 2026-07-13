import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const APP_ID = 'com.librestatic.openmibcatalog';

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
    expect(desktop.build?.executableName).toBe('open-mib-catalog');
    expect(desktop.build?.linux?.syncDesktopName).toBe(true);
    expect(desktop.build?.rpm?.packageName).toBe('open-mib-catalog');
    expect(desktop.scripts?.['dist:linux']).toContain('--x64 --arm64');
    expect(desktop.scripts?.['dist:windows']).toContain('--x64');
    expect(desktop.scripts?.['dist:mac']).toContain('--x64 --arm64');
  });

  it('keeps Flatpak metadata aligned with the canonical application id', () => {
    expect(read('packaging/flatpak/com.librestatic.openmibcatalog.yml')).toContain(
      `app-id: ${APP_ID}`,
    );
    expect(read('packaging/flatpak/com.librestatic.openmibcatalog.metainfo.xml')).toContain(
      `<id>${APP_ID}</id>`,
    );
    expect(read('packaging/flatpak/com.librestatic.openmibcatalog.desktop')).toContain(
      `X-Flatpak=${APP_ID}`,
    );
    expect(read('packaging/flatpak/com.librestatic.openmibcatalog.yml')).toContain(
      `${APP_ID}.svg /app/share/icons/hicolor/scalable/apps/${APP_ID}.svg`,
    );
    expect(read('packaging/flatpak/com.librestatic.openmibcatalog.yml')).toContain(
      '- --socket=x11',
    );
    expect(read(`packaging/flatpak/${APP_ID}.svg`)).toContain(`<title>Open MIB Catalog</title>`);
  });

  it('does not retain the provisional application id in release configuration', () => {
    const releaseFiles = [
      'apps/mobile/app.json',
      'apps/desktop/package.json',
      'packaging/flatpak/com.librestatic.openmibcatalog.yml',
      'packaging/flatpak/com.librestatic.openmibcatalog.metainfo.xml',
      'packaging/flatpak/com.librestatic.openmibcatalog.desktop',
    ];

    for (const path of releaseFiles) expect(read(path)).not.toContain('org.openmibcatalog.app');
  });
});
