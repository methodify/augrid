import { describe, expect, it, vi } from 'vitest';
import { Grid } from '../grid.js';
import { createMockContext } from '../test/mockContext.js';
import { buildDefaultItems, resolveMenuItems } from './contextMenuService.js';
import type { Column } from '../columns/column.js';
import type { ColDef } from '../types/colDef.js';
import type { GetContextMenuItemsParams, MenuItemDef } from '../types/menu.js';

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
    country: countries[i % countries.length]!,
    gold: i % 5,
  }));
}

const columnDefs: ColDef<Row>[] = [
  { field: 'name', editable: true },
  { field: 'country' },
  { field: 'gold' },
];

function mount(extra: object = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const grid = new Grid<Row>(host, {
    columnDefs,
    rowData: makeRows(20),
    getRowId: (p) => String(p.data.id),
    ...extra,
  });
  grid.getContext().renderer.setViewportSizeForTesting(800, 300);
  grid.getContext().renderer.renderNow();
  return { grid, host, ctx: grid.getContext() };
}

function rightClick(el: Element, init: MouseEventInit = {}): MouseEvent {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
}

function cellEl(host: HTMLElement, colId: string): Element {
  return host.querySelector(`[data-au-col="${colId}"]`)!;
}

function menuItems(host: HTMLElement): string[] {
  return [...host.querySelectorAll('.au-menu-name')].map((e) => e.textContent!);
}

/* ------------------------------------------------------- pure item builders */

describe('buildDefaultItems', () => {
  it('flat grid: clipboard, pin, export — no expand/collapse', () => {
    const { ctx, start } = createMockContext<Row>({ columnDefs, rowData: makeRows(4) });
    start();
    const col = ctx.columnModel.getColumn('country') as Column<Row>;
    const items = buildDefaultItems(ctx, col);
    expect(items).toContain('copy');
    expect(items).toContain('paste');
    expect(items).toContain('pinSubMenu');
    expect(items).toContain('csvExport');
    expect(items).not.toContain('expandAll');
  });

  it('grouped grid adds expandAll/contractAll; lockPinned drops pinSubMenu', () => {
    const { ctx, start } = createMockContext<Row>({
      columnDefs: [
        { field: 'country', rowGroup: true },
        { field: 'name', lockPinned: true },
      ],
      rowData: makeRows(4),
    });
    start();
    const locked = ctx.columnModel.getColumn('name') as Column<Row>;
    const items = buildDefaultItems(ctx, locked);
    expect(items).toContain('expandAll');
    expect(items).toContain('contractAll');
    expect(items).not.toContain('pinSubMenu');
  });
});

describe('resolveMenuItems', () => {
  it('resolves names to defs, passes custom defs through, collapses separators', () => {
    const { ctx, start } = createMockContext<Row>({ columnDefs, rowData: makeRows(4) });
    start();
    const custom: MenuItemDef<Row> = { name: 'Drill through', action: () => {} };
    const items = resolveMenuItems(
      ctx,
      ['separator', 'copy', 'separator', 'separator', custom, 'separator'],
      null,
    );
    // leading/duplicate/trailing separators removed
    expect(items.length).toBe(3);
    expect((items[0] as MenuItemDef<Row>).name).toBe('Copy');
    expect(items[1]).toBe('separator');
    expect((items[2] as MenuItemDef<Row>).name).toBe('Drill through');
  });

  it('paste is disabled under suppressClipboardPaste; pinSubMenu reflects pin state', () => {
    const { ctx, start } = createMockContext<Row>({
      columnDefs,
      rowData: makeRows(4),
      suppressClipboardPaste: true,
    });
    start();
    const col = ctx.columnModel.getColumn('country') as Column<Row>;
    col.pinned = 'right';
    const items = resolveMenuItems(ctx, ['paste', 'pinSubMenu'], col) as MenuItemDef<Row>[];
    expect(items[0]!.disabled).toBe(true);
    const pin = items[1]!;
    expect(pin.subMenu!.map((s) => (s as MenuItemDef<Row>).checked)).toEqual([false, true, false]);
    // activating "Pin left" pins the column
    ((pin.subMenu![0] as MenuItemDef<Row>).action as () => void)();
    expect(col.pinned).toBe('left');
  });

  it('pinSubMenu drops out with no column', () => {
    const { ctx, start } = createMockContext<Row>({ columnDefs, rowData: makeRows(4) });
    start();
    expect(resolveMenuItems(ctx, ['pinSubMenu'], null)).toEqual([]);
  });
});

