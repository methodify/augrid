import { describe, expect, it } from 'vitest';
import { createMockContext } from '../../test/mockContext';
import { resolveSideBarDef } from './sideBarService';
import { addToZone, removeFromZone, zoneColIds } from './columnsPanel';
import { Grid } from '../../grid';
import type { ColDef } from '../../types/colDef';

interface Row {
  id: number;
  name: string;
  country: string;
  gold: number;
}

const ROWS: Row[] = [
  { id: 0, name: 'A', country: 'USA', gold: 1 },
  { id: 1, name: 'B', country: 'USA', gold: 2 },
  { id: 2, name: 'C', country: 'France', gold: 3 },
];

const COLS: ColDef<Row>[] = [{ field: 'name' }, { field: 'country' }, { field: 'gold' }];

describe('resolveSideBarDef', () => {
  it('normalizes shorthand forms', () => {
    expect(resolveSideBarDef(undefined)).toBeNull();
    expect(resolveSideBarDef(false)).toBeNull();
    expect(resolveSideBarDef(true)).toEqual({
      panels: ['columns', 'filters'],
      defaultOpen: null,
      position: 'right',
    });
    expect(resolveSideBarDef('filters')!.panels).toEqual(['filters']);
    expect(
      resolveSideBarDef({ panels: ['columns'], defaultOpen: 'columns', position: 'left' }),
    ).toEqual({ panels: ['columns'], defaultOpen: 'columns', position: 'left' });
    expect(resolveSideBarDef({ panels: [] })).toBeNull();
  });
});

describe('columns panel zone helpers', () => {
  it('add/remove row-group zone reshapes the row model', () => {
    const { ctx, start } = createMockContext<Row>({ columnDefs: COLS, rowData: ROWS });
    start();
    expect(ctx.rowModel.getRowCount()).toBe(3);
    addToZone(ctx, 'rowGroup', 'country');
    expect(zoneColIds(ctx, 'rowGroup')).toEqual(['country']);
    // grouped: 2 group rows at minimum (default collapsed)
    expect(ctx.rowModel.getRow(0)!.group).toBe(true);
    removeFromZone(ctx, 'rowGroup', 'country');
    expect(zoneColIds(ctx, 'rowGroup')).toEqual([]);
    expect(ctx.rowModel.getRow(0)!.group).toBe(false);
  });

  it('value zone preserves aggFunc and defaults to sum', () => {
    const { ctx, start } = createMockContext<Row>({
      columnDefs: [{ field: 'name' }, { field: 'country', rowGroup: true }, { field: 'gold', aggFunc: 'avg' }],
      rowData: ROWS,
      groupDefaultExpanded: -1,
    });
    start();
    expect(zoneColIds(ctx, 'value')).toEqual(['gold']);
    addToZone(ctx, 'value', 'name');
    // zone order follows primary-column order, not insertion order
    expect(zoneColIds(ctx, 'value').sort()).toEqual(['gold', 'name']);
    // existing avg preserved, new column defaulted
    expect(ctx.columnModel.getColumn('gold')!.aggFunc).toBe('avg');
    expect(ctx.columnModel.getColumn('name')!.aggFunc).toBe('sum');
    // duplicate add is a no-op
    addToZone(ctx, 'value', 'name');
    expect(zoneColIds(ctx, 'value').length).toBe(2);
  });

  it('pivot zone toggles pivot columns', () => {
    const { ctx, start } = createMockContext<Row>({
      columnDefs: COLS,
      rowData: ROWS,
      pivotMode: true,
    });
    start();
    addToZone(ctx, 'pivot', 'country');
    expect(zoneColIds(ctx, 'pivot')).toEqual(['country']);
    removeFromZone(ctx, 'pivot', 'country');
    expect(zoneColIds(ctx, 'pivot')).toEqual([]);
  });
});

function mount(extra: object = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const grid = new Grid<Row>(host, {
    columnDefs: COLS,
    rowData: ROWS,
    getRowId: (p) => String(p.data.id),
    sideBar: true,
    ...extra,
  });
  grid.getContext().renderer.setViewportSizeForTesting(800, 300);
  grid.getContext().renderer.renderNow();
  return { grid, host };
}

