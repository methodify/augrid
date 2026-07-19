import type { GridContext } from '../context';
import type { IRowModel, PipelineStep } from './rowModel';
import { RowNode } from './rowNode';
import type { RowDataTransaction, RowDataTransactionResult } from '../types/api';
import { runAggStage, runFilterStage, runGroupStage, runSortStage, pivotColId, PIVOT_SEP, type SortSpec } from './stages';
import { binarySearchLE, insertArray } from '../utils/general';
import type { Column } from '../columns/column';
import type { ColDef } from '../types/colDef';

const STEP_ORDER: PipelineStep[] = ['group', 'filter', 'pivot', 'aggregate', 'sort', 'flatten'];

export class ClientSideRowModel<TData = unknown> implements IRowModel<TData> {
  readonly type = 'clientSide' as const;

  private ctx: GridContext<TData>;
  private allLeafNodes: RowNode<TData>[] = [];
  private nodesById = new Map<string, RowNode<TData>>();
  private root: RowNode<TData> | null = null;
  private groupsByPath = new Map<string, RowNode<TData>>();
  /** Expansion overrides: 'path' = expanded, '!path' = collapsed. */
  private expandedOverrides = new Set<string>();

  /** All displayed rows after flatten (pre-pagination). */
  private displayedAll: RowNode<TData>[] = [];
  /** Page window over displayedAll (pagination), else null. */
  private pageWindow: { start: number; end: number } | null = null;
  private pageRows: RowNode<TData>[] = [];
  private rowTops: Float64Array = new Float64Array(0);
  private totalHeight = 0;
  private uniformHeight: number | null = null;

  private pinnedTop: RowNode<TData>[] = [];
  private pinnedBottom: RowNode<TData>[] = [];

  private dataLoaded = false;
  private started = false;
  private asyncTxQueue: { tx: RowDataTransaction<TData>; cb?: (r: RowDataTransactionResult<TData>) => void }[] = [];
  private asyncTxTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPivotSignature: string | null = null;

  constructor(ctx: GridContext<TData>) {
    this.ctx = ctx;
  }

  start(): void {
    this.started = true;
    const data = this.ctx.options.get('rowData');
    this.buildPinnedRows();
    if (data) this.setRowData(data);
    else this.refreshModel('group');
  }

  destroy(): void {
    if (this.asyncTxTimer) clearTimeout(this.asyncTxTimer);
    this.allLeafNodes = [];
    this.nodesById.clear();
    this.displayedAll = [];
    this.pageRows = [];
  }

  /* ------------------------------------------------------------------- data */

  setRowData(data: TData[]): void {
    const getRowId = this.ctx.options.get('getRowId');
    if (getRowId && this.allLeafNodes.length > 0) {
      this.setRowDataImmutable(data, getRowId);
      return;
    }
    this.allLeafNodes = [];
    this.nodesById.clear();
    let i = 0;
    for (const item of data) {
      const id = getRowId ? getRowId({ data: item, level: 0 }) : undefined;
      const node = new RowNode<TData>(this.ctx, id);
      node.data = item;
      node.__sourceIndex = i++;
      this.allLeafNodes.push(node);
      this.nodesById.set(node.id, node);
    }
    this.dataLoaded = true;
    this.ctx.columnModel.inferCellDataTypes(data[0]);
    this.refreshModel('group', true);
    this.dispatchRowDataUpdated();
  }

  /** Diff by id: keep node identity (selection, expansion) for surviving rows. */
  private setRowDataImmutable(data: TData[], getRowId: NonNullable<ReturnType<GridContext<TData>['options']['get']>> & ((p: { data: TData; level: number }) => string)): void {
    const next: RowNode<TData>[] = [];
    const nextById = new Map<string, RowNode<TData>>();
    let i = 0;
    for (const item of data) {
      const id = getRowId({ data: item, level: 0 });
      const existing = this.nodesById.get(id);
      if (existing) {
        if (existing.data !== item) {
          existing.data = item;
          existing.__version++;
        }
        existing.__sourceIndex = i++;
        next.push(existing);
        nextById.set(id, existing);
      } else {
        const node = new RowNode<TData>(this.ctx, id);
        node.data = item;
        node.__sourceIndex = i++;
        next.push(node);
        nextById.set(id, node);
      }
    }
    this.allLeafNodes = next;
    this.nodesById = nextById;
    this.dataLoaded = true;
    this.refreshModel('group', true);
    this.dispatchRowDataUpdated();
  }

