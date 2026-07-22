import type { CellPosition, CellRange, SortModelItem } from './base';
import type { IRowNode } from './rowNode';
import type { IColumn } from './column';
import type { ColDef } from './colDef';
import type { FilterModelMap } from './filter';
import type { GridApi } from './api';
import type { PivotCellContext } from './pivot';

export interface AuEvent<TData = unknown> {
  type: string;
  api: GridApi<TData>;
  context: unknown;
}

export interface CellEvent<TData = unknown> extends AuEvent<TData> {
  node: IRowNode<TData>;
  data: TData | undefined;
  column: IColumn<TData>;
  colDef: ColDef<TData>;
  colId: string;
  value: unknown;
  rowIndex: number;
  /** Original DOM event when user-initiated. */
  event?: Event;
}

export interface RowEvent<TData = unknown> extends AuEvent<TData> {
  node: IRowNode<TData>;
  data: TData | undefined;
  rowIndex: number;
  event?: Event;
}

export interface CellValueChangedEvent<TData = unknown> extends CellEvent<TData> {
  oldValue: unknown;
  newValue: unknown;
  /** 'edit' | 'paste' | 'fill' | 'undo' | 'redo' | 'api' | custom */
  source: string;
  /**
   * Intersection coordinates when the cell has group/pivot context (aggregate
   * cells always; leaf cells under grouping). See PivotCellContext.
   */
  pivot?: PivotCellContext<TData>;
}

/** Fired instead of mutating when readOnlyEdit is on. */
export interface CellEditRequestEvent<TData = unknown> extends CellValueChangedEvent<TData> {}

export interface CellEditingEvent<TData = unknown> extends CellEvent<TData> {}

export interface SelectionChangedEvent<TData = unknown> extends AuEvent<TData> {
  selectedNodes: IRowNode<TData>[];
  source: string;
}

export interface RowSelectedEvent<TData = unknown> extends RowEvent<TData> {
  selected: boolean;
}

export interface CellSelectionChangedEvent<TData = unknown> extends AuEvent<TData> {
  ranges: CellRange[];
  /** True when the change is final (mouse released / keys settled). */
  finished: boolean;
}

export interface FillEndEvent<TData = unknown> extends AuEvent<TData> {
  initialRange: CellRange;
  finalRange: CellRange;
}

export interface SortChangedEvent<TData = unknown> extends AuEvent<TData> {
  sortModel: SortModelItem[];
  source: string;
}

export interface FilterChangedEvent<TData = unknown> extends AuEvent<TData> {
  filterModel: FilterModelMap;
  source: string;
}

export interface ColumnEvent<TData = unknown> extends AuEvent<TData> {
  columns: IColumn<TData>[];
  source: string;
}

export interface ColumnResizedEvent<TData = unknown> extends ColumnEvent<TData> {
  finished: boolean;
}

export interface RowGroupOpenedEvent<TData = unknown> extends RowEvent<TData> {
  expanded: boolean;
}

export interface ModelUpdatedEvent<TData = unknown> extends AuEvent<TData> {
  /** Which pipeline stage triggered the update. */
  step: 'group' | 'filter' | 'pivot' | 'aggregate' | 'sort' | 'flatten' | 'data';
  newData: boolean;
}

export interface PasteEvent<TData = unknown> extends AuEvent<TData> {
  source: 'clipboard';
}

export interface CellFocusedEvent<TData = unknown> extends AuEvent<TData> {
  rowIndex: number | null;
  colId: string | null;
  rowPinned: 'top' | 'bottom' | null;
}

export interface BodyScrollEvent<TData = unknown> extends AuEvent<TData> {
  left: number;
  top: number;
  direction: 'horizontal' | 'vertical';
}

