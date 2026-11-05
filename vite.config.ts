import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    singleQuote: true,
    sortImports: { newlinesBetween: false },
    sortPackageJson: false,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    categories: {
      correctness: 'error',
    },
    rules: {
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
    },
    overrides: [
      {
        files: ['**/*.spec.ts', '**/test/**'],
        plugins: ['vitest'],
        rules: {
          'vitest/expect-expect': 'off',
          'vitest/require-mock-type-parameters': 'off',
          'vitest/require-to-throw-message': 'off',
        },
      },
      {
        files: ['apps/**/*.tsx'],
        plugins: ['react'],
      },
    ],
  },
});
