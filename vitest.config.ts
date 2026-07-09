import { defineConfig } from 'vitest/config';

/**
 * Pure-TS packages that run under Node. Later phases add their packages here:
 *  - packages/smi      (plan 03)
 *  - packages/resolver (plan 06)
 * packages/ui and packages/app are React Native and are not vitest projects.
 */
export default defineConfig({
  test: {
    projects: ['packages/transport', 'packages/core'],
  },
});
