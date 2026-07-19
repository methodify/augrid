import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Dev serves the workspace TS sources directly (no package build step needed):
 * @augrid/core and @augrid/react resolve to their src/index.ts.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@augrid/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@augrid/react': fileURLToPath(new URL('../../packages/react/src/index.ts', import.meta.url)),
    },
  },
});
