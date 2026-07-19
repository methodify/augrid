import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      '@augrid/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
    },
  },
});
