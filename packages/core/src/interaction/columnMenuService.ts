import type { GridContext, IColumnMenuService } from '../context.js';
import type { Column } from '../columns/column.js';
import { MenuPopup, type ResolvedMenuItem } from './menuPopup.js';
import { resolveMenuItems } from './contextMenuService.js';

/**
 * Item list for a column's header menu, driven by column capabilities
 * (exported for tests). Sorting applies a single-column sort model (matching
 * header-click semantics without modifiers); grouping toggles membership in
 * the row-group list.
 */
export function buildColumnMenuItems<TData>(
  ctx: GridContext<TData>,
  column: Column<TData>,
): ResolvedMenuItem<TData>[] {
  const api = ctx.api;
  const colId = column.colId;
  const items: ResolvedMenuItem<TData>[] = [];
  const special = column.isAutoGroupCol || colId === 'au-selection-col';

  if (column.isSortable()) {
    const sort = column.sort;
    const setSort = (dir: 'asc' | 'desc' | null) => () => {
      ctx.sort.setSortModel(
        dir ? [{ colId, sort: dir }] : ctx.sort.getSortModel().filter((m) => m.colId !== colId),
        'columnMenu',
      );
    };
    items.push(
      { name: 'Sort ascending', checked: sort === 'asc', action: setSort('asc') },
      { name: 'Sort descending', checked: sort === 'desc', action: setSort('desc') },
    );
    if (sort != null) items.push({ name: 'Clear sort', action: setSort(null) });
    items.push('separator');
  }

  if (column.getColDef().lockPinned !== true) {
    items.push(...resolveMenuItems(ctx, ['pinSubMenu'], column));
  }
  items.push(
    { name: 'Autosize this column', action: () => api.autoSizeColumns([colId]) },
    { name: 'Autosize all columns', action: () => api.autoSizeAllColumns() },
    'separator',
  );

  if (!special && !column.secondary) {
    const grouped = column.rowGroupActive;
    const current = () => ctx.columnModel.getRowGroupColumns().map((c) => c.colId);
    items.push({
      name: grouped ? `Un-group by ${column.getHeaderName()}` : `Group by ${column.getHeaderName()}`,
      action: () =>
        ctx.columnModel.setRowGroupColumns(
          grouped ? current().filter((id) => id !== colId) : [...current(), colId],
          'columnMenu',
        ),
    });
    items.push({ name: 'Hide column', action: () => api.setColumnsVisible([colId], false) });
  }
  if (ctx.sideBar) {
    items.push('separator', {
      name: 'Choose columns…',
      action: () => ctx.sideBar?.openPanel('columns'),
    });
  }

  // Trim boundary separators (capability gating can leave them dangling).
  while (items[0] === 'separator') items.shift();
  while (items[items.length - 1] === 'separator') items.pop();
  return items;
}

/** Header ⋮ button menu. Shares the MenuPopup surface with the context menu. */
export class ColumnMenuService<TData = unknown> implements IColumnMenuService<TData> {
  private popup: MenuPopup<TData>;
  /** Header element to return focus to when the menu closes via keyboard. */
  private anchorEl: HTMLElement | null = null;

  constructor(private ctx: GridContext<TData>) {
    this.popup = new MenuPopup(
      ctx,
      (items) => resolveMenuItems(ctx, items, null),
      (restoreFocus) => {
        if (restoreFocus && !this.ctx.destroyed) this.anchorEl?.focus({ preventScroll: true });
        this.anchorEl = null;
      },
    );
  }

  isOpen(): boolean {
    return this.popup.isOpen();
  }

  showForColumn(colId: string, anchorEl: HTMLElement): boolean {
    const ctx = this.ctx;
    const column = ctx.columnModel.getColumn(colId);
    if (!column) return false;
    const items = buildColumnMenuItems(ctx, column);
    const rootRect = ctx.rootEl.getBoundingClientRect();
    const rect = anchorEl.getBoundingClientRect();
    this.anchorEl = (anchorEl.closest('.au-header-cell') as HTMLElement | null) ?? anchorEl;
    return this.popup.open(items, rect.left - rootRect.left, rect.bottom - rootRect.top + 2);
  }

  hideMenu(): void {
    this.popup.close(false);
  }

  destroy(): void {
    this.popup.destroy();
  }
}
