# @augrid/core

**A free, MIT-licensed, high-performance data grid.** Framework-agnostic, zero
runtime dependencies, one small package. Everything the commercial enterprise
grids charge per-developer prices for — row grouping, aggregation, pivoting
(editable, with write-back), cell range selection, fill handle, clipboard,
tree data, set filters, undo/redo, Excel export, sparklines — free.

### ▶ [Live demo](https://methodify.github.io/augrid/) · [Repository & docs](https://github.com/methodify/augrid)

```ts
import { createGrid } from '@augrid/core';

const api = createGrid(document.querySelector('#grid')!, {
  columnDefs: [
    { field: 'athlete', filter: 'text', editable: true },
    { field: 'country', rowGroup: true },
    { field: 'gold', aggFunc: 'sum', editable: true },
  ],
  rowData,
  rowSelection: 'multiRow',
  cellSelection: { handle: 'fill' },
  undoRedoCellEditing: true,
});
```

Or as a native custom element:

```html
<au-grid style="height: 400px"></au-grid>
<script type="module">
  import { defineAuGridElement } from '@augrid/core';
  defineAuGridElement(); // registers <au-grid>
  document.querySelector('au-grid').gridOptions = { columnDefs, rowData };
</script>
```

## Highlights

- **O(viewport) rendering** — row + column virtualization with DOM recycling;
  100k-row sorts in ~120ms, ~6ms render passes.
- **Server write-back as a first-class contract** — `readOnlyEdit` +
  `cellEditRequest` intercept every mutation path: typing, paste, fill, cut.
- **Editable pivots** — aggregate-cell commits carry full intersection context
  (`rowKeys` × `pivotKeys` × value column) for allocation/spread write-back.
- **Server-side row model** — lazy per-parent expansion over hierarchies too
  large to materialize (hundreds of thousands of leaves), honest loading UX.
- **In-house Excel export** — real .xlsx (typed values, formats, freeze,
  autofilter, multi-sheet), including **live native Excel sparklines**.
- **Sparklines & data bars** — 8 mark types with honest, explicit scale
  domains (`auto`/`shared`/`group`/fixed), slope-sortable, hover + drill.
- **State transparency** — `getState()`/`applyState()` round-trips columns,
  sort, filter, grouping, pivot, pagination.
- **Themable** — one CSS-variable system, light/dark, density, Shadow-DOM safe.

React users: see [`@augrid/react`](https://www.npmjs.com/package/@augrid/react).

Full docs, recipes (write-back, streaming, pivot editing, theming, server-side
trees), and the change log live in the
[repository](https://github.com/methodify/augrid).

MIT © Bryon Williams
