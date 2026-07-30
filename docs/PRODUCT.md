# AuGrid — Product Plan

## Vision

AuGrid is a free, MIT-licensed, framework-agnostic data grid that matches or exceeds the
leading commercial data grids on performance and interaction quality, with a cleaner API,
smaller bundle, and no free/paid feature wall. Every feature is free.

**Positioning:** "The grid you'd build if you could start over" — enterprise-grid power
without the accumulated API sprawl, licensing complexity, or bundle weight.

## Target users

1. **App developers** who need a serious grid: virtualized 100k+ rows, grouping, pivoting,
   editing, range selection, clipboard — without paying per-developer licensing.
2. **Analytical/planning apps** (the first consumer is a planning system over Microsoft
   Fabric-backed matrix sheets): pivot display, cell editing with write-back, async data
   loading, transactional updates. AuGrid must make "editable pivot with server write-back"
   a first-class scenario, not a hack.
3. **Design-system teams** who need deep theming (CSS variables, density, dark mode) and full
   control of cell rendering in their framework (React first).

## Product principles

- **Performance is the feature.** 60fps scroll on 1M rows, sub-100ms pipeline on 100k rows,
  O(visible) DOM. Every feature must state its performance cost; nothing degrades the
  scroll path.
- **Framework-agnostic core, first-class wrappers.** Zero-dependency TypeScript core that
  renders its own DOM. A `<au-grid>` custom element and a React wrapper ship in v1.
- **One coherent API.** Declarative `GridOptions` in, imperative `GridApi` out, events
  throughout. No parallel legacy APIs.
- **Everything is free.** Pivoting, range selection, clipboard, tree data — features the
  commercial grids gate behind enterprise licenses are all in the MIT core.
- **Headless where it counts.** The row pipeline (sort/filter/group/aggregate/pivot) is usable
  without the renderer for tests and server-side use.

## Feature scope

### v1 (this build)

**Columns**: column defs with defaults ladder (grid default → type → per-column), column groups
(multi-row headers), pinning left/right, drag reorder, drag resize + autosize (fit content /
fit grid), flex sizing, show/hide, value getters/formatters/setters/parsers, editable flag,
sortable/filterable/resizable flags, header renderers, column state get/set (persistence).

**Row models**:
- *Client-side*: full pipeline — filter → group/pivot → aggregate → sort → flatten. Transactions
  (add/update/remove) with delta recompute. Immutable-data mode keyed by `getRowId`.
