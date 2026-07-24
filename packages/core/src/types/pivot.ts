/**
 * Intersection context for aggregate cells (pivot result cells, value-column
 * cells on group rows, and group-header cells). Carried on cellEditRequest /
 * cellValueChanged events and editable callbacks so a consuming app can write
 * back with the cell's full coordinates: WHERE on the row axis, WHERE on the
 * column axis, and WHICH field.
 */

/** One axis step: the source column and the key value at this intersection. */
export interface PivotKeyPart {
  colId: string;
  /**
   * Client-side groups produce string keys. The server-side model preserves
   * the server's member values losslessly: numbers stay numbers and a blank
   * member is `null` (never coerced to '').
   */
  key: string | number | null;
}

export interface PivotCellContext<TData = unknown> {
  /** Row-axis path at the edited row, outermost group first. */
  rowKeys: PivotKeyPart[];
  /** Column-axis path (pivot keys), outermost first. Empty outside pivot mode. */
  pivotKeys: PivotKeyPart[];
  /**
   * The source value column the cell aggregates ('allocation', not the
   * generated pivot colId). For group-header cells: the grouped source colId.
   */
  valueColId: string;
  /** Group depth of the row (0 = outermost group level). */
  level: number;
  /**
   * Source data rows at this intersection: the row-group's filtered leaf rows,
   * further narrowed to the pivot key tuple when in pivot mode. Resolved
   * lazily — calling this walks the node subtree.
   */
  getLeafRows(): TData[];
}
