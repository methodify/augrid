import type { RowNode } from './rowNode.js';
import type { RowDataTransaction, RowDataTransactionResult } from '../types/api.js';

export type PipelineStep = 'group' | 'filter' | 'pivot' | 'aggregate' | 'sort' | 'flatten';

/**
 * Contract between the grid and a row data engine. Indices below are
 * *display* indices over the currently visible (flattened, page-windowed) rows.
 */
export interface IRowModel<TData = unknown> {
  readonly type: 'clientSide' | 'infinite';

  start(): void;
  destroy(): void;

  getRowCount(): number;
  getRow(index: number): RowNode<TData> | undefined;
  getRowNode(id: string): RowNode<TData> | undefined;

  /** Total pixel height of all displayed rows. */
  getTotalHeight(): number;
  getRowTop(index: number): number;
  getRowHeightAt(index: number): number;
  getRowIndexAtPixel(y: number): number;
  /** True once real data has arrived (vs initial empty). */
  isDataLoaded(): boolean;
  /** Rows currently displayed, before pagination windowing (client model). */
  getDisplayedRowCountAllPages?(): number;

  forEachNode(fn: (node: RowNode<TData>, index: number) => void): void;
  forEachLeafNode?(fn: (node: RowNode<TData>) => void): void;
  forEachNodeAfterFilter?(fn: (node: RowNode<TData>, index: number) => void): void;
  forEachNodeAfterFilterAndSort?(fn: (node: RowNode<TData>, index: number) => void): void;

  /* mutation (client model; infinite throws) */
  setRowData?(data: TData[]): void;
  applyTransaction?(tx: RowDataTransaction<TData>): RowDataTransactionResult<TData> | null;
  refreshModel?(step: PipelineStep): void;

  /* hooks called by the rest of the grid */
  onGroupExpandedChanged(node: RowNode<TData> | null): void;
  onRowDataPatched(nodes: RowNode<TData>[]): void;
  onSortChanged(): void;
  onFilterChanged(): void;
  /** Pagination window over displayed rows; null = no windowing. */
  setPageWindow?(start: number, end: number): void;

  /* infinite-model extras */
  refreshCache?(range?: { fromRow: number; toRow: number }): void;
  purgeCache?(): void;
}
