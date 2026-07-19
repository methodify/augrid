import type { IRowNode } from '../types/rowNode';
import type { RowPinnedPosition } from '../types/base';
import type { GridContext } from '../context';

let nodeIdSeq = 0;

export class RowNode<TData = unknown> implements IRowNode<TData> {
  readonly id: string;
  data: TData | undefined;
  rowIndex = -1;
  level = 0;
  group = false;
  key: string | null = null;
  field: string | null = null;
  parent: RowNode<TData> | null = null;
  childrenAfterGroup: RowNode<TData>[] | undefined;
  childrenAfterFilter: RowNode<TData>[] | undefined;
  childrenAfterSort: RowNode<TData>[] | undefined;
  allChildrenCount = 0;
  aggData: Record<string, unknown> | undefined;
  expanded = false;
  rowPinned: RowPinnedPosition = null;
  footer = false;
  sibling: RowNode<TData> | null = null;
  rowTop = 0;
  rowHeight = 0;

  /** Selection state, managed by SelectionService. */
  __selected = false;
  /** Bumped when any cell value changes; cells cache against it. */
  __version = 0;
  /** Position of the leaf in source data order (stable sort tiebreak). */
  __sourceIndex = 0;
  /** Group nodes: composite key path used for expansion persistence. */
  __groupPath: string | null = null;
  /** Tree data: full path. */
  __treePath: string[] | null = null;

  private ctx: GridContext<TData>;

  constructor(ctx: GridContext<TData>, id?: string) {
    this.ctx = ctx;
    this.id = id ?? `au-${++nodeIdSeq}`;
  }

  isSelected(): boolean | undefined {
    return this.ctx.selection ? this.ctx.selection.isSelected(this) : this.__selected;
  }

  setSelected(selected: boolean): void {
    this.ctx.selection?.setSelected([this], selected, 'api');
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded || !this.group) return;
    this.expanded = expanded;
    this.ctx.rowModel.onGroupExpandedChanged(this);
    this.ctx.events.dispatch({
      type: 'rowGroupOpened',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      node: this,
      data: this.data,
      rowIndex: this.rowIndex,
      expanded,
    });
  }

  setDataValue(colId: string, newValue: unknown, source = 'api'): boolean {
    return this.ctx.values.setValue(this, colId, newValue, source);
  }

  setData(data: TData): void {
    this.data = data;
    this.__version++;
    this.ctx.rowModel.onRowDataPatched([this]);
  }

  /** Composite group identity path (group rows) — used to persist expansion. */
  getGroupPath(): string {
    if (this.__groupPath !== null) return this.__groupPath;
    const parts: string[] = [];
    let cur: RowNode<TData> | null = this;
    while (cur && cur.group) {
      parts.push(cur.key ?? '');
      cur = cur.parent;
    }
    this.__groupPath = parts.reverse().join('|');
    return this.__groupPath;
  }
}
