# AuGrid

**A free, MIT-licensed, high-performance data grid.** Framework-agnostic core, first-class
React wrapper, native `<au-grid>` custom element. Everything AG Grid charges Enterprise
prices for — row grouping, aggregation, **pivoting**, cell **range selection**, **fill
handle**, **clipboard**, tree data, set filters, undo/redo — free, in one small,
zero-dependency package.

### ▶ [Try it live — methodify.github.io/augrid](https://methodify.github.io/augrid/)

1M rows, editable pivots, server-side trees, sparklines, Excel export — the real grid
running in your browser, no install.

**Installing (pre-npm):** AuGrid is not on npm yet. Install the built tarballs from the
latest [GitHub Release](https://github.com/methodify/augrid/releases) — works with npm,
pnpm, yarn, and bun:

```
npm add https://github.com/methodify/augrid/releases/download/v0.6.0/augrid-core-0.6.0.tgz \
        https://github.com/methodify/augrid/releases/download/v0.6.0/augrid-react-0.6.0.tgz
```

Install both together: `@augrid/react` declares `@augrid/core` as a peer dependency.
(Once published to npm this becomes `npm add @augrid/core @augrid/react`.)
Note: a plain git dependency on this repo does NOT work — it's a source-only monorepo;
the release tarballs are the built artifacts.

## Quick start (vanilla)

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

## Quick start (React)

```tsx
import { AuGrid, reactComponent } from '@augrid/react';

<AuGrid<Row>
  rowData={rows}
  columnDefs={[
    { field: 'name', editable: true },
    { field: 'total', cellRenderer: reactComponent(MedalBadge) },
  ]}
  cellSelection={{ handle: 'fill' }}
  onCellValueChanged={(e) => save(e.node.data)}
/>
```

## Why AuGrid

| | AG Grid | AuGrid |
|---|---|---|
| Pivoting, ranges, clipboard, grouping, tree data | Enterprise ($999+/dev/yr) | **Free, MIT** |
| Core bundle (min+gzip) | ~250 kB+ | **47 kB** |
| Runtime dependencies | — | **Zero** |
| Server write-back editing | possible | **first-class** (`readOnlyEdit` + `cellEditRequest` on every edit/paste/fill) |
| Web component | no | **`<au-grid>`** |
| State transparency | opaque internals | `getState()`/`applyState()` for everything |

## Feature highlights

- **Performance**: DOM row+column virtualization with element recycling, rAF-batched writes,
  zero layout reads in the scroll path, incremental pipeline recompute, transactions with
  `getRowId` diffing, async transaction batching. O(viewport) DOM at any row count —
  measured ~6ms per render pass at 100k rows (see the Benchmark demo; very large
  row counts are tracked in AUG-31).
- **Data**: client-side row model (sort → filter → group → aggregate → pivot → flatten) and
  infinite (block-cached server) row model behind one `RowModel` interface.
- **Columns**: groups, pinning, drag reorder, drag/auto resize, flex, types ladder, state
  persistence, autosize.
- **Editing**: six built-in editors, full-row mode, validation hook, undo/redo, paste and
  fill-handle routed through the same commit pipeline as typing.
- **Interaction**: Excel-grade keyboard model, multi-range selection, fill handle with
  series extension, TSV clipboard both ways.
- **A11y**: ARIA grid semantics, roving tab index, full keyboard operation.
- **Theming**: every color/size is a `--au-*` CSS variable; light/dark/auto schemes;
  compact/normal/comfortable density; style injection works in Shadow DOM.

## Write-back (server-authoritative editing)

Set `readOnlyEdit: true` and the grid never mutates your data. Every mutation attempt —
cell edit, paste, fill-handle drag — emits `cellEditRequest`. Apply it to your store or
server (e.g. a Microsoft Fabric write-back queue), then feed the result back with
`applyTransaction`. The grid renders whatever your data says, always.

```ts
onCellEditRequest: async (e) => {
  await fabric.write(e.node.id, e.colId, e.newValue);
  api.applyTransaction({ update: [updatedRow] });
}
```

## Repo layout

```
packages/core    @augrid/core   — the grid (TypeScript, zero deps)
packages/react   @augrid/react  — React wrapper (portal-based custom components)
apps/demo        kitchen sink + write-back demo + benchmarks (pnpm demo)
docs/            product plan, architecture, ADRs
```

## Development

```
pnpm install
pnpm test        # vitest suite
pnpm typecheck
pnpm demo        # kitchen sink at localhost:5173
```

Read `docs/ARCHITECTURE.md` before touching core. Performance rules are enforced in review:
no layout reads in the render path, no per-cell listeners, no per-frame allocations in hot
loops.

## Status & roadmap

v0.1 implements the full v1 scope in `docs/PRODUCT.md`, plus (post-v1, in main — see
CHANGELOG.md): pivot write-back with intersection-keyed `cellEditRequest`, context menu,
header column menus, side-bar tool panels (columns chooser with group/value/pivot drop
zones; filters panel), find-in-grid, and the server-side row model (lazy per-parent
group expansion with server-computed aggregates and write-back at any grain), and
zero-dependency Excel (.xlsx) export, and in-cell sparklines. Roadmap (v1.x):
master/detail, row drag, cell spanning,
Angular/Vue/Svelte wrappers.

MIT — see LICENSE.