export interface PaginationChangedEvent<TData = unknown> extends AuEvent<TData> {
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface GridSizeChangedEvent<TData = unknown> extends AuEvent<TData> {
  clientWidth: number;
  clientHeight: number;
}

export interface UndoRedoEvent<TData = unknown> extends AuEvent<TData> {
  operation: 'undo' | 'redo';
}

export interface RowDataUpdatedEvent<TData = unknown> extends AuEvent<TData> {
  /** Transaction results when applied via applyTransaction. */
  add?: IRowNode<TData>[];
  update?: IRowNode<TData>[];
  remove?: IRowNode<TData>[];
}

export interface StateUpdatedEvent<TData = unknown> extends AuEvent<TData> {
  sources: string[];
}

export interface TooltipEvent<TData = unknown> extends AuEvent<TData> {
  value: string;
  cell: CellPosition | null;
}

export interface ContextMenuVisibleChangedEvent<TData = unknown> extends AuEvent<TData> {
  visible: boolean;
  /** What opened/closed it: 'ui' (mouse/keyboard) or 'api'. */
  source: 'ui' | 'api';
}

/** All grid events, keyed by name. The single source of truth. */
export interface GridEventMap<TData = unknown> {
  gridReady: AuEvent<TData>;
  gridPreDestroyed: AuEvent<TData>;
  firstDataRendered: AuEvent<TData>;
  gridSizeChanged: GridSizeChangedEvent<TData>;

  modelUpdated: ModelUpdatedEvent<TData>;
  rowDataUpdated: RowDataUpdatedEvent<TData>;

  cellClicked: CellEvent<TData>;
  cellDoubleClicked: CellEvent<TData>;
  cellContextMenu: CellEvent<TData>;
  cellFocused: CellFocusedEvent<TData>;
  rowClicked: RowEvent<TData>;
  rowDoubleClicked: RowEvent<TData>;

  rowSelected: RowSelectedEvent<TData>;
  selectionChanged: SelectionChangedEvent<TData>;
  cellSelectionChanged: CellSelectionChangedEvent<TData>;
  fillEnd: FillEndEvent<TData>;

  cellEditingStarted: CellEditingEvent<TData>;
  cellEditingStopped: CellEditingEvent<TData>;
  rowEditingStarted: RowEvent<TData>;
  rowEditingStopped: RowEvent<TData>;
  cellValueChanged: CellValueChangedEvent<TData>;
  cellEditRequest: CellEditRequestEvent<TData>;
  rowValueChanged: RowEvent<TData>;
  pasteStart: PasteEvent<TData>;
  pasteEnd: PasteEvent<TData>;
  undoPerformed: UndoRedoEvent<TData>;
  redoPerformed: UndoRedoEvent<TData>;

  sortChanged: SortChangedEvent<TData>;
  filterChanged: FilterChangedEvent<TData>;

  columnMoved: ColumnEvent<TData>;
  columnResized: ColumnResizedEvent<TData>;
  columnPinned: ColumnEvent<TData>;
  columnVisible: ColumnEvent<TData>;
  columnRowGroupChanged: ColumnEvent<TData>;
  columnPivotChanged: ColumnEvent<TData>;
  columnValueChanged: ColumnEvent<TData>;
  pivotModeChanged: AuEvent<TData>;
  displayedColumnsChanged: AuEvent<TData>;
  newColumnsLoaded: AuEvent<TData>;

  rowGroupOpened: RowGroupOpenedEvent<TData>;
  expandOrCollapseAll: AuEvent<TData>;

  paginationChanged: PaginationChangedEvent<TData>;
  bodyScroll: BodyScrollEvent<TData>;
  bodyScrollEnd: BodyScrollEvent<TData>;
  viewportChanged: AuEvent<TData>;

  stateUpdated: StateUpdatedEvent<TData>;
  tooltipShow: TooltipEvent<TData>;
  tooltipHide: AuEvent<TData>;
  contextMenuVisibleChanged: ContextMenuVisibleChangedEvent<TData>;
}

export type GridEventName = keyof GridEventMap;

export type GridEventListener<
  K extends GridEventName = GridEventName,
  TData = unknown,
> = (event: GridEventMap<TData>[K]) => void;

/** onCellClicked-style callback props derived from the event map. */
export type GridOptionEventCallbacks<TData = unknown> = {
  [K in GridEventName as `on${Capitalize<K>}`]?: (event: GridEventMap<TData>[K]) => void;
};