  applyTransaction(tx: RowDataTransaction<TData>): RowDataTransactionResult<TData> | null {
    const getRowId = this.ctx.options.get('getRowId');
    const result: RowDataTransactionResult<TData> = { add: [], update: [], remove: [] };

    if (tx.remove && tx.remove.length > 0) {
      const removeIds = new Set<string>();
      for (const item of tx.remove) {
        const id = getRowId ? getRowId({ data: item, level: 0 }) : this.findByReference(item)?.id;
        if (id != null) removeIds.add(id);
      }
      if (removeIds.size > 0) {
        const removed: RowNode<TData>[] = [];
        this.allLeafNodes = this.allLeafNodes.filter((n) => {
          if (removeIds.has(n.id)) {
            removed.push(n);
            this.nodesById.delete(n.id);
            return false;
          }
          return true;
        });
        result.remove = removed;
      }
    }

    if (tx.update && tx.update.length > 0) {
      for (const item of tx.update) {
        const node = getRowId
          ? this.nodesById.get(getRowId({ data: item, level: 0 }))
          : this.findByReference(item);
        if (node) {
          node.data = item;
          node.__version++;
          result.update.push(node);
        }
      }
    }

    if (tx.add && tx.add.length > 0) {
      const added: RowNode<TData>[] = [];
      for (const item of tx.add) {
        const id = getRowId ? getRowId({ data: item, level: 0 }) : undefined;
        const node = new RowNode<TData>(this.ctx, id);
        node.data = item;
        added.push(node);
        this.nodesById.set(node.id, node);
      }
      insertArray(this.allLeafNodes, added, tx.addIndex);
      result.add = added;
    }

    // Re-stamp source order.
    for (let i = 0; i < this.allLeafNodes.length; i++) this.allLeafNodes[i].__sourceIndex = i;
    this.dataLoaded = true;
    this.refreshModel('group');
    this.dispatchRowDataUpdated(result);
    return result;
  }

  applyTransactionAsync(
    tx: RowDataTransaction<TData>,
    cb?: (r: RowDataTransactionResult<TData>) => void,
  ): void {
    this.asyncTxQueue.push({ tx, cb });
    if (!this.asyncTxTimer) {
      this.asyncTxTimer = setTimeout(() => this.flushAsyncTransactions(), 16);
    }
  }

  flushAsyncTransactions(): void {
    if (this.asyncTxTimer) {
      clearTimeout(this.asyncTxTimer);
      this.asyncTxTimer = null;
    }
    if (this.asyncTxQueue.length === 0) return;
    const queue = this.asyncTxQueue;
    this.asyncTxQueue = [];
    // Merge into one recompute: apply data changes without refresh, then refresh once.
    const merged: RowDataTransaction<TData> = { add: [], update: [], remove: [] };
    for (const { tx } of queue) {
      if (tx.add) merged.add!.push(...tx.add);
      if (tx.update) merged.update!.push(...tx.update);
      if (tx.remove) merged.remove!.push(...tx.remove);
      if (tx.addIndex != null) merged.addIndex = tx.addIndex;
    }
    const result = this.applyTransaction(merged);
    for (const { cb } of queue) if (cb && result) cb(result);
  }

  private findByReference(item: TData): RowNode<TData> | undefined {
    return this.allLeafNodes.find((n) => n.data === item);
  }

  private buildPinnedRows(): void {
    const build = (data: TData[] | undefined, pos: 'top' | 'bottom'): RowNode<TData>[] => {
      if (!data) return [];
      return data.map((item, i) => {
        const node = new RowNode<TData>(this.ctx, `pinned-${pos}-${i}`);
        node.data = item;
        node.rowPinned = pos;
        node.rowIndex = i;
        node.rowHeight = this.defaultRowHeight();
        return node;
      });
    };
    this.pinnedTop = build(this.ctx.options.get('pinnedTopRowData'), 'top');
    this.pinnedBottom = build(this.ctx.options.get('pinnedBottomRowData'), 'bottom');
  }

  refreshPinnedRows(): void {
    this.buildPinnedRows();
    this.ctx.scheduleRender();
  }

  /* --------------------------------------------------------------- pipeline */

