import type { CellPosition, CellRange, RowPinnedPosition, SortModelItem } from './types/base';
import type { FilterModel, FilterModelMap } from './types/filter';
import type { GridApi } from './types/api';
import type { OptionsService } from './options';
import type { EventService } from './events/eventService';
import type { ColumnModel } from './columns/columnModel';
import type { Column } from './columns/column';
import type { RowNode } from './rows/rowNode';
import type { IRowModel } from './rows/rowModel';
import type { GridRenderer } from './render/renderer';
import type { ValueService } from './values/valueService';

/* ----- interaction service contracts (implemented in interaction/, features/) ----- */

export interface IFocusService<TData = unknown> {
  getFocusedCell(): CellPosition | null;
  setFocusedCell(rowIndex: number, colId: string, rowPinned?: RowPinnedPosition): void;
  clearFocusedCell(): void;
  /** All grid keydowns enter here; service routes to edit/nav/selection/clipboard. */
  onKeyDown(e: KeyboardEvent): void;
  /** Move focus by delta with clamping; returns new position or null. */
  navigateBy(dRow: number, dCol: number, extendRange?: boolean): CellPosition | null;
  destroy(): void;
}

export interface ISelectionService<TData = unknown> {
  isSelected(node: RowNode<TData>): boolean | undefined;
  setSelected(nodes: RowNode<TData>[], value: boolean, source?: string, clearOthers?: boolean): void;
  /** Handle row-area click (with modifier semantics). */
  handleRowClick(node: RowNode<TData>, e: MouseEvent): void;
  handleHeaderCheckbox(checked: boolean): void;
  getSelectedNodes(): RowNode<TData>[];
  selectAll(justFiltered?: boolean): void;
  deselectAll(source?: string): void;
  /** Header checkbox state: true/false/'indeterminate'. */
  getHeaderState(): boolean | 'indeterminate';
  /** Re-sync after model updates (nodes removed etc.). */
  refresh(): void;
  destroy(): void;
}

export interface IRangeService<TData = unknown> {
  getCellRanges(): CellRange[];
  addCellRange(range: CellRange): void;
  setRangeToCell(pos: CellPosition, clearOthers?: boolean): void;
  extendLatestRangeToCell(pos: CellPosition): void;
  /**
   * Current extension end of the latest range — the corner opposite the
   * anchor. Keyboard shift+arrow steps FROM this cell (not from the focused
   * cell, which stays on the anchor while extending). Null when no range.
   */
  getLatestRangeEnd(): CellPosition | null;
  clearCellSelection(): void;
  /** Cell paint flags for the renderer. Bit flags: 1 in-range, 2 top, 4 right, 8 bottom, 16 left, 32 fill-handle-cell. */
  getCellFlags(rowIndex: number, colId: string): number;
  onCellMouseDown(pos: CellPosition, e: MouseEvent): void;
  /** Fill handle drag started from range corner. */
  onFillHandleMouseDown(e: MouseEvent): void;
  destroy(): void;
}

export interface StartEditParams {
  rowIndex: number;
  colId: string;
  rowPinned?: RowPinnedPosition;
  /** Printable key that triggered edit-by-typing. */
  key?: string | null;
  /** Event source for cellEditingStarted. */
  event?: Event;
}

export interface IEditingService<TData = unknown> {
  isEditing(): boolean;
  isEditingCell(rowIndex: number, colId: string): boolean;
  getEditingCells(): CellPosition[];
  startEditing(params: StartEditParams): boolean;
  /** Commit (or cancel) current edit(s). Returns true if an edit was open. */
  stopEditing(cancel?: boolean): boolean;
  /** Renderer calls this when it renders a cell under edit, to (re)mount editor GUI. */
  mountEditorInto(cellEl: HTMLElement, rowIndex: number, colId: string): void;
  /**
   * The single value-commit funnel used by editors, paste, and fill:
   * parse (optional) → validate → setDataValue / cellEditRequest.
   */
  commitValue(
    node: RowNode<TData>,
    colId: string,
    newValue: unknown,
    source: string,
    parse?: boolean,
  ): boolean;
  destroy(): void;
}

export interface IClipboardService<TData = unknown> {
  copy(includeHeaders?: boolean): void;
  cut(): void;
  paste(): void;
  /** Serialize current ranges/selection/focused cell to TSV (used by copy + tests). */
  getCopyText(includeHeaders?: boolean): string;
  destroy(): void;
}

