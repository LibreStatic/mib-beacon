import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Large streaming-import fixtures can exceed Vitest's 5s default while
    // the workspace projects are competing for CPU.
    testTimeout: 10_000,
  },
});
