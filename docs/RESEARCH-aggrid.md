# AG Grid Feature Inventory (research snapshot, 2026-07)

Reference for roadmap planning. Ed.: C = ag-grid Community, E = Enterprise. Diff: S/M/L/XL
from-scratch effort. AuGrid v1 coverage noted in [brackets].

## Columns
- Col defs w/ field dot-paths, colId (C/S) [v1]; columnTypes bundles (C/S) [v1]; defaultColDef (C/S) [v1]
- Auto type inference from data (C/M) [v1: basic number/date/boolean detection]
- Column groups, collapsible (C/M) [v1: groups; collapsible v1.x]
- Pinning L/R (C/M) [v1]; resizing drag/dblclick/keyboard, shift-drag redistribute (C/M) [v1: drag+dblclick+API]
- Flex sizing (C/M) [v1]; autosize to content/fit (C/M) [v1]; moving/drag reorder (C/M) [v1]
- colSpan (C/M) [v1.x]; row spanning (E/L, v33.1+) [v1.x]
- Visibility toggles (C/S) [v1]; column state API (C/M) [v1]
- Row-group panel dragging (E/M) [v1.x]; column selection via header (E/M) [v1.x]

## Row models
- Client-side: in-memory sort/filter/group/pivot/agg, 100k+ rows (C/L) [v1]
- Infinite: block-fetch flat data, unknown row count (C/L) [v1]
- Server-side (SSRM): lazy groups, server ops, transactions (E/XL) [v1.x — interface reserved]
- Viewport: server pushes visible range (E/XL) [future]

## Sort / filter / quick filter
- Single+multi sort, shift-click, order badges, custom comparators (C/M) [v1]
- Text/Number/Date filters with AND/OR pairs (C/M each) [v1]
- Set filter: checkbox distinct values, search, select-all (E/L) [v1 — free in AuGrid]
- Multi filter stack (E/M) [v1.x]; Advanced formula filter (E/L) [future]
- Floating filters (C/M) [v1]; Quick filter (C/M) [v1]; external filter hooks (C/S) [v1]
- Custom filter components (C/M) [v1]; filter get/set model API (C/S) [v1]

## Grouping / agg / pivot / tree / master-detail
- Row grouping multi-level (E/L) [v1 — free]; display modes single/multi/groupRows (E/M) [v1: single+groupRows]
- Expand/collapse + default level + expand-all API (E/M) [v1]
- Group panel drag UI (E/M) [v1.x]
- Aggregation sum/min/max/count/avg/first/last/custom, cascading (E/L) [v1]
- Group/grand total rows top/bottom (E/M) [v1: footers option]
- Pivot mode w/ generated secondary col groups (E/XL) [v1 — free]
- Pivot config panel (E/M) [v1.x]
- Tree data getDataPath + self-referencing parentId (E/L-M) [v1: getDataPath; parentId v1.x]
- Master/detail nested grids (E/XL) [v1.x]

## Rendering
- Cell renderers (C/M) [v1]; value getter/formatter/setter/parser (C/S) [v1]
- cellClass/Style/ClassRules, rowClassRules, getRowStyle (C/S) [v1]
- Tooltips (C/M) [v1: text tooltips]; full-width rows (C/M) [v1]; auto height (C/M) [v1: opt-in]
- Find in grid (E/L, v33.2) [v1.x]
- Row+col virtualization w/ buffer, recycling (C/XL) [v1 — the kernel]

## Editing
- Cell editing triggers: dblclick/typing/F2/Enter, type-default editors (C/M) [v1]
- Editors: text, large text, number, date, checkbox, select (C/M each) [v1], rich select (L) [v1.x]
- Full row editing (C/M) [v1]; lifecycle events (C/S) [v1]; validation (M) [v1: hook]
- Undo/redo (E/L) [v1 — free]; batch editing / Ctrl+Enter range fill (E/L) [v1: paste+fill; Ctrl+D]
- readOnlyEdit / cellEditRequest write-back (C) [v1 — first-class]

## Selection
- Row selection single/multi, checkbox col, header select-all, keyboard (C/M) [v1]
- Cell range selection: drag, shift+arrows, ctrl multi-range (E/L) [v1 — free]
- Fill handle w/ pattern detection (E/L) [v1 — free]; Ctrl+D copy-down (E/S) [v1]
- Selection API (C/M) [v1]

## Clipboard / export / menus / panels
- Copy TSV (cell/ranges/rows), with headers (E/M) [v1 — free]; paste incl. range fill (E/L) [v1]
- Cut (E/S) [v1]; clipboard events (E/S) [v1]
- CSV export (C/M) [v1]; Excel XLSX export (E/XL) [v1.x]
- Context menu (E/M) [v1.x]; column menu (E/L) [v1.x]; tool panels/sidebar (E/L) [v1.x]
- Status bar (E/M) [v1.x]

## Pagination / pinning / dragging / state
- Pagination, group-aware (C/M) [v1: client-side]
- Row pinning top/bottom (C/M) [v1]
- Row dragging managed/unmanaged, cross-grid (C-E/L) [v1.x]
- Full grid state persistence (C/L) [v1: columns/sort/filter/group/pivot/pagination]

## Keyboard & a11y
- Arrow/Ctrl+arrow/Page/Home-End nav (C/M) [v1]; edit-mode keys (C/M) [v1]
- Header keyboard nav+manipulation (C/M) [v1: nav + Enter sort]
- Keyboard selection (C-E/M) [v1]; navigateToNextCell/tabToNextCell hooks (C/S) [v1]
- ARIA grid semantics (C/L) [v1]

## Theming
- JS theme objects + runtime CSS injection (C, v33) [v1: CSS-var themes, runtime injection]
- Built-in themes + light/dark schemes (C) [v1: one polished theme, both schemes, density]
- Params/parts/custom icons (C) [v1: CSS vars; parts v1.x]
- Shadow-DOM style container support (C/M) [v1: constructable stylesheets]

## Performance features
- Row buffer, 500-row safety cap (C) [v1]; transactions + getRowId matching (C/L) [v1]
- Async transactions batched on rAF (C/L) [v1]; delta/changed-path recompute (E/XL) [v1: dirty stages; per-group delta v1.x]
- Immutable data diffing (C/M) [v1]

## Recent ag-grid additions (v31–v36) not above
- Integrated charts (E/XL) [future]; AI toolkit/MCP (E) [future]
- Calculated columns, "show values as" (E, v36) [v1.x — natural fit for pivot]
- DateTime editor (v34) [v1.x]

## Top user complaints about AG Grid (AuGrid opportunities)
1. Enterprise pricing $999+/dev/yr; grouping/ranges/clipboard/export gated → AuGrid: all MIT.
2. Bundle size historically huge; tree-shaking arrived late → small core, ESM, shakeable.
3. Grid state opaque to frameworks (selection/expansion lost on data change) → transparent
   `getState()`/immutable-mode preservation; document the React state story.
4. API sprawl/inconsistency → one modern typed API.
5. Breaking-change churn (theming reworked repeatedly) → additive API + deprecation policy.
6. Edge-case docs gaps; customization friction beyond paved path → recipes for editing/
   streaming/write-back.
