import { defineConfig } from 'vitest/config';

/** Local vitest config for demo unit tests (pure logic — node env, no DOM). */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
