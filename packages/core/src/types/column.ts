import type { PinnedPosition, SortDirection } from './base.js';
import type { AggFunc, ColDef } from './colDef.js';

/** Public view of a live column instance. */
export interface IColumn<TData = unknown> {
  getColId(): string;
  getColDef(): ColDef<TData>;
  /** Current rendered width in px (after flex resolution). */
  getActualWidth(): number;
  isVisible(): boolean;
  getPinned(): PinnedPosition;
  getSort(): SortDirection;
  getSortIndex(): number | null;
  isRowGroupActive(): boolean;
  isPivotActive(): boolean;
  getAggFunc(): string | AggFunc<TData> | null | undefined;
  /** Left offset in px within its region (left-pinned / center / right-pinned). */
  getLeft(): number;
  /** True for pivot-generated value columns. */
  isSecondary(): boolean;
  /** Resolved user-facing header label. */
  getHeaderName(): string;
}
