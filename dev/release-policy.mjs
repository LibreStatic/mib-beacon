import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function assetBytes(release) {
  return (release.assets ?? []).reduce((total, asset) => total + Number(asset.size ?? 0), 0);
}

function deletionPriority(release) {
  return release.draft || release.prerelease ? 0 : 1;
}

/**
 * Plan release deletions without mutating GitHub state.
 * Drafts and prereleases are removed oldest-first, followed by stable releases.
 * The release matching targetTag is treated as replaceable and is never deleted.
 */
export function planReleaseCleanup({ releases, targetTag, newReleaseBytes, capBytes }) {
  const normalizedNewBytes = Number(newReleaseBytes);
  const normalizedCapBytes = Number(capBytes);
  const target = releases.find((release) => release.tag_name === targetTag);
  const replacedTargetBytes = target ? assetBytes(target) : 0;
  const existingBytes = releases.reduce((total, release) => total + assetBytes(release), 0);
  const candidates = releases
    .filter((release) => release.tag_name !== targetTag && assetBytes(release) > 0)
    .sort((left, right) => {
      const priority = deletionPriority(left) - deletionPriority(right);
      if (priority !== 0) return priority;
      return String(left.created_at).localeCompare(String(right.created_at));
    });

  let projectedBytes = existingBytes - replacedTargetBytes + normalizedNewBytes;
  const deleted = [];

  for (const release of candidates) {
    if (projectedBytes <= normalizedCapBytes) break;
    const bytes = assetBytes(release);
    deleted.push({
      id: release.id,
      tag: release.tag_name,
      bytes,
      kind: release.draft ? 'draft' : release.prerelease ? 'prerelease' : 'stable',
    });
    projectedBytes -= bytes;
  }

  return {
    capBytes: normalizedCapBytes,
    newReleaseBytes: normalizedNewBytes,
    existingBytes,
    replacedTargetBytes,
    projectedBytes,
    oversizeNewRelease: normalizedNewBytes > normalizedCapBytes,
    deleted,
  };
}

function readArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function main() {
  const args = readArguments(process.argv.slice(2));
  const releasesPath = args.get('releases');
  const targetTag = args.get('target-tag');
  const newReleaseBytes = args.get('new-bytes');
  const capBytes = args.get('cap-bytes');
  if (!releasesPath || !targetTag || !newReleaseBytes || !capBytes) {
    throw new Error(
      'Required: --releases FILE --target-tag TAG --new-bytes BYTES --cap-bytes BYTES',
    );
  }

  const parsed = JSON.parse(readFileSync(releasesPath, 'utf8'));
  const releases = Array.isArray(parsed[0]) ? parsed.flat() : parsed;
  const plan = planReleaseCleanup({
    releases,
    targetTag,
    newReleaseBytes,
    capBytes,
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
