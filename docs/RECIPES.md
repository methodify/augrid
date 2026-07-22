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