/* -------------------------------------------------------------- DOM behavior */

describe('ContextMenuService (DOM)', () => {
  it('right-click opens the menu, fires events, and prevents the browser menu', () => {
    const { grid, host } = mount();
    const visible: boolean[] = [];
    grid.api.addEventListener('contextMenuVisibleChanged', (e) => visible.push(e.visible));
    const cellCtx = vi.fn();
    grid.api.addEventListener('cellContextMenu', cellCtx);

    const e = rightClick(cellEl(host, 'country'));
    expect(e.defaultPrevented).toBe(true);
    expect(cellCtx).toHaveBeenCalledTimes(1);
    expect(visible).toEqual([true]);
    const menu = host.querySelector('.au-menu')!;
    expect(menu.getAttribute('role')).toBe('menu');
    const names = menuItems(host);
    expect(names).toContain('Copy');
    expect(names).toContain('Pin column');
    expect(names).toContain('Export to CSV');
    // first item focused for keyboard users
    expect(document.activeElement?.classList.contains('au-menu-item')).toBe(true);
    grid.destroy();
  });

  it('Ctrl+right-click falls through to the browser menu unless allowed', () => {
    const { grid, host } = mount();
    const e = rightClick(cellEl(host, 'country'), { ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(host.querySelector('.au-menu')).toBeNull();
    grid.destroy();

    const { grid: g2, host: h2 } = mount({ allowContextMenuWithControlKey: true });
    rightClick(cellEl(h2, 'country'), { ctrlKey: true });
    expect(h2.querySelector('.au-menu')).toBeTruthy();
    g2.destroy();
  });

  it('suppressContextMenu blocks the menu entirely', () => {
    const { grid, host } = mount({ suppressContextMenu: true });
    const e = rightClick(cellEl(host, 'country'));
    expect(e.defaultPrevented).toBe(false);
    expect(host.querySelector('.au-menu')).toBeNull();
    grid.destroy();
  });

  it('getContextMenuItems customizes items and receives cell params', () => {
    let seen: GetContextMenuItemsParams<Row> | null = null;
    const action = vi.fn();
    const { grid, host } = mount({
      getContextMenuItems: (p: GetContextMenuItemsParams<Row>) => {
        seen = p;
        return ['copy', 'separator', { name: 'Drill through', action }];
      },
    });
    rightClick(cellEl(host, 'country'));
    const p = seen! as GetContextMenuItemsParams<Row>;
    expect(p.colId).toBe('country');
    expect(p.node?.data?.id).toBe(0);
    expect(p.value).toBe('USA');
    expect(p.defaultItems).toContain('copy');
    expect(menuItems(host)).toEqual(['Copy', 'Drill through']);

    // clicking the custom item runs its action and closes the menu
    const items = host.querySelectorAll('.au-menu-item');
    (items[1] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.au-menu')).toBeNull();
    grid.destroy();
  });

  it('an empty item list opens nothing and lets the browser menu through', () => {
    const { grid, host } = mount({ getContextMenuItems: () => [] });
    const e = rightClick(cellEl(host, 'country'));
    expect(e.defaultPrevented).toBe(false);
    expect(host.querySelector('.au-menu')).toBeNull();
    grid.destroy();
  });

  it('Escape closes the menu and returns focus to the grid', () => {
    const { grid, host } = mount();
    grid.api.setFocusedCell(0, 'country');
    rightClick(cellEl(host, 'country'));
    const item = document.activeElement as HTMLElement;
    expect(item.classList.contains('au-menu-item')).toBe(true);
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.querySelector('.au-menu')).toBeNull();
    grid.destroy();
  });

  it('arrow keys rove focus through items; Enter activates', () => {
    const action = vi.fn();
    const { grid, host } = mount({
      getContextMenuItems: () => [
        { name: 'First', action: () => {} },
        { name: 'Second', action },
      ],
    });
    rightClick(cellEl(host, 'country'));
    let active = document.activeElement as HTMLElement;
    expect(active.textContent).toContain('First');
    active.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    active = document.activeElement as HTMLElement;
    expect(active.textContent).toContain('Second');
    active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.au-menu')).toBeNull();
    grid.destroy();
  });

  it('pin submenu opens and pins the clicked column', () => {
    const { grid, host, ctx } = mount();
    rightClick(cellEl(host, 'country'));
    const pinItem = [...host.querySelectorAll('.au-menu-item')].find((el) =>
      el.textContent!.includes('Pin column'),
    )! as HTMLElement;
    pinItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const menus = host.querySelectorAll('.au-menu');
    expect(menus.length).toBe(2);
    const pinLeft = [...menus[1]!.querySelectorAll('.au-menu-item')].find((el) =>
      el.textContent!.includes('Pin left'),
    )! as HTMLElement;
    pinLeft.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ctx.columnModel.getColumn('country')!.pinned).toBe('left');
    expect(host.querySelector('.au-menu')).toBeNull();
    grid.destroy();
  });

  it('Shift+F10 and the ContextMenu key open the menu at the focused cell', () => {
    const { grid, host } = mount();
    grid.api.setFocusedCell(1, 'name');
    const root = host.querySelector('.au-root')!;
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
    expect(host.querySelector('.au-menu')).toBeTruthy();
    // Escape via the focused item, then reopen with the ContextMenu key
    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(host.querySelector('.au-menu')).toBeNull();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true }));
    expect(host.querySelector('.au-menu')).toBeTruthy();
    grid.destroy();
  });

  it('outside mousedown and grid scroll close the menu', () => {
    const { grid, host, ctx } = mount();
    rightClick(cellEl(host, 'country'));
    expect(host.querySelector('.au-menu')).toBeTruthy();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(host.querySelector('.au-menu')).toBeNull();

    rightClick(cellEl(host, 'country'));
    expect(host.querySelector('.au-menu')).toBeTruthy();
    ctx.events.dispatch({
      type: 'bodyScroll',
      api: grid.api,
      context: undefined,
      left: 0,
      top: 10,
      direction: 'vertical',
    });
    expect(host.querySelector('.au-menu')).toBeNull();
    grid.destroy();
  });

  it('api.showContextMenu / hideContextMenu drive the menu programmatically', () => {
    const { grid, host } = mount();
    grid.api.setFocusedCell(0, 'gold');
    expect(grid.api.showContextMenu()).toBe(true);
    expect(host.querySelector('.au-menu')).toBeTruthy();
    grid.api.hideContextMenu();
    expect(host.querySelector('.au-menu')).toBeNull();
    // explicit position without focus
    grid.api.clearFocusedCell();
    expect(grid.api.showContextMenu({ rowIndex: 2, colId: 'name' })).toBe(true);
    expect(host.querySelector('.au-menu')).toBeTruthy();
    grid.destroy();
    expect(host.querySelector('.au-menu')).toBeNull();
  });

  it('pivot cells: getContextMenuItems receives the intersection context', () => {
    let pivotSeen: unknown = null;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new Grid(host, {
      columnDefs: [
        { field: 'country', rowGroup: true },
        { field: 'name', pivot: true },
        { field: 'gold', aggFunc: 'sum' },
      ] as ColDef<Row>[],
      rowData: makeRows(8),
      pivotMode: true,
      groupDefaultExpanded: -1,
      getContextMenuItems: (p: GetContextMenuItemsParams<Row>) => {
        pivotSeen = p.pivot ?? null;
        return ['copy'];
      },
    });
    grid.getContext().renderer.setViewportSizeForTesting(1200, 300);
    grid.getContext().renderer.renderNow();
    const secondary = grid.getContext().columnModel.getSecondaryColumns()!;
    // pivot colIds contain  — locate by attribute scan, not a CSS selector
    const cell = [...host.querySelectorAll('[data-au-col]')].find(
      (el) => el.getAttribute('data-au-col') === secondary[0]!.colId,
    );
    expect(cell).toBeTruthy();
    rightClick(cell!);
    expect(pivotSeen).toBeTruthy();
    expect((pivotSeen as { rowKeys: unknown[] }).rowKeys.length).toBe(1);
    grid.destroy();
  });
});
