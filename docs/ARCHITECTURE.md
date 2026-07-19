# AuGrid — Architecture

## Repository layout

```
packages/core        @augrid/core   — zero-dep TS. All grid logic + DOM rendering.
packages/react       @augrid/react  — React 18/19 wrapper (portals for custom components).
apps/demo            Vite + React demo/kitchen-sink + benchmark pages.
```

## Core package layout (`packages/core/src`)

```
types/          Public types: ColDef, GridOptions, GridApi, events, params. No logic.
utils/          dom.ts, general.ts (debounce, escapeHtml, numeric parse), keys.ts
state/          Store: fine-grained reactive container (signal-like) used internally.
columns/        ColumnModel: instantiation, defaults ladder, order, visibility, pinning,
                widths (px/flex), column groups, autosize, column state, pivot result cols.
rows/           RowNode, ClientSideRowModel + pipeline stages:
                  filterStage, groupStage (incl. tree data), pivotStage, aggStage,
                  sortStage, flattenStage. InfiniteRowModel (block cache).
render/         GridRenderer: layout scaffold DOM, VirtualizerY/X, RowCtrl/CellCtrl
                (recycled), HeaderRenderer, overlays, flash, auto-height.
interaction/    focus.ts (keyboard nav + roving tabindex), selection.ts (row),
                range.ts (cell ranges + fill handle), editing.ts (edit lifecycle+editors),
                clipboard.ts, columnDrag.ts (reorder), columnResize.ts, touch.ts
features/       filters/ (text/number/date/set + floating row + quick filter),
                sortController.ts, pagination.ts, csvExport.ts, undoRedo.ts,
                tooltips.ts, overlays.ts
style/          theme.ts (CSS injection), themes as CSS-variable maps.
grid.ts         Grid class: composition root. createGrid(el, options) → GridApi.
element.ts      <au-grid> custom element wrapper.
index.ts        Public exports.
```

## Data flow

```
GridOptions ─► Grid (composition root)
                 ├─► ColumnModel  ──────────────┐
                 ├─► RowModel (client|infinite) ├─► Store (reactive state)
                 │      pipeline stages         │
                 └─► GridRenderer  ◄────────────┘
                        │  subscribes to store slices; rAF-batched DOM writes
                        ▼
                     DOM (recycled rows/cells)
User input ─► interaction controllers ─► API/model mutations ─► store ─► renderer
```

### Store

Minimal signal implementation: `signal(v)`, `computed(fn)`, `effect(fn)`, `batch(fn)`.
Grid-wide `GridContext` object carries: options (with reactive option updates), store,
columnModel, rowModel, renderer, eventService, focus/selection/range/edit services, api.
Every module receives `ctx` — no globals, multiple grids per page are independent.

### Events

`EventService`: typed `addEventListener(type, fn)` / `dispatch(event)`. All public events in
`types/events.ts`. Options may carry `onCellValueChanged`-style callbacks; both routes fire.

## Row pipeline (client-side model)

`RowNode` fields: `id, data, rowIndex (displayed), level, group, key, field, parent, children,
childrenAfterFilter, childrenAfterSort, leafCount, aggData, expanded, selected, pinned,
treePath`. Leaf order preserved from source. Stages run in order, each with dirty-flags so a
sort change does not re-filter, a filter change re-runs filter→…→flatten:

1. **group/tree/pivot stage** — builds node tree from row data (rowGroup cols or getDataPath);
   in pivot mode also computes pivot keys → asks ColumnModel to generate secondary columns.
2. **filter stage** — column filters + quick filter + external; groups kept if any descendant
   passes; option `suppressAggFilteredOnly`.
3. **aggregation stage** — bottom-up aggregation over `childrenAfterFilter` into `aggData`
   (in pivot mode: per pivot-column bucket).
4. **sort stage** — sorts `childrenAfterFilter` → `childrenAfterSort` per level using active
   sort model (multi-column, comparators, group columns sort by key or agg value).
5. **flatten stage** — walk expanded tree → `displayedRows: RowNode[]`, assign rowIndex,
   compute row tops (uniform height fast path; per-row heights via prefix array).

Transactions: `applyTransaction({add, update, remove, addIndex})` patches leaf arrays then
re-runs stages from the cheapest dirty stage. `setRowData` with `getRowId` diffs by id
(immutable mode) instead of rebuilding nodes, preserving selection/expansion.

## Rendering

