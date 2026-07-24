# Changelog

All notable changes to AuGrid will be documented in this file. Versions follow
[semver](https://semver.org); pre-1.0 minor versions may contain breaking changes.

## 0.1.3 — 2026-07-24

- **Boot-render cliff fix at high column counts** (found via Plank's AUG-21
  benchmark request): when a grid boots in an unmeasured container (hidden
  tab, display:none, not yet laid out), the render fallbacks built up to 501
  rows × ALL columns of throwaway cells — ~8s at 400 columns. Both fallbacks
  are now bounded prefixes (~100 rows × ~2400px of columns) that self-heal on
  the first measured pass. 400-column × 40-group benchmark added to the suite.
- **Infinite model, targeted refresh** (AUG-22):
  `api.refreshInfiniteCache({ fromRow, toRow })` refetches only the cached
  blocks a row range touches; refresh (full or ranged) is in place — rows
  stay visible until replaced, and row selection now carries across refetch
  by `getRowId`. Docs: RECIPES "Server-backed scrolling".

## 0.1.2 — 2026-07-24

- Fix: numeric columns now right-align (cells, headers, inline editor input).
  The alignment rule targeted the flex cell container, but the value span
  flex-grows to fill the cell, so numbers rendered left-aligned everywhere.
  Reported by mosaic-ui. `cellDataType` inference is unchanged — columns with
  numeric first-row values get this automatically; declare
  `cellDataType: 'number'` to force it.

## 0.1.1 — 2026-07-23

First **externally consumable** release: built `@augrid/core` and `@augrid/react`
tarballs are attached to the GitHub Release (installable via URL with
npm/pnpm/yarn/bun — see README "Installing"). A plain git dependency on the repo
was never consumable (source-only monorepo, no `dist`); reported by mosaic-ui
as AUG-18.

- Packaging: `prepack` build hooks; `repository`/`homepage`/`bugs` metadata;
  emitted ESM now uses `.js`-extensioned relative imports (strict-ESM/Node
  compatible, not just bundler-compatible).
- `@augrid/react` now declares `@augrid/core` as a **peerDependency**
  (was a hard dependency) — install both packages together.
- BREAKING (element API): importing `@augrid/core` is now safe without a DOM
  (SSR/Node). `AuGridElement` is exported as a type; the class is created
  lazily — use `defineAuGridElement()` as before, or `getAuGridElementClass()`
  if you subclassed. `sideEffects` is now `false` (better tree-shaking).

## 0.1.0 — 2026-07-22 (tag only, not consumable externally)

Initial public release: framework-agnostic core (`@augrid/core`, zero runtime
dependencies) and React wrapper (`@augrid/react`). Client-side row pipeline
(grouping, tree data, filtering, aggregation, pivot, sort), infinite row model,
virtualized DOM renderer, editing (incl. `readOnlyEdit` write-back), cell
ranges + fill handle, clipboard, CSV export, column/row state persistence,
theming, accessibility (ARIA grid/treegrid, full keyboard model).

### Highlights

- **Pivot write-back**: editable value columns generate editable pivot cells;
  every commit to an aggregate cell is event-routed via `cellEditRequest` with
  a `PivotCellContext` (`rowKeys` × `pivotKeys` × `valueColId`,
  `getLeafRows()`). See `docs/RECIPES.md` → "Editable pivot".
- **Treegrid keyboard semantics**: ArrowLeft/ArrowRight/Enter expand/collapse
  apply only on the group-header cell; all other cells navigate normally.
- **Context menu**: right-click / Shift+F10 menu with built-in items
  (clipboard, pin, expand/collapse, CSV export) and an app hook
  (`getContextMenuItems`) that receives `PivotCellContext` on pivot/group
  cells. See `docs/RECIPES.md` → "Context menu with app actions".
- **Column menu, side bar, find-in-grid**: header ⋮ menus (sort/pin/autosize/
  group/hide); `sideBar` option with a columns panel (visibility + row-group/
  value/pivot drop zones) and a filters panel; `setFindText`/`findNext`
  API with match highlighting. See `docs/RECIPES.md`.

### Known issues / migration notes

- **Expansion-state path format** (affects only users of pre-release builds):
  `getState().expandedGroups` now encodes group paths with a collision-safe
  scheme (`\u001e`-prefixed segments). Expansion state persisted by pre-fix
  builds will not restore (no crash — the paths simply don't match). If your
  app persists grid state across upgrades, drop the stored expansion state
  once; everything else in persisted state is unaffected.
- **CSV formula-injection neutralization is on by default**: exported cells
  beginning with `=`, `+`, `-`, `@`, tab, or CR are prefixed with `'`. Opt
  out with `CsvExportParams.suppressFormulaEscaping` if your pipeline needs
  raw values.
