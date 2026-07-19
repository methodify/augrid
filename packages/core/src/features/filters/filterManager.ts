/**
 * FilterManager: owns the filter model map (colId → serializable model),
 * lazily-created custom filter component instances, and compiles the combined
 * row predicate (column filters + quick filter + external filter) consumed by
 * the client-side row model's filter stage.
 */
import type { GridContext, IFilterManager } from '../../context';
import type { Column } from '../../columns/column';
import type { RowNode } from '../../rows/rowNode';
import type {
  FilterComp,
  FilterModel,
  FilterModelMap,
} from '../../types/filter';
import type { IRowNode } from '../../types/rowNode';
import { buildDatePredicate, buildNumberPredicate, buildTextPredicate } from './simpleFilters';
import { buildSetPredicate, collectSetValues } from './setFilter';
import { mountFloatingFilter } from './floatingFilters';

export type ProvidedFilterKind = 'text' | 'number' | 'date' | 'set';
export type FilterKind = ProvidedFilterKind | 'custom' | null;

export class FilterManager<TData = unknown> implements IFilterManager<TData> {
  private ctx: GridContext<TData>;
  private model: FilterModelMap = {};
  private customInstances = new Map<string, FilterComp<TData>>();
  /** Guard against onModelChange re-entry while pushing models into comps. */
  private syncingCustom = false;

  constructor(ctx: GridContext<TData>) {
    this.ctx = ctx;
  }

  /* ------------------------------------------------------------------ model */

  getModel(): FilterModelMap {
    return { ...this.model };
  }

  setModel(model: FilterModelMap | null, source = 'api'): void {
    this.model = {};
    if (model) {
      for (const colId of Object.keys(model)) {
        const m = model[colId];
        if (m != null) this.model[colId] = m;
      }
    }
    for (const colId of this.customInstances.keys()) this.syncCustomInstance(colId);
    for (const colId of Object.keys(this.model)) {
      if (this.model[colId].filterType === 'custom') this.syncCustomInstance(colId);
    }
    this.onModelChanged(source);
  }

  getColumnModel_(colId: string): FilterModel | null {
    return this.model[colId] ?? null;
  }

  setColumnModel_(colId: string, model: FilterModel | null, source = 'api'): void {
    if (model == null) delete this.model[colId];
    else this.model[colId] = model;
    this.syncCustomInstance(colId);
    this.onModelChanged(source);
  }

  isColumnActive(colId: string): boolean {
    return this.model[colId] != null;
  }

  isAnyFilterActive(): boolean {
    if (Object.keys(this.model).length > 0) return true;
    const quick = this.ctx.options.get('quickFilterText');
    if (quick != null && String(quick).trim() !== '') return true;
    return this.ctx.options.get('isExternalFilterPresent')?.() === true;
  }

  private onModelChanged(source: string): void {
    this.ctx.events.dispatch({
      type: 'filterChanged',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      filterModel: this.getModel(),
      source,
    });
    this.ctx.rowModel.onFilterChanged();
    this.ctx.scheduleRender();
  }

  /* ------------------------------------------------------------- predicate */

