import type { GridContext } from '../context';
import type { Column } from '../columns/column';
import type { RowNode } from '../rows/rowNode';
import { RANGE_BOTTOM, RANGE_HANDLE, RANGE_IN, RANGE_LEFT, RANGE_RIGHT, RANGE_TOP } from '../context';
import { el } from '../utils/dom';
import { toDisplayString } from '../utils/general';
import type { CellRendererComp, CellRendererParams } from '../types/colDef';

const INDENT_PX = 20;

/** One rendered cell: element + caches to skip redundant DOM writes. */
class CellCtrl<TData> {
  readonly elCell: HTMLElement;
  private valueSpan: HTMLElement | null = null;
  private lastSig = '';
  private lastLeft = -1;
  private lastWidth = -1;
  private rendererCleanup: (() => void) | null = null;
  private rendererComp: CellRendererComp<TData> | null = null;
  private lastContentKey = '';

  constructor(private ctx: GridContext<TData>, readonly colId: string) {
    this.elCell = el('div', 'au-cell', { role: 'gridcell', 'data-au-col': colId, tabindex: '-1' });
  }

  update(node: RowNode<TData>, column: Column<TData>, displayIndex: number, colIndex: number): void {
    const e = this.elCell;
    if (column.left !== this.lastLeft) {
      e.style.left = `${column.left}px`;
      this.lastLeft = column.left;
    }
    if (column.actualWidth !== this.lastWidth) {
      e.style.width = `${column.actualWidth}px`;
      this.lastWidth = column.actualWidth;
    }
    e.setAttribute('aria-colindex', String(colIndex + 1));

    const ctx = this.ctx;
    const editing = ctx.editing?.isEditingCell(displayIndex, this.colId) && node.rowPinned == null;
    const focus = ctx.focus?.getFocusedCell();
    const focused =
      !!focus && focus.rowIndex === displayIndex && focus.colId === this.colId && focus.rowPinned === node.rowPinned;
    const rangeFlags = node.rowPinned == null && ctx.range ? ctx.range.getCellFlags(displayIndex, this.colId) : 0;

    // Content signature: skip DOM writes when nothing changed.
    const sig = `${node.id}|${node.__version}|${editing ? 1 : 0}|${focused ? 1 : 0}|${rangeFlags}|${column.cellDataType}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    // classes
    let cls = 'au-cell';
    if (column.cellDataType === 'number' && !column.isAutoGroupCol) cls += ' au-cell-number';
    if (column.getColDef().wrapText) cls += ' au-cell-wrap';
    if (focused && !ctx.options.is('suppressCellFocus')) cls += ' au-cell-focus';
    if (editing) cls += ' au-cell-inline-editing';
    if (rangeFlags & RANGE_IN) cls += ' au-range-selected';
    if (rangeFlags & RANGE_TOP) cls += ' au-range-top';
    if (rangeFlags & RANGE_RIGHT) cls += ' au-range-right';
    if (rangeFlags & RANGE_BOTTOM) cls += ' au-range-bottom';
    if (rangeFlags & RANGE_LEFT) cls += ' au-range-left';
    cls += this.userClasses(node, column, displayIndex);
    e.className = cls;
    this.applyUserStyle(node, column, displayIndex);

    if (editing) {
      if (this.lastContentKey !== '__editor') {
        this.teardownRenderer();
        e.textContent = '';
        this.valueSpan = null;
        this.lastContentKey = '__editor';
      }
      ctx.editing.mountEditorInto(e, displayIndex, this.colId);
      return;
    }

    this.renderContent(node, column, displayIndex);

    if (rangeFlags & RANGE_HANDLE) {
      const handle = el('div', 'au-fill-handle');
      handle.setAttribute('data-au-fill-handle', '1');
      e.appendChild(handle);
    }
  }

  private userClasses(node: RowNode<TData>, column: Column<TData>, rowIndex: number): string {
    const def = column.getColDef();
    if (!def.cellClass && !def.cellClassRules) return '';
    let extra = '';
    const params = this.cellParams(node, column, rowIndex);
    if (def.cellClass) {
      const v = typeof def.cellClass === 'function' ? def.cellClass(params) : def.cellClass;
      if (v) extra += ' ' + (Array.isArray(v) ? v.join(' ') : v);
    }
    if (def.cellClassRules) {
      for (const cls in def.cellClassRules) {
        if (def.cellClassRules[cls](params)) extra += ' ' + cls;
      }
    }
    return extra;
  }

  private applyUserStyle(node: RowNode<TData>, column: Column<TData>, rowIndex: number): void {
    const def = column.getColDef();
    if (!def.cellStyle) return;
    const style =
      typeof def.cellStyle === 'function'
        ? def.cellStyle(this.cellParams(node, column, rowIndex))
        : def.cellStyle;
    if (style) Object.assign(this.elCell.style, style);
  }

  private cellParams(node: RowNode<TData>, column: Column<TData>, rowIndex: number) {
    return {
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      data: node.data,
      node,
      column,
      colDef: column.getColDef(),
      value: this.ctx.values.getValue(node, column),
      rowIndex,
    };
  }

  private renderContent(node: RowNode<TData>, column: Column<TData>, rowIndex: number): void {
    const ctx = this.ctx;
    const e = this.elCell;

    // Selection checkbox column
    if (column.colId === 'au-selection-col') {
      if (this.lastContentKey !== '__checkbox') {
        this.teardownRenderer();
        e.textContent = '';
        const cb = el('input', 'au-checkbox', { type: 'checkbox', 'data-au-row-checkbox': '1' }) as HTMLInputElement;
        e.appendChild(cb);
        this.lastContentKey = '__checkbox';
      }
      const cb = e.querySelector('input') as HTMLInputElement;
      const sel = node.isSelected();
      cb.checked = sel === true;
      cb.indeterminate = sel === undefined;
      return;
    }

    // Auto group column
    if (column.isAutoGroupCol) {
      this.teardownRenderer();
      this.renderGroupCell(node, e);
      this.lastContentKey = '__group';
      return;
    }

    const value = ctx.values.getValue(node, column);
    const formatted = ctx.values.formatValue(node, column, value);
    const def = column.getColDef();
    const renderer = def.cellRenderer;

    if (node.footer && column.isAutoGroupCol) {
      // handled by group cell path
    }

    if (renderer && (!node.group || node.footer || node.data !== undefined || column.secondary || (node.aggData && column.colId in (node.aggData ?? {})))) {
      const contentKey = `__renderer|${node.id}`;
      const params: CellRendererParams<TData> = {
        ...this.cellParams(node, column, rowIndex),
        value,
        valueFormatted: formatted,
        refreshCell: () => ctx.scheduleRender(),
      };
      // Framework component
      if (typeof renderer === 'object' && renderer !== null && '__frameworkComponent' in renderer) {
        if (ctx.frameworkAdapter) {
          if (this.lastContentKey !== contentKey) {
            this.teardownRenderer();
            e.textContent = '';
            this.lastContentKey = contentKey;
          }
          this.rendererCleanup?.();
          this.rendererCleanup = ctx.frameworkAdapter.render(
            (renderer as { __frameworkComponent: unknown }).__frameworkComponent,
            params as unknown as Record<string, unknown>,
            e,
          );
          return;
        }
        // no adapter: fall through to text
      } else if (typeof renderer === 'function') {
        const isClass = !!(renderer as { prototype?: { init?: unknown } }).prototype?.init;
        if (isClass) {
          if (this.rendererComp && this.lastContentKey === contentKey && this.rendererComp.refresh) {
            if (this.rendererComp.refresh(params)) return;
          }
          this.teardownRenderer();
          e.textContent = '';
          const comp = new (renderer as new () => CellRendererComp<TData>)();
          this.rendererComp = comp;
          e.appendChild(comp.init(params));
          this.lastContentKey = contentKey;
          return;
        }
        this.teardownRenderer();
        const out = (renderer as (p: CellRendererParams<TData>) => string | HTMLElement | null)(params);
        if (out instanceof HTMLElement) {
          e.textContent = '';
          e.appendChild(out);
        } else {
          this.setTextContent(out ?? '');
        }
        this.lastContentKey = contentKey;
        return;
      }
    }

    this.teardownRenderer();
    // group rows show agg values in value columns; blank elsewhere
    if (node.group && !column.secondary && node.data === undefined && !(node.aggData && column.colId in node.aggData)) {
      this.setTextContent('');
      return;
    }
    this.setTextContent(formatted);
  }

  private setTextContent(text: string): void {
    if (this.lastContentKey !== '__text' || !this.valueSpan) {
      this.elCell.textContent = '';
      this.valueSpan = el('span', 'au-cell-value');
      this.elCell.appendChild(this.valueSpan);
      this.lastContentKey = '__text';
    }
    this.valueSpan.textContent = text;
  }

  private renderGroupCell(node: RowNode<TData>, container: HTMLElement): void {
    container.textContent = '';
    const wrap = el('div', 'au-group-cell');
    wrap.style.paddingLeft = `${Math.max(0, node.level) * INDENT_PX}px`;
    const expandable = node.group && !node.footer && (node.childrenAfterFilter?.length ?? 0) > 0;
    const chevron = el('span', 'au-group-expand' + (node.expanded ? ' au-expanded' : '') + (expandable ? '' : ' au-hidden'));
    chevron.setAttribute('data-au-expand', '1');
    chevron.textContent = '▶';
    chevron.style.fontSize = '9px';
    wrap.appendChild(chevron);
    const key = el('span', 'au-group-key');
    if (node.footer) {
      key.textContent = node.level === -1 ? 'Grand Total' : `Total ${node.key ?? ''}`;
    } else if (node.group) {
      key.textContent = node.key ?? '';
    } else {
      // leaf in tree data shown under group column
      key.textContent = node.key ?? toDisplayString(node.data ? this.ctx.values.getFormattedValue(node, this.groupLeafColumn()) : '');
    }
    wrap.appendChild(key);
    if (node.group && !node.footer && node.allChildrenCount > 0) {
      const count = el('span', 'au-group-count');
      count.textContent = `(${node.allChildrenCount})`;
      wrap.appendChild(count);
    }
    container.appendChild(wrap);
  }

  private groupLeafColumnCache: Column<TData> | null = null;
  private groupLeafColumn(): Column<TData> {
    if (!this.groupLeafColumnCache) {
      this.groupLeafColumnCache =
        this.ctx.columnModel.getDisplayedColumns().find((c) => !c.isAutoGroupCol && c.colId !== 'au-selection-col') ??
        this.ctx.columnModel.getPrimaryColumns()[0];
    }
    return this.groupLeafColumnCache;
  }

  teardownRenderer(): void {
    if (this.rendererCleanup) {
      this.rendererCleanup();
      this.rendererCleanup = null;
    }
    if (this.rendererComp) {
      this.rendererComp.destroy?.();
      this.rendererComp = null;
    }
  }

  /** Force full re-render next update. */
  invalidate(): void {
    this.lastSig = '';
    this.lastContentKey = '';
    this.lastLeft = -1;
    this.lastWidth = -1;
  }

  destroy(): void {
    this.teardownRenderer();
    this.elCell.remove();
  }
}

/** A region-slice of one displayed row (left/center/right share a RowCtrl). */
class RegionRow<TData> {
  readonly elRow: HTMLElement;
  private cells = new Map<string, CellCtrl<TData>>();

  constructor(private ctx: GridContext<TData>, container: HTMLElement) {
    this.elRow = el('div', 'au-row', { role: 'row' });
    container.appendChild(this.elRow);
  }

  update(
    node: RowNode<TData>,
    displayIndex: number,
    columns: Column<TData>[],
    regionWidth: number,
    allColIndex: Map<string, number>,
  ): void {
    const e = this.elRow;
    e.style.transform = `translateY(${node.rowTop}px)`;
    e.style.height = `${node.rowHeight}px`;
    e.style.width = `${regionWidth}px`;

    // reconcile cells
    const wanted = new Set<string>();
    for (const col of columns) wanted.add(col.colId);
    for (const [colId, cell] of this.cells) {
      if (!wanted.has(colId)) {
        cell.destroy();
        this.cells.delete(colId);
      }
    }
    for (const col of columns) {
      let cell = this.cells.get(col.colId);
      if (!cell) {
        cell = new CellCtrl(this.ctx, col.colId);
        this.cells.set(col.colId, cell);
        this.elRow.appendChild(cell.elCell);
      }
      cell.update(node, col, displayIndex, allColIndex.get(col.colId) ?? 0);
    }
  }

  setRowMeta(cls: string, ariaRowIndex: number, rowId: string, displayIndex: number): void {
    this.elRow.className = cls;
    this.elRow.setAttribute('aria-rowindex', String(ariaRowIndex));
    this.elRow.setAttribute('data-au-row-id', rowId);
    this.elRow.setAttribute('data-au-row-index', String(displayIndex));
  }

  invalidateCells(colIds?: Set<string>): void {
    for (const [colId, cell] of this.cells) {
      if (!colIds || colIds.has(colId)) cell.invalidate();
    }
  }

  getCellElement(colId: string): HTMLElement | null {
    return this.cells.get(colId)?.elCell ?? null;
  }

  setVisible(visible: boolean): void {
    this.elRow.style.display = visible ? '' : 'none';
  }

  destroy(): void {
    for (const cell of this.cells.values()) cell.destroy();
    this.cells.clear();
    this.elRow.remove();
  }
}

/**
 * Manages the pool of row elements for one horizontal band of the grid
 * (main body, pinned-top, pinned-bottom) across the three column regions.
 */
export class RowBand<TData> {
  private rows = new Map<string, { left: RegionRow<TData>; center: RegionRow<TData>; right: RegionRow<TData>; node: RowNode<TData> }>();

  constructor(
    private ctx: GridContext<TData>,
    private containers: { left: HTMLElement; center: HTMLElement; right: HTMLElement },
    private pinned: 'top' | 'bottom' | null,
  ) {}

  /**
   * Render the given nodes (already the visible window). displayIndexOffset
   * maps window position → display row index.
   */
  render(
    nodes: RowNode<TData>[],
    leftCols: Column<TData>[],
    centerCols: Column<TData>[],
    rightCols: Column<TData>[],
    regionWidths: { left: number; center: number; right: number },
    ariaOffset: number,
  ): void {
    const wanted = new Map<string, RowNode<TData>>();
    for (const n of nodes) wanted.set(n.id, n);

    // Destroy rows no longer visible (pool trimming: destroy beyond 2x window).
    for (const [id, row] of this.rows) {
      if (!wanted.has(id)) {
        row.left.destroy();
        row.center.destroy();
        row.right.destroy();
        this.rows.delete(id);
      }
    }

    const allColIndex = new Map<string, number>();
    let ci = 0;
    for (const c of [...leftCols, ...centerCols, ...rightCols]) allColIndex.set(c.colId, ci++);
    // aria col index should include virtualized-out columns; use displayed set
    const displayed = this.ctx.columnModel.getDisplayedColumns();
    allColIndex.clear();
    displayed.forEach((c, i) => allColIndex.set(c.colId, i));

    for (const node of nodes) {
      let row = this.rows.get(node.id);
      if (!row) {
        row = {
          left: new RegionRow(this.ctx, this.containers.left),
          center: new RegionRow(this.ctx, this.containers.center),
          right: new RegionRow(this.ctx, this.containers.right),
          node,
        };
        this.rows.set(node.id, row);
      }
      row.node = node;
      const displayIndex = node.rowIndex;
      const cls = this.rowClass(node, displayIndex);
      const ariaIndex = ariaOffset + displayIndex + 1;
      row.left.setRowMeta(cls, ariaIndex, node.id, displayIndex);
      row.center.setRowMeta(cls, ariaIndex, node.id, displayIndex);
      row.right.setRowMeta(cls, ariaIndex, node.id, displayIndex);
      row.left.update(node, displayIndex, leftCols, regionWidths.left, allColIndex);
      row.center.update(node, displayIndex, centerCols, regionWidths.center, allColIndex);
      row.right.update(node, displayIndex, rightCols, regionWidths.right, allColIndex);
    }
  }

  private rowClass(node: RowNode<TData>, displayIndex: number): string {
    let cls = 'au-row';
    cls += displayIndex % 2 === 1 ? ' au-row-odd' : ' au-row-even';
    if (node.group && !node.footer) cls += ' au-row-group';
    if (node.footer) cls += ' au-row-footer';
    if (node.isSelected() === true) cls += ' au-row-selected';
    if (this.pinned) cls += ` au-row-pinned-${this.pinned}`;
    const ctx = this.ctx;
    const rowClass = ctx.options.get('rowClass');
    if (rowClass) cls += ' ' + (Array.isArray(rowClass) ? rowClass.join(' ') : rowClass);
    const getRowClass = ctx.options.get('getRowClass');
    if (getRowClass) {
      const v = getRowClass({ data: node.data, node, rowIndex: displayIndex });
      if (v) cls += ' ' + (Array.isArray(v) ? v.join(' ') : v);
    }
    const rules = ctx.options.get('rowClassRules');
    if (rules) {
      for (const c in rules) {
        if (rules[c]({ data: node.data, node, rowIndex: displayIndex })) cls += ' ' + c;
      }
    }
    return cls;
  }

  getCellElement(rowId: string, colId: string): HTMLElement | null {
    const row = this.rows.get(rowId);
    if (!row) return null;
    return (
      row.left.getCellElement(colId) ?? row.center.getCellElement(colId) ?? row.right.getCellElement(colId)
    );
  }

  getRowElements(rowId: string): HTMLElement[] {
    const row = this.rows.get(rowId);
    if (!row) return [];
    return [row.left.elRow, row.center.elRow, row.right.elRow];
  }

  invalidateAll(colIds?: Set<string>): void {
    for (const row of this.rows.values()) {
      row.left.invalidateCells(colIds);
      row.center.invalidateCells(colIds);
      row.right.invalidateCells(colIds);
    }
  }

  invalidateRows(rowIds: Set<string>, colIds?: Set<string>): void {
    for (const [id, row] of this.rows) {
      if (rowIds.has(id)) {
        row.left.invalidateCells(colIds);
        row.center.invalidateCells(colIds);
        row.right.invalidateCells(colIds);
      }
    }
  }

  clear(): void {
    for (const row of this.rows.values()) {
      row.left.destroy();
      row.center.destroy();
      row.right.destroy();
    }
    this.rows.clear();
  }

  destroy(): void {
    this.clear();
  }
}
