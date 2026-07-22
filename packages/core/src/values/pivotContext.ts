import type { GridContext } from '../context';
import type { Column } from '../columns/column';
import type { RowNode } from '../rows/rowNode';
import type { PivotCellContext, PivotKeyPart } from '../types/pivot';
import { toDisplayString } from '../utils/general';

/**
 * True when a commit to (node, column) targets an AGGREGATE value — a cell
 * with no single backing field. Such commits are always event-routed
 * (cellEditRequest) and never mutate data locally:
 *  - pivot result (secondary) columns on group rows,
 *  - value columns (aggFunc set) read from aggData on group rows,
 *  - group-header cells (auto group columns) on group rows.
 * Footers are excluded — total rows are never editable.
 */
export function isAggregateTarget<TData>(node: RowNode<TData>, column: Column<TData>): boolean {
  if (!node.group || node.footer) return false;
  if (column.secondary) return true;
  if (column.isAutoGroupCol) return true;
  return column.aggFunc != null && node.data === undefined;
}

/**
 * Build the intersection context for a cell. Returns null when the position
 * carries no group/pivot coordinates (a plain leaf cell in a flat grid).
 */
export function buildPivotCellContext<TData>(
  ctx: GridContext<TData>,
  node: RowNode<TData>,
  column: Column<TData>,
): PivotCellContext<TData> | null {
  const rowKeys = buildRowKeys(node);
  const pivotCols = ctx.columnModel.getPivotColumns();

  let pivotKeys: PivotKeyPart[] = [];
  if (column.secondary && column.pivotKeys) {
    const n = Math.min(column.pivotKeys.length, pivotCols.length);
    for (let i = 0; i < n; i++) {
      pivotKeys.push({ colId: pivotCols[i].colId, key: column.pivotKeys[i] });
    }
    // Pivot key path without a matching active pivot column (config drifted
    // mid-flight): keep the keys with a blank colId rather than dropping them.
    for (let i = n; i < column.pivotKeys.length; i++) {
      pivotKeys.push({ colId: '', key: column.pivotKeys[i] });
    }
  }

  const valueColId = column.secondary
    ? (column.pivotValueColId ?? column.colId)
    : column.isAutoGroupCol
      ? (node.field ?? column.colId)
      : column.colId;

  if (rowKeys.length === 0 && pivotKeys.length === 0 && !node.group) return null;

  const pivotKeyTuple = column.secondary ? column.pivotKeys : null;
  return {
    rowKeys,
    pivotKeys,
    valueColId,
    level: Math.max(0, node.level),
    getLeafRows: () => collectLeafRows(ctx, node, pivotKeyTuple, pivotCols),
  };
}

function buildRowKeys<TData>(node: RowNode<TData>): PivotKeyPart[] {
  const parts: PivotKeyPart[] = [];
  // For a group row, its own key is part of the path; for a leaf, start at
  // the parent group.
  let cur: RowNode<TData> | null = node.group ? node : (node.parent as RowNode<TData> | null);
  while (cur && cur.group && cur.level >= 0) {
    parts.push({ colId: cur.field ?? 'au-group-col', key: cur.key ?? '' });
    cur = cur.parent as RowNode<TData> | null;
  }
  return parts.reverse();
}

function collectLeafRows<TData>(
  ctx: GridContext<TData>,
  node: RowNode<TData>,
  pivotKeyTuple: string[] | null,
  pivotCols: Column<TData>[],
): TData[] {
  const out: TData[] = [];
  const matchesPivot = (leaf: RowNode<TData>): boolean => {
    if (!pivotKeyTuple) return true;
    const n = Math.min(pivotKeyTuple.length, pivotCols.length);
    for (let i = 0; i < n; i++) {
      if (toDisplayString(ctx.values.getValue(leaf, pivotCols[i])) !== pivotKeyTuple[i]) {
        return false;
      }
    }
    return true;
  };
  const visit = (n: RowNode<TData>): void => {
    if (n.data !== undefined && matchesPivot(n)) out.push(n.data);
    for (const ch of n.childrenAfterFilter ?? []) visit(ch);
  };
  visit(node);
  return out;
}
