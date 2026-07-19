import type { GridContext, ISelectionService } from '../context';
import type { RowNode } from '../rows/rowNode';
import type { IRowNode } from '../types/rowNode';

interface NormalizedRowSelection<TData> {
  mode: 'singleRow' | 'multiRow';
  enableClickSelection: boolean;
  enableDeselection: boolean;
  groupSelects: 'self' | 'descendants';
  isRowSelectable: ((node: IRowNode<TData>) => boolean) | null;
}

/**
 * Row selection: state (Set of selected nodes + node.__selected mirror), click
 * semantics (single/multi, ctrl toggle, shift range from anchor), header
 * checkbox, group-selects-descendants, and pruning after model updates.
 */
export class SelectionService<TData = unknown> implements ISelectionService<TData> {
  private readonly ctx: GridContext<TData>;
  private readonly selected = new Set<RowNode<TData>>();
  /** Last non-shift clicked node; base of shift+click ranges. */
  private anchor: RowNode<TData> | null = null;

  constructor(ctx: GridContext<TData>) {
    this.ctx = ctx;
  }

  /** Normalize the rowSelection grid option; null when selection is off. */
  private config(): NormalizedRowSelection<TData> | null {
    const opt = this.ctx.options.get('rowSelection');
    if (!opt) return null;
    if (typeof opt === 'string') {
      return {
        mode: opt,
        enableClickSelection: true,
        enableDeselection: false,
        groupSelects: 'self',
        isRowSelectable: null,
      };
    }
    return {
      mode: opt.mode,
      enableClickSelection: opt.enableClickSelection !== false,
      enableDeselection: opt.enableDeselection === true,
      groupSelects: opt.groupSelects ?? 'self',
      isRowSelectable: opt.isRowSelectable ?? null,
    };
  }

  private collectFilteredLeaves(node: RowNode<TData>, out: RowNode<TData>[]): void {
    for (const ch of node.childrenAfterFilter ?? []) {
      if (ch.group) this.collectFilteredLeaves(ch, out);
      else out.push(ch);
    }
  }

  isSelected(node: RowNode<TData>): boolean | undefined {
    if (node.group && this.config()?.groupSelects === 'descendants') {
      const leaves: RowNode<TData>[] = [];
      this.collectFilteredLeaves(node, leaves);
      if (leaves.length === 0) return false;
      let count = 0;
      for (const leaf of leaves) if (this.selected.has(leaf)) count++;
      if (count === 0) return false;
      return count === leaves.length ? true : undefined;
    }
    return this.selected.has(node);
  }

  setSelected(nodes: RowNode<TData>[], value: boolean, source = 'api', clearOthers = false): void {
    const cfg = this.config();
    if (!cfg) return;

    // Expand groups to their filtered leaf descendants (store leaves, not the group).
    let targets: RowNode<TData>[] = [];
    for (const node of nodes) {
      if (node.group && cfg.groupSelects === 'descendants') this.collectFilteredLeaves(node, targets);
      else targets.push(node);
    }
    if (value && cfg.isRowSelectable) {
      const selectable = cfg.isRowSelectable;
      targets = targets.filter((n) => selectable(n));
    }
    if (value && cfg.mode === 'singleRow') {
      targets = targets.slice(0, 1);
      clearOthers = true;
    }

    const changed: RowNode<TData>[] = [];
    if (value && clearOthers) {
      const keep = new Set(targets);
      for (const node of [...this.selected]) {
        if (!keep.has(node)) {
          this.selected.delete(node);
          node.__selected = false;
          changed.push(node);
        }
      }
    }
    for (const node of targets) {
      if (value && !this.selected.has(node)) {
        this.selected.add(node);
        node.__selected = true;
        changed.push(node);
      } else if (!value && this.selected.has(node)) {
        this.selected.delete(node);
        node.__selected = false;
        changed.push(node);
      }
    }
    if (changed.length === 0) return;
    this.emitChanges(changed, source);
  }

