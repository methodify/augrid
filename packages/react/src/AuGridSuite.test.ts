/**
 * Collection shim: the root vitest include pattern only matches *.test.ts
 * (not .tsx), so this file registers the JSX test suites in AuGrid.test.tsx.
 * Extensionless import resolves to the .tsx via bundler-style resolution.
 */
import './AuGrid.test';