  createPredicate(): ((node: RowNode<TData>) => boolean) | null {
    const colIds = Object.keys(this.model);
    const quickRaw = this.ctx.options.get('quickFilterText');
    const quick = quickRaw != null ? String(quickRaw).trim() : '';
    const externalPresent = this.ctx.options.get('isExternalFilterPresent')?.() === true;
    if (colIds.length === 0 && quick === '' && !externalPresent) return null;

    const values = this.ctx.values;
    const columnPreds: ((node: RowNode<TData>) => boolean)[] = [];

    for (const colId of colIds) {
      const column = this.ctx.columnModel.getColumn(colId);
      if (!column) continue;
      const model = this.model[colId];
      if (model.filterType === 'custom') {
        const inst = this.getOrCreateCustomInstance(column);
        if (inst) {
          columnPreds.push((node) => inst.doesFilterPass(node, values.getValue(node, column)));
        }
        continue;
      }
      let valuePred: ((value: unknown) => boolean) | null = null;
      switch (model.filterType) {
        case 'text':
          valuePred = buildTextPredicate(model);
          break;
        case 'number':
          valuePred = buildNumberPredicate(model);
          break;
        case 'date':
          valuePred = buildDatePredicate(model);
          break;
        case 'set':
          valuePred = buildSetPredicate(model);
          break;
      }
      if (valuePred) {
        const p = valuePred;
        columnPreds.push((node) => p(values.getValue(node, column)));
      }
    }

    let quickPred: ((node: RowNode<TData>) => boolean) | null = null;
    if (quick !== '') {
      const tokens = quick.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
      const useFormatted = this.ctx.options.get('quickFilterMatchesFormatted') !== false;
      const cols = this.ctx.columnModel
        .getDisplayedColumns()
        .filter((c) => c.colId !== 'au-selection-col' && c.getColDef().suppressQuickFilter !== true);
      quickPred = (node) => {
        for (const token of tokens) {
          let matched = false;
          for (const col of cols) {
            const text = useFormatted
              ? values.getFormattedValue(node, col)
              : String(values.getValue(node, col) ?? '');
            if (text.toLowerCase().includes(token)) {
              matched = true;
              break;
            }
          }
          if (!matched) return false;
        }
        return true;
      };
    }

    const externalPass = externalPresent
      ? this.ctx.options.get('doesExternalFilterPass')
      : undefined;

    return (node) => {
      for (const p of columnPreds) if (!p(node)) return false;
      if (quickPred && !quickPred(node)) return false;
      if (externalPass && !externalPass(node as IRowNode<TData>)) return false;
      return true;
    };
  }

  /* ------------------------------------------------------------ set filter */

  getSetValues(colId: string): (string | null)[] {
    return collectSetValues(this.ctx, colId);
  }

  /* -------------------------------------------------------------- floating */

  mountFloatingFilter(container: HTMLElement, column: Column<TData>): void {
    mountFloatingFilter(this.ctx, container, column);
  }

  /* ---------------------------------------------------------- filter kinds */

  /** Resolve a column's filter kind from colDef.filter (+ cellDataType). */
  resolveFilterKind(column: Column<TData>): FilterKind {
    const f = column.getColDef().filter;
    if (f == null || f === false) return null;
    if (f === true) {
      if (column.cellDataType === 'number') return 'number';
      if (column.cellDataType === 'date') return 'date';
      return 'text';
    }
    if (typeof f === 'string') return f;
    return 'custom';
  }

  /* --------------------------------------------------------- custom comps */

  /** Lazily create (and init) the custom filter component for a column. */
  getOrCreateCustomInstance(column: Column<TData>): FilterComp<TData> | null {
    const colId = column.colId;
    const existing = this.customInstances.get(colId);
    if (existing) return existing;
    const f = column.getColDef().filter;
    if (typeof f !== 'function') return null;
    const Ctor = f as new () => FilterComp<TData>;
    const inst = new Ctor();
    inst.init({
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      // Column implements IColumn; cast bridges the kernel's known
      // getAggFunc signature variance between the two.
      column: column as unknown as import('../../types/column').IColumn<TData>,
      colId,
      getValue: (node: IRowNode<TData>) => this.ctx.values.getValue(node as RowNode<TData>, column),
      onModelChange: (model: unknown | null) => {
        if (this.syncingCustom) return;
        this.setColumnModel_(
          colId,
          model == null ? null : { filterType: 'custom', model },
          'columnFilter',
        );
      },
      colParams: column.getColDef().filterParams,
    });
    this.customInstances.set(colId, inst);
    this.syncCustomInstance(colId);
    return inst;
  }

  /** Push the stored model (or null) into an existing custom instance. */
  private syncCustomInstance(colId: string): void {
    const inst = this.customInstances.get(colId);
    if (!inst) return;
    const m = this.model[colId];
    this.syncingCustom = true;
    try {
      inst.setModel(m && m.filterType === 'custom' ? m.model : null);
    } finally {
      this.syncingCustom = false;
    }
  }

  destroy(): void {
    for (const inst of this.customInstances.values()) inst.destroy?.();
    this.customInstances.clear();
    this.model = {};
  }
}
