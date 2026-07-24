# AuGrid Recipes

Practical patterns for common scenarios. All snippets are TypeScript against
`@augrid/core` / `@augrid/react`.

## Server-authoritative editing (write-back)

The pattern for grids whose truth lives on a server (e.g. a planning system
writing back to Microsoft Fabric). The grid never mutates data; every mutation
attempt — typing, paste, fill handle, Delete — arrives as one event.

```ts
const api = createGrid(el, {
  rowData,
  getRowId: (p) => p.data.id,          // stable ids are essential
  readOnlyEdit: true,
  columnDefs: [{ field: 'qty', editable: true, cellDataType: 'number' }],
  onCellEditRequest: async (e) => {
    // e.source: 'edit' | 'paste' | 'fill' | 'cut'
    markPending(e.node.id, e.colId);
    try {
      const updatedRow = await server.write(e.node.id, e.colId, e.newValue);
      api.applyTransaction({ update: [updatedRow] });   // server truth flows back
    } catch (err) {
      showError(err);                                   // grid still shows old value
    } finally {
      clearPending(e.node.id, e.colId);
    }
  },
});
```

Notes:
- EVERY mutation path — typing, paste, fill handle, cut, Delete — runs
  through the same editability gate: cells that aren't `editable` are
  silently skipped, never mutated. A cut/paste swept across a mixed range
  changes only the editable cells (copy still captures the whole block).
  If you want read-only cells visually distinct, style them via `cellClass`.
- Batch rapid edits server-side; the grid will happily emit many requests
  during a paste. Collect them and `applyTransaction({ update })` once.
- `validateEdit` runs before the request fires — reject bad input locally.
- Undo/redo is a client concept; with `readOnlyEdit` drive history from your
  server instead (`undoRedoCellEditing` records nothing when data never changes).

## Live/streaming updates without jank

```ts
// High-frequency ticks: batches all transactions in a 16ms window into one
// pipeline pass + one paint.
socket.on('tick', (rows) => api.applyTransactionAsync({ update: rows }));
// Cell change flashing:
// gridOptions: { enableCellChangeFlash: true }
```

## Editable pivot ("matrix sheet")

Pivot write-back is first-class. Mark a value column `editable` and every pivot
cell it generates becomes a write cell; all other measures stay read-only.
Commits to aggregate cells are ALWAYS event-routed (regardless of
`readOnlyEdit`) — the grid never mutates an aggregate. The event carries the
full intersection:

```ts
const opts = {
  pivotMode: true,
  columnDefs: [
    { field: 'item',  rowGroup: true },
    { field: 'color', rowGroup: true },
    { field: 'market', pivot: true },
    { field: 'store',  pivot: true },
    { field: 'onHand', aggFunc: 'sum' },                    // read-only measure
    { field: 'alloc',  aggFunc: 'sum', editable: true },    // WRITE measure
    { field: 'reason', aggFunc: 'first', editable: true },  // write ATTRIBUTE
  ],
  onCellEditRequest: async (e) => {
    const pc = e.pivot!; // PivotCellContext
    // pc.rowKeys   → [{colId:'item',key:'Crew Tee'},{colId:'color',key:'Black'}]
    // pc.pivotKeys → [{colId:'market',key:'East'},{colId:'store',key:'BOS-02'}]
    // pc.valueColId → 'alloc';  pc.level → group depth of the edited row
    const sourceRows = pc.getLeafRows();       // rows at this intersection
    const updated = await server.writeAllocation(pc, e.newValue, sourceRows);
    api.applyTransaction({ update: updated }); // truth flows back, cell recomputes
  },
};
```

Notes:
- Edits above the deepest level reach you with ALL matching source rows —
  spreading/allocation policy is yours (`getLeafRows()` gives you the targets).
- Per-cell policy (purview, level restrictions): make `editable` a callback —
  it receives `params.pivot` with the same context.
