import { describe, expect, it, vi } from 'vitest';
import { Grid } from './grid';
import type { ColDef } from './types/colDef';
import type { CellEditRequestEvent, CellValueChangedEvent } from './types/events';

interface Row {
  id: number;
  name: string;
  country: string;
  gold: number;
}

function makeRows(n: number): Row[] {
  const countries = ['USA', 'China', 'France', 'Japan'];
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `A${i}`,
    country: countries[i % countries.length],
    gold: i % 5,
  }));
}

const columnDefs: ColDef<Row>[] = [
  { field: 'name', editable: true },
  { field: 'country' },
  { field: 'gold', aggFunc: 'sum', editable: true },
];

function mount(extra: object = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const grid = new Grid<Row>(host, {
    columnDefs,
    rowData: makeRows(100),
    getRowId: (p) => String(p.data.id),
    ...extra,
  });
  grid.getContext().renderer.setViewportSizeForTesting(800, 300);
  grid.getContext().renderer.renderNow();
  return { grid, host };
}

describe('Grid composition root', () => {
  it('boots all services, renders rows, and destroys cleanly', () => {
    const { grid, host } = mount();
    expect(grid.api.getDisplayedRowCount()).toBe(100);
    expect(host.querySelectorAll('.au-row').length).toBeGreaterThan(0);
    expect(host.querySelector('.au-header-cell')).toBeTruthy();
    grid.destroy();
    expect(grid.api.isDestroyed()).toBe(true);
    expect(host.querySelector('.au-root')).toBeNull();
  });

  it('bridges events to GridOptions onXxx callbacks', () => {
    const onCellValueChanged = vi.fn();
    const { grid } = mount({ onCellValueChanged });
    grid.api.getDisplayedRowAtIndex(0)!.setDataValue('gold', 42, 'edit');
    expect(onCellValueChanged).toHaveBeenCalledTimes(1);
    const ev = onCellValueChanged.mock.calls[0][0] as CellValueChangedEvent<Row>;
    expect(ev.newValue).toBe(42);
    expect(ev.colId).toBe('gold');
    grid.destroy();
  });

  it('readOnlyEdit routes mutations to onCellEditRequest without touching data', () => {
    const onCellEditRequest = vi.fn();
    const { grid } = mount({ readOnlyEdit: true, onCellEditRequest });
    const node = grid.api.getDisplayedRowAtIndex(0)!;
    node.setDataValue('gold', 99, 'edit');
    expect(onCellEditRequest).toHaveBeenCalledTimes(1);
    const ev = onCellEditRequest.mock.calls[0][0] as CellEditRequestEvent<Row>;
    expect(ev.newValue).toBe(99);
    expect(node.data!.gold).not.toBe(99);
    grid.destroy();
  });

  it('callbacks added via updateGridOptions after creation also fire', () => {
    const late = vi.fn();
    const { grid } = mount();
    grid.api.setGridOption('onCellValueChanged', late);
    grid.api.getDisplayedRowAtIndex(1)!.setDataValue('gold', 7, 'edit');
    expect(late).toHaveBeenCalledTimes(1);
    grid.destroy();
  });

  it('enableCellChangeFlash (grid option) flashes the changed cell (C26)', () => {
    const { grid, host } = mount({ enableCellChangeFlash: true });
    grid.api.getDisplayedRowAtIndex(0)!.setDataValue('gold', 42, 'edit');
    const cell = host.querySelector('.au-row[data-au-row-index="0"] [data-au-col="gold"]')!;
    expect(cell.classList.contains('au-cell-flash')).toBe(true);
    // untouched cells do not flash
    const other = host.querySelector('.au-row[data-au-row-index="0"] [data-au-col="name"]')!;
    expect(other.classList.contains('au-cell-flash')).toBe(false);
    grid.destroy();
  });

  it('colDef.enableCellChangeFlash flashes without the grid-wide option (C26)', () => {
    const defs: ColDef<Row>[] = [
      { field: 'name', editable: true },
      { field: 'country' },
      { field: 'gold', editable: true, enableCellChangeFlash: true },
    ];
    const { grid, host } = mount({ columnDefs: defs });
    grid.api.getDisplayedRowAtIndex(1)!.setDataValue('gold', 7, 'edit');
    const cell = host.querySelector('.au-row[data-au-row-index="1"] [data-au-col="gold"]')!;
    expect(cell.classList.contains('au-cell-flash')).toBe(true);
    grid.destroy();
  });

  it('columnDefs updates invalidate rendered body cells (C30)', () => {
    const { grid, host } = mount();
    const cell = () => host.querySelector('.au-row[data-au-row-index="0"] [data-au-col="name"]')!;
    expect(cell().textContent).toBe('A0');
    grid.api.setGridOption('columnDefs', [
      { field: 'name', valueFormatter: (p) => `» ${p.value}` },
      { field: 'country' },
      { field: 'gold' },
    ] satisfies ColDef<Row>[]);
    grid.getContext().renderer.renderNow();
    expect(cell().textContent).toBe('» A0');
    grid.destroy();
  });

  it('shift+arrow extends the cell range step by step from the anchor', () => {
    const { grid, host } = mount({ cellSelection: true });
    const root = host.querySelector('.au-root')!;
    grid.api.setFocusedCell(2, 'name');
    const press = (key: string, shiftKey = true) =>
      root.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));

    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    let [range] = grid.api.getCellRanges();
    expect(range.startRowIndex).toBe(2);
    expect(range.endRowIndex).toBe(5); // grew one row per press
    expect(range.colIds).toEqual(['name']);
    // focus stays on the anchor while extending
    expect(grid.api.getFocusedCell()!.rowIndex).toBe(2);

    press('ArrowRight');
    [range] = grid.api.getCellRanges();
    expect(range.colIds).toEqual(['name', 'country']); // rectangle widens
    expect(range.endRowIndex).toBe(5);

    press('ArrowUp');
    [range] = grid.api.getCellRanges();
    expect(range.endRowIndex).toBe(4); // shrinks back toward the anchor

    // plain arrow collapses the range and moves focus
    press('ArrowDown', false);
    [range] = grid.api.getCellRanges();
    expect(range.startRowIndex).toBe(range.endRowIndex);
    expect(grid.api.getFocusedCell()!.rowIndex).toBe(3);
    grid.destroy();
  });

  it('editable pivot cell: typed edit is event-routed with intersection context (AUG-6)', () => {
    interface PRow {
      item: string;
      store: string;
      onHand: number;
      alloc: number;
    }
    const rows: PRow[] = [
      { item: 'Shirt', store: 'S1', onHand: 10, alloc: 1 },
      { item: 'Shirt', store: 'S2', onHand: 20, alloc: 2 },
      { item: 'Pants', store: 'S1', onHand: 30, alloc: 3 },
    ];
    const requests: import('./types/events').CellEditRequestEvent<PRow>[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new Grid<PRow>(host, {
      columnDefs: [
        { field: 'item', rowGroup: true },
        { field: 'store', pivot: true },
        { field: 'onHand', aggFunc: 'sum' },
        { field: 'alloc', aggFunc: 'sum', editable: true },
      ],
      rowData: rows,
      pivotMode: true,
      getRowId: (p) => `${p.data.item}-${p.data.store}`,
      onCellEditRequest: (e) => requests.push(e),
    });
    const ctx = grid.getContext();
    ctx.renderer.setViewportSizeForTesting(1000, 400);
    ctx.renderer.renderNow();

    // Shirt group row, alloc column under store S1.
    const shirt = grid.api.getDisplayedRowAtIndex(0)!;
    expect(shirt.key).toBe('Shirt');
    const allocS1 = grid.api
      .getPivotResultColumns()
      .find((c) => {
        const pc = grid.api.getPivotCellContext(shirt, c.getColId());
        return pc?.valueColId === 'alloc' && pc.pivotKeys[0]?.key === 'S1';
      })!;
    expect(allocS1).toBeTruthy();

    // Read-only value column (onHand) refuses editing entirely.
    const onHandS1 = grid.api
      .getPivotResultColumns()
      .find((c) => grid.api.getPivotCellContext(shirt, c.getColId())?.valueColId === 'onHand')!;
    ctx.editing.startEditing({ rowIndex: 0, colId: onHandS1.getColId() });
    expect(ctx.editing.isEditing()).toBe(false);

    // Editable alloc cell: full editor lifecycle → cellEditRequest, no mutation.
    expect(ctx.editing.startEditing({ rowIndex: 0, colId: allocS1.getColId() })).toBe(true);
    ctx.renderer.renderNow(); // mounts the editor
    const input = host.querySelector('.au-cell-inline-editing input') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = '42';
    ctx.editing.stopEditing(false);

    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.newValue).toBe(42); // number-parsed via inherited cellDataType
    expect(req.pivot!.rowKeys).toEqual([{ colId: 'item', key: 'Shirt' }]);
    expect(req.pivot!.pivotKeys).toEqual([{ colId: 'store', key: 'S1' }]);
    expect(req.pivot!.valueColId).toBe('alloc');
    expect(req.pivot!.getLeafRows()).toEqual([rows[0]]);
    // Data untouched; aggregate unchanged.
    expect(rows[0].alloc).toBe(1);
    expect(shirt.aggData![allocS1.getColId()]).toBe(1);

    // Paste path routes identically (single funnel).
    ctx.editing.commitValue(
      shirt as never,
      allocS1.getColId(),
      '7',
      'paste',
      true,
    );
    expect(requests).toHaveLength(2);
    expect(requests[1].source).toBe('paste');
    expect(requests[1].newValue).toBe(7);
    grid.destroy();
  });

  it('grouped (non-pivot) editable aggregate cell routes with empty pivotKeys (AUG-6)', () => {
    const requests: import('./types/events').CellEditRequestEvent<Row>[] = [];
    const { grid } = mount({
      columnDefs: [
        { field: 'name' },
        { field: 'country', rowGroup: true },
        { field: 'gold', aggFunc: 'sum', editable: true },
      ] satisfies ColDef<Row>[],
      onCellEditRequest: (e: import('./types/events').CellEditRequestEvent<Row>) =>
        requests.push(e),
    });
    const group = grid.api.getDisplayedRowAtIndex(0)!;
    expect(group.group).toBe(true);
    const before = group.aggData!.gold;
    grid.getContext().editing.commitValue(group as never, 'gold', '99', 'edit', true);
    expect(requests).toHaveLength(1);
    expect(requests[0].pivot!.pivotKeys).toEqual([]);
    expect(requests[0].pivot!.rowKeys[0].colId).toBe('country');
    expect(group.aggData!.gold).toBe(before); // no local mutation
    // Leaf-row editing still writes locally (readOnlyEdit off).
    grid.api.setRowNodeExpanded(group, true);
    const leaf = grid.api.getDisplayedRowAtIndex(1)!;
    expect(leaf.group).toBe(false);
    leaf.setDataValue('gold', 55, 'edit');
    expect(leaf.data!.gold).toBe(55);
    grid.destroy();
  });

  it('editable callback on aggregate cells receives pivot context (AUG-6)', () => {
    const seen: unknown[] = [];
    const { grid } = mount({
      columnDefs: [
        { field: 'name' },
        { field: 'country', rowGroup: true },
        {
          field: 'gold',
          aggFunc: 'sum',
          editable: (p: import('./types/colDef').EditableCallbackParams<Row>) => {
            seen.push(p.pivot);
            return p.pivot != null && p.pivot.level === 0;
          },
        },
      ] satisfies ColDef<Row>[],
    });
    const group = grid.api.getDisplayedRowAtIndex(0)!;
    const ok = grid.getContext().editing.startEditing({ rowIndex: 0, colId: 'gold' });
    expect(ok).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect((seen[0] as { rowKeys: unknown[] }).rowKeys).toHaveLength(1);
    grid.getContext().editing.stopEditing(true);
    void group;
    grid.destroy();
  });

  it('groups + aggregates through the full stack', () => {
    const { grid } = mount();
    grid.api.applyColumnState({ state: [{ colId: 'country', rowGroup: true }] });
    expect(grid.api.getDisplayedRowCount()).toBe(4); // collapsed country groups
    const first = grid.api.getDisplayedRowAtIndex(0)!;
    expect(first.group).toBe(true);
    expect(typeof first.aggData!.gold).toBe('number');
    grid.destroy();
  });
});
