import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    watch: false,
    restoreMocks: true,
    fileParallelism: false,
    environment: 'node',
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reporter: ['text'],
      all: true,
      thresholds: {
        lines: 90,
        functions: 85,
        branches: 75,
        statements: 90,
      },
    },
  },
});
