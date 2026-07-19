import type { RowPinnedPosition } from './base';

/**
 * Public view of a row in the grid. Leaf rows wrap one item of row data;
 * group rows (rowGroup / tree data / pivot) aggregate children.
 */
export interface IRowNode<TData = unknown> {
  /** Stable id: from getRowId, or generated. */
  readonly id: string;
  /** The row data. Undefined for group rows (unless tree data supplied it). */
  data: TData | undefined;
  /** Index in the currently displayed (flattened, sorted, filtered) rows; -1 if not displayed. */
  rowIndex: number;
  /** Depth: 0 for top level. Group children are level+1. */
  readonly level: number;
  /** True if this node is a group (rowGroup, tree parent, or pivot group). */
  readonly group: boolean;
  /** Grouping key for group nodes (the shared column value as string). */
  readonly key: string | null;
  /** ColId this group was grouped by (undefined for tree data groups). */
  readonly field: string | null;
  readonly parent: IRowNode<TData> | null;
  /** All direct children (groups: subgroups or leaves). Undefined for leaves. */
  readonly childrenAfterGroup: IRowNode<TData>[] | undefined;
  readonly childrenAfterFilter: IRowNode<TData>[] | undefined;
  readonly childrenAfterSort: IRowNode<TData>[] | undefined;
  /** Number of leaf descendants passing the filter. */
  readonly allChildrenCount: number;
  /** Aggregated values for group nodes, keyed by colId. */
  readonly aggData: Record<string, unknown> | undefined;
  expanded: boolean;
  /** 'top' | 'bottom' for pinned rows, else null. */
  readonly rowPinned: RowPinnedPosition;
  /** True for the inserted footer (total) twin of a group node. */
  readonly footer: boolean;
  /** Group footer's source group node, if footer. */
  readonly sibling: IRowNode<TData> | null;
  /** Row top position in px within the scrollable body (displayed rows only). */
  readonly rowTop: number;
  readonly rowHeight: number;

  isSelected(): boolean | undefined; // undefined = indeterminate (some children)
  setSelected(selected: boolean): void;
  setExpanded(expanded: boolean): void;
  /**
   * Set a cell value through the full pipeline (valueParser NOT applied — pass a parsed
   * value). Fires cellValueChanged. Honors readOnlyEdit (fires cellEditRequest instead).
   * Returns true if the value was changed.
   */
  setDataValue(colId: string, newValue: unknown, source?: string): boolean;
  /** Replace this node's data wholesale and refresh (leaf nodes only). */
  setData(data: TData): void;
}