- **Scaffold** (one-time DOM):
  ```
  .au-root
    .au-header  [pinned-left | center-viewport>center-container | pinned-right]
    .au-floating-filters (optional row, same 3-region split)
    .au-body    [pinned-left col | center-viewport (scrolls XY) | pinned-right col]
       center-viewport > .au-center-container (height = totalRowHeight spacer)
    .au-pinned-top / .au-pinned-bottom rows
    .au-overlay (loading / no-rows)
    .au-paging-panel (optional)
  ```
  Horizontal scroll of center viewport drives header center via `transform` sync (scroll
  event → rAF → translate). Vertical scroll positions rows via `transform: translateY` inside
  spacer containers in all three regions (pinned regions have their own y-synced containers).
- **VirtualizerY**: from scrollTop+viewportHeight compute [firstRow,lastRow] + overscan
  (default 3). Uniform row height O(1); variable heights binary-search prefix sums.
- **VirtualizerX**: from scrollLeft compute visible center columns by prefix widths; pinned
  columns always rendered.
- **Recycling**: `RowCtrl` pool keyed by row identity; on range change, exiting rows are
  re-bound to entering rows (no DOM teardown). `CellCtrl` per (row, col) updates
  `textContent` when only value changes; full re-render only when renderer identity changes.
- **rAF loop**: all model→DOM updates funneled through `scheduleRender()`; one write pass per
  frame; scroll handler is passive and only records position.
- **Change detection**: cells re-render only when their (rowNode, column) value changed —
  pipeline bumps per-node version; cells cache last value + version.

## Interaction contracts

- **Focus**: one focused cell (rowIndex, colId, region). Grid root has `tabindex=0`; cells get
  `tabindex=-1` roving. All keyboard dispatch enters at focus.ts and delegates to
  edit/range/selection controllers.
- **Editing lifecycle**: `startEditing(cell, keyPress?)` → editor instance (interface
  `CellEditor { getGui, getValue, afterGuiAttached?, isCancelBeforeStart?, destroy? }`) →
  commit via valueParser → `readOnlyEdit ? fire cellEditRequest : node.setDataValue` →
  `cellValueChanged` (old, new, source) → undo stack push. Esc cancels; Tab/Enter commit+move.
- **Write-back pattern**: `readOnlyEdit: true` + `onCellEditRequest` — grid never mutates; the
  host app writes to its store/server and calls `applyTransaction`/`setRowData`. Paste and
  fill-handle route through the same request event with `source: 'paste' | 'fill'`.
- **Ranges**: `CellRange { startRow, endRow, columns }[]`; drag/shift-extend; fill handle emits
  `fillOperation` callback per target cell (default: repeat/series-extend numbers).
- **Clipboard**: TSV serialize of ranges (formatters applied unless `useValueForClipboard`);
  paste parses TSV, maps to cells, routes through editing pipeline (validation + events).

## Theming

All visuals from `--au-*` CSS custom properties (colors, borders, spacing unit, row height,
font). `theme.ts` injects a constructable stylesheet once per document; themes are JS objects
mapping variables, applied as inline vars on the root element (so two grids can have two
themes). Density multiplies the spacing unit. Dark mode via `data-au-color-scheme` attr or
auto `prefers-color-scheme`.

## React wrapper

`<AuGrid rowData columnDefs {...gridOptions} onGridReady .../>` creates core grid in a div.
Custom components: `colDef.cellRenderer` may be a React component; core exposes a renderer
adapter hook — wrapper registers a `frameworkComponentFactory` on options; each mounted cell
gets a stable container element, wrapper renders `createPortal(<Comp {...params}/>, el)` and
collects portals in one state array (single React commit per render batch). Same for editors,
header components, filter components, overlays. Prop diffing maps changed props to
`api.updateGridOptions`.

## Performance rules (enforced in review)

1. No layout reads in render path (cache widths/heights; ResizeObserver only).
2. No per-cell event listeners — all events delegated at container level.
3. No array spreads/allocations per frame in hot loops; reuse buffers.
4. Pipeline stages must be incremental under transactions (dirty flags).
5. `textContent` over `innerHTML`; user HTML must be explicit (`cellRenderer`).
6. All user-visible strings escapable; no `eval`-class APIs.

## Testing

- Vitest + jsdom: pipeline stages, column model, selection/range math, clipboard TSV,
  editing lifecycle, filters, state persistence — pure-logic-first design makes this cheap.
- DOM smoke tests: scaffold, virtualization windows (mock sizes), keyboard nav.
- Benchmarks (`apps/demo/bench`): scripted scenarios logging frame times + pipeline timings.
