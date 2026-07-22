# Changelog

All notable changes to AuGrid will be documented in this file. Versions follow
[semver](https://semver.org); pre-1.0 minor versions may contain breaking changes.

## Unreleased (v0.1)

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
