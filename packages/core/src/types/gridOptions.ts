import type { Density, GridState, RowPinnedPosition } from './base';
import type { AggFunc, CellRendererDef, ColDef, ColDefOrGroup } from './colDef';
import type { GridOptionEventCallbacks } from './events';
import type { GetContextMenuItems } from './menu';
import type { IRowNode } from './rowNode';
import type { GridApi } from './api';

/* ----------------------------------------------------------- infinite model */

export interface GetRowsParams<TData = unknown> {
  startRow: number;
  endRow: number;
  sortModel: { colId: string; sort: 'asc' | 'desc' }[];
  filterModel: Record<string, unknown>;
  /**
   * Call with the block's rows. lastRow: total row count once known, else -1.
   */
  success(result: { rowData: TData[]; lastRow?: number }): void;
  fail(): void;
}

export interface Datasource<TData = unknown> {
  getRows(params: GetRowsParams<TData>): void;
  destroy?(): void;
}

/* ---------------------------------------------------------------- selection */

export interface RowSelectionOptions<TData = unknown> {
  mode: 'singleRow' | 'multiRow';
  /** Render a checkbox column (default true for multiRow). */
  checkboxes?: boolean;
  headerCheckbox?: boolean;
  /** Rows selectable by clicking anywhere on the row (default true). */
  enableClickSelection?: boolean;
  /** Clicking a selected row deselects it (multiRow). */
  enableDeselection?: boolean;
  /** Groups select their descendants. */
  groupSelects?: 'self' | 'descendants';
  isRowSelectable?: (node: IRowNode<TData>) => boolean;
}

export interface CellSelectionOptions {
  /** Enable the fill handle drag corner. */
  handle?: boolean | 'fill';
  suppressMultiRanges?: boolean;
}

/* ----------------------------------------------------------------- side bar */

export interface SideBarDef {
  /** Panels to offer, in tab order (default: both). */
  panels?: ('columns' | 'filters')[];
  /** Panel open on grid creation (default: none — closed). */
  defaultOpen?: 'columns' | 'filters' | null;
  /** Which side the bar docks on (default 'right'). */
  position?: 'left' | 'right';
}

/* ------------------------------------------------------------------ theming */

export interface ThemeSpec {
  /** CSS custom property overrides, e.g. { accentColor: '#6366f1' }. Camel-cased --au-* names. */
  params?: Record<string, string | number>;
  /** 'light' | 'dark' | 'auto' (follows prefers-color-scheme). */
  colorScheme?: 'light' | 'dark' | 'auto';
  density?: Density;
}

/* -------------------------------------------------------------- fill handle */

export interface FillOperationParams<TData = unknown> {
  api: GridApi<TData>;
  context: unknown;
  /** Values in the dragged-from range for this column, in order. */
  initialValues: unknown[];
  /** 0-based index of the cell being filled beyond the initial range. */
  fillIndex: number;
  direction: 'up' | 'down' | 'left' | 'right';
  colId: string;
  node: IRowNode<TData>;
  currentValue: unknown;
}

/* ------------------------------------------------------------- grid options */

export interface GridOptions<TData = unknown> extends GridOptionEventCallbacks<TData> {
  /* columns */
  columnDefs?: ColDefOrGroup<TData>[];
  defaultColDef?: ColDef<TData>;
  columnTypes?: Record<string, ColDef<TData>>;
  /** ColDef for the auto group column (grouping display 'singleColumn'). */
  autoGroupColumnDef?: ColDef<TData>;
  /** Maintain column order from columnDefs updates (default: preserve user order). */
  maintainColumnOrder?: boolean;

  /* data */
  rowData?: TData[] | null;
  getRowId?: (params: { data: TData; level: number; parentKeys?: string[] }) => string;
  rowModelType?: 'clientSide' | 'infinite';
  datasource?: Datasource<TData>;
  /** Infinite model: rows per block (default 100). */
  cacheBlockSize?: number;
  /** Infinite model: max blocks kept in cache (default 10). */
  maxBlocksInCache?: number;

  /* dimensions */
  rowHeight?: number;
  getRowHeight?: (params: { node: IRowNode<TData>; data: TData | undefined }) => number | null;
  headerHeight?: number;
  floatingFiltersHeight?: number;

  /* pinned rows */
  pinnedTopRowData?: TData[];
  pinnedBottomRowData?: TData[];

  /* selection */
  rowSelection?: RowSelectionOptions<TData> | 'singleRow' | 'multiRow';
  cellSelection?: boolean | CellSelectionOptions;
  suppressCellFocus?: boolean;

  /* editing */
  editType?: 'fullRow';
  readOnlyEdit?: boolean;
  singleClickEdit?: boolean;
  stopEditingWhenCellsLoseFocus?: boolean;
  enterNavigatesVertically?: boolean;
  enterNavigatesVerticallyAfterEdit?: boolean;
  undoRedoCellEditing?: boolean;
  undoRedoCellEditingLimit?: number;
  /** Validate a pending edit; return an error string to reject, null/undefined to accept. */
  validateEdit?: (params: {
    node: IRowNode<TData>;
    colId: string;
    oldValue: unknown;
    newValue: unknown;
  }) => string | null | undefined;

