/** Shared primitive types used across the public API. */

export type SortDirection = 'asc' | 'desc' | null;
export type PinnedPosition = 'left' | 'right' | null | undefined;
export type RowPinnedPosition = 'top' | 'bottom' | null;

export interface CellPosition {
  rowIndex: number;
  colId: string;
  rowPinned: RowPinnedPosition;
}

export interface SortModelItem {
  colId: string;
  sort: 'asc' | 'desc';
}

/** One rectangular block of selected cells. Columns are in display order. */
export interface CellRange {
  startRowIndex: number;
  endRowIndex: number;
  colIds: string[];
}

export interface RowHeightParams<TData = unknown> {
  data: TData | undefined;
  node: unknown; // narrowed to RowNode<TData> at call sites; avoids circular import
  api: unknown;
}

export type Density = 'compact' | 'normal' | 'comfortable';

/** Column state snapshot entry — serializable, used for persistence. */
export interface ColumnStateItem {
  colId: string;
  width?: number;
  flex?: number | null;
  hide?: boolean;
  pinned?: PinnedPosition;
  sort?: SortDirection;
  sortIndex?: number | null;
  rowGroup?: boolean;
  rowGroupIndex?: number | null;
  pivot?: boolean;
  pivotIndex?: number | null;
  aggFunc?: string | null;
  orderIndex?: number;
}

export interface GridState {
  columns?: ColumnStateItem[];
  filter?: Record<string, unknown>;
  quickFilter?: string;
  pivotMode?: boolean;
  expandedGroups?: string[];
  pagination?: { page: number; pageSize: number };
}
