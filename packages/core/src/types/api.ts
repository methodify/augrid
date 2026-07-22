import type {
  CellPosition,
  CellRange,
  ColumnStateItem,
  GridState,
  PinnedPosition,
  RowPinnedPosition,
  SortModelItem,
} from './base';
import type { IColumn } from './column';
import type { IRowNode } from './rowNode';
import type { FilterModel, FilterModelMap } from './filter';
import type { GridEventListener, GridEventName } from './events';
import type { GridOptions } from './gridOptions';
import type { PivotCellContext } from './pivot';

export interface RowDataTransaction<TData = unknown> {
  add?: TData[];
  /** Insert position for adds (default: end). */
  addIndex?: number;
  /** Rows to update — matched by getRowId (required for update/remove). */
  update?: TData[];
  remove?: TData[];
}

export interface RowDataTransactionResult<TData = unknown> {
  add: IRowNode<TData>[];
  update: IRowNode<TData>[];
  remove: IRowNode<TData>[];
}

export interface CsvExportParams {
  fileName?: string;
  columnSeparator?: string;
  /** Export all columns, not just visible (default false). */
  allColumns?: boolean;
  /** Only selected rows (default false). */
  onlySelected?: boolean;
  skipHeaders?: boolean;
  /** Apply valueFormatters (default true). */
  useFormattedValues?: boolean;
  /**
   * Disable neutralization of spreadsheet formula triggers (values starting
   * with = + - @ or tab/CR are prefixed with ' by default to prevent CSV
   * formula injection when opened in Excel/Sheets).
   */
  suppressFormulaEscaping?: boolean;
}

export interface GridApi<TData = unknown> {
  /* lifecycle */
  destroy(): void;
  isDestroyed(): boolean;

  /* options */
  setGridOption<K extends keyof GridOptions<TData>>(key: K, value: GridOptions<TData>[K]): void;
  updateGridOptions(options: Partial<GridOptions<TData>>): void;
  getGridOption<K extends keyof GridOptions<TData>>(key: K): GridOptions<TData>[K];

  /* events */
  addEventListener<K extends GridEventName>(type: K, listener: GridEventListener<K, TData>): void;
  removeEventListener<K extends GridEventName>(
    type: K,
    listener: GridEventListener<K, TData>,
  ): void;

  /* rows / model */
  applyTransaction(tx: RowDataTransaction<TData>): RowDataTransactionResult<TData> | null;
  applyTransactionAsync(
    tx: RowDataTransaction<TData>,
    callback?: (res: RowDataTransactionResult<TData>) => void,
  ): void;
  flushAsyncTransactions(): void;
  getRowNode(id: string): IRowNode<TData> | undefined;
  getDisplayedRowCount(): number;
  getDisplayedRowAtIndex(index: number): IRowNode<TData> | undefined;
  forEachNode(fn: (node: IRowNode<TData>, index: number) => void): void;
  forEachLeafNode(fn: (node: IRowNode<TData>) => void): void;
  forEachNodeAfterFilter(fn: (node: IRowNode<TData>, index: number) => void): void;
  forEachNodeAfterFilterAndSort(fn: (node: IRowNode<TData>, index: number) => void): void;
  getPinnedRow(pinned: 'top' | 'bottom', index: number): IRowNode<TData> | undefined;
  /** Re-run the client-side pipeline from a stage. */
  refreshClientSideRowModel(step?: 'group' | 'filter' | 'aggregate' | 'sort' | 'flatten'): void;
  /** Infinite model: drop cached blocks and refetch. */
  refreshInfiniteCache(): void;
  purgeInfiniteCache(): void;

  /* columns */
  getColumn(colId: string): IColumn<TData> | undefined;
  getColumns(): IColumn<TData>[];
  getDisplayedColumns(): IColumn<TData>[];
  getColumnState(): ColumnStateItem[];
  applyColumnState(params: {
    state?: ColumnStateItem[];
    applyOrder?: boolean;
    defaultState?: Partial<ColumnStateItem>;
  }): boolean;
  resetColumnState(): void;
  setColumnsVisible(colIds: string[], visible: boolean): void;
  setColumnsPinned(colIds: string[], pinned: PinnedPosition): void;
  moveColumns(colIds: string[], toIndex: number): void;
  setColumnWidths(widths: { colId: string; width: number }[], finished?: boolean): void;
  sizeColumnsToFit(): void;
  autoSizeColumns(colIds?: string[], skipHeader?: boolean): void;
  autoSizeAllColumns(skipHeader?: boolean): void;
  /** Pivot result (secondary) columns, when pivot active. */
  getPivotResultColumns(): IColumn<TData>[];