describe('SideBarService (DOM)', () => {
  it('renders tab buttons; open/close toggles the columns panel', () => {
    const { grid, host } = mount();
    const btns = host.querySelectorAll('.au-sidebar-btn');
    expect(btns.length).toBe(2);
    expect(grid.api.isSideBarVisible()).toBe(true);
    expect(grid.api.getOpenedToolPanel()).toBeNull();

    (btns[0] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(grid.api.getOpenedToolPanel()).toBe('columns');
    // visibility checkboxes for the three columns
    expect(host.querySelectorAll('[data-au-panel-visibility]').length).toBe(3);
    // row groups + values zones (no pivot zone outside pivot mode)
    expect(host.querySelectorAll('[data-au-panel-zone]').length).toBe(2);

    (btns[0] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(grid.api.getOpenedToolPanel()).toBeNull();
    grid.destroy();
  });

  it('visibility checkbox hides the column; api.openToolPanel works', () => {
    const { grid, host } = mount({ sideBar: { panels: ['columns'], defaultOpen: 'columns' } });
    expect(grid.api.getOpenedToolPanel()).toBe('columns');
    const cb = host.querySelector('[data-au-panel-visibility="country"]') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(grid.api.getColumn('country')!.isVisible()).toBe(false);
    // panel re-rendered; checkbox reflects hidden state
    const cb2 = host.querySelector('[data-au-panel-visibility="country"]') as HTMLInputElement;
    expect(cb2.checked).toBe(false);
    grid.destroy();
  });

  it('drop on the row-groups zone groups the column (chip renders, ✕ removes)', () => {
    const { grid, host } = mount({ sideBar: { panels: ['columns'], defaultOpen: 'columns' } });
    const zone = host.querySelector('[data-au-panel-zone="rowGroup"]')!;
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: { getData: () => JSON.stringify({ colId: 'country', from: null }) },
    });
    zone.dispatchEvent(drop);
    expect(grid.getContext().columnModel.getRowGroupColumns().map((c) => c.colId)).toEqual(['country']);

    // The header must repaint with the auto group column — services mutate
    // through the ColumnModel, not the api layer (live-found regression).
    grid.getContext().renderer.renderNow();
    expect(host.querySelector('[data-au-header-col="au-group-col"]')).toBeTruthy();

    const chipX = host.querySelector('[data-au-panel-chip-x="country"]') as HTMLElement;
    expect(chipX).toBeTruthy();
    chipX.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(grid.getContext().columnModel.getRowGroupColumns().length).toBe(0);
    grid.getContext().renderer.renderNow();
    expect(host.querySelector('[data-au-header-col="au-group-col"]')).toBeNull();
    grid.destroy();
  });

  it('filters panel mounts filter inputs and clears via ✕', () => {
    const { grid, host } = mount({
      columnDefs: [{ field: 'name', filter: true }, { field: 'country', filter: true }, { field: 'gold' }],
      sideBar: { panels: ['filters'], defaultOpen: 'filters' },
    });
    const entries = host.querySelectorAll('.au-panel-filter-entry');
    expect(entries.length).toBeGreaterThanOrEqual(2);

    grid.api.setColumnFilterModel('name', { filterType: 'text', type: 'contains', filter: 'A' } as never);
    grid.api.onFilterChanged();
    expect(grid.api.isColumnFilterActive('name')).toBe(true);
    const clear = host.querySelector('[data-au-panel-filter-clear="name"]') as HTMLElement;
    clear.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(grid.api.isColumnFilterActive('name')).toBe(false);
    grid.destroy();
  });

  it('no sideBar option: host stays hidden and api reports invisible', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new Grid<Row>(host, { columnDefs: COLS, rowData: ROWS });
    grid.getContext().renderer.renderNow();
    expect(grid.api.isSideBarVisible()).toBe(false);
    expect(host.querySelectorAll('.au-sidebar-btn').length).toBe(0);
    grid.destroy();
  });
});
