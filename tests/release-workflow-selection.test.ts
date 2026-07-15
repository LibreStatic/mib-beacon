import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8',
);

describe('release workflow output selection', () => {
  it('exposes every distributable as a boolean web UI input', () => {
    for (const output of [
      'appimage',
      'deb',
      'rpm',
      'flatpak',
      'nsis',
      'dmg',
      'apk',
      'aab',
      'ipa',
    ]) {
      expect(workflow).toMatch(
        new RegExp(`\\n      ${output}:\\n        description: [^\\n]+\\n        type: boolean`),
      );
    }
  });

  it('drives the build matrix and published inventory from one validated selection', () => {
    expect(workflow).toContain('node dev/release-selection.mjs');
    expect(workflow).toContain('fromJSON(needs.verify.outputs.desktop_matrix)');
    expect(workflow).toContain('required_patterns=()');
    expect(workflow).toContain("needs.verify.outputs.apk == 'true'");
    expect(workflow).toContain("needs.verify.outputs.ipa == 'true'");
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
