import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const REPOSITORY = 'https://github.com/LibreStatic/mib-beacon';

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('repository identity', () => {
  it('uses the canonical hyphenated GitHub repository slug', () => {
    const repositoryFiles = [
      '.github/ISSUE_TEMPLATE/config.yml',
      '.github/workflows/release.yml',
      'README.md',
      'SECURITY.md',
      'apps/desktop/package.json',
      'docs/plans/06-online-mib-resolution.md',
      'package.json',
      'packages/app/src/generated/release-info.ts',
      'packages/transport/src/types.ts',
      'packaging/flatpak/com.librestatic.mibbeacon.metainfo.xml',
    ];

    for (const path of repositoryFiles) {
      expect(read(path), path).not.toContain('github.com/LibreStatic/mibbeacon');
      expect(read(path), path).not.toContain('github.com/<org>/mibbeacon');
    }

    expect(read('package.json')).toContain(`${REPOSITORY}.git`);
    expect(read('README.md')).toContain(`git clone ${REPOSITORY}.git`);
    expect(read('README.md')).toContain('cd mib-beacon');
  });
});