  handleRowClick(node: RowNode<TData>, e: MouseEvent): void {
    const cfg = this.config();
    if (!cfg || !cfg.enableClickSelection) return;

    if (cfg.mode === 'singleRow') {
      if (cfg.enableDeselection && this.isSelected(node) === true) {
        this.setSelected([node], false, 'rowClicked');
      } else {
        this.setSelected([node], true, 'rowClicked', true);
      }
      return;
    }

    // multiRow
    if (e.shiftKey && this.anchor && this.anchor.rowIndex >= 0 && node.rowIndex >= 0) {
      const a = this.anchor.rowIndex;
      const b = node.rowIndex;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const range: RowNode<TData>[] = [];
      for (let i = lo; i <= hi; i++) {
        const row = this.ctx.rowModel.getRow(i);
        if (row) range.push(row);
      }
      this.setSelected(range, true, 'rowClicked');
      return;
    }

    this.anchor = node;
    if (e.ctrlKey || e.metaKey) {
      this.setSelected([node], this.isSelected(node) !== true, 'rowClicked');
      return;
    }
    if (cfg.enableDeselection && this.isSelected(node) === true) {
      this.setSelected([node], false, 'rowClicked');
    } else {
      this.setSelected([node], true, 'rowClicked', true);
    }
  }

  handleHeaderCheckbox(checked: boolean): void {
    if (!this.config()) return;
    if (checked) this.selectAll(true);
    else this.deselectAll('header');
  }

  getSelectedNodes(): RowNode<TData>[] {
    return [...this.selected];
  }

  selectAll(justFiltered = false): void {
    const cfg = this.config();
    if (!cfg || cfg.mode !== 'multiRow') return;
    const nodes: RowNode<TData>[] = [];
    if (justFiltered) {
      this.ctx.rowModel.forEachNodeAfterFilter?.((n) => {
        if (!n.group) nodes.push(n);
      });
    } else {
      this.ctx.rowModel.forEachLeafNode?.((n) => nodes.push(n));
    }
    this.setSelected(nodes, true, 'selectAll');
  }

  deselectAll(source = 'api'): void {
    if (this.selected.size === 0) return;
    const changed = [...this.selected];
    for (const node of changed) node.__selected = false;
    this.selected.clear();
    this.emitChanges(changed, source);
  }

  getHeaderState(): boolean | 'indeterminate' {
    let total = 0;
    let count = 0;
    this.ctx.rowModel.forEachNodeAfterFilter?.((n) => {
      if (!n.group) {
        total++;
        if (this.selected.has(n)) count++;
      }
    });
    if (total === 0 || count === 0) return false;
    return count === total ? true : 'indeterminate';
  }

  refresh(): void {
    let dropped = false;
    for (const node of [...this.selected]) {
      if (this.ctx.rowModel.getRowNode(node.id) !== node) {
        this.selected.delete(node);
        node.__selected = false;
        dropped = true;
      }
    }
    if (this.anchor && this.ctx.rowModel.getRowNode(this.anchor.id) !== this.anchor) {
      this.anchor = null;
    }
    if (dropped) {
      this.ctx.events.dispatch({
        type: 'selectionChanged',
        api: this.ctx.api,
        context: this.ctx.options.get('context'),
        selectedNodes: this.getSelectedNodes(),
        source: 'modelUpdate',
      });
      this.ctx.scheduleRender();
    }
  }

  destroy(): void {
    for (const node of this.selected) node.__selected = false;
    this.selected.clear();
    this.anchor = null;
  }

  private emitChanges(changed: RowNode<TData>[], source: string): void {
    for (const node of changed) {
      this.ctx.events.dispatch({
        type: 'rowSelected',
        api: this.ctx.api,
        context: this.ctx.options.get('context'),
        node,
        data: node.data,
        rowIndex: node.rowIndex,
        selected: node.__selected,
      });
    }
    this.ctx.events.dispatch({
      type: 'selectionChanged',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      selectedNodes: this.getSelectedNodes(),
      source,
    });
    this.ctx.scheduleRender();
  }
}