- The "reason code" pattern: any editable per-row attribute is a value column
  with `aggFunc: 'first'` — it renders per row group and round-trips like any
  write measure.
- `api.getPivotCellContext(rowIndexOrNode, colId)` resolves the same context
  anywhere (cell renderers, context menus, drill-through).
- Paste and fill-handle drags on write cells route through the same event.
- The demo's "Pivot Plan" page is this recipe running end-to-end.

## Context menu with app actions

Right-click (and Shift+F10 / the ContextMenu key) opens a built-in menu:
clipboard, pin, expand/collapse (when grouping), CSV export. Mix your own
items in with `getContextMenuItems` — on pivot/group cells the params carry
the same `PivotCellContext` as write-back events, so intersection actions
(drill-through, allocate, comment) are one callback away:

```ts
const opts = {
  getContextMenuItems: (p: GetContextMenuItemsParams<Row>) => {
    const items: (DefaultMenuItem | MenuItemDef<Row>)[] = [];
    if (p.pivot) {
      items.push({
        name: `Drill through (${p.pivot.getLeafRows().length} rows)`,
        icon: '🔎',
        action: () => openDrillThrough(p.pivot!),
      }, 'separator');
    }
    return [...items, ...p.defaultItems];   // defaults: copy/paste/pin/export…
  },
};
```

Notes:
- Item `name`/`icon` render via textContent (no HTML). `subMenu` nests;
  `disabled`, `checked`, `shortcut`, `cssClass` cover the usual affordances.
- Return `[]` to let the browser's own menu through for that cell;
  `suppressContextMenu` disables the grid menu entirely; Ctrl+right-click
  shows the browser menu unless `allowContextMenuWithControlKey`.
- `api.showContextMenu()` / `api.hideContextMenu()` drive it programmatically;
  `contextMenuVisibleChanged` fires on open/close.

## Side bar: columns chooser, pivot config, filters

```ts
createGrid(el, {
  sideBar: true,                                  // columns + filters panels
  // or: sideBar: 'filters'
  // or: sideBar: { panels: ['columns'], defaultOpen: 'columns', position: 'left' },
});
```

The **columns panel** offers visibility checkboxes, a search box, and
drag-and-drop zones for Row Groups, Values, and (in pivot mode) Column
Labels — a user-driven pivot configurator over the same
`setRowGroupColumns`/`setPivotColumns`/`setValueColumns` model the API uses.
The **filters panel** mounts every filterable column's filter inline, with
active indicators and per-column clear. Drive it programmatically with
`api.openToolPanel('columns')`, `closeToolPanel()`, `setSideBarVisible()`;
`toolPanelVisibleChanged` fires on open/close.

Every column header also gets a ⋮ menu (sort, pin, autosize, group-by, hide,
choose columns). Disable with `suppressHeaderMenuButton` (grid-wide or per
colDef).

## Find in grid

Search what the user sees — formatted values across all displayed cells:

```ts
api.setFindText('nilsson');   // recompute + highlight all matches
api.findNext();               // step active match, scrolls & focuses (wraps)
api.findPrevious();
api.getFindState();           // { text, totalMatches, activeIndex }
api.clearFind();
// event: findChanged fires on every change — drive a "3/41" counter from it.
```

Matches restyle via `.au-find-match` / `.au-find-active` (override the
`--au-find-match-color` / `--au-find-active-color` vars). Matching is
case-insensitive substring over formatted values; match sets recompute
automatically on data/filter/sort/column changes while a search is live.

## Server-side row model (lazy trees over big hierarchies)

For hierarchies too large to materialize client-side (a 7-level product tree
with 240K leaves): children are fetched per parent on expand, block-windowed
within each parent, with the SERVER computing aggregate values at every grain.

