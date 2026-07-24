import type { GridContext } from '../context.js';
import type { Column } from '../columns/column.js';
import type { RowNode } from '../rows/rowNode.js';
import { getPath, setPath, toDisplayString } from '../utils/general.js';
import { buildPivotCellContext, isAggregateTarget } from './pivotContext.js';

/**
 * The single read/write funnel for cell values:
 * read: aggData (groups) → valueGetter → field path
 * write: readOnlyEdit? event-only : valueSetter → field path, then version bump,
 * cellValueChanged, and incremental model refresh.
 */
export class ValueService<TData = unknown> {
  private ctx: GridContext<TData>;

  constructor(ctx: GridContext<TData>) {
    this.ctx = ctx;
  }

  getValue(node: RowNode<TData>, column: Column<TData>): unknown {
    const colDef = column.getColDef();

    // Pivot-generated value column: read from the node's pivot agg bucket.
    if (column.secondary) {
      return node.aggData?.[column.colId];
    }

    // Auto group column: the group key (or blank for leaves).
    if (column.isAutoGroupCol) {
      return node.group ? node.key : null;
    }

    // Group rows read aggregated values when present.
    if (node.group && node.aggData && column.colId in node.aggData) {
      return node.aggData[column.colId];
    }

    const vg = colDef.valueGetter;
    if (typeof vg === 'function') {
      return vg({
        api: this.ctx.api,
        context: this.ctx.options.get('context'),
        data: node.data,
        node,
        column,
        colDef,
        getValue: (colId: string) => {
          const other = this.ctx.columnModel.getColumn(colId);
          return other ? this.getValue(node, other) : undefined;
        },
      });
    }
    if (typeof vg === 'string') {
      return getPath(node.data, vg);
    }
    if (colDef.field) {
      return getPath(node.data, colDef.field);
    }
    return undefined;
  }

  getFormattedValue(node: RowNode<TData>, column: Column<TData>): string {
    const value = this.getValue(node, column);
    return this.formatValue(node, column, value);
  }

  formatValue(node: RowNode<TData>, column: Column<TData>, value: unknown): string {
    const fmt = column.getColDef().valueFormatter;
    if (fmt) {
      return fmt({
        api: this.ctx.api,
        context: this.ctx.options.get('context'),
        data: node.data,
        node,
        column,
        colDef: column.getColDef(),
        value,
      });
    }
    return toDisplayString(value);
  }

  parseValue(node: RowNode<TData>, column: Column<TData>, newValue: unknown): unknown {
    const colDef = column.getColDef();
    const oldValue = this.getValue(node, column);
    if (colDef.valueParser) {
      return colDef.valueParser({
        api: this.ctx.api,
        context: this.ctx.options.get('context'),
        data: node.data,
        node,
        column,
        colDef,
        oldValue,
        newValue,
      });
    }
    // Default parsing by cell data type for string input.
    if (typeof newValue === 'string') {
      if (column.cellDataType === 'number') {
        if (newValue.trim() === '') return null;
        const n = Number(newValue);
        return Number.isNaN(n) ? newValue : n;
      }
      if (column.cellDataType === 'boolean') {
        return newValue === 'true' || newValue === '1';
      }
      if (column.cellDataType === 'date') {
        const d = new Date(newValue);
        return Number.isNaN(d.getTime()) ? newValue : d;
      }
    }
    return newValue;
  }

  /**
   * Write a (parsed) value. Returns true if data changed (or a readOnlyEdit
   * request was dispatched).
   */
  setValue(node: RowNode<TData>, colId: string, newValue: unknown, source = 'edit'): boolean {
    const column = this.ctx.columnModel.getColumn(colId);
    if (!column) return false;
    const colDef = column.getColDef();
    const oldValue = this.getValue(node, column);
    if (Object.is(oldValue, newValue)) return false;

    const base = {
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      node,
      data: node.data,
      column,
      colDef,
      colId: column.colId,
      rowIndex: node.rowIndex,
      oldValue,
      newValue,
      value: newValue,
      source,
      pivot: buildPivotCellContext(this.ctx, node, column) ?? undefined,
    };

    // Aggregate cells (pivot results, group-row value cells, group headers)
    // have no single backing field: commits to them are ALWAYS event-routed —
    // regardless of readOnlyEdit — and never mutate data locally. The app
    // applies the change and feeds truth back via applyTransaction/setRowData.
    if (
      isAggregateTarget(node, column, this.ctx.rowModel.type === 'serverSide') ||
      this.ctx.options.is('readOnlyEdit')
    ) {
      this.ctx.events.dispatch({ ...base, type: 'cellEditRequest' });
      return true;
    }

    let written = false;
    if (colDef.valueSetter) {
      written = colDef.valueSetter({ ...base });
    } else {
      const field = colDef.field;
      if (!field || node.data == null) return false;
      setPath(node.data, field, newValue);
      written = true;
    }
    if (!written) return false;

    node.__version++;
    this.ctx.events.dispatch({ ...base, type: 'cellValueChanged' });
    this.ctx.rowModel.onRowDataPatched([node]);
    return true;
  }
}
