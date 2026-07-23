# AuGrid

Free, MIT, framework-agnostic high-performance data grid (AG Grid class). Monorepo:
`packages/core` (@augrid/core, zero deps), `packages/react` (@augrid/react), `apps/demo`.

Read `docs/PRODUCT.md` (scope) and `docs/ARCHITECTURE.md` (module map, interfaces,
performance rules) before changing core.

## Commands

- `pnpm test` — vitest run (jsdom). `pnpm test:watch` to iterate.
- `pnpm typecheck` — tsc across packages. Run before considering any change done.
- `pnpm build` — build packages. `pnpm demo` — vite demo app.

## Hard rules

- Push to origin after landing a feature/fix. External consumers (e.g. mosaic-ui)
  track the remote and file issues against what they can see — unpushed work
  doesn't exist for them. Keep README/PRODUCT.md scope claims in sync with what
  actually shipped (a consumer read "not built now" and filed for an existing feature).
- Releases (until npm publish, AUG-16): bump versions, CHANGELOG section, tag `vX.Y.Z`,
  then `pnpm pack` both packages and attach the tarballs to a GitHub Release —
  consumers install by asset URL. A bare git tag is NOT consumable (source-only
  monorepo; AUG-18). Verify a release by npm-installing the tarballs in a scratch
  project and importing both packages in DOM-less Node.

- Core has ZERO runtime dependencies. Never add one.
- Strict TS; no `any` in public types (internal casts allowed sparingly).
- Render path: no layout reads, no per-cell listeners (delegate at containers), no
  per-frame allocations in hot loops, `textContent` over `innerHTML`.
- All modules receive `GridContext` (`ctx`) — no module-level mutable state; multiple
  grids per page must be independent.
- Every public event/option/API method gets typed definitions in `src/types/`.
- Logic-first: pipeline/interaction logic must be testable without DOM; DOM code thin.
- Unit tests live next to code as `*.test.ts`.
