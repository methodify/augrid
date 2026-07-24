import type { GridContext } from '../context.js';
import type { Column } from '../columns/column.js';
import type { RowNode } from '../rows/rowNode.js';
import type { PivotCellContext, PivotKeyPart } from '../types/pivot.js';
import { toDisplayString } from '../utils/general.js';

/**
 * True when a commit to (node, column) targets an AGGREGATE value — a cell
 * with no single backing field. Such commits are always event-routed
 * (cellEditRequest) and never mutate data locally:
 *  - pivot result (secondary) columns on group rows,
 *  - value columns (aggFunc set) read from aggData on group rows,
 *  - group-header cells (auto group columns) on group rows,
 *  - EVERY group-row cell in the server-side model (values are
 *    server-computed at the parent's grain; the app owns decomposition).
 * Footers are excluded — total rows are never editable.
 */
export function isAggregateTarget<TData>(
  node: RowNode<TData>,
  column: Column<TData>,
  serverSide = false,
): boolean {
  if (!node.group || node.footer) return false;
  if (serverSide) return true;
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
  const serverSide = ctx.rowModel.type === 'serverSide';
  return {
    rowKeys,
    pivotKeys,
    valueColId,
    level: Math.max(0, node.level),
    // Server-side model: leaves may never have been fetched — enumeration is
    // CACHED-ONLY (documented as partial) and never triggers loads. The edit
    // event itself needs no leaf materialization: rowKeys carries the path.
    getLeafRows: () =>
      serverSide
        ? collectCachedServerLeaves(ctx, node)
        : collectLeafRows(ctx, node, pivotKeyTuple, pivotCols),
  };
}

function buildRowKeys<TData>(node: RowNode<TData>): PivotKeyPart[] {
  const parts: PivotKeyPart[] = [];
  // For a group row, its own key is part of the path; for a leaf, start at
  // the parent group.
  let cur: RowNode<TData> | null = node.group ? node : (node.parent as RowNode<TData> | null);
  while (cur && cur.group && cur.level >= 0) {
    // Server-side nodes carry the raw member key (number/null preserved);
    // client-side group keys are display strings.
    const key = cur.__serverKey !== undefined ? cur.__serverKey : (cur.key ?? '');
    parts.push({ colId: cur.field ?? 'au-group-col', key });
    cur = cur.parent as RowNode<TData> | null;
  }
  return parts.reverse();
}

/** Loaded leaf descendants of a server-side group node (partial by design). */
function collectCachedServerLeaves<TData>(ctx: GridContext<TData>, node: RowNode<TData>): TData[] {
  const out: TData[] = [];
  const prefix = node.__ssPath;
  if (!prefix) return node.data !== undefined && !node.group ? [node.data] : out;
  ctx.rowModel.forEachNode((n) => {
    if (n.group || n.data === undefined) return;
    // A leaf belongs to this subtree when its parent chain passes through the node.
    let cur: RowNode<TData> | null = n.parent as RowNode<TData> | null;
    while (cur) {
      if (cur === node) {
        out.push(n.data as TData);
        return;
      }
      cur = cur.parent as RowNode<TData> | null;
    }
  });
  return out;
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
