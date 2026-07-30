# @augrid/react

React bindings for [**AuGrid**](https://www.npmjs.com/package/@augrid/core) —
the free, MIT-licensed, high-performance data grid. Typed component props for
every grid option and event, plus `reactComponent()` to use React components
as cell renderers, editors, headers, and tooltips.

### ▶ [Live demo](https://methodify.github.io/augrid/) · [Repository & docs](https://github.com/methodify/augrid)

```
npm add @augrid/core @augrid/react
```

```tsx
import { AuGrid, reactComponent } from '@augrid/react';

<AuGrid<Row>
  rowData={rows}
  columnDefs={[
    { field: 'name', editable: true },
    { field: 'total', cellRenderer: reactComponent(MedalBadge) },
  ]}
  rowSelection="multiRow"
  onCellValueChanged={(e) => save(e.data)}
  onGridReady={(e) => (apiRef.current = e.api)}
/>
```

- All grid options are props; all events are `onXxx` props, fully typed.
- `reactComponent(MyComp)` bridges any custom-component slot to React with
  correct mount/unmount through the grid's recycling renderer.
- The imperative `GridApi` is available via `onGridReady` for everything else
  (transactions, state, export, find, pivots).

Requires `react >= 18` and the matching `@augrid/core` (declared as peer
dependencies). Full docs and recipes in the
[repository](https://github.com/methodify/augrid).

MIT © Bryon Williams