  refreshModel(step: PipelineStep = 'group', newData = false): void {
    if (!this.started) return;
    const from = STEP_ORDER.indexOf(step === 'pivot' ? 'group' : step);

    if (from <= 0 || !this.root) {
      const defaultExpanded = this.ctx.options.get('groupDefaultExpanded') ?? 0;
      const res = runGroupStage(this.ctx, this.allLeafNodes, this.expandedOverrides, defaultExpanded);
      this.root = res.root;
      this.groupsByPath = res.groupsByPath;
    }
    const root = this.root;

    if (from <= 1) {
      runFilterStage(root, this.ctx.filters ? this.ctx.filters.createPredicate() as ((node: RowNode<TData>) => boolean) | null : null);
    }
    if (from <= 3) {
      const pivotPaths = runAggStage(this.ctx, root);
      this.syncSecondaryColumns(pivotPaths);
    }
    if (from <= 4) {
      runSortStage(this.ctx, root, this.getSortSpecs());
    }
    this.flatten();
    this.ctx.selection?.refresh();
    this.ctx.events.dispatch({
      type: 'modelUpdated',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      step,
      newData,
    });
    this.ctx.scheduleRender();
  }

  private getSortSpecs(): SortSpec<TData>[] {
    const cols = [
      ...(this.ctx.columnModel.getAutoGroupColumn() ? [this.ctx.columnModel.getAutoGroupColumn()!] : []),
      ...this.ctx.columnModel.getPrimaryColumns(),
      ...(this.ctx.columnModel.getSecondaryColumns() ?? []),
    ];
    return cols
      .filter((c): c is Column<TData> => !!c && c.sort != null)
      .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
      .map((column) => ({ column, direction: column.sort as 'asc' | 'desc' }));
  }

  private syncSecondaryColumns(pivotPaths: string[][]): void {
    const pivotActive = this.ctx.columnModel.isPivotMode() && this.ctx.columnModel.getPivotColumns().length > 0;
    if (!pivotActive) {
      this.lastPivotSignature = null;
      this.ctx.columnModel.setSecondaryColumns(null);
      return;
    }
    const valueCols = this.ctx.columnModel.getValueColumns();
    const signature = pivotPaths.map((p) => p.join(PIVOT_SEP)).join('\n') + '::' + valueCols.map((c) => c.colId + ':' + String(c.aggFunc)).join(',');
    if (signature === this.lastPivotSignature) return;
    this.lastPivotSignature = signature;
    const suppressAgg = this.ctx.options.get('suppressAggFuncInHeader') === true;
    const defs = pivotPaths.flatMap((keys) =>
      valueCols.map((vc) => {
        const headerBase = vc.getHeaderName();
        const aggName = typeof vc.aggFunc === 'string' ? vc.aggFunc : 'agg';
        const colDef: ColDef<TData> = {
          colId: pivotColId(keys, vc.colId),
          headerName: suppressAgg || valueCols.length === 1 ? headerBase : `${aggName}(${headerBase})`,
          width: vc.width,
          minWidth: vc.minWidth,
          valueFormatter: vc.getColDef().valueFormatter,
          cellClass: vc.getColDef().cellClass,
          cellRenderer: vc.getColDef().cellRenderer,
          sortable: true,
          editable: false,
        };
        return { keys, valueCol: vc, colDef };
      }),
    );
    this.ctx.columnModel.setSecondaryColumns(defs);
  }

  /* ---------------------------------------------------------------- flatten */

  private flatten(): void {
    const out: RowNode<TData>[] = [];
    if (this.root) {
      const pivotActive = this.ctx.columnModel.isPivotMode() && this.ctx.columnModel.getPivotColumns().length > 0;
      const groupRowsMode = this.ctx.options.get('groupDisplayType') === 'groupRows';
      const groupTotal = this.ctx.options.get('groupTotalRow');
      void groupRowsMode;

      const visit = (node: RowNode<TData>): void => {
        const children = node.childrenAfterSort ?? node.childrenAfterFilter ?? [];
        for (const ch of children) {
          if (ch.group) {
            if (pivotActive && !this.hasGroupChildren(ch)) {
              // deepest group level in pivot mode: leaf-like, not expandable
              out.push(ch);
              continue;
            }
            if (groupTotal === 'top' && ch.expanded) {
              out.push(this.getFooterNode(ch));
              out.push(ch);
            } else {
              out.push(ch);
            }
            if (ch.expanded) {
              if (!pivotActive || this.hasGroupChildren(ch)) visit(ch);
              if (groupTotal === 'bottom') out.push(this.getFooterNode(ch));
            }
          } else if (!pivotActive) {
            out.push(ch);
          }
        }
      };
      const grandTotal = this.ctx.options.get('grandTotalRow');
      if (grandTotal === 'top' && this.hasAnyAgg()) out.push(this.getFooterNode(this.root));
      visit(this.root);
      if (grandTotal === 'bottom' && this.hasAnyAgg()) out.push(this.getFooterNode(this.root));
    }
    this.displayedAll = out;
    this.applyPageWindowInternal();
  }

