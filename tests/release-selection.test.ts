import { describe, expect, it } from 'vitest';
import { selectReleaseOutputs } from '../dev/release-selection.mjs';

describe('release output selection', () => {
  it('builds every distributable for tag pushes', () => {
    const selection = selectReleaseOutputs({ eventName: 'push', inputs: {} });

    expect(Object.values(selection.outputs).every(Boolean)).toBe(true);
    expect(selection.desktopMatrix.map(({ platform }) => platform)).toEqual([
      'linux',
      'windows',
      'macos',
    ]);
  });

  it('only schedules manually selected artifacts and their build prerequisites', () => {
    const selection = selectReleaseOutputs({
      eventName: 'workflow_dispatch',
      inputs: { appimage: true, flatpak: true, ipa: true },
    });

    expect(selection.outputs).toMatchObject({
      appimage: true,
      deb: false,
      rpm: false,
      flatpak: true,
      nsis: false,
      dmg: false,
      apk: false,
      aab: false,
      ipa: true,
    });
    expect(selection.desktopMatrix.map(({ platform }) => platform)).toEqual(['linux']);
  });

  it('rejects a manual run with no packaging outputs selected', () => {
    expect(() =>
      selectReleaseOutputs({ eventName: 'workflow_dispatch', inputs: {} }),
    ).toThrow('Select at least one release output');
  });
});
