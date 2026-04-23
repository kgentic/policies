import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    globals: false,
    testTimeout: 10000,
    passWithNoTests: true,
  },
});
