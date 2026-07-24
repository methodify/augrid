import type {
  CellPosition,
  CellRange,
  ColumnStateItem,
  GridState,
  PinnedPosition,
  RowPinnedPosition,
  SortModelItem,
} from './base.js';
import type { IColumn } from './column.js';
import type { IRowNode } from './rowNode.js';
import type { FilterModel, FilterModelMap } from './filter.js';
import type { GridEventListener, GridEventName } from './events.js';
import type { GridOptions } from './gridOptions.js';
import type { PivotCellContext } from './pivot.js';

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

export interface ExcelExportParams<TData = unknown> {
  fileName?: string;
  /** Worksheet tab name (sanitized: ≤31 chars, no : \ / ? * [ ]). */
  sheetName?: string;
  /** Export all visible columns, not just displayed ones (default false). */
  allColumns?: boolean;
  /** Only selected rows (default false). */
  onlySelected?: boolean;
  skipHeaders?: boolean;
  /**
   * Export formatted strings instead of typed values (default false).
   * Off by default because typed cells let Excel sum, sort, and format —
   * turn it on when the display string IS the data.
   */
  useFormattedValues?: boolean;
  /** Header row appearance; merged over the default (bold, light fill, rule). */
  headerStyle?: ExcelHeaderStyle;
  /** Don't freeze the header row / pinned-left columns. */
  suppressFreeze?: boolean;
  /** Don't add an autofilter over the header row. */
  suppressAutoFilter?: boolean;
  /** Transform a value on its way into the sheet (return a typed value). */
  processCellForExcel?: (params: {
    value: unknown;
    node: IRowNode<TData>;
    colId: string;
  }) => string | number | boolean | Date | null;
}

export interface ExcelHeaderStyle {
  bold?: boolean;
  /** ARGB fill, e.g. 'FFEFF2F7'. */
  fill?: string;
  /** ARGB font color, e.g. 'FF1F2937'. */
  color?: string;
  align?: 'left' | 'center' | 'right';
  borderBottom?: boolean;
}

/**
 * One sheet's exportable content plus the style specs its cells reference
 * (cell `styleId`s index into `styleSpecs`). Returned by
 * `api.getSheetDataForExcel` and accepted by `exportMultipleSheetsAsExcel`,
 * which re-interns styles so sheets from DIFFERENT grids compose safely.
 */
export interface ExcelSheetPayload {
  sheet: ExcelSheetContent;
  styleSpecs: ExcelHeaderStyle_[];
}

/** Structural sheet content; `rows[r][c]` is a typed cell. */
export interface ExcelSheetContent {
  name: string;
  rows: { value: string | number | boolean | Date | null; styleId?: number }[][];
  columnWidths?: (number | undefined)[];
  freeze?: { rows: number; cols: number };
  autoFilterRows?: number;
}

/** Style spec (superset of ExcelHeaderStyle: also carries number formats). */
export interface ExcelHeaderStyle_ extends ExcelHeaderStyle {
  numberFormat?: string;
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
  /**
   * Infinite model: refetch loaded blocks IN PLACE — rows stay visible until
   * replaced, so scroll/focus/selection survive. Pass a row range to
   * invalidate only the blocks it touches (server data changed underneath).
   */
  refreshInfiniteCache(params?: { fromRow?: number; toRow?: number }): void;
  /** Infinite model: drop the whole cache, reset counts, reload from row 0. */
  purgeInfiniteCache(): void;
  /**
   * Server-side model: refetch loaded blocks IN PLACE (rows stay visible
   * until replaced; selection carries by getRowId). `groupKeys` targets one
   * parent's children (null/number members round-trip exactly); omit to
   * refresh every store. `fromRow`/`toRow` are offsets WITHIN the parent.
   */
  refreshServerSideStore(params?: {
    groupKeys?: (string | number | null)[];
    fromRow?: number;
    toRow?: number;
  }): void;

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

  /* side bar / tool panels */
  setSideBarVisible(visible: boolean): void;
  isSideBarVisible(): boolean;
  openToolPanel(id: 'columns' | 'filters'): void;
  closeToolPanel(): void;
  getOpenedToolPanel(): 'columns' | 'filters' | null;

  /* find */
  /** Set the find text; matches recompute and highlight ('' clears). */
  setFindText(text: string): void;
  /** Step the active match forward/backward (wraps; scrolls it into view). */
  findNext(): void;
  findPrevious(): void;
  clearFind(): void;
  getFindState(): { text: string; totalMatches: number; activeIndex: number };

  /* context menu */
  /**
   * Open the context menu anchored to a cell (defaults to the focused cell).
   * Returns false when nothing opened (no cell, suppressed, or empty menu).
   */
  showContextMenu(params?: { rowIndex?: number; colId?: string }): boolean;
  hideContextMenu(): void;

  /* export */
  exportDataAsCsv(params?: CsvExportParams): void;
  getDataAsCsv(params?: CsvExportParams): string;
  /** Build and download an .xlsx of the current view. */
  exportDataAsExcel(params?: ExcelExportParams<TData>): Promise<void>;
  /** Workbook bytes for the current view (for upload, tests, custom delivery). */
  getDataAsExcel(params?: ExcelExportParams<TData>): Promise<Uint8Array>;
  /** This grid's content as a composable sheet payload (see ExcelSheetPayload). */
  getSheetDataForExcel(params?: ExcelExportParams<TData>): ExcelSheetPayload;
  /** Download one workbook containing several sheets (any grid can contribute). */
  exportMultipleSheetsAsExcel(params: {
    sheets: ExcelSheetPayload[];
    fileName?: string;
  }): Promise<void>;

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
