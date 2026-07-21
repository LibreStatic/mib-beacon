import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('versioned AGENTS validation matrix', () => {
  const matrix = JSON.parse(fs.readFileSync('dev/audit/validation-matrix.v1.json', 'utf8')) as {
    schemaVersion: number;
    routes: { id: string }[];
    viewports: { id: string; width: number; height: number }[];
    browserAssertions: string[];
    nativeAssertions: string[];
  };

  it('covers every route, breakpoint edge, and short landscape viewport', () => {
    expect(matrix.schemaVersion).toBe(1);
    expect(matrix.routes.map(({ id }) => id)).toEqual([
      'browse',
      'live-mibs',
      'results',
      'agents',
      'traps',
      'tools',
      'settings',
    ]);
    expect(matrix.viewports.map(({ width }) => width)).toEqual(
      expect.arrayContaining([390, 639, 640, 820, 1023, 1024, 1280]),
    );
    expect(matrix.viewports).toContainEqual(
      expect.objectContaining({ id: 'short-landscape', width: 640, height: 480 }),
    );
  });

  it('requires bounds, occlusion, last-control, nested panes, dialogs, native adapters, and freshness', () => {
    expect(matrix.browserAssertions).toEqual(
      expect.arrayContaining([
        'horizontal-bounds',
        'vertical-bounds',
        'hit-target-occlusion',
        'last-control-reachability',
        'nested-pane-viability',
        'dialog-reachability',
        'tested-commit-freshness',
      ]),
    );
    expect(matrix.nativeAssertions).toEqual(
      expect.arrayContaining([
        'android-emulator-launch',
        'notification-permission-and-delivery',
        'binary-png-sharing',
        'tested-commit-freshness',
      ]),
    );
  });

  it('is enforced by CI and Android release jobs', () => {
    const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
    const release = fs.readFileSync('.github/workflows/release.yml', 'utf8');
    expect(ci).toContain('python3 dev/audit/validation-matrix.py');
    expect(ci).toContain('MIB_BEACON_AUDIT_COMMIT: ${{ github.sha }}');
    expect(release).toContain('reactivecircus/android-emulator-runner@v2');
    expect(release).toContain('adb install -r');
  });
});
