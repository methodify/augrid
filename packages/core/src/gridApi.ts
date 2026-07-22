import type { GridApi, CsvExportParams, RowDataTransaction, RowDataTransactionResult } from './types/api';
import type { GridContext } from './context';
import type { GridOptions } from './types/gridOptions';
import type { GridState, CellPosition, CellRange, ColumnStateItem, PinnedPosition, RowPinnedPosition, SortModelItem } from './types/base';
import type { IRowNode } from './types/rowNode';
import type { RowNode } from './rows/rowNode';
import type { ClientSideRowModel } from './rows/clientSideRowModel';
import type { FilterModel, FilterModelMap } from './types/filter';
import type { GridEventListener, GridEventName } from './types/events';
import { exportCsv, downloadCsv } from './features/csvExport';
import { buildPivotCellContext } from './values/pivotContext';

/** Concrete GridApi implementation — thin delegation over the context. */
export function createGridApi<TData>(ctx: GridContext<TData>): GridApi<TData> {
  let destroyed = false;
  const csm = () => ctx.rowModel as ClientSideRowModel<TData>;

  const api: GridApi<TData> = {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      (ctx as { __destroyGrid?: () => void }).__destroyGrid?.();
    },
    isDestroyed: () => destroyed || ctx.destroyed,

    setGridOption(key, value) {
      ctx.options.update({ [key]: value } as Partial<GridOptions<TData>>);
    },
    updateGridOptions(options) {
      ctx.options.update(options);
    },
    getGridOption(key) {
      return ctx.options.get(key);
    },

    addEventListener<K extends GridEventName>(type: K, listener: GridEventListener<K, TData>) {
      ctx.events.addEventListener(type, listener);
    },
    removeEventListener<K extends GridEventName>(type: K, listener: GridEventListener<K, TData>) {
      ctx.events.removeEventListener(type, listener);
    },

    applyTransaction(tx: RowDataTransaction<TData>): RowDataTransactionResult<TData> | null {
      return ctx.rowModel.applyTransaction?.(tx) ?? null;
    },
    applyTransactionAsync(tx, callback) {
      csm().applyTransactionAsync?.(tx, callback);
    },
    flushAsyncTransactions() {
      csm().flushAsyncTransactions?.();
    },
    getRowNode(id: string) {
      return ctx.rowModel.getRowNode(id);
    },
    getDisplayedRowCount() {
      return ctx.rowModel.getRowCount();
    },
    getDisplayedRowAtIndex(index: number) {
      return ctx.rowModel.getRow(index);
    },
    forEachNode(fn) {
      ctx.rowModel.forEachNode(fn as (node: RowNode<TData>, index: number) => void);
    },
    forEachLeafNode(fn) {
      ctx.rowModel.forEachLeafNode?.(fn as (node: RowNode<TData>) => void);
    },
    forEachNodeAfterFilter(fn) {
      ctx.rowModel.forEachNodeAfterFilter?.(fn as (node: RowNode<TData>, index: number) => void);
    },
    forEachNodeAfterFilterAndSort(fn) {
      ctx.rowModel.forEachNodeAfterFilterAndSort?.(fn as (node: RowNode<TData>, index: number) => void);
    },
    getPinnedRow(pinned, index) {
      return csm().getPinnedRow?.(pinned, index);
    },
    refreshClientSideRowModel(step) {
      ctx.rowModel.refreshModel?.(step ?? 'group');
    },
    refreshInfiniteCache() {
      ctx.rowModel.refreshCache?.();
    },
    purgeInfiniteCache() {
      ctx.rowModel.purgeCache?.();
    },

    getColumn(colId: string) {
      return ctx.columnModel.getColumn(colId);
    },
    getColumns() {
      return ctx.columnModel.getPrimaryColumns();
    },
    getDisplayedColumns() {
      return ctx.columnModel.getDisplayedColumns();
    },
    getColumnState(): ColumnStateItem[] {
      return ctx.columnModel.getColumnState();
    },
    applyColumnState(params) {
      return ctx.columnModel.applyColumnState(params);
    },
    resetColumnState() {
      const defs = ctx.options.get('columnDefs');
      if (defs) ctx.columnModel.setColumnDefs(defs);
      ctx.rowModel.refreshModel?.('group');
      ctx.renderer.markHeaderDirty();
      ctx.scheduleRender();
    },
    setColumnsVisible(colIds, visible) {
      ctx.columnModel.setColumnsVisible(colIds, visible);
      ctx.renderer.markHeaderDirty();
    },
    setColumnsPinned(colIds, pinned: PinnedPosition) {
      ctx.columnModel.setColumnsPinned(colIds, pinned);
      ctx.renderer.markHeaderDirty();
    },
    moveColumns(colIds, toIndex) {
      ctx.columnModel.moveColumns(colIds, toIndex);
      ctx.renderer.markHeaderDirty();
    },
    setColumnWidths(widths, finished = true) {
      ctx.columnModel.setColumnWidths(widths, finished);
      ctx.renderer.markHeaderDirty();
    },
    sizeColumnsToFit() {
      ctx.columnModel.sizeColumnsToFit();
      ctx.renderer.markHeaderDirty();
    },
    autoSizeColumns(colIds, skipHeader = false) {
      const cols = (colIds ?? ctx.columnModel.getDisplayedColumns().map((c) => c.colId))
        .map((id) => ctx.columnModel.getColumn(id))
        .filter((c): c is NonNullable<typeof c> => !!c);
      const widths = cols.map((c) => ({
        colId: c.colId,
        width: ctx.renderer.measureColumnWidth(c, skipHeader),
      }));
      ctx.columnModel.setColumnWidths(widths, true, 'autosize');
      ctx.renderer.markHeaderDirty();
    },
    autoSizeAllColumns(skipHeader = false) {
      api.autoSizeColumns(undefined, skipHeader);
    },
    getPivotResultColumns() {
      return ctx.columnModel.getSecondaryColumns() ?? [];
    },

    getSortModel(): SortModelItem[] {
      return ctx.sort.getSortModel();
    },
    setSortModel(model: SortModelItem[]) {
      ctx.sort.setSortModel(model, 'api');
    },
    getFilterModel(): FilterModelMap {
      return ctx.filters.getModel();
    },
    setFilterModel(model: FilterModelMap | null) {
      ctx.filters.setModel(model, 'api');
    },
    getColumnFilterModel(colId: string): FilterModel | null {
      return ctx.filters.getColumnModel_(colId);
    },
    setColumnFilterModel(colId: string, model: FilterModel | null) {
      ctx.filters.setColumnModel_(colId, model, 'api');
    },
    isColumnFilterActive(colId: string) {
      return ctx.filters.isColumnActive(colId);
    },
    onFilterChanged() {
      ctx.rowModel.onFilterChanged();
    },
    getSetFilterValues(colId: string) {
      return ctx.filters.getSetValues(colId);
    },

    getSelectedNodes() {
      return ctx.selection.getSelectedNodes();
    },
    getSelectedRows() {
      return ctx.selection
        .getSelectedNodes()
        .map((n) => n.data)
        .filter((d): d is TData => d !== undefined);
    },
    setNodesSelected(params) {
      ctx.selection.setSelected(params.nodes as RowNode<TData>[], params.newValue, 'api');
    },
    selectAll(justFiltered = false) {
      ctx.selection.selectAll(justFiltered);
    },
    deselectAll() {
      ctx.selection.deselectAll('api');
    },

    getCellRanges(): CellRange[] {
      return ctx.range?.getCellRanges() ?? [];
    },
    addCellRange(range: CellRange) {
      ctx.range?.addCellRange(range);
    },
    clearCellSelection() {
      ctx.range?.clearCellSelection();
    },

    getFocusedCell(): CellPosition | null {
      return ctx.focus.getFocusedCell();
    },
    setFocusedCell(rowIndex: number, colId: string, rowPinned: RowPinnedPosition = null) {
      ctx.focus.setFocusedCell(rowIndex, colId, rowPinned);
    },
    clearFocusedCell() {
      ctx.focus.clearFocusedCell();
    },
    ensureIndexVisible(index, position = null) {
      ctx.renderer.ensureIndexVisible(index, position);
    },
    ensureColumnVisible(colId) {
      ctx.renderer.ensureColumnVisible(colId);
    },
    ensureNodeVisible(node: IRowNode<TData>, position = null) {
      if (node.rowIndex >= 0) ctx.renderer.ensureIndexVisible(node.rowIndex, position);
    },

    startEditingCell(params) {
      ctx.editing.startEditing({ rowIndex: params.rowIndex, colId: params.colId, key: params.key ?? null });
    },
    stopEditing(cancel = false) {
      ctx.editing.stopEditing(cancel);
    },
    getEditingCells() {
      return ctx.editing.getEditingCells();
    },
    undoCellEditing() {
      ctx.undoRedo?.undo();
    },
    redoCellEditing() {
      ctx.undoRedo?.redo();
    },
    getCurrentUndoSize() {
      return ctx.undoRedo?.undoSize() ?? 0;
    },
    getCurrentRedoSize() {
      return ctx.undoRedo?.redoSize() ?? 0;
    },

    copyToClipboard(params) {
      ctx.clipboard.copy(params?.includeHeaders);
    },
    cutToClipboard() {
      ctx.clipboard.cut();
    },
    pasteFromClipboard() {
      ctx.clipboard.paste();
    },

    expandAll() {
      csm().expandAll?.(true);
    },
    collapseAll() {
      csm().expandAll?.(false);
    },
    setRowNodeExpanded(node, expanded, expandParents = false) {
      if (expandParents) {
        let p = node.parent;
        while (p && p.level >= 0) {
          p.setExpanded(true);
          p = p.parent;
        }
      }
      node.setExpanded(expanded);
    },

    refreshCells(params) {
      ctx.renderer.refreshCells({
        rowIds: params?.rowNodes ? new Set(params.rowNodes.map((n) => n.id)) : undefined,
        colIds: params?.colIds ? new Set(params.colIds) : undefined,
      });
    },
    redrawRows() {
      ctx.renderer.redrawAll();
    },
    refreshHeader() {
      ctx.renderer.markHeaderDirty();
      ctx.scheduleRender();
    },
    flashCells(params) {
      ctx.renderer.flashCells(
        params?.rowNodes ? new Set(params.rowNodes.map((n) => n.id)) : null,
        params?.colIds ? new Set(params.colIds) : null,
      );
    },
    getVisibleRowRange() {
      return ctx.renderer.getVisibleRowRange();
    },

    showLoadingOverlay() {
      ctx.renderer.showOverlay('loading');
    },
    showNoRowsOverlay() {
      ctx.renderer.showOverlay('noRows');
    },
    hideOverlay() {
      ctx.renderer.showOverlay('hidden');
    },

    paginationGoToPage(page) {
      ctx.pagination?.goToPage(page);
    },
    paginationGoToNextPage() {
      ctx.pagination?.goToPage((ctx.pagination?.getCurrentPage() ?? 0) + 1);
    },
    paginationGoToPreviousPage() {
      ctx.pagination?.goToPage((ctx.pagination?.getCurrentPage() ?? 0) - 1);
    },
    paginationGetCurrentPage() {
      return ctx.pagination?.getCurrentPage() ?? 0;
    },
    paginationGetTotalPages() {
      return ctx.pagination?.getTotalPages() ?? 1;
    },
    paginationGetPageSize() {
      return ctx.pagination?.getPageSize() ?? (ctx.options.get('paginationPageSize') ?? 100);
    },
    paginationSetPageSize(size) {
      ctx.pagination?.setPageSize(size);
    },

    showContextMenu(params) {
      const focused = ctx.focus.getFocusedCell();
      const rowIndex = params?.rowIndex ?? focused?.rowIndex;
      const colId = params?.colId ?? focused?.colId;
      if (rowIndex == null || colId == null) return false;
      return (
        ctx.contextMenu?.showMenuAtCell({ rowIndex, colId, rowPinned: null }, 'api') ?? false
      );
    },
    hideContextMenu() {
      ctx.contextMenu?.hideMenu();
    },

    exportDataAsCsv(params?: CsvExportParams) {
      downloadCsv(exportCsv(ctx, params), params?.fileName ?? 'export.csv');
    },
    getDataAsCsv(params?: CsvExportParams) {
      return exportCsv(ctx, params);
    },

    getState(): GridState {
      const state: GridState = {
        columns: ctx.columnModel.getColumnState(),
        filter: ctx.filters.getModel(),
        quickFilter: ctx.options.get('quickFilterText'),
        pivotMode: ctx.options.get('pivotMode') === true,
        expandedGroups: csm().getExpandedGroupPaths?.(),
      };
      if (ctx.pagination?.isActive()) {
        state.pagination = {
          page: ctx.pagination.getCurrentPage(),
          pageSize: ctx.pagination.getPageSize(),
        };
      }
      return state;
    },
    applyState(state: GridState) {
      if (state.pivotMode !== undefined) ctx.options.update({ pivotMode: state.pivotMode } as Partial<GridOptions<TData>>);
      if (state.columns) ctx.columnModel.applyColumnState({ state: state.columns, applyOrder: true });
      if (state.filter) ctx.filters.setModel(state.filter as FilterModelMap, 'state');
      if (state.quickFilter !== undefined)
        ctx.options.update({ quickFilterText: state.quickFilter } as Partial<GridOptions<TData>>);
      if (state.expandedGroups) csm().setExpandedGroupPaths?.(state.expandedGroups);
      if (state.pagination) {
        ctx.pagination?.setPageSize(state.pagination.pageSize);
        ctx.pagination?.goToPage(state.pagination.page);
      }
      ctx.renderer.markHeaderDirty();
      ctx.scheduleRender();
      ctx.events.dispatch({
        type: 'stateUpdated',
        api: ctx.api,
        context: ctx.options.get('context'),
        sources: ['applyState'],
      });
    },

    isPivotMode() {
      return ctx.columnModel.isPivotMode();
    },
    getPivotCellContext(row, colId) {
      const node =
        typeof row === 'number' ? ctx.rowModel.getRow(row) : (row as RowNode<TData> | undefined);
      const column = ctx.columnModel.getColumn(colId);
      if (!node || !column) return null;
      return buildPivotCellContext(ctx, node, column);
    },
  };
  return api;
}
