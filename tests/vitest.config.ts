import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'release-metadata',
    include: ['**/*.test.ts'],
    environment: 'node',
  },
});
