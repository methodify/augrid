import { describe, expect, it } from 'vitest';
import { createMockContext } from '../test/mockContext';
import { buildColumnMenuItems } from './columnMenuService';
import { Grid } from '../grid';
import type { Column } from '../columns/column';
import type { ColDef } from '../types/colDef';
import type { MenuItemDef } from '../types/menu';

interface Row {
  id: number;
  name: string;
  country: string;
  gold: number;
}

const ROWS: Row[] = [
  { id: 0, name: 'A', country: 'USA', gold: 1 },
  { id: 1, name: 'B', country: 'France', gold: 2 },
];

const COLS: ColDef<Row>[] = [
  { field: 'name', sortable: true },
  { field: 'country' },
  { field: 'gold' },
];

function names(items: (MenuItemDef<Row> | 'separator')[]): string[] {
  return items.filter((i): i is MenuItemDef<Row> => i !== 'separator').map((i) => i.name);
}

describe('buildColumnMenuItems', () => {
  it('offers sort, pin, autosize, group, hide for a plain column', () => {
    const { ctx, start } = createMockContext<Row>({ columnDefs: COLS, rowData: ROWS });
    start();
    const col = ctx.columnModel.getColumn('country') as Column<Row>;
    const items = buildColumnMenuItems(ctx, col);
    const n = names(items);
    expect(n).toContain('Sort ascending');
    expect(n).toContain('Pin column');
    expect(n).toContain('Autosize this column');
    expect(n).toContain('Group by Country');
    expect(n).toContain('Hide column');
    expect(n).not.toContain('Clear sort'); // nothing sorted yet
  });

  it('sort actions apply a single-column model; clear appears when sorted', () => {
    const { ctx, start } = createMockContext<Row>({ columnDefs: COLS, rowData: ROWS });
    start();
    const col = ctx.columnModel.getColumn('name') as Column<Row>;
    const asc = names(buildColumnMenuItems(ctx, col)).indexOf('Sort ascending');
    const items = buildColumnMenuItems(ctx, col).filter((i) => i !== 'separator') as MenuItemDef<Row>[];
    items[asc]!.action!();
    expect(ctx.sort.getSortModel()).toEqual([{ colId: 'name', sort: 'asc' }]);

    const after = buildColumnMenuItems(ctx, col).filter((i) => i !== 'separator') as MenuItemDef<Row>[];
    expect(after.find((i) => i.name === 'Sort ascending')!.checked).toBe(true);
    const clear = after.find((i) => i.name === 'Clear sort')!;
    clear.action!();
    expect(ctx.sort.getSortModel()).toEqual([]);
  });

  it('group toggle mutates the row-group list both ways', () => {
    const { ctx, start } = createMockContext<Row>({ columnDefs: COLS, rowData: ROWS });
    start();
    const col = ctx.columnModel.getColumn('country') as Column<Row>;
    const group = (buildColumnMenuItems(ctx, col).filter((i) => i !== 'separator') as MenuItemDef<Row>[]).find(
      (i) => i.name === 'Group by Country',
    )!;
    group.action!();
    expect(ctx.columnModel.getRowGroupColumns().map((c) => c.colId)).toEqual(['country']);
    const ungroup = (buildColumnMenuItems(ctx, col).filter((i) => i !== 'separator') as MenuItemDef<Row>[]).find(
      (i) => i.name === 'Un-group by Country',
    )!;
    ungroup.action!();
    expect(ctx.columnModel.getRowGroupColumns()).toEqual([]);
  });
});

describe('ColumnMenuService (DOM)', () => {
  function mount(extra: object = {}) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new Grid<Row>(host, {
      columnDefs: COLS,
      rowData: ROWS,
      getRowId: (p) => String(p.data.id),
      ...extra,
    });
    grid.getContext().renderer.setViewportSizeForTesting(800, 300);
    grid.getContext().renderer.renderNow();
    return { grid, host };
  }

  it('header ⋮ button opens the menu; an action applies and closes it', () => {
    const { grid, host } = mount();
    const btn = host.querySelector('[data-au-col-menu="name"]') as HTMLElement;
    expect(btn).toBeTruthy();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const menu = host.querySelector('.au-menu');
    expect(menu).toBeTruthy();
    const sortAsc = [...menu!.querySelectorAll('.au-menu-item')].find((i) =>
      i.textContent!.includes('Sort ascending'),
    ) as HTMLElement;
    sortAsc.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.querySelector('.au-menu')).toBeNull();
    expect(grid.api.getSortModel()).toEqual([{ colId: 'name', sort: 'asc' }]);
    grid.destroy();
  });

  it('menu button click does not trigger header sort', () => {
    const { grid, host } = mount();
    const btn = host.querySelector('[data-au-col-menu="name"]') as HTMLElement;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(grid.api.getSortModel()).toEqual([]); // menu open, no sort applied
    grid.destroy();
  });

  it('Hide column hides; suppressHeaderMenuButton removes buttons', () => {
    const { grid, host } = mount();
    const btn = host.querySelector('[data-au-col-menu="gold"]') as HTMLElement;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const hide = [...host.querySelectorAll('.au-menu-item')].find((i) =>
      i.textContent!.includes('Hide column'),
    ) as HTMLElement;
    hide.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(grid.api.getColumn('gold')!.isVisible()).toBe(false);
    grid.destroy();

    const { grid: g2, host: h2 } = mount({ suppressHeaderMenuButton: true });
    expect(h2.querySelector('[data-au-col-menu]')).toBeNull();
    g2.destroy();

    const { grid: g3, host: h3 } = mount({
      columnDefs: [{ field: 'name', suppressHeaderMenuButton: true }, { field: 'country' }] as ColDef<Row>[],
    });
    expect(h3.querySelector('[data-au-col-menu="name"]')).toBeNull();
    expect(h3.querySelector('[data-au-col-menu="country"]')).toBeTruthy();
    g3.destroy();
  });

  it('"Choose columns…" opens the columns tool panel when a side bar exists', () => {
    const { grid, host } = mount({ sideBar: true });
    const btn = host.querySelector('[data-au-col-menu="name"]') as HTMLElement;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const choose = [...host.querySelectorAll('.au-menu-item')].find((i) =>
      i.textContent!.includes('Choose columns'),
    ) as HTMLElement;
    expect(choose).toBeTruthy();
    choose.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(grid.api.getOpenedToolPanel()).toBe('columns');
    grid.destroy();
  });
});
