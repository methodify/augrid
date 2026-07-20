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
