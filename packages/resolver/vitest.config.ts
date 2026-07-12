import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'resolver',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
