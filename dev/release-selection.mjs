import { fileURLToPath } from 'node:url';

export const RELEASE_OUTPUTS = [
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
];

// These artifacts require paid external signing programs. Keep tag-triggered
// releases safe to run until the project elects to buy and configure them.
export const COST_GATED_RELEASE_OUTPUTS = ['nsis', 'dmg'];

const SIGNING_VARIANTS = [
  {
    signed: 'nsis',
    unsigned: 'nsis_unsigned',
    label: 'Windows installer',
  },
  {
    signed: 'dmg',
    unsigned: 'dmg_unsigned',
    label: 'macOS DMG',
  },
];

function enabled(value) {
  return value === true || value === 'true';
}

export function selectReleaseOutputs({ eventName, inputs = {} }) {
  const useManualSelection = eventName === 'workflow_dispatch';
  const outputs = Object.fromEntries(
    RELEASE_OUTPUTS.map((name) => [
      name,
      useManualSelection ? enabled(inputs[name]) : !COST_GATED_RELEASE_OUTPUTS.includes(name),
    ]),
  );

  if (!Object.values(outputs).some(Boolean)) {
    throw new Error('Select at least one release output for a manual workflow run.');
  }

  for (const { signed, unsigned, label } of SIGNING_VARIANTS) {
    if (outputs[signed] && outputs[unsigned]) {
      throw new Error(`Select either the signed or unsigned ${label}, not both.`);
    }
  }

  const desktopMatrix = [];
  if (outputs.appimage || outputs.deb || outputs.rpm || outputs.flatpak) {
    desktopMatrix.push({ os: 'ubuntu-latest', platform: 'linux' });
  }
  if (outputs.nsis || outputs.nsis_unsigned) {
    desktopMatrix.push({ os: 'windows-latest', platform: 'windows' });
  }
  if (outputs.dmg || outputs.dmg_unsigned) {
    desktopMatrix.push({ os: 'macos-latest', platform: 'macos' });
  }

  return { outputs, desktopMatrix };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const eventName = argument('--event');
  const inputs = JSON.parse(argument('--inputs') ?? '{}');
  process.stdout.write(`${JSON.stringify(selectReleaseOutputs({ eventName, inputs }))}\n`);
}
