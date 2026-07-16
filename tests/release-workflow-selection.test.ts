import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

describe('release workflow output selection', () => {
  it('exposes every distributable as a boolean web UI input', () => {
    for (const output of [
      'appimage',
      'deb',
      'rpm',
      'flatpak',
      'nsis',
      'nsis_unsigned',
      'dmg',
      'dmg_unsigned',
      'apk',
      'aab',
      'ipa',
    ]) {
      expect(workflow).toMatch(
        new RegExp(`\\n      ${output}:\\n        description: [^\\n]+\\n        type: boolean`),
      );
    }
  });

  it('defaults purchase-gated Windows and macOS packages to off', () => {
    for (const output of ['nsis', 'dmg']) {
      expect(workflow).toMatch(
        new RegExp(
          `\\n      ${output}:\\n        description: [^\\n]+\\n        type: boolean\\n        default: false`,
        ),
      );
    }
  });

  it('defaults clearly labeled unsigned Windows and macOS packages to on', () => {
    for (const output of ['nsis_unsigned', 'dmg_unsigned']) {
      expect(workflow).toMatch(
        new RegExp(
          `\\n      ${output}:\\n        description: Build an unsigned [^\\n]+\\n        type: boolean\\n        default: true`,
        ),
      );
    }
  });

  it('drives the build matrix and published inventory from one validated selection', () => {
    expect(workflow).toContain('node dev/release-selection.mjs');
    expect(workflow).toContain('fromJSON(needs.verify.outputs.desktop_matrix)');
    expect(workflow).toContain('required_patterns=()');
    expect(workflow).toContain("needs.verify.outputs.apk == 'true'");
    expect(workflow).toContain("needs.verify.outputs.ipa == 'true'");
    expect(workflow).toContain('BUILD_NSIS_UNSIGNED');
    expect(workflow).toContain('BUILD_DMG_UNSIGNED');
    expect(workflow).toContain('--config.win.signExecutable=false');
    expect(workflow).toContain('--config.mac.identity=null');
  });

  it('validates unsigned desktop artifacts without applying signed-release checks', () => {
    expect(workflow).toContain('Verify unsigned Windows NSIS package');
    expect(workflow).toContain("$signature.Status -ne 'NotSigned'");
    expect(workflow).toContain('Verify unsigned macOS application');
    expect(workflow).toContain('Expected an unsigned macOS application');
  });

  it('finds NSIS uninstall and file-association registrations for either install scope', () => {
    expect(workflow).toContain("'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'");
    expect(workflow).toContain("'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'");
    expect(workflow).toContain("'HKCU:\\Software\\Classes'");
    expect(workflow).toContain("'HKLM:\\Software\\Classes'");
    expect(workflow).toContain("DisplayName -eq 'MIB Beacon ${{ needs.verify.outputs.version }}'");
    expect(workflow).toContain('$uninstallKey.UninstallString');
    expect(workflow).toContain('Split-Path -Parent $uninstallerPath');
  });

  it('gives the Android release build enough JVM metaspace', () => {
    expect(workflow).toContain(
      "-Dorg.gradle.jvmargs='-Xmx3072m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8'",
    );
  });

  it('leaves Android emulator smoke testing to the local host', () => {
    expect(workflow).not.toContain('reactivecircus/android-emulator-runner');
    expect(workflow).not.toContain('Start Android SNMP fixture');
  });

  it('configures the unpacked Electron sandbox before hosted Linux smoke testing', () => {
    expect(workflow).toContain('sudo chown root:root "$sandbox"');
    expect(workflow).toContain('sudo chmod 4755 "$sandbox"');
  });

  it('streams the hosted Flatpak smoke log into Actions output', () => {
    expect(workflow).toContain('2>&1 | tee flatpak-package-smoke.log');
    expect(workflow).toContain('dbus-run-session -- xvfb-run --auto-servernum');
    expect(workflow).toContain('*-flatpak-source-x86_64.tar.xz');
    expect(workflow).toContain('[[ -x packaging/flatpak/staging/app/mib-beacon ]]');
    expect(workflow).toContain('libnspr4');
    expect(workflow).toContain('libgtk-3-0t64');
    expect(workflow).toContain('[[ "${ACT:-}" == true ]] && electron_args+=(--no-sandbox)');
    expect(workflow).toContain('flatpak_args+=(--no-sandbox)');
    expect(workflow).toContain('dbus-daemon --system --fork');
    expect(workflow).toContain('dbus-run-session -- flatpak uninstall');
  });
});
