import { describe, expect, it } from 'vitest';
import { selectReleaseOutputs } from '../dev/release-selection.mjs';

describe('release output selection', () => {
  it('skips purchase-gated Windows and macOS packages for tag pushes', () => {
    const selection = selectReleaseOutputs({ eventName: 'push', inputs: {} });

    expect(selection.outputs).toMatchObject({
      appimage: true,
      deb: true,
      rpm: true,
      flatpak: true,
      nsis: false,
      nsis_unsigned: true,
      dmg: false,
      dmg_unsigned: true,
      apk: true,
      aab: true,
      ipa: true,
    });
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
      nsis_unsigned: false,
      dmg: false,
      dmg_unsigned: false,
      apk: false,
      aab: false,
      ipa: true,
    });
    expect(selection.desktopMatrix.map(({ platform }) => platform)).toEqual(['linux']);
  });

  it('rejects a manual run with no packaging outputs selected', () => {
    expect(() => selectReleaseOutputs({ eventName: 'workflow_dispatch', inputs: {} })).toThrow(
      'Select at least one release output',
    );
  });

  it('rejects selecting signed and unsigned variants for the same desktop platform', () => {
    expect(() =>
      selectReleaseOutputs({
        eventName: 'workflow_dispatch',
        inputs: { nsis: true, nsis_unsigned: true },
      }),
    ).toThrow('Select either the signed or unsigned Windows installer, not both.');
  });
});
