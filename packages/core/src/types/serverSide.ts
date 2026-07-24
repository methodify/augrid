import type { SortModelItem } from './base.js';
import type { FilterModelMap } from './filter.js';

/**
 * A group key as the server knows it. Numbers, dates-as-strings, and blanks
 * are all real member values in semantic-model hierarchies; `null` is a
 * legitimate key and is NEVER conflated with `''` or with "no key" — paths
 * round-trip losslessly through expansion state, store cache keys, and
 * `refreshServerSideStore`.
 */
export type GroupKey = string | number | null;

export interface ServerSideRowsParams<TData = unknown> {
  /** Path of group keys from root to the parent being fetched; [] = root. */
  groupKeys: GroupKey[];
  /** The grouping hierarchy, in level order. */
  rowGroupCols: { colId: string; field: string }[];
  /**
   * Value columns the grid displays. `aggFunc` is advisory/opaque — the
   * SERVER computes aggregate values at each grain (the grid never
   * re-aggregates); it is undefined for server-defined measures.
   */
  valueCols: { colId: string; aggFunc?: string }[];
  /** Block window WITHIN this parent's children (row offsets; endRow exclusive). */
  startRow: number;
  endRow: number;
  sortModel: SortModelItem[];
  filterModel: FilterModelMap;
  /**
   * Deliver this block. `rowCount`: this parent's exact child count when
   * known; omit while unknown (the count grows speculatively — never
   * synthesized).
   */
  success(result: { rowData: TData[]; rowCount?: number }): void;
  fail(): void;
}

export interface ServerSideDatasource<TData = unknown> {
  getRows(params: ServerSideRowsParams<TData>): void;
  destroy?(): void;
}
