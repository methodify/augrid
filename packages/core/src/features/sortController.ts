import type { GridContext, ISortController } from '../context';
import type { Column } from '../columns/column';
import type { SortDirection, SortModelItem } from '../types/base';

const DEFAULT_SORTING_ORDER: SortDirection[] = ['asc', 'desc', null];

/**
 * Owns the active sort model: reads/writes Column.sort/sortIndex over the
 * auto-group + primary + secondary column set, and drives the sort stage.
 */
export class SortController<TData = unknown> implements ISortController<TData> {
  private ctx: GridContext<TData>;

  constructor(ctx: GridContext<TData>) {
    this.ctx = ctx;
  }

  /** All columns that can carry sort state, in canonical order. */
  private sortableColumns(): Column<TData>[] {
    const auto = this.ctx.columnModel.getAutoGroupColumn();
    return [
      ...(auto ? [auto] : []),
      ...this.ctx.columnModel.getPrimaryColumns(),
      ...(this.ctx.columnModel.getSecondaryColumns() ?? []),
    ];
  }

  getSortModel(): SortModelItem[] {
    return this.sortableColumns()
      .filter((c) => c.sort != null)
      .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
      .map((c) => ({ colId: c.colId, sort: c.sort as 'asc' | 'desc' }));
  }

  setSortModel(model: SortModelItem[], source = 'api'): void {
    const cols = this.sortableColumns();
    for (const c of cols) {
      c.sort = null;
      c.sortIndex = null;
    }
    for (let i = 0; i < model.length; i++) {
      const item = model[i];
      const col = cols.find((c) => c.colId === item.colId);
      if (col) {
        col.sort = item.sort;
        col.sortIndex = i;
      }
    }
    this.ctx.events.dispatch({
      type: 'sortChanged',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      sortModel: model,
      source,
    });
    this.ctx.rowModel.onSortChanged();
    this.ctx.scheduleRender();
  }

  progressSort(column: Column<TData>, multi: boolean, source = 'header'): void {
    if (!column.isSortable()) return;
    const order = column.colDef.sortingOrder ?? DEFAULT_SORTING_ORDER;
    if (order.length === 0) return;
    const next = order[(order.indexOf(column.sort) + 1) % order.length] ?? null;

    let model: SortModelItem[];
    if (!multi) {
      model = next == null ? [] : [{ colId: column.colId, sort: next }];
    } else {
      model = this.getSortModel();
      const idx = model.findIndex((m) => m.colId === column.colId);
      if (next == null) {
        if (idx >= 0) model.splice(idx, 1);
      } else if (idx >= 0) {
        model[idx] = { colId: column.colId, sort: next };
      } else {
        model.push({ colId: column.colId, sort: next });
      }
    }
    this.setSortModel(model, source);
  }

  destroy(): void {
    // no listeners / DOM to clean up
  }
}