export interface IFilterManager<TData = unknown> {
  getModel(): FilterModelMap;
  setModel(model: FilterModelMap | null, source?: string): void;
  getColumnModel_(colId: string): FilterModel | null;
  setColumnModel_(colId: string, model: FilterModel | null, source?: string): void;
  isColumnActive(colId: string): boolean;
  isAnyFilterActive(): boolean;
  /**
   * Compiled predicate over leaf nodes for the filter stage (column filters +
   * quick filter + external). Null when no filter is active.
   */
  createPredicate(): ((node: RowNode<TData>) => boolean) | null;
  /** Distinct set-filter values for a column. */
  getSetValues(colId: string): (string | null)[];
  /**
   * Mount a column's floating filter UI. Returns a cleanup function that
   * unsubscribes event listeners, closes any open popup, and removes document
   * listeners; the header renderer must invoke it before discarding the
   * container (i.e. on every header refresh/destroy).
   */
  mountFloatingFilter(container: HTMLElement, column: Column<TData>): () => void;
  destroy(): void;
}

export interface ISortController<TData = unknown> {
  getSortModel(): SortModelItem[];
  setSortModel(model: SortModelItem[], source?: string): void;
  /** Header click behavior: cycle asc→desc→none; multi adds to model. */
  progressSort(column: Column<TData>, multi: boolean, source?: string): void;
  destroy(): void;
}

export interface IUndoRedoService<TData = unknown> {
  undo(): void;
  redo(): void;
  undoSize(): number;
  redoSize(): number;
  destroy(): void;
}

export interface IPaginationService<TData = unknown> {
  isActive(): boolean;
  getCurrentPage(): number;
  getTotalPages(): number;
  getPageSize(): number;
  goToPage(page: number): void;
  setPageSize(size: number): void;
  /** Mount the pager panel UI. */
  mountPanel(container: HTMLElement): void;
  destroy(): void;
}

export interface IColumnDragService {
  /** Wire drag-to-reorder on a header cell element. */
  attachHeaderDrag(headerEl: HTMLElement, colId: string): void;
  destroy(): void;
}

export interface IColumnResizeService {
  /** Wire the resize grip on a header cell element. */
  attachResizeGrip(headerEl: HTMLElement, colId: string): void;
  destroy(): void;
}

export interface ITooltipService {
  /** Delegated mouseover entry from renderer. */
  onCellMouseOver(cellEl: HTMLElement, rowIndex: number, colId: string): void;
  onLeaveGrid(): void;
  destroy(): void;
}

/**
 * Adapter registered by framework wrappers (React etc.) to render framework
 * components into grid-owned elements.
 */
export interface FrameworkAdapter {
  /** Returns a cleanup function. */
  render(component: unknown, props: Record<string, unknown>, container: HTMLElement): () => void;
  /** Optional editor bridging: adapter provides value access for framework editors. */
  getEditorValue?(container: HTMLElement): unknown;
}

/* --------------------------------------------------------------- the context */

/**
 * Composition-root wiring shared by every module. Constructed by Grid; fields
 * assigned during boot in dependency order (kernel first, then interaction).
 */
export interface GridContext<TData = unknown> {
  readonly gridId: string;
  readonly rootEl: HTMLElement;
  destroyed: boolean;

  options: OptionsService<TData>;
  events: EventService<TData>;
  api: GridApi<TData>;
  values: ValueService<TData>;
  columnModel: ColumnModel<TData>;
  rowModel: IRowModel<TData>;
  renderer: GridRenderer<TData>;

  focus: IFocusService<TData>;
  selection: ISelectionService<TData>;
  editing: IEditingService<TData>;
  filters: IFilterManager<TData>;
  sort: ISortController<TData>;
  /** Null when cellSelection is off. */
  range: IRangeService<TData> | null;
  clipboard: IClipboardService<TData>;
  undoRedo: IUndoRedoService<TData> | null;
  pagination: IPaginationService<TData> | null;
  columnDrag: IColumnDragService | null;
  columnResize: IColumnResizeService | null;
  tooltips: ITooltipService | null;
  frameworkAdapter: FrameworkAdapter | null;

  /** Schedule a render pass on the next animation frame (idempotent). */
  scheduleRender(): void;
  /** Immediate synchronous render (tests, teardown-sensitive paths). */
  renderNow(): void;
}

/** Range cell paint flags. */
export const RANGE_IN = 1;
export const RANGE_TOP = 2;
export const RANGE_RIGHT = 4;
export const RANGE_BOTTOM = 8;
export const RANGE_LEFT = 16;
export const RANGE_HANDLE = 32;
