import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('GitHub workflow package manager setup', () => {
  it('lets pnpm/action-setup use the packageManager version', () => {
    for (const path of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      const workflow = read(path);
      expect(workflow, path).toContain('pnpm/action-setup@v4');
      expect(workflow, path).not.toMatch(/pnpm\/action-setup@v4\s*\n\s+with:\s*(?:\{\s*)?version:/);
    }
  });
});
