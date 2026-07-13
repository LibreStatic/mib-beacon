import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'resolver',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Recursive resolver integration tests can exceed Vitest's 5s default
    // while the workspace projects are competing for CPU.
    testTimeout: 10_000,
  },
});
