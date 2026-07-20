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

Pivot cells are aggregates, so direct editing is off by default. The matrix-
sheet experience (each pivot cell backed by exactly one source record) is:

```ts
const opts = {
  pivotMode: true,
  columnDefs: [
    { field: 'account', rowGroup: true },
    { field: 'month', pivot: true },
    { field: 'amount', aggFunc: 'sum' },
  ],
  cellSelection: true,
  onCellClicked: (e) => {
    if (!e.column.isSecondary()) return;
    // Resolve the source records behind this pivot cell and open your editor:
    // pivot colIds encode the key path; use e.node (the group row) + the
    // column's pivot keys to look up source rows in your store.
  },
};
```

For true two-way matrix editing, keep the grid in `readOnlyEdit` and translate
`cellEditRequest` on secondary columns into writes against the resolved source
record (unbalanced cells → your allocation rules), then `applyTransaction`.

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
