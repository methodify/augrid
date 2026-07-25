import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Dev serves the workspace TS sources directly (no package build step needed):
 * @augrid/core and @augrid/react resolve to their src/index.ts.
 *
 * Production builds deliberately do NOT alias — they resolve to the packages'
 * built `dist`, so the deployed demo exercises exactly what consumers install.
 * A broken package build then fails the deploy instead of shipping a demo that
 * only works from source.
 *
 * `base` targets GitHub Pages project hosting (served from /augrid/);
 * set AUGRID_BASE to deploy elsewhere.
 */
export default defineConfig(({ command, isPreview }) => {
  // `vite preview` reports command === 'serve' but serves the production
  // build, so it needs production's base or every asset 404s behind an
  // index.html fallback.
  const isDevServer = command === 'serve' && !isPreview;
  return {
    base: isDevServer ? '/' : (process.env.AUGRID_BASE ?? '/augrid/'),
    plugins: [react()],
    resolve: {
      alias: isDevServer
        ? {
            '@augrid/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
            '@augrid/react': fileURLToPath(new URL('../../packages/react/src/index.ts', import.meta.url)),
          }
        : {},
    },
  };
});