```ts
createGrid(el, {
  rowModelType: 'serverSide',
  cacheBlockSize: 100,                       // block window within each parent
  columnDefs: [
    { field: 'region', rowGroup: true },
    { field: 'store',  rowGroup: true },
    { field: 'sku' },
    { field: 'target', aggFunc: 'sum', editable: true },  // aggFunc advisory: server computes
  ],
  isServerSideGroup: (d) => d.sku === undefined,          // expandability rides on the row
  getServerSideGroupKey: (d) => d.store ?? d.region,      // null is a REAL key (blank member)
  getRowId: (p) => p.data.sku ?? `g:${p.parentKeys?.join('/')}:${p.data.store ?? p.data.region}`,
  serverSideDatasource: {
    getRows: async (p) => {
      // p.groupKeys: raw key path to the parent ([] = root) — numbers and
      // nulls round-trip losslessly. One query per expansion (per block for
      // very wide parents via p.startRow/p.endRow).
      const { rows, total } = await server.children(p.groupKeys, p.startRow, p.endRow,
                                                    p.sortModel, p.filterModel);
      p.success({ rowData: rows, rowCount: total });      // omit rowCount while unknown
    },
  },
  // Write-back at ANY grain: group-row commits are ALWAYS event-routed —
  // e.pivot.rowKeys carries the raw key path; the server decomposes.
  onCellEditRequest: async (e) => {
    await server.write(e.pivot!.rowKeys, e.pivot!.valueColId, e.newValue);
    api.refreshServerSideStore({ groupKeys: e.pivot!.rowKeys.slice(0, -1).map(k => k.key) });
  },
});
```

Notes:
- Sort/filter changes purge and refetch (server owns both); expanded paths
  re-open lazily as their parents reload.
- `api.refreshServerSideStore({ groupKeys, fromRow?, toRow? })` refetches a
  parent's loaded blocks in place — rows stay visible until replaced,
  selection carries by `getRowId`. Omit `groupKeys` to refresh every store.
- `e.pivot.getLeafRows()` on a server-side group returns CACHED leaves only
  (never fetches) — decomposition belongs to your server, keyed by `rowKeys`.
- Collapsed stores stay cached; re-expanding is instant.
- The demo's "Server-Side" page runs this end-to-end, including a null
  (blank) group member and group-level write-back with decomposition.

## Excel (.xlsx) export

Zero-dependency xlsx writing — no SheetJS, no server round-trip. Values keep
their real types, so Excel can sum, sort, and filter them natively:

```ts
await api.exportDataAsExcel({ fileName: 'medals.xlsx', sheetName: 'Medals' });

const bytes = await api.getDataAsExcel();   // Uint8Array, for upload/preview
```

What lands in the file: the current view (respects sort, filter, and column
order), a styled + frozen header row, frozen pinned-left columns, an
autofilter, column widths carried over from the grid, and typed cells —
numbers as numbers, dates as real dates, booleans as booleans.

```ts
columnDefs: [
  { field: 'gold',  excelNumberFormat: '#,##0' },
  { field: 'share', excelNumberFormat: '0.0%' },
  { field: 'when' },                            // dates default to yyyy-mm-dd
]
```

Options: `allColumns`, `onlySelected`, `skipHeaders`, `suppressFreeze`,
`suppressAutoFilter`, `headerStyle` (bold/fill/color/align), and
`processCellForExcel` to rewrite values on the way out. Set
`useFormattedValues: true` when the display string *is* the data — it exports
formatter output as text instead of typed values.

### Multiple sheets (including across grids)

```ts
await api.exportMultipleSheetsAsExcel({
  fileName: 'review.xlsx',
  sheets: [
    api.getSheetDataForExcel({ sheetName: 'All rows' }),
    api.getSheetDataForExcel({ sheetName: 'Selected', onlySelected: true }),
    otherGridApi.getSheetDataForExcel({ sheetName: 'Summary' }),  // another grid
  ],
});
```

`getSheetDataForExcel` returns a self-contained payload (cells plus the style
specs they reference), so sheets built by *different* grids compose without
style collisions — styles are re-interned during the merge.

