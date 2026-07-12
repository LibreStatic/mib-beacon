import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Pure-TS packages that run under Node (anchored to this file so per-package
 * `vitest run` works too). Later phases add their packages here:
 *  - packages/resolver (plan 06)
 * packages/ui and packages/app are React Native and are not vitest projects.
 */
export default defineConfig({
  test: {
    projects: [
      join(root, 'packages/transport'),
      join(root, 'packages/core'),
      join(root, 'packages/smi'),
      join(root, 'packages/resolver'),
      join(root, 'packages/app'),
      join(root, 'tests'),
    ],
  },
});
