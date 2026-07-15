import { fileURLToPath } from 'node:url';

export const RELEASE_OUTPUTS = [
  'appimage',
  'deb',
  'rpm',
  'flatpak',
  'nsis',
  'dmg',
  'apk',
  'aab',
  'ipa',
];

function enabled(value) {
  return value === true || value === 'true';
}

export function selectReleaseOutputs({ eventName, inputs = {} }) {
  const buildEverything = eventName !== 'workflow_dispatch';
  const outputs = Object.fromEntries(
    RELEASE_OUTPUTS.map((name) => [name, buildEverything || enabled(inputs[name])]),
  );

  if (!Object.values(outputs).some(Boolean)) {
    throw new Error('Select at least one release output for a manual workflow run.');
  }

  const desktopMatrix = [];
  if (outputs.appimage || outputs.deb || outputs.rpm || outputs.flatpak) {
    desktopMatrix.push({ os: 'ubuntu-latest', platform: 'linux' });
  }
  if (outputs.nsis) desktopMatrix.push({ os: 'windows-latest', platform: 'windows' });
  if (outputs.dmg) desktopMatrix.push({ os: 'macos-latest', platform: 'macos' });

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