- *Infinite*: block cache + `getRows(params)` datasource for server-backed scrolling (the Fabric
  app's lazy path), with sort/filter pass-through.

**Sorting**: single + multi (shift-click), custom comparators, sort indicators + order badges,
accented/locale-aware option.

**Filtering**: per-column filters — text (contains/equals/starts/ends/blank), number
(eq/gt/lt/range/blank), date (eq/before/after/range/blank), set filter (checkbox list with
search, select-all, sorted unique values); AND/OR condition pairs; floating filter row; quick
filter (whole-grid search); external filter hook.

**Row grouping & aggregation**: group by any column(s), group rows with expand/collapse,
aggregation functions (sum, min, max, avg, count, first, last, custom), group footers option,
`groupDisplayType` (single group column / multiple), expand-all/collapse-all API.

**Pivoting**: pivot mode with row groups + pivot columns + value columns; generated secondary
column groups per pivot value; works with editing disabled or enabled per policy (write-back
apps decide what a pivot cell edit means via callback).

**Tree data**: `getDataPath` hierarchical rows with aggregation.

**Selection**: row selection (single/multi, click/checkbox, header select-all,
keyboard), cell range selection (mouse drag, shift+arrows, multiple ranges with ctrl),
fill handle (drag-to-fill copies/extends values, fires events for write-back).

**Editing**: cell editing (double-click / typing / F2 / Enter), provided editors — text, number,
date, select (dropdown), checkbox, large-text; custom editor interface; full-row edit mode;
Tab/Enter/Esc semantics matching spreadsheet muscle memory; `valueParser`; validation hook;
undo/redo stack; `readOnlyEdit` mode where the grid fires events but does not mutate (the
write-back pattern: app applies the change to its store / server and feeds data back);
paste + fill respect editability.

**Clipboard**: copy cell/range/rows as TSV (with headers option), paste single→range fill and
range→range, fires cancellable events for write-back interception.

**Rendering**: DOM row + column virtualization with element recycling; pinned rows (top/bottom);
row spanning n/a in v1 (roadmap); cell renderers (string, DOM, framework component via
wrapper); `cellClass`/`cellStyle`/`cellClassRules`; row class rules; tooltips; value change
flash animation; loading overlay, no-rows overlay; auto row height opt-in per column.

**Keyboard & a11y**: full spreadsheet navigation (arrows, Home/End, Ctrl+arrows, PageUp/Down,
Tab within edit), ARIA grid semantics (role=grid/row/gridcell, aria-rowindex, sort/selection
states), focus management with roving tabindex, screen-reader-announced sort/filter changes.

**Theming**: CSS custom properties for every color/size/spacing; `quartz`-class default theme
with light/dark via `color-scheme`; density (compact/normal/comfortable); all styles injected,
zero mandatory CSS import; overridable via parts/classes.

**Export**: CSV export (visible or all columns, respects value formatters).

**State & events**: `getState()`/`setState()` for column order/width/visibility/pinning, sort,
filter, group, pivot; comprehensive event stream (~60 events) with typed payloads.

**Wrappers**: `<au-grid>` custom element; `@augrid/react` — `<AuGrid>` component with typed
props, React component cell renderers/editors rendered via portals, stable API ref.

**Pagination**: client-side pagination as a display mode over the pipeline output.

### Shipped post-v1 (in main, see CHANGELOG)

**Pivot write-back**: editable pivot/aggregate cells — commits are always event-routed
(`cellEditRequest` with `PivotCellContext`: rowKeys × pivotKeys × valueColId +
`getLeafRows()`); `api.getPivotCellContext()`.

**Context menu**: right-click / Shift+F10 with built-in items (clipboard, pin,
expand/collapse, CSV export) and the `getContextMenuItems` hook (receives
`PivotCellContext` on aggregate cells).

**Column menu**: header ⋮ button — sort, pin, autosize, group-by, hide, choose columns.

**Side bar / tool panels** (`sideBar` option): columns panel (search, show/hide
checkboxes, Row Groups / Values / Column Labels drag-drop zones) and filters panel
(every column filter inline, active indicators). `openToolPanel()` API.

**Find-in-grid**: `setFindText`/`findNext`/`findPrevious` over formatted values with
match highlighting and a `findChanged` event.

**Excel export (xlsx)**: zero-dependency writer (in-house ZIP + OOXML) — typed cells
(numbers/dates/booleans), per-column number formats, styled + frozen header row,
frozen pinned columns, autofilter, column widths, multi-sheet workbooks composable
across grids.

**Cell visuals**: `colDef.sparkline` renders line/area/column/win-loss/band marks from
an array-valued cell, plus scalar marks (data bar, bullet vs target, delta vs baseline)
and optional value-with-mark composition; per-cell, column-shared, or fixed Y domains;
gaps as breaks; markers and reference lines; series-summary sorting (incl. trend
slope); constant DOM node count per cell.

**Server-side row model** (`rowModelType: 'serverSide'`): per-parent lazy group
expansion for huge hierarchies — one datasource call per expansion (block-windowed
within wide parents), raw group keys (`string | number | null`, blanks preserved),
server-computed aggregates at every grain, group-row write-back event-routed with
the raw key path, in-place store refresh (`refreshServerSideStore`).

### v1.x roadmap (documented, not built now)

Master/detail rows; row dragging (managed + to external targets); status bar; cell spanning; integrated
charts; Angular, Vue, Svelte wrappers; RTL; localization bundles.

## Quality bars (v1 exit criteria)

- 1M-row client-side model: smooth wheel scroll, < 16ms average frame during scroll.
- 100k rows: sort < 120ms, filter < 80ms, group+aggregate < 250ms (M-class laptop).
- Initial render (100 cols × 100k rows) < 250ms after data set.
- Core bundle < 120kB min+gzip (typical commercial grid cores: 200–300kB+).
- Zero runtime dependencies in core.
- Unit test suite over the entire pipeline + interaction logic; demo app exercising every
  feature; benchmark harness in-repo.

## Why we win vs the incumbents

| Axis | Incumbent enterprise grids | AuGrid |
|---|---|---|
| Licensing | Free/paid split, per-dev pricing for pivot/ranges/clipboard | Everything MIT |
| Bundle | Large; opt-in module systems to trim | Small core, tree-shakeable features |
| API | Years of accretion, many deprecated paths | One modern API, typed end-to-end |
| Write-back | Interception hooks exist but second-class | First-class: every mutation (edit, paste, fill) is interceptable and async-friendly |
| Theming | Successive theming systems + legacy CSS paths | Single CSS-variable system from day one |
| Web component | Rare | `<au-grid>` native custom element |
