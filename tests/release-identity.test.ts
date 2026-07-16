import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const APP_ID = 'com.librestatic.mibbeacon';
const PRODUCT_NAME = 'MIB Beacon';
const RELEASE_VERSION = '0.1.0-beta.1';

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('release identity', () => {
  it('loads the preload bundle using electron-vite output filename', () => {
    const main = read('apps/desktop/src/main/index.ts');
    expect(main).toContain('../preload/index.js');
    expect(main).not.toContain('../preload/index.mjs');
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
        publish?: { provider?: string; releaseType?: string };
      };
    };

    expect(mobile.expo.android.package).toBe(APP_ID);
    expect(mobile.expo.ios.bundleIdentifier).toBe(APP_ID);
    expect(desktop.build?.appId).toBe(APP_ID);
    expect(desktop.desktopName).toBe(APP_ID);
    expect(desktop.build?.executableName).toBe('mib-beacon');
    expect(desktop.build?.linux?.syncDesktopName).toBe(true);
    expect(desktop.build?.rpm?.packageName).toBe('mib-beacon');
    expect(desktop.build?.publish).toEqual({
      provider: 'github',
      releaseType: 'prerelease',
    });
    expect(desktop.scripts?.['dist:linux']).toContain('--x64 --arm64');
    expect(desktop.scripts?.['dist:windows']).toContain('--x64');
    expect(desktop.scripts?.['dist:mac']).toContain('--x64 --arm64');
  });

  it('keeps Flatpak metadata aligned with the canonical application id', () => {
    expect(read(`packaging/flatpak/${APP_ID}.yml`)).toContain(`app-id: ${APP_ID}`);
    expect(read(`packaging/flatpak/${APP_ID}.metainfo.xml`)).toContain(`<id>${APP_ID}</id>`);
    expect(read(`packaging/flatpak/${APP_ID}.desktop`)).toContain(`X-Flatpak=${APP_ID}`);
    expect(read(`packaging/flatpak/${APP_ID}.yml`)).toContain(
      `${APP_ID}.svg /app/share/icons/hicolor/scalable/apps/${APP_ID}.svg`,
    );
    expect(read(`packaging/flatpak/${APP_ID}.yml`)).toContain('- --socket=x11');
    expect(read(`packaging/flatpak/${APP_ID}.yml`)).toContain('--ozone-platform-hint=auto');
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
      build?: { productName?: string; artifactName?: string; nsis?: { perMachine?: boolean } };
    };

    expect(mobile.expo.name).toBe(PRODUCT_NAME);
    expect(mobile.expo.slug).toBe('mib-beacon');
    expect(mobile.expo.scheme).toBe('mibbeacon');
    expect(desktop.name).toBe('@mibbeacon/desktop');
    expect(desktop.description).toContain('SNMP toolkit');
    expect(desktop.build?.productName).toBe(PRODUCT_NAME);
    expect(desktop.build?.artifactName).toBe('MIB-Beacon-${version}-${os}-${arch}.${ext}');
    expect(desktop.build?.nsis?.perMachine).toBe(true);
  });

  it('uses the packaged MIB Beacon mark in the application chrome', () => {
    const appRoot = read('packages/app/src/AppRoot.tsx');
    const markComponent = read('packages/app/src/components/MibBeaconMark.tsx');
    const markSource = read('packages/app/src/mib-beacon-mark.ts');
    const packagedMark = read('assets/brand/mib-beacon.svg').trim();

    expect(appRoot).toContain("import { MibBeaconMark } from './components/MibBeaconMark';");
    expect(appRoot).toContain('<MibBeaconMark size={38} />');
    expect(appRoot).not.toContain('>◉</Text>');
    expect(markComponent).toContain('MIB_BEACON_MARK_SVG');
    expect(markSource).toContain(packagedMark);
  });

  it('keeps every package and Expo manifest on the beta release version', () => {
    const rootVersion = JSON.parse(read('package.json')).version;
    const manifests = [
      'apps/desktop/package.json',
      'apps/mobile/package.json',
      'apps/server/package.json',
      'packages/app/package.json',
      'packages/core/package.json',
      'packages/resolver/package.json',
      'packages/smi/package.json',
      'packages/transport/package.json',
      'packages/ui/package.json',
    ];

    expect(rootVersion).toBe(RELEASE_VERSION);
    for (const path of manifests) {
      expect(JSON.parse(read(path)).version, path).toBe(rootVersion);
    }

    expect(JSON.parse(read('apps/mobile/app.json')).expo.version).toBe(rootVersion);
  });

  it('publishes every supported package with short-lived workflow artifacts', () => {
    const workflow = read('.github/workflows/release.yml');

    for (const extension of [
      '*.AppImage',
      '*.deb',
      '*.rpm',
      '*.flatpak',
      '*.exe',
      '*.dmg',
      '*.apk',
      '*.aab',
      '*.ipa',
    ]) {
      expect(workflow, extension).toContain(extension);
    }

    expect(workflow).toContain('retention-days: 1');
    expect(workflow).toContain('SHA256SUMS');
    expect(workflow).toContain('apps/desktop/release/latest-linux*.yml');
    expect(workflow).toContain('apps/desktop/release/latest.yml');
    expect(workflow).toContain('apps/desktop/release/latest-mac.yml');
    expect(workflow).not.toContain('artifacts/**/*');
    expect(workflow).not.toContain('apps/desktop/release/*\n');
    expect(workflow).not.toContain('apps/desktop/release/*.yml');
    expect(workflow).not.toContain('apps/desktop/release/*.yaml');
    expect(workflow).not.toContain('builder-debug.yml');
    expect(workflow).not.toContain('builder-effective-config.yaml');
  });

  it('validates tags and applies the documented release housekeeping policy', () => {
    const workflow = read('.github/workflows/release.yml');

    expect(workflow).toContain('dev/release-policy.mjs');
    expect(workflow).toContain('RELEASE_STORAGE_CAP_BYTES: 524288000');
    expect(workflow).toContain('gh api --method DELETE');
    expect(workflow).toContain('gh release upload');
    expect(workflow).toContain('--clobber');
    expect(workflow).toContain('--prerelease');
    expect(workflow).toContain('CODE_SIGNING_ALLOWED=NO');
    expect(workflow).toContain('-sdk iphoneos');
  });

  it('downloads the published release and verifies its exact inventory and checksums', () => {
    const workflow = read('.github/workflows/release.yml');

    expect(workflow).toContain('Verify published inventory and checksums');
    expect(workflow).toContain('gh release download "$RELEASE_TAG" --dir published-assets');
    expect(workflow).toContain('diff -u expected-assets.txt published-assets.txt');
    expect(workflow).toContain('sha256sum --check --strict SHA256SUMS');
    expect(workflow).toContain('Downloaded SHA-256 checksums: all passed');
  });

  it('installs and exercises target-host desktop packages before publication', () => {
    const workflow = read('.github/workflows/release.yml');

    expect(workflow).toContain('Install, launch, and uninstall NSIS package');
    expect(workflow).toContain('$installation.ExitCode -ne 0');
    expect(workflow).toContain("$uninstallKey.Publisher -ne 'LibreStatic'");
    expect(workflow).toContain("@('.mib', '.my', '.smi')");
    expect(workflow).toContain('Installed application did not report SMOKE_MAIN_WINDOW_READY');
    expect(workflow).toContain('Installed executable remained after uninstall');
    expect(workflow).toContain(
      "bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier'",
    );
    expect(workflow).toContain('Mounted DMG main-window smoke: passed');
    expect(workflow).toContain('package-smoke-${{ matrix.platform }}');
  });

  it('runs hosted Linux distributables and keeps the canonical Flatpak filename', () => {
    const workflow = read('.github/workflows/release.yml');

    expect(workflow).toContain('Exercise hosted AppImage and deb packages');
    expect(workflow).toContain('x86_64 AppImage FUSE launch: passed');
    expect(workflow).toContain('amd64 deb install/main-window launch/uninstall: passed');
    expect(workflow).toContain('Install and launch hosted Flatpak bundle');
    expect(workflow).toContain('flatpak install --user --noninteractive --bundle "$bundle"');
    expect(workflow).toContain('Install/main-window launch/uninstall: passed');
    expect(workflow).toContain(
      'flatpak build-bundle repo "MIB-Beacon-${version}-linux-x86_64.flatpak"',
    );
    expect(workflow).not.toContain('MIB-Beacon-${GITHUB_REF_NAME}-linux-x86_64.flatpak');
  });

  it('inspects the hosted unsigned IPA as an unsigned physical-device archive', () => {
    const workflow = read('.github/workflows/release.yml');

    expect(workflow).toContain('Inspect unsigned iOS device archive');
    expect(workflow).toContain('unzip -t');
    expect(workflow).toContain('CFBundleIdentifier');
    expect(workflow).toContain('DTPlatformName');
    expect(workflow).toContain('com.librestatic.mibbeacon');
    expect(workflow).toContain(
      'Expected an unsigned application, but codesign verification succeeded',
    );
  });

  it('runs installed rc1 to rc2 updater smokes on Linux and Windows', () => {
    const workflow = read('.github/workflows/release.yml');

    expect(workflow).toContain('update-smoke:');
    expect(workflow).toContain("endsWith(needs.verify.outputs.version, '-rc.2')");
    expect(workflow).toContain('Download the rc1 installer');
    expect(workflow).toContain('--update-smoke-test');
    expect(workflow).toContain("state -ne 'complete'");
    expect(workflow).toContain('update-smoke-evidence');
  });

  it('wires desktop updates, file-association review, and conditional signing', () => {
    const desktop = JSON.parse(read('apps/desktop/package.json')) as {
      dependencies?: Record<string, string>;
      build?: { afterSign?: string; fileAssociations?: { ext: string }[] };
    };
    const main = read('apps/desktop/src/main/index.ts');
    const preload = read('apps/desktop/src/preload/index.ts');
    expect(desktop.dependencies?.['electron-updater']).toBeTruthy();
    expect(desktop.build?.afterSign).toBe('scripts/notarize.cjs');
    expect(desktop.build?.fileAssociations?.map(({ ext }) => ext)).toEqual(['mib', 'my', 'smi']);
    expect(main).toContain("app.on('open-file'");
    expect(main).toContain('mibPathsFromArguments(arguments_)');
    expect(main).toContain('configureUpdates()');
    expect(preload).toContain('takeOpenFiles');
    expect(preload).toContain('updates:');
  });

  it('keeps Android permissions minimal and release signing credential-gated', () => {
    const mobile = JSON.parse(read('apps/mobile/app.json')) as {
      expo: {
        runtimeVersion?: { policy?: string };
        updates?: { enabled?: boolean; checkAutomatically?: string };
        android: { permissions?: string[]; blockedPermissions?: string[] };
        plugins?: string[];
      };
    };
    expect(mobile.expo.runtimeVersion?.policy).toBe('appVersion');
    expect(mobile.expo.updates).toMatchObject({ enabled: false, checkAutomatically: 'NEVER' });
    expect(mobile.expo.android.permissions).toEqual(['android.permission.INTERNET']);
    expect(mobile.expo.android.blockedPermissions).toContain(
      'android.permission.ACCESS_FINE_LOCATION',
    );
    expect(mobile.expo.plugins).toContain('expo-updates');
    expect(read('apps/mobile/eas.json')).toContain('"buildType": "app-bundle"');
    expect(read('apps/mobile/plugins/with-release-signing.cjs')).toContain(
      'signingConfigs.release',
    );
  });

  it('gates licenses, payload privacy, and desktop/mobile smoke tests in release CI', () => {
    const workflow = read('.github/workflows/release.yml');
    expect(workflow).toContain('pnpm verify:licenses');
    expect(workflow).toContain('scan-release-artifacts.mjs');
    expect(workflow).toContain('SMOKE_MAIN_WINDOW_READY');
    expect(workflow).toContain('reactivecircus/android-emulator-runner@v2');
    expect(workflow).toContain('verify-android-permissions.mjs');
    expect(workflow).toContain('ANDROID_KEYSTORE_BASE64');
    expect(workflow).toContain('prepare-flatpak-release.mjs');
    expect(workflow).toContain('Require Windows signing credentials');
    expect(workflow).toContain('Verify Windows Authenticode signature');
    expect(workflow).toContain('Get-AuthenticodeSignature');
    expect(workflow).toContain('Windows Authenticode verification');
    expect(workflow).toContain('Require macOS signing and notarization credentials');
    expect(workflow).toContain('Verify notarized macOS application');
    expect(workflow).toContain('xcrun stapler validate');
    expect(workflow).toContain('macOS signing and notarization verification');
    expect(workflow).toContain('verify --verbose --print-certs');
    expect(workflow).toContain('jarsigner -verify -certs');
    expect(workflow).not.toContain('jarsigner -verify -strict -certs');
    expect(workflow).toContain('Android publication-signature verification');
    expect(workflow).toContain('keytool -printcert -jarfile');
  });

  it('ships contribution, disclosure, user, release, and generated About metadata', () => {
    const readme = read('README.md');
    expect(read('CONTRIBUTING.md')).toContain('Developer Certificate of Origin');
    expect(read('SECURITY.md')).toContain('/security/advisories/new');
    expect(read('docs/user/custom-sources.md')).toContain('Name JSONPath');
    expect(read('docs/user/faq.md')).toContain('Expo Go');
    expect(read('docs/user/updates-signing-and-stores.md')).toContain('Automatic checks are off');
    expect(read('docs/releases/v0.1.0-beta.1.md')).toContain('First feature beta release');
    expect(read('packages/app/src/generated/release-info.ts')).toContain('/tree/v0.1.0-beta.1');
    expect(read('packages/app/src/screens/SettingsScreen.tsx')).toContain('Dependency licenses');
    expect(readme).toContain(
      'The tag workflow distributes a clearly named unsigned Windows beta installer by default.',
    );
    expect(readme).toContain(
      'The tag workflow distributes a clearly named unsigned macOS beta DMG by default.',
    );
    expect(readme).toContain("'/opt/MIB Beacon/mib-beacon'");
    expect(readme).toContain('pnpm audit:artifact-identity');
    expect(readme).toContain('pnpm audit:ubuntu-vm-appimage');
    expect(readme).toContain("falls back to Chromium's `--no-sandbox` mode");
    expect(readme).toContain('Prefer the Flatpak or a native deb/rpm package');
    expect(readme).not.toContain('/usr/bin/mib-beacon');
  });
});
