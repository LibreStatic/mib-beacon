import { describe, expect, it } from 'vitest';

import { planReleaseCleanup } from '../dev/release-policy.mjs';

function release(
  id: number,
  tag: string,
  size: number,
  options: { draft?: boolean; prerelease?: boolean; createdAt?: string } = {},
) {
  return {
    id,
    tag_name: tag,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? false,
    created_at: options.createdAt ?? `2026-01-${String(id).padStart(2, '0')}T00:00:00Z`,
    assets: size === 0 ? [] : [{ size }],
  };
}

describe('release cleanup policy', () => {
  it('keeps every release when the replacement fits under the cap', () => {
    const plan = planReleaseCleanup({
      releases: [release(1, 'v0.0.1-alpha.1', 100)],
      targetTag: 'v0.0.1-beta.1',
      newReleaseBytes: 200,
      capBytes: 500,
    });

    expect(plan.deleted).toEqual([]);
    expect(plan.projectedBytes).toBe(300);
    expect(plan.oversizeNewRelease).toBe(false);
  });

  it('deletes oldest prereleases before stable releases', () => {
    const plan = planReleaseCleanup({
      releases: [
        release(1, 'v0.0.1', 180, { createdAt: '2026-01-01T00:00:00Z' }),
        release(2, 'v0.0.2-beta.1', 120, {
          prerelease: true,
          createdAt: '2026-02-01T00:00:00Z',
        }),
        release(3, 'v0.0.2-beta.2', 110, {
          prerelease: true,
          createdAt: '2026-03-01T00:00:00Z',
        }),
      ],
      targetTag: 'v0.0.3-beta.1',
      newReleaseBytes: 200,
      capBytes: 500,
    });

    expect(plan.deleted.map(({ tag }) => tag)).toEqual(['v0.0.2-beta.1']);
    expect(plan.projectedBytes).toBe(490);
  });

  it('falls back to the oldest stable release after drafts and prereleases', () => {
    const plan = planReleaseCleanup({
      releases: [
        release(1, 'v0.0.1', 150),
        release(2, 'v0.0.2', 150),
        release(3, 'draft', 50, { draft: true }),
      ],
      targetTag: 'v0.0.3-beta.1',
      newReleaseBytes: 400,
      capBytes: 500,
    });

    expect(plan.deleted.map(({ tag }) => tag)).toEqual(['draft', 'v0.0.1', 'v0.0.2']);
    expect(plan.projectedBytes).toBe(400);
  });

  it('replaces the target release assets without deleting its release', () => {
    const plan = planReleaseCleanup({
      releases: [
        release(1, 'v0.0.1-beta.1', 450, { prerelease: true }),
        release(2, 'v0.0.1-alpha.1', 100, { prerelease: true }),
      ],
      targetTag: 'v0.0.1-beta.1',
      newReleaseBytes: 350,
      capBytes: 500,
    });

    expect(plan.deleted).toEqual([]);
    expect(plan.replacedTargetBytes).toBe(450);
    expect(plan.projectedBytes).toBe(450);
  });

  it('deletes all releases with assets but allows an oversized new release', () => {
    const plan = planReleaseCleanup({
      releases: [release(1, 'v0.0.1', 100), release(2, 'empty-draft', 0, { draft: true })],
      targetTag: 'v0.0.2-beta.1',
      newReleaseBytes: 600,
      capBytes: 500,
    });

    expect(plan.deleted.map(({ tag }) => tag)).toEqual(['v0.0.1']);
    expect(plan.projectedBytes).toBe(600);
    expect(plan.oversizeNewRelease).toBe(true);
  });
});