  /* grouping / pivot / tree */
  groupDefaultExpanded?: number; // -1 = all
  groupDisplayType?: 'singleColumn' | 'multipleColumns' | 'groupRows';
  groupTotalRow?: 'top' | 'bottom';
  grandTotalRow?: 'top' | 'bottom';
  suppressAggFuncInHeader?: boolean;
  aggFuncs?: Record<string, AggFunc<TData>>;
  pivotMode?: boolean;
  treeData?: boolean;
  getDataPath?: (data: TData) => string[];
  /**
   * Comparator ordering group rows when no explicit sort applies.
   * Default keeps first-encounter (key insertion) order.
   */
  initialGroupOrderComparator?: (params: {
    nodeA: IRowNode<TData>;
    nodeB: IRowNode<TData>;
  }) => number;

  /* filtering */
  quickFilterText?: string;
  /** Quick filter matches formatted values (default true) vs raw. */
  quickFilterMatchesFormatted?: boolean;
  isExternalFilterPresent?: () => boolean;
  doesExternalFilterPass?: (node: IRowNode<TData>) => boolean;
  /** Show the floating filter row under headers for all filterable columns. */
  floatingFilter?: boolean;

  /* sorting */
  multiSortKey?: 'shift' | 'ctrl';
  accentedSort?: boolean;
  /** Post-sort hook to reorder displayed rows. */
  postSortRows?: (params: { nodes: IRowNode<TData>[] }) => void;

  /* pagination */
  pagination?: boolean;
  paginationPageSize?: number;
  paginationPageSizeSelector?: number[] | boolean;
  paginationAutoPageSize?: boolean;

  /* rendering */
  rowBuffer?: number;
  suppressColumnVirtualisation?: boolean;
  suppressRowVirtualisation?: boolean;
  enableCellChangeFlash?: boolean;
  cellFlashDuration?: number;
  rowClass?: string | string[];
  rowClassRules?: Record<string, (params: { data: TData | undefined; node: IRowNode<TData>; rowIndex: number }) => boolean>;
  getRowClass?: (params: { data: TData | undefined; node: IRowNode<TData>; rowIndex: number }) => string | string[] | undefined;
  getRowStyle?: (params: { data: TData | undefined; node: IRowNode<TData>; rowIndex: number }) => Partial<CSSStyleDeclaration> | undefined;
  isFullWidthRow?: (params: { rowNode: IRowNode<TData> }) => boolean;
  fullWidthCellRenderer?: CellRendererDef<TData>;
  /** Show built-in loading overlay. */
  loading?: boolean;
  overlayNoRowsTemplate?: string;
  tooltipShowDelay?: number;

  /* clipboard / fill */
  copyHeadersToClipboard?: boolean;
  clipboardDelimiter?: string;
  suppressClipboardPaste?: boolean;
  processCellForClipboard?: (params: { value: unknown; node: IRowNode<TData>; colId: string }) => unknown;
  processCellFromClipboard?: (params: { value: string; node: IRowNode<TData>; colId: string }) => unknown;
  fillOperation?: (params: FillOperationParams<TData>) => unknown;

  /* menus / side bar */
  /** Hide all header ⋮ menu buttons (per-column: colDef.suppressHeaderMenuButton). */
  suppressHeaderMenuButton?: boolean;
  /**
   * Tool panel side bar. true = columns + filters panels; a single panel name
   * shows just that panel; the object form controls panels, the initially
   * open panel, and which side it docks on.
   */
  sideBar?: boolean | 'columns' | 'filters' | SideBarDef;

  /* context menu */
  suppressContextMenu?: boolean;
  /**
   * Show the grid context menu even when Ctrl is held during right-click.
   * Default: Ctrl+right-click falls through to the browser menu.
   */
  allowContextMenuWithControlKey?: boolean;
  /** Customize menu items per cell; return names and/or MenuItemDefs. */
  getContextMenuItems?: GetContextMenuItems<TData>;

  /* keyboard */
  navigateToNextCell?: (params: {
    key: string;
    previousCellPosition: { rowIndex: number; colId: string; rowPinned: RowPinnedPosition };
    nextCellPosition: { rowIndex: number; colId: string; rowPinned: RowPinnedPosition } | null;
  }) => { rowIndex: number; colId: string; rowPinned: RowPinnedPosition } | null;
  tabToNextCell?: (params: {
    backwards: boolean;
    editing: boolean;
    previousCellPosition: { rowIndex: number; colId: string; rowPinned: RowPinnedPosition };
    nextCellPosition: { rowIndex: number; colId: string; rowPinned: RowPinnedPosition } | null;
  }) => { rowIndex: number; colId: string; rowPinned: RowPinnedPosition } | null;

  /* theming */
  theme?: ThemeSpec;

  /* state */
  initialState?: GridState;

  /* misc */
  context?: unknown;
}
