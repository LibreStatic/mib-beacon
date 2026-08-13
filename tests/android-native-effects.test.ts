import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Android release native-effects audit', () => {
  it('exercises the production notification and PNG-sharing adapters from emulator-only audit links', () => {
    const app = fs.readFileSync('apps/mobile/App.tsx', 'utf8');
    const audit = fs.readFileSync('apps/mobile/src/native-audit.ts', 'utf8');
    const host = fs.readFileSync('apps/mobile/src/native-host.ts', 'utf8');
    expect(app).toContain('installNativeEffectsAudit(nativeNotifications, shareNativeChartPng)');
    expect(audit).toContain('mibbeacon://localhost/__native-audit/notification');
    expect(audit).toContain('mibbeacon://localhost/__native-audit/share-png');
    expect(audit).toContain('isAndroidEmulator()');
    expect(audit).toContain('AUDIT_URLS.has(url)');
    expect(audit).toContain("Platform.OS !== 'android'");
    expect(audit).not.toContain("startsWith('mibbeacon://audit/");
    expect(audit).not.toContain('url.includes(');
    expect(host).toContain('Notifications.scheduleNotificationAsync');
    expect(host).toContain("capture.mimeType ?? 'image/png'");
    expect(host).toContain('setNotificationChannelAsync');

    const encoded = audit.match(/NATIVE_AUDIT_PNG_BASE64\s*=\s*\n?\s*'([^']+)'/)?.[1];
    expect(encoded).toBeTruthy();
    const png = Buffer.from(encoded!, 'base64');
    expect(png.subarray(0, 8)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
    expect(png).toHaveLength(68);
    expect(createHash('sha256').update(png).digest('hex')).toBe(
      '431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460',
    );
  });

  it('generates a deterministic receiver that opens the granted URI and validates PNG bytes', () => {
    const plugin = fs.readFileSync('apps/mobile/plugins/with-native-effects-audit.cjs', 'utf8');
    expect(plugin).toContain('Intent.ACTION_SEND.equals');
    expect(plugin).toContain('Intent.EXTRA_STREAM');
    expect(plugin).toContain('Intent.FLAG_GRANT_READ_URI_PERMISSION');
    expect(plugin).toContain('getContentResolver().openInputStream(uri)');
    expect(plugin).toContain('OpenableColumns.DISPLAY_NAME');
    expect(plugin).toContain('BitmapFactory.decodeByteArray');
    expect(plugin).toContain('invalid PNG signature');
    expect(plugin).toContain('mib-beacon-native-adapter-audit.png');
    expect(plugin).toContain("'android:host': 'localhost'");
    expect(plugin).toContain("'/__native-audit/notification'");
    expect(plugin).toContain("'/__native-audit/share-png'");
    expect(plugin).toContain('withFinalizedMod');
    expect(plugin).toContain('filter.data = [');
    expect(plugin).toContain('writeAndroidManifestAsync');
    expect(plugin).toContain('signingConfig signingConfigs.debug');
    expect(plugin).toContain('android:label="MIB Beacon audit receiver"');
  });

  it('uses semantic chooser selection and keeps audit evidence out of release assets', () => {
    const runner = fs.readFileSync('dev/audit/android-native-effects/run.sh', 'utf8');
    const workflow = fs.readFileSync('.github/workflows/release.yml', 'utf8');
    expect(runner).toContain('uiautomator dump');
    expect(runner).toContain("RECEIVER_LABEL='MIB Beacon audit receiver'");
    expect(runner).toContain('chooser_scrollable_container');
    expect(runner).not.toContain('input tap 540 520');
    expect(runner).toContain('mHidden==false');
    expect(runner).toContain('mIntercept=false');
    expect(runner).toContain('status --porcelain=v1 --untracked-files=all');
    expect(runner).toContain('cannot attest MIB_BEACON_AUDIT_COMMIT from a dirty worktree');
    expect(runner).toContain(
      "PNG_SHA256='431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460'",
    );
    expect(workflow).toContain('name: audit-android-native-effects-${{ github.sha }}');
    const releaseArtifact = workflow.slice(workflow.indexOf('name: release-android'));
    expect(releaseArtifact.slice(0, releaseArtifact.indexOf('retention-days: 1'))).not.toContain(
      'docs/audits/android-native-effects/',
    );
  });

  it('generates exact audit filters without Expo dev-scheme broadening', () => {
    const fixtureRoot = fs.mkdtempSync(path.resolve('.tmp-native-audit-'));
    const project = path.join(fixtureRoot, 'apps/mobile');
    try {
      fs.mkdirSync(project, { recursive: true });
      for (const source of ['apps/mobile/app.json', 'apps/mobile/package.json']) {
        fs.copyFileSync(source, path.join(project, path.basename(source)));
      }
      fs.cpSync('apps/mobile/plugins', path.join(project, 'plugins'), { recursive: true });
      fs.mkdirSync(path.join(fixtureRoot, 'assets'), { recursive: true });
      fs.symlinkSync(path.resolve('assets/brand'), path.join(fixtureRoot, 'assets/brand'));
      fs.symlinkSync(path.resolve('node_modules'), path.join(fixtureRoot, 'node_modules'));
      execFileSync(
        'pnpm',
        ['exec', 'expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'],
        { cwd: project, stdio: 'pipe' },
      );
      const manifest = fs.readFileSync(
        path.join(project, 'android/app/src/main/AndroidManifest.xml'),
        'utf8',
      );
      const filters = [...manifest.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/g)].map(
        ([source]) => source,
      );
      for (const auditPath of ['/__native-audit/notification', '/__native-audit/share-png']) {
        const filter = filters.find((source) => source.includes(`android:path="${auditPath}"`));
        expect(filter).toBeTruthy();
        expect(filter?.match(/<data\b/g)).toHaveLength(1);
        expect(filter).toContain(
          `android:scheme="mibbeacon" android:host="localhost" android:path="${auditPath}"`,
        );
        expect(filter).not.toContain('exp+mib-beacon');
      }
    } finally {
      try {
        fs.rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        // Expo may leave a short-lived process with its generated tree as cwd.
        // Empty it synchronously so the repository cannot retain test artifacts.
        fs.rmSync(path.join(fixtureRoot, 'apps'), {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      }
    }
  }, 60_000);
});