Notes:
- Export is async: the writer DEFLATE-compresses via the platform's
  `CompressionStream` when available (~8× smaller), and falls back to stored
  entries — still a valid .xlsx — where it isn't.
- Measured: 100k rows × 9 columns exports in ~0.8s to a ~4 MB file in Chrome.
- Unlike CSV there is no formula-injection concern: text lands in the shared
  string table and Excel never parses it as a formula.
- Group rows are skipped (leaf data only), matching CSV export.

## Persisting user layout

```ts
// Save (e.g. on gridPreDestroyed or debounced on stateUpdated):
localStorage.setItem('grid-state', JSON.stringify(api.getState()));
// Restore — either at creation:
createGrid(el, { ...opts, initialState: JSON.parse(saved) });
// or live:
api.applyState(JSON.parse(saved));
```

## React: custom cells and editors

```tsx
import { AuGrid, reactComponent } from '@augrid/react';

const Badge = (p: CellRendererParams<Row>) => <span className="badge">{p.valueFormatted}</span>;

<AuGrid<Row>
  rowData={rows}                       // memoize! identity change = data update
  columnDefs={useMemo(() => [
    { field: 'status', cellRenderer: reactComponent(Badge) },
  ], [])}
/>
```

Memoize `columnDefs`, `defaultColDef`, and callbacks — the wrapper diffs props
by identity and forwards changes to the grid.

## Server-backed scrolling (infinite model)

```ts
createGrid(el, {
  rowModelType: 'infinite',
  cacheBlockSize: 200,
  datasource: {
    getRows: async (p) => {
      const { rows, total } = await server.query({
        offset: p.startRow, limit: p.endRow - p.startRow,
        sort: p.sortModel, filter: p.filterModel,
      });
      p.success({ rowData: rows, lastRow: total });
    },
  },
});
```

Sort and filter changes purge the cache and re-query with the new model —
your server owns ordering and filtering.

`getRows` params: `startRow`/`endRow` are ROW OFFSETS (not block indexes;
`endRow` exclusive, always one `cacheBlockSize` apart), `sortModel` is
`[{ colId, sort: 'asc' | 'desc' }]`, `filterModel` is the same per-column
map as `api.getFilterModel()`. Report the total via `lastRow` when known
(else `-1` and the row count grows speculatively); call `fail()` on error.

### When server data changes underneath the cache

For server-authoritative grids (write-back decompositions, ticking values),
refresh without tearing anything down:

```ts
api.refreshInfiniteCache();                          // refetch every cached block
api.refreshInfiniteCache({ fromRow: 200, toRow: 340 }); // only blocks touching a range
```

Refresh is IN PLACE: current rows stay visible until each block's replacement
arrives, scroll/focus survive, and row selection carries across by `getRowId`.
Use `api.purgeInfiniteCache()` only for "everything changed" resets — it drops
the cache, resets the row count, and reloads from the top (scroll position is
not meaningful across a purge).

## Theming to your design system

```ts
createGrid(el, {
  theme: {
    colorScheme: 'auto',               // follows prefers-color-scheme
    density: 'compact',
    params: {
      accentColor: 'var(--brand-500)', // any CSS value, including your vars
      fontFamily: 'Inter, sans-serif',
      rowHeight: '28px',
    },
  },
});
```

Every visual knob is a `--au-*` custom property; `params` camelCase names map
directly (`accentColor` → `--au-accent-color`). Grids are styled per-instance,
so two grids with different themes coexist.

## Multiple selection models together

Row selection (checkboxes) and cell ranges are independent and compose:

```ts
{
  rowSelection: { mode: 'multiRow', checkboxes: true, headerCheckbox: true },
  cellSelection: { handle: 'fill' },
}
```

Clipboard prefers cell ranges when present, then selected rows, then the
focused cell.
