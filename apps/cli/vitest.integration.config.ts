import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.it.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: true,
  },
});
