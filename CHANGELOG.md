# Changelog

All notable changes to AuGrid will be documented in this file. Versions follow
[semver](https://semver.org); pre-1.0 minor versions may contain breaking changes.

## 0.4.0 — 2026-07-25

**Sparklines** — phase 1 of the cell-visuals surface (AUG-25 design, AUG-26).
Declare `colDef.sparkline`; the cell value is the series.

- Marks: `line`, `area`, `column`, `winLoss`, with first/last/min/max
  markers, a reference rule, and per-polarity fills at equal visual weight.
- **Scale is an explicit choice**: `domain: 'auto'` (per cell — shape, the
  default) | `'shared'` (one scale across the column — magnitude, making rows
  comparable) | `[min, max]`. Documented plainly, because a column of
  auto-scaled sparklines *looks* comparable and isn't.
- Gaps are real: `null`/`NaN` break the line instead of reading as zero.
  Flat series render centered rather than collapsed on an edge.
- Series may be `number[]` or `{x, y}[]` (x as number or `Date`) so irregular
  time axes plot at true spacing.
- **Sorting an array column now means something**: `sortBy: 'last' | 'first' |
  'min' | 'max' | 'mean' | 'sum' | 'slope'` (default `'last'`); `'slope'` is
  the least-squares trend. Summaries are memoized per row per sort.
- Clipboard and CSV emit the underlying series, not `[object Object]`.
- Each cell is one SVG with a **constant node count regardless of series
  length**; measured 100k rows × 4 sparkline columns at ~1.3 ms/scroll frame.
- Per-cell `aria-label` summary (overridable); themeable via `--au-sparkline-*`.

## 0.3.1 — 2026-07-24

Excel export correctness — two defects that made Excel offer to "repair"
otherwise-fine workbooks (reported against v0.3.0; lenient readers such as
openpyxl accept both forms, which is why the first release passed
validation):

- **Frozen panes**: `activePane` always claimed `bottomRight`, but a pane
  only exists if its split does. A header-row-only freeze (any grid with no
  pinned-left columns) must use `bottomLeft`, a column-only freeze
  `topRight`. Excel logged *"Repaired Records: View from
  /xl/worksheets/sheet1.xml"*. The `<selection>` now matches the same pane.
- **Sheet names**: multi-sheet workbooks could emit duplicate names (two
  `getSheetDataForExcel()` calls without `sheetName` both defaulted to
  "Sheet1"), which Excel treats as corruption. Names are now deduplicated
  ("Data", "Data (2)") within the 31-character cap, and leading/trailing
  apostrophes — also illegal — are stripped.

## 0.3.0 — 2026-07-24

**Excel (.xlsx) export** (AUG-10) — an in-house, dependency-free writer
(ZIP container + SpreadsheetML), honoring the zero-runtime-deps rule:

- `api.exportDataAsExcel(params?)` downloads; `api.getDataAsExcel(params?)`
  returns the bytes. Both async.
- Typed cells: numbers stay numeric, dates become real Excel dates,
  booleans become booleans — Excel can sum/sort/filter without a re-import.
- Per-column number formats via `colDef.excelNumberFormat` (dates default
  to `yyyy-mm-dd`); styled + frozen header row; pinned-left columns frozen;
  autofilter; grid column widths carried over.
- Params: `allColumns`, `onlySelected`, `skipHeaders`, `sheetName`,
  `headerStyle`, `suppressFreeze`, `suppressAutoFilter`,
  `useFormattedValues`, `processCellForExcel`.
- Multi-sheet: `api.getSheetDataForExcel()` returns a composable payload and
  `api.exportMultipleSheetsAsExcel({ sheets })` merges them — sheets from
  DIFFERENT grids compose safely (styles are re-interned on merge).
- DEFLATE via the platform `CompressionStream` when available (~8× smaller),
  stored entries otherwise; both are valid .xlsx.
- Validated end-to-end against openpyxl (an independent OOXML reader),
  including a 100k-row workbook downloaded from a real browser.

## 0.2.1 — 2026-07-24

- **Server-side expand no longer flashes a block of blank rows** (AUG-23,
  reported by Plank): a store now allocates ONE loading row until its first
  block lands (or exactly the known child count when a prior load reported
  it) instead of a speculative `cacheBlockSize` allocation that pushed
  content down and snapped back.
- **Loading skeletons**: rows in in-flight blocks (server-side AND infinite
  model) render animated skeleton bars (`.au-cell-loading` / `.au-skeleton`,
  themeable via `--au-skeleton-color` / `--au-skeleton-highlight-color`;
  honors `prefers-reduced-motion`) instead of blank cells.

## 0.2.0 — 2026-07-24

**Server-side row model** (`rowModelType: 'serverSide'`) — lazy per-parent
group expansion for hierarchies too large to materialize (AUG-8/AUG-20;
contract co-designed with Plank):

- One `serverSideDatasource.getRows` per expansion, block-windowed within
  each parent (`cacheBlockSize`) for very wide parents.
- Raw group keys: `GroupKey = string | number | null` — blank members are
  `null`, never conflated with `''`; paths round-trip losslessly through
  expansion state, store cache keys, and `refreshServerSideStore`.
- Expandability rides on the row (`isServerSideGroup(data)`), no per-node
  probes; `getServerSideGroupKey(data)` supplies raw keys.
- Group rows carry SERVER-computed aggregates (`valueCols[].aggFunc` is
  advisory/optional; the grid never re-aggregates). `rowCount` is honest:
  exact when reported, speculative growth otherwise — never synthesized.
- Write-back at any grain: every group-row commit is event-routed
  (`cellEditRequest`) with `pivot.rowKeys` = the raw key path.
  `PivotKeyPart.key` widened to `string | number | null`.
  `getLeafRows()` on server-side groups returns cached leaves only.
- `api.refreshServerSideStore({ groupKeys?, fromRow?, toRow? })`: in-place
  refetch; selection carries across by `getRowId`. Sort/filter changes purge
  and refetch; expanded paths re-open lazily. Collapsed stores stay cached.
- Demo "Server-Side" page: Region→Store→SKU with a null member and
  group-level write-back with server decomposition.

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
