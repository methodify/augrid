import type { IColumn } from '../types/column.js';
import type { ColDef } from '../types/colDef.js';
import type { PinnedPosition, SortDirection } from '../types/base.js';
import { humanize } from '../utils/general.js';

export type CellDataType = 'text' | 'number' | 'date' | 'boolean' | 'object';

export class Column<TData = unknown> implements IColumn<TData> {
  readonly colId: string;
  colDef: ColDef<TData>;

  visible: boolean;
  pinned: PinnedPosition = null;
  /** Explicit width; flex columns get actualWidth from flex resolution. */
  width: number;
  flex: number | null = null;
  actualWidth: number;
  minWidth: number;
  maxWidth: number;
  left = 0;

  sort: SortDirection = null;
  sortIndex: number | null = null;

  rowGroupActive = false;
  rowGroupIndex: number | null = null;
  pivotActive = false;
  pivotIndex: number | null = null;
  aggFunc: ColDef<TData>['aggFunc'] = null;

  /** Pivot-generated value column. */
  secondary = false;
  /** For secondary columns: the pivot key path + source value colId. */
  pivotKeys: string[] | null = null;
  pivotValueColId: string | null = null;
  /** Inferred or declared cell data type. */
  cellDataType: CellDataType = 'text';
  /** The synthetic auto-group column flag. */
  isAutoGroupCol = false;

  constructor(colId: string, colDef: ColDef<TData>) {
    this.colId = colId;
    this.colDef = colDef;
    this.visible = !colDef.hide;
    this.minWidth = colDef.minWidth ?? 40;
    this.maxWidth = colDef.maxWidth ?? 10000;
    this.width = Math.min(this.maxWidth, Math.max(this.minWidth, colDef.width ?? 200));
    this.actualWidth = this.width;
    this.flex = colDef.flex ?? null;
    if (colDef.pinned === true || colDef.pinned === 'left') this.pinned = 'left';
    else if (colDef.pinned === 'right') this.pinned = 'right';
    this.sort = colDef.sort ?? null;
    this.sortIndex = colDef.sortIndex ?? null;
    this.rowGroupActive = !!colDef.rowGroup;
    this.rowGroupIndex = colDef.rowGroupIndex ?? (colDef.rowGroup ? 0 : null);
    this.pivotActive = !!colDef.pivot;
    this.pivotIndex = colDef.pivotIndex ?? (colDef.pivot ? 0 : null);
    this.aggFunc = colDef.aggFunc ?? null;
  }

  getColId(): string {
    return this.colId;
  }
  getColDef(): ColDef<TData> {
    return this.colDef;
  }
  getActualWidth(): number {
    return this.actualWidth;
  }
  isVisible(): boolean {
    return this.visible;
  }
  getPinned(): PinnedPosition {
    return this.pinned;
  }
  getSort(): SortDirection {
    return this.sort;
  }
  getSortIndex(): number | null {
    return this.sortIndex;
  }
  isRowGroupActive(): boolean {
    return this.rowGroupActive;
  }
  isPivotActive(): boolean {
    return this.pivotActive;
  }
  getAggFunc(): ColDef<TData>['aggFunc'] {
    return this.aggFunc;
  }
  getLeft(): number {
    return this.left;
  }
  isSecondary(): boolean {
    return this.secondary;
  }

  getHeaderName(): string {
    if (this.colDef.headerName !== undefined) return this.colDef.headerName;
    if (this.colDef.field) return humanize(this.colDef.field);
    return this.colId;
  }

  isEditable(): boolean {
    return this.colDef.editable !== undefined && this.colDef.editable !== false;
  }

  isSortable(): boolean {
    return this.colDef.sortable !== false;
  }

  isResizable(): boolean {
    return this.colDef.resizable !== false;
  }
}