  private hasGroupChildren(node: RowNode<TData>): boolean {
    return (node.childrenAfterFilter ?? []).some((c) => c.group);
  }

  private hasAnyAgg(): boolean {
    return this.ctx.columnModel.getValueColumns().length > 0;
  }

  private getFooterNode(group: RowNode<TData>): RowNode<TData> {
    if (group.sibling) return group.sibling;
    const footer = new RowNode<TData>(this.ctx, `${group.id}-footer`);
    footer.footer = true;
    footer.group = true;
    footer.key = group.key;
    footer.field = group.field;
    footer.level = group.level;
    footer.parent = group.parent;
    footer.aggData = group.aggData;
    footer.sibling = group;
    group.sibling = footer;
    return footer;
  }

  private applyPageWindowInternal(): void {
    if (this.pageWindow) {
      const { start, end } = this.pageWindow;
      this.pageRows = this.displayedAll.slice(start, end);
    } else {
      this.pageRows = this.displayedAll;
    }
    this.computeHeights();
  }

  private defaultRowHeight(): number {
    return this.ctx.options.get('rowHeight') ?? 32;
  }

  private computeHeights(): void {
    const getRowHeight = this.ctx.options.get('getRowHeight');
    const def = this.defaultRowHeight();
    const rows = this.pageRows;
    if (!getRowHeight && !this.hasCustomHeights) {
      // uniform fast path
      this.uniformHeight = def;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        r.rowIndex = i;
        r.rowTop = i * def;
        r.rowHeight = def;
      }
      this.totalHeight = rows.length * def;
      this.rowTops = new Float64Array(0);
      return;
    }
    this.uniformHeight = null;
    this.rowTops = new Float64Array(rows.length + 1);
    let y = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      r.rowIndex = i;
      r.rowTop = y;
      const h = (getRowHeight ? getRowHeight({ node: r, data: r.data }) : null) ?? r.rowHeight || def;
      r.rowHeight = h;
      this.rowTops[i] = y;
      y += h;
    }
    this.rowTops[rows.length] = y;
    this.totalHeight = y;
  }

  /** Set by renderer when autoHeight measurement changes a row. */
  private hasCustomHeights = false;
  setRowHeight(node: RowNode<TData>, height: number): void {
    if (node.rowHeight === height) return;
    node.rowHeight = height;
    this.hasCustomHeights = true;
    this.computeHeights();
    this.ctx.scheduleRender();
  }

  /* ------------------------------------------------------------------ reads */

  getRowCount(): number {
    return this.pageRows.length;
  }

  getRow(index: number): RowNode<TData> | undefined {
    return this.pageRows[index];
  }

  getRowNode(id: string): RowNode<TData> | undefined {
    const leaf = this.nodesById.get(id);
    if (leaf) return leaf;
    for (const g of this.groupsByPath.values()) if (g.id === id) return g;
    return undefined;
  }

  getPinnedRow(pos: 'top' | 'bottom', index: number): RowNode<TData> | undefined {
    return (pos === 'top' ? this.pinnedTop : this.pinnedBottom)[index];
  }

  getPinnedRows(pos: 'top' | 'bottom'): RowNode<TData>[] {
    return pos === 'top' ? this.pinnedTop : this.pinnedBottom;
  }

  getTotalHeight(): number {
    return this.totalHeight;
  }

  getRowTop(index: number): number {
    if (this.uniformHeight !== null) return index * this.uniformHeight;
    return this.rowTops[index] ?? 0;
  }

  getRowHeightAt(index: number): number {
    return this.pageRows[index]?.rowHeight ?? this.defaultRowHeight();
  }

  getRowIndexAtPixel(y: number): number {
    if (this.pageRows.length === 0) return 0;
    if (this.uniformHeight !== null) {
      return Math.min(this.pageRows.length - 1, Math.max(0, Math.floor(y / this.uniformHeight)));
    }
    return binarySearchLE(this.rowTops.subarray(0, this.pageRows.length), y);
  }

  isDataLoaded(): boolean {
    return this.dataLoaded;
  }

  getDisplayedRowCountAllPages(): number {
    return this.displayedAll.length;
  }

  forEachNode(fn: (node: RowNode<TData>, index: number) => void): void {
    let i = 0;
    const visit = (node: RowNode<TData>): void => {
      for (const ch of node.childrenAfterGroup ?? []) {
        fn(ch, i++);
        if (ch.group) visit(ch);
      }
    };
    if (this.root) visit(this.root);
  }

  forEachLeafNode(fn: (node: RowNode<TData>) => void): void {
    for (const n of this.allLeafNodes) fn(n);
  }

  forEachNodeAfterFilter(fn: (node: RowNode<TData>, index: number) => void): void {
    let i = 0;
    const visit = (node: RowNode<TData>): void => {
      for (const ch of node.childrenAfterFilter ?? []) {
        fn(ch, i++);
        if (ch.group) visit(ch);
      }
    };
    if (this.root) visit(this.root);
  }

  forEachNodeAfterFilterAndSort(fn: (node: RowNode<TData>, index: number) => void): void {
    let i = 0;
    const visit = (node: RowNode<TData>): void => {
      for (const ch of node.childrenAfterSort ?? node.childrenAfterFilter ?? []) {
        fn(ch, i++);
        if (ch.group) visit(ch);
      }
    };
    if (this.root) visit(this.root);
  }

  getAllLeafNodes(): RowNode<TData>[] {
    return this.allLeafNodes;
  }

  /* ------------------------------------------------------------------ hooks */

  onGroupExpandedChanged(node: RowNode<TData> | null): void {
    if (node) {
      const path = node.getGroupPath();
      this.expandedOverrides.delete(path);
      this.expandedOverrides.delete('!' + path);
      this.expandedOverrides.add(node.expanded ? path : '!' + path);
    }
    this.flatten();
    this.ctx.scheduleRender();
  }

  expandAll(expand: boolean): void {
    this.expandedOverrides.clear();
    for (const [path, g] of this.groupsByPath) {
      g.expanded = expand;
      this.expandedOverrides.add(expand ? path : '!' + path);
    }
    this.flatten();
    this.ctx.events.dispatch({
      type: 'expandOrCollapseAll',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
    });
    this.ctx.scheduleRender();
  }

  getExpandedGroupPaths(): string[] {
    const out: string[] = [];
    for (const [path, g] of this.groupsByPath) if (g.expanded) out.push(path);
    return out;
  }

  setExpandedGroupPaths(paths: string[]): void {
    this.expandedOverrides.clear();
    const set = new Set(paths);
    for (const [path, g] of this.groupsByPath) {
      g.expanded = set.has(path);
      this.expandedOverrides.add(g.expanded ? path : '!' + path);
    }
    this.flatten();
    this.ctx.scheduleRender();
  }

  onRowDataPatched(nodes: RowNode<TData>[]): void {
    // A cell value changed in place: re-run filter→…→flatten (group keys may
    // not change from setDataValue; a full regroup requires applyTransaction).
    void nodes;
    this.refreshModel('filter');
  }

  onSortChanged(): void {
    this.refreshModel('sort');
  }

  onFilterChanged(): void {
    this.refreshModel('filter');
  }

  setPageWindow(start: number, end: number): void {
    this.pageWindow = { start, end };
    this.applyPageWindowInternal();
    this.ctx.scheduleRender();
  }

  clearPageWindow(): void {
    this.pageWindow = null;
    this.applyPageWindowInternal();
    this.ctx.scheduleRender();
  }

  private dispatchRowDataUpdated(result?: RowDataTransactionResult<TData>): void {
    this.ctx.events.dispatch({
      type: 'rowDataUpdated',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      add: result?.add,
      update: result?.update,
      remove: result?.remove,
    });
  }
}