  /* sort / filter */
  getSortModel(): SortModelItem[];
  setSortModel(model: SortModelItem[]): void;
  getFilterModel(): FilterModelMap;
  setFilterModel(model: FilterModelMap | null): void;
  getColumnFilterModel(colId: string): FilterModel | null;
  setColumnFilterModel(colId: string, model: FilterModel | null): void;
  isColumnFilterActive(colId: string): boolean;
  onFilterChanged(): void;
  /** Distinct values shown by a set filter for a column (post other filters). */
  getSetFilterValues(colId: string): (string | null)[];

  /* selection */
  getSelectedNodes(): IRowNode<TData>[];
  getSelectedRows(): TData[];
  setNodesSelected(params: { nodes: IRowNode<TData>[]; newValue: boolean }): void;
  selectAll(justFiltered?: boolean): void;
  deselectAll(): void;

  /* cell ranges */
  getCellRanges(): CellRange[];
  addCellRange(range: CellRange): void;
  clearCellSelection(): void;

  /* focus / navigation */
  getFocusedCell(): CellPosition | null;
  setFocusedCell(rowIndex: number, colId: string, rowPinned?: RowPinnedPosition): void;
  clearFocusedCell(): void;
  ensureIndexVisible(index: number, position?: 'top' | 'middle' | 'bottom' | null): void;
  ensureColumnVisible(colId: string): void;
  ensureNodeVisible(node: IRowNode<TData>, position?: 'top' | 'middle' | 'bottom' | null): void;

  /* editing */
  startEditingCell(params: { rowIndex: number; colId: string; key?: string }): void;
  stopEditing(cancel?: boolean): void;
  getEditingCells(): CellPosition[];
  undoCellEditing(): void;
  redoCellEditing(): void;
  getCurrentUndoSize(): number;
  getCurrentRedoSize(): number;

  /* clipboard */
  copyToClipboard(params?: { includeHeaders?: boolean }): void;
  cutToClipboard(): void;
  pasteFromClipboard(): void;

  /* grouping */
  expandAll(): void;
  collapseAll(): void;
  setRowNodeExpanded(node: IRowNode<TData>, expanded: boolean, expandParents?: boolean): void;

  /* rendering */
  refreshCells(params?: { rowNodes?: IRowNode<TData>[]; colIds?: string[]; force?: boolean }): void;
  redrawRows(params?: { rowNodes?: IRowNode<TData>[] }): void;
  refreshHeader(): void;
  flashCells(params?: { rowNodes?: IRowNode<TData>[]; colIds?: string[] }): void;
  getVisibleRowRange(): { first: number; last: number };

  /* overlays */
  showLoadingOverlay(): void;
  showNoRowsOverlay(): void;
  hideOverlay(): void;

  /* pagination */
  paginationGoToPage(page: number): void;
  paginationGoToNextPage(): void;
  paginationGoToPreviousPage(): void;
  paginationGetCurrentPage(): number;
  paginationGetTotalPages(): number;
  paginationGetPageSize(): number;
  paginationSetPageSize(size: number): void;

  /* export */
  exportDataAsCsv(params?: CsvExportParams): void;
  getDataAsCsv(params?: CsvExportParams): string;

  /* state */
  getState(): GridState;
  applyState(state: GridState): void;

  /* pivot */
  isPivotMode(): boolean;
  /**
   * Intersection coordinates (row keys × pivot keys × source field) for a
   * cell, for use in renderers, tooltips, context menus, and click handling.
   * Null when the cell carries no group/pivot context or the position is
   * invalid. See PivotCellContext.
   */
  getPivotCellContext(
    row: number | IRowNode<TData>,
    colId: string,
  ): PivotCellContext<TData> | null;
}
