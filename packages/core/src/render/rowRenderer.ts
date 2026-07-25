import type { GridContext } from '../context.js';
import type { Column } from '../columns/column.js';
import { isNodeExpandable, type RowNode } from '../rows/rowNode.js';
import { SparklineCell } from '../features/sparkline/sparklineRenderer.js';

/** Cell padding allowance so the mark never touches the cell border. */
const SPARKLINE_INSET = 8;
import { RANGE_BOTTOM, RANGE_HANDLE, RANGE_IN, RANGE_LEFT, RANGE_RIGHT, RANGE_TOP } from '../context.js';
import { el } from '../utils/dom.js';
import { toDisplayString } from '../utils/general.js';
import type { CellRendererComp, CellRendererParams } from '../types/colDef.js';

const INDENT_PX = 20;

/** One rendered cell: element + caches to skip redundant DOM writes. */
class CellCtrl<TData> {
  readonly elCell: HTMLElement;
  private valueSpan: HTMLElement | null = null;
  private sparkline: SparklineCell | null = null;
  // Change detection uses plain field comparisons (no per-frame string allocs).
  private dirty = true;
  private lastNode: RowNode<TData> | null = null;
  private lastVersion = -1;
  private lastEditing = false;
  private lastFocused = false;
  private lastRangeFlags = -1;
  private lastFindFlags = -1;
  private lastSelected: boolean | undefined = undefined;
  private lastColIndex = -1;
  private lastLeft = -1;
  private lastWidth = -1;
  private rendererCleanup: (() => void) | null = null;
  private rendererComp: CellRendererComp<TData> | null = null;
  /**
   * Framework renderers mount into a dedicated wrapper element. When content
   * changes away we remove the WRAPPER node (never wipe it via textContent),
   * so a framework's asynchronous unmount still finds its container intact.
   */
  private fwWrapper: HTMLElement | null = null;
  private handleEl: HTMLElement | null = null;
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
    if (colIndex !== this.lastColIndex) {
      e.setAttribute('aria-colindex', String(colIndex + 1));
      this.lastColIndex = colIndex;
    }

    const ctx = this.ctx;
    const editing = !!ctx.editing?.isEditingCell(displayIndex, this.colId) && node.rowPinned == null;
    const focus = ctx.focus?.getFocusedCell();
    const focused =
      !!focus && focus.rowIndex === displayIndex && focus.colId === this.colId && focus.rowPinned === node.rowPinned;
    const rangeFlags = node.rowPinned == null && ctx.range ? ctx.range.getCellFlags(displayIndex, this.colId) : 0;
    const findFlags =
      node.rowPinned == null && ctx.find?.isActive() ? ctx.find.getCellState(displayIndex, this.colId) : 0;
    // Checkbox cells must track selection changes even without a version bump.
    const selected = this.colId === 'au-selection-col' ? node.isSelected() : undefined;

    // Skip all DOM writes when nothing observable changed.
    if (
      !this.dirty &&
      node === this.lastNode &&
      node.__version === this.lastVersion &&
      editing === this.lastEditing &&
      focused === this.lastFocused &&
      rangeFlags === this.lastRangeFlags &&
      findFlags === this.lastFindFlags &&
      selected === this.lastSelected
    ) {
      return;
    }
    this.dirty = false;
    this.lastNode = node;
    this.lastVersion = node.__version;
    this.lastEditing = editing;
    this.lastFocused = focused;
    this.lastRangeFlags = rangeFlags;
    this.lastFindFlags = findFlags;
    this.lastSelected = selected;

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
    if (findFlags === 1) cls += ' au-find-match';
    else if (findFlags === 2) cls += ' au-find-match au-find-active';
    if (node.__loading) cls += ' au-cell-loading';
    cls += this.userClasses(node, column, displayIndex);
    e.className = cls;
    this.applyUserStyle(node, column, displayIndex);

    if (editing) {
      if (this.lastContentKey !== '__editor') {
        this.clearContent();
        this.lastContentKey = '__editor';
      }
      ctx.editing.mountEditorInto(e, displayIndex, this.colId);
      return;
    }

    this.renderContent(node, column, displayIndex);

    if (rangeFlags & RANGE_HANDLE) {
      if (!this.handleEl || this.handleEl.parentElement !== e) {
        const handle = el('div', 'au-fill-handle');
        handle.setAttribute('data-au-fill-handle', '1');
        e.appendChild(handle);
        this.handleEl = handle;
      }
    } else if (this.handleEl) {
      this.handleEl.remove();
      this.handleEl = null;
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

  /**
   * Reset the cell to empty. The framework wrapper (if any) is detached as a
   * whole node — never wiped with textContent — so React's deferred unmount
   * finds the container element it rendered into still intact.
   */
  private clearContent(): void {
    if (this.fwWrapper) {
      this.fwWrapper.remove();
      this.fwWrapper = null;
    }
    if (this.rendererCleanup) {
      this.rendererCleanup();
      this.rendererCleanup = null;
    }
    if (this.rendererComp) {
      this.rendererComp.destroy?.();
      this.rendererComp = null;
    }
    this.elCell.textContent = '';
    this.valueSpan = null;
    this.sparkline = null;
    this.handleEl = null;
  }

  private renderContent(node: RowNode<TData>, column: Column<TData>, rowIndex: number): void {
    const ctx = this.ctx;
    const e = this.elCell;

    // Row still being fetched (infinite/server-side block in flight): render
    // a skeleton bar so loading reads as "working", not "broken" (AUG-23).
    if (node.__loading) {
      if (this.lastContentKey !== '__skeleton') {
        this.clearContent();
        const bar = el('span', 'au-skeleton');
        bar.setAttribute('aria-hidden', 'true');
        e.appendChild(bar);
        this.lastContentKey = '__skeleton';
      }
      return;
    }

    // Selection checkbox column
    if (column.colId === 'au-selection-col') {
      if (this.lastContentKey !== '__checkbox') {
        this.clearContent();
        const cb = el('input', 'au-checkbox', {
          type: 'checkbox',
          'data-au-row-checkbox': '1',
          tabindex: '-1',
          'aria-label': 'Select row',
        }) as HTMLInputElement;
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
      this.renderGroupCell(node, column, e);
      this.lastContentKey = '__group';
      return;
    }

    const value = ctx.values.getValue(node, column);
    const formatted = ctx.values.formatValue(node, column, value);
    const def = column.getColDef();

    // Sparkline columns: an SVG mark drawn from the cell's series. Sized from
    // known geometry (never a layout read) and skipped entirely on group rows
    // that carry no series of their own.
    if (def.sparkline && (!node.group || node.data !== undefined || node.aggData)) {
      if (this.lastContentKey !== '__sparkline' || !this.sparkline) {
        this.clearContent();
        this.sparkline = new SparklineCell();
        e.appendChild(this.sparkline.root);
        this.lastContentKey = '__sparkline';
      }
      const shared =
        def.sparkline.domain === 'shared'
          ? (ctx.renderer.getSparklineDomain?.(column.colId) ?? null)
          : null;
      this.sparkline.update(
        value,
        def.sparkline,
        column.actualWidth - SPARKLINE_INSET,
        node.rowHeight - SPARKLINE_INSET,
        shared,
      );
      return;
    }

    const renderer = def.cellRenderer;

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
          // Every mount gets a FRESH dedicated wrapper: the previous wrapper is
          // detached intact (framework unmount still finds its container) and a
          // new container guarantees the adapter treats this as a new render —
          // the same-container/same-key no-op that blanked cells is impossible.
          this.clearContent();
          const wrap = el('span', 'au-fw-mount');
          e.appendChild(wrap);
          this.fwWrapper = wrap;
          this.rendererCleanup = ctx.frameworkAdapter.render(
            (renderer as { __frameworkComponent: unknown }).__frameworkComponent,
            params as unknown as Record<string, unknown>,
            wrap,
          );
          this.lastContentKey = contentKey;
          return;
        }
        // no adapter: fall through to text
      } else if (typeof renderer === 'function') {
        const isClass = !!(renderer as { prototype?: { init?: unknown } }).prototype?.init;
        if (isClass) {
          if (this.rendererComp && this.lastContentKey === contentKey && this.rendererComp.refresh) {
            if (this.rendererComp.refresh(params)) return;
          }
          this.clearContent();
          const comp = new (renderer as new () => CellRendererComp<TData>)();
          this.rendererComp = comp;
          e.appendChild(comp.init(params));
          this.lastContentKey = contentKey;
          return;
        }
        this.clearContent();
        const out = (renderer as (p: CellRendererParams<TData>) => string | HTMLElement | null)(params);
        if (out instanceof HTMLElement) {
          e.appendChild(out);
        } else {
          this.valueSpan = el('span', 'au-cell-value');
          this.valueSpan.textContent = out ?? '';
          e.appendChild(this.valueSpan);
          this.lastContentKey = '__text';
          return;
        }
        this.lastContentKey = contentKey;
        return;
      }
    }

    // group rows show agg values in value columns; blank elsewhere
    if (node.group && !column.secondary && node.data === undefined && !(node.aggData && column.colId in node.aggData)) {
      this.setTextContent('');
      return;
    }
    this.setTextContent(formatted);
  }

  private setTextContent(text: string): void {
    if (this.lastContentKey !== '__text' || !this.valueSpan) {
      this.clearContent();
      this.valueSpan = el('span', 'au-cell-value');
      this.elCell.appendChild(this.valueSpan);
      this.lastContentKey = '__text';
    }
    this.valueSpan.textContent = text;
  }

  private renderGroupCell(node: RowNode<TData>, column: Column<TData>, container: HTMLElement): void {
    this.clearContent();
    // 'multipleColumns': each auto group column only shows content for nodes
    // at its own group level; every other row is blank in that column. The
    // grand-total footer (level -1) surfaces in the level-0 column.
    if (this.ctx.options.get('groupDisplayType') === 'multipleColumns') {
      const colLevel = this.ctx.columnModel.getAutoGroupLevel(column.colId);
      if (colLevel != null) {
        if (!node.group && !node.footer) return; // leaves stay blank
        const nodeLevel = node.footer ? Math.max(0, node.level) : node.level;
        if (nodeLevel !== colLevel) return;
      }
    }
    const wrap = el('div', 'au-group-cell');
    wrap.style.paddingLeft = `${Math.max(0, node.level) * INDENT_PX}px`;
    const expandable = isNodeExpandable(this.ctx, node);
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
    this.dirty = true;
    this.lastContentKey = '';
    this.lastLeft = -1;
    this.lastWidth = -1;
    this.lastColIndex = -1;
  }

  destroy(): void {
    // Detach the framework wrapper as a node first so any deferred framework
    // unmount still finds its container intact.
    if (this.fwWrapper) {
      this.fwWrapper.remove();
      this.fwWrapper = null;
    }
    this.teardownRenderer();
    this.elCell.remove();
  }
}

/** A region-slice of one displayed row (left/center/right share a RowCtrl). */
class RegionRow<TData> {
  readonly elRow: HTMLElement;
  private cells = new Map<string, CellCtrl<TData>>();
  // Per-frame write caches: skip DOM writes when the value is unchanged.
  private lastRowTop: number | null = null;
  private lastHeight = -1;
  private lastWidth = -1;
  private lastClassName = '';
  private lastAriaIndex = -1;
  private lastRowId: string | null = null;
  private lastDisplayIndex: number | null = null;
  private lastAriaSelected: string | null = null;
  private lastAriaExpanded: string | null = null;
  private lastStyleRef: Readonly<Partial<CSSStyleDeclaration>> | null = null;
  private appliedStyleKeys: string[] | null = null;
  private visible = true;

  /**
   * ARIA: only the CENTER slice is the canonical `role="row"` (carrying
   * aria-rowindex / aria-selected / aria-expanded). The pinned left/right
   * slices are `role="presentation"` duplicates of the same logical row, but
   * their CELLS keep `role="gridcell"` + aria-colindex so assistive tech
   * reparents them into the grid correctly.
   */
  private detached = false;

  constructor(private ctx: GridContext<TData>, private container: HTMLElement, private canonical: boolean) {
    this.elRow = el('div', 'au-row', { role: canonical ? 'row' : 'presentation' });
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
    if (node.rowTop !== this.lastRowTop) {
      e.style.transform = `translateY(${node.rowTop}px)`;
      this.lastRowTop = node.rowTop;
    }
    if (node.rowHeight !== this.lastHeight) {
      e.style.height = `${node.rowHeight}px`;
      this.lastHeight = node.rowHeight;
    }
    if (regionWidth !== this.lastWidth) {
      e.style.width = `${regionWidth}px`;
      this.lastWidth = regionWidth;
    }

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
    if (!this.visible) {
      this.elRow.style.display = '';
      this.visible = true;
    }
    if (cls !== this.lastClassName) {
      this.elRow.className = cls;
      this.lastClassName = cls;
    }
    if (this.canonical && ariaRowIndex !== this.lastAriaIndex) {
      this.elRow.setAttribute('aria-rowindex', String(ariaRowIndex));
      this.lastAriaIndex = ariaRowIndex;
    }
    if (rowId !== this.lastRowId) {
      this.elRow.setAttribute('data-au-row-id', rowId);
      this.lastRowId = rowId;
    }
    if (displayIndex !== this.lastDisplayIndex) {
      this.elRow.setAttribute('data-au-row-index', String(displayIndex));
      this.lastDisplayIndex = displayIndex;
    }
  }

  /** aria-selected / aria-expanded on the canonical row slice; null removes. */
  setAriaState(selected: string | null, expanded: string | null): void {
    if (!this.canonical) return;
    if (selected !== this.lastAriaSelected) {
      if (selected == null) this.elRow.removeAttribute('aria-selected');
      else this.elRow.setAttribute('aria-selected', selected);
      this.lastAriaSelected = selected;
    }
    if (expanded !== this.lastAriaExpanded) {
      if (expanded == null) this.elRow.removeAttribute('aria-expanded');
      else this.elRow.setAttribute('aria-expanded', expanded);
      this.lastAriaExpanded = expanded;
    }
  }

  /**
   * Apply the user's getRowStyle result. Called BEFORE update() each frame:
   * previously applied keys are cleared and positioning caches reset so the
   * positioning pass re-asserts transform/height/width (positioning always
   * wins for those; custom style wins for everything else, e.g. background).
   * The style object reference is cached by the band, so identical frames
   * short-circuit here.
   */
  applyRowStyle(style: Readonly<Partial<CSSStyleDeclaration>> | null): void {
    if (style === this.lastStyleRef) return;
    this.lastStyleRef = style;
    const st = this.elRow.style;
    if (this.appliedStyleKeys) {
      for (const k of this.appliedStyleKeys) {
        (st as unknown as Record<string, string>)[k] = '';
      }
      this.appliedStyleKeys = null;
      // Custom props may have shadowed positioning; force a positioning rewrite.
      this.lastRowTop = null;
      this.lastHeight = -1;
      this.lastWidth = -1;
    }
    if (style) {
      Object.assign(st, style);
      this.appliedStyleKeys = Object.keys(style);
    }
  }

  /**
   * Prepare a pooled (recycled) row for a new node: full cell invalidation and
   * clearing of leaked per-row custom styles. Write caches for class/attrs are
   * kept — they mirror the actual DOM, so identical writes stay skippable.
   * Rows exiting and re-entering within the same render pass (the steady
   * scrolling case) were never parked, so this is pure cache work.
   */
  rebind(): void {
    if (this.detached) {
      this.container.appendChild(this.elRow);
      this.detached = false;
    }
    if (!this.visible) {
      this.elRow.style.display = '';
      this.visible = true;
    }
    for (const cell of this.cells.values()) cell.invalidate();
  }

  /**
   * Detach an unused pooled row from the DOM (keeping the element and its
   * cell tree for later rebind). Only leftover free-list rows are parked —
   * never rows recycled within a render pass.
   */
  park(): void {
    this.elRow.remove();
    this.detached = true;
    this.elRow.removeAttribute('data-au-row-id');
    this.elRow.removeAttribute('data-au-row-index');
    this.lastRowId = null;
    this.lastDisplayIndex = null;
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
    this.visible = visible;
  }

  containsActiveElement(): boolean {
    return typeof document !== 'undefined' && document.activeElement != null && this.elRow.contains(document.activeElement);
  }

  destroy(): void {
    for (const cell of this.cells.values()) cell.destroy();
    this.cells.clear();
    this.elRow.remove();
  }
}

interface PooledRow<TData> {
  left: RegionRow<TData>;
  center: RegionRow<TData>;
  right: RegionRow<TData>;
  node: RowNode<TData>;
  parked: boolean;
  // rowClass/getRowStyle cache: recomputed only when this signature changes.
  clsNode: RowNode<TData> | null;
  clsVersion: number;
  clsIndex: number;
  clsSelected: boolean | undefined;
  cls: string;
  style: Partial<CSSStyleDeclaration> | null;
}

/**
 * Manages the pool of row elements for one horizontal band of the grid
 * (main body, pinned-top, pinned-bottom) across the three column regions.
 *
 * Recycling: rows leaving the visible window are pushed onto a free list with
 * their DOM intact; entering rows claim a free entry (rebind = full cell
 * invalidate) before any new allocation. The free list is trimmed beyond
 * ~1.5x the window size; leftover free rows are parked (hidden, identity
 * attributes removed) so they never surface stale content.
 */
export class RowBand<TData> {
  private rows = new Map<string, PooledRow<TData>>();
  private free: PooledRow<TData>[] = [];

  constructor(
    private ctx: GridContext<TData>,
    private containers: { left: HTMLElement; center: HTMLElement; right: HTMLElement },
    private pinned: 'top' | 'bottom' | null,
  ) {}

  /**
   * Render the given nodes (already the visible window). `ariaOffset` maps a
   * display row index to its 1-based aria-rowindex (header rows + preceding
   * bands included). `allColIndex` is the shared displayed-column index map
   * built once per render pass by GridRenderer.
   */
  render(
    nodes: RowNode<TData>[],
    leftCols: Column<TData>[],
    centerCols: Column<TData>[],
    rightCols: Column<TData>[],
    regionWidths: { left: number; center: number; right: number },
    ariaOffset: number,
    allColIndex: Map<string, number>,
  ): void {
    const wanted = new Set<string>();
    for (const n of nodes) wanted.add(n.id);

    // Rows leaving the window go to the free list (DOM kept for recycling).
    for (const [id, row] of this.rows) {
      if (!wanted.has(id)) {
        this.releaseFocusIfInside(row);
        this.rows.delete(id);
        this.free.push(row);
      }
    }

    const ctx = this.ctx;
    const getRowStyle = ctx.options.get('getRowStyle');
    const selectionActive = !!ctx.options.get('rowSelection');

    for (const node of nodes) {
      let row = this.rows.get(node.id);
      if (!row) {
        const reuse = this.free.pop();
        if (reuse) {
          row = reuse;
          row.parked = false;
          row.left.rebind();
          row.center.rebind();
          row.right.rebind();
          row.clsNode = null; // force class/style recompute for the new node
        } else {
          row = {
            left: new RegionRow(ctx, this.containers.left, false),
            center: new RegionRow(ctx, this.containers.center, true),
            right: new RegionRow(ctx, this.containers.right, false),
            node,
            parked: false,
            clsNode: null,
            clsVersion: -1,
            clsIndex: -1,
            clsSelected: undefined,
            cls: '',
            style: null,
          };
        }
        this.rows.set(node.id, row);
      }
      row.node = node;
      const displayIndex = node.rowIndex;
      const selected = node.isSelected();

      // rowClass()/getRowStyle() user callbacks run only when the row's
      // (node, version, displayIndex, selected) signature changed.
      if (
        row.clsNode !== node ||
        row.clsVersion !== node.__version ||
        row.clsIndex !== displayIndex ||
        row.clsSelected !== selected
      ) {
        row.clsNode = node;
        row.clsVersion = node.__version;
        row.clsIndex = displayIndex;
        row.clsSelected = selected;
        row.cls = this.rowClass(node, displayIndex);
        row.style = getRowStyle ? getRowStyle({ data: node.data, node, rowIndex: displayIndex }) ?? null : null;
      }

      const ariaIndex = ariaOffset + displayIndex + 1;
      row.left.setRowMeta(row.cls, ariaIndex, node.id, displayIndex);
      row.center.setRowMeta(row.cls, ariaIndex, node.id, displayIndex);
      row.right.setRowMeta(row.cls, ariaIndex, node.id, displayIndex);
      const expandable = isNodeExpandable(this.ctx, node);
      row.center.setAriaState(
        selectionActive && node.rowPinned == null ? (selected === true ? 'true' : 'false') : null,
        expandable ? (node.expanded ? 'true' : 'false') : null,
      );
      // Custom row style first (clears stale keys), then positioning pass.
      row.left.applyRowStyle(row.style);
      row.center.applyRowStyle(row.style);
      row.right.applyRowStyle(row.style);
      row.left.update(node, displayIndex, leftCols, regionWidths.left, allColIndex);
      row.center.update(node, displayIndex, centerCols, regionWidths.center, allColIndex);
      row.right.update(node, displayIndex, rightCols, regionWidths.right, allColIndex);
    }

    // Trim the free list beyond ~1.5x the window size.
    const maxFree = Math.ceil(nodes.length * 1.5);
    while (this.free.length > maxFree) {
      const r = this.free.pop()!;
      r.left.destroy();
      r.center.destroy();
      r.right.destroy();
    }
    // Park remaining free rows so they don't show stale content.
    for (const r of this.free) {
      if (!r.parked) {
        r.parked = true;
        r.left.park();
        r.center.park();
        r.right.park();
      }
    }
  }

  /**
   * C19: a row about to be recycled/destroyed may contain document.activeElement
   * (a focused cell or embedded control). Move focus to the grid root so
   * keyboard interaction keeps working instead of falling back to <body>.
   */
  private releaseFocusIfInside(row: PooledRow<TData>): void {
    if (typeof document === 'undefined') return;
    if (row.left.containsActiveElement() || row.center.containsActiveElement() || row.right.containsActiveElement()) {
      this.ctx.renderer.eRoot.focus({ preventScroll: true });
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
      row.clsNode = null;
    }
  }

  invalidateRows(rowIds: Set<string>, colIds?: Set<string>): void {
    for (const [id, row] of this.rows) {
      if (rowIds.has(id)) {
        row.left.invalidateCells(colIds);
        row.center.invalidateCells(colIds);
        row.right.invalidateCells(colIds);
        row.clsNode = null;
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
    for (const row of this.free) {
      row.left.destroy();
      row.center.destroy();
      row.right.destroy();
    }
    this.free = [];
  }

  destroy(): void {
    this.clear();
  }
}

/* ------------------------------------------------------------- full width */

interface FullWidthRow<TData> {
  elRow: HTMLElement;
  elCell: HTMLElement;
  node: RowNode<TData>;
  lastVersion: number;
  lastExpanded: boolean | null;
  lastTop: number | null;
  lastHeight: number;
  lastWidth: number;
  lastClassName: string;
  lastAriaIndex: number;
  contentKey: string;
  fwWrapper: HTMLElement | null;
  rendererCleanup: (() => void) | null;
  rendererComp: CellRendererComp<TData> | null;
}

/**
 * Renders full-width rows (groupDisplayType 'groupRows' group rows and
 * isFullWidthRow leaf rows) into the dedicated .au-fullwidth-container. The
 * container is y-synced (translateY) with body scroll by GridRenderer and
 * pinned to the viewport on the x axis. Rows carry the standard
 * data-au-row-id/-index attributes; the single cell carries
 * data-au-col="au-fullwidth" so delegated events resolve the row even though
 * no real column exists for it.
 */
export class FullWidthBand<TData> {
  private rows = new Map<string, FullWidthRow<TData>>();

  constructor(private ctx: GridContext<TData>, private container: HTMLElement) {}

  render(nodes: RowNode<TData>[], width: number, ariaOffset: number, groupRowsMode: boolean): void {
    if (nodes.length === 0 && this.rows.size === 0) return;
    const wanted = new Set<string>();
    for (const n of nodes) wanted.add(n.id);
    for (const [id, row] of this.rows) {
      if (!wanted.has(id)) {
        this.destroyRow(row);
        this.rows.delete(id);
      }
    }
    const selectionActive = !!this.ctx.options.get('rowSelection');
    for (const node of nodes) {
      let row = this.rows.get(node.id);
      if (!row) {
        const elCell = el('div', 'au-cell au-fullwidth-cell', {
          role: 'gridcell',
          'data-au-col': 'au-fullwidth',
          'aria-colindex': '1',
          tabindex: '-1',
        });
        elCell.style.width = '100%';
        elCell.style.left = '0';
        const elRow = el('div', 'au-row au-fullwidth-row', { role: 'row' });
        elRow.appendChild(elCell);
        this.container.appendChild(elRow);
        row = {
          elRow,
          elCell,
          node,
          lastVersion: -1,
          lastExpanded: null,
          lastTop: null,
          lastHeight: -1,
          lastWidth: -1,
          lastClassName: '',
          lastAriaIndex: -1,
          contentKey: '',
          fwWrapper: null,
          rendererCleanup: null,
          rendererComp: null,
        };
        this.rows.set(node.id, row);
      }
      row.node = node;
      this.updateRow(row, node, width, ariaOffset, groupRowsMode, selectionActive);
    }
  }

  private updateRow(
    row: FullWidthRow<TData>,
    node: RowNode<TData>,
    width: number,
    ariaOffset: number,
    groupRowsMode: boolean,
    selectionActive: boolean,
  ): void {
    const e = row.elRow;
    const displayIndex = node.rowIndex;
    if (node.rowTop !== row.lastTop) {
      e.style.transform = `translateY(${node.rowTop}px)`;
      row.lastTop = node.rowTop;
    }
    if (node.rowHeight !== row.lastHeight) {
      e.style.height = `${node.rowHeight}px`;
      row.lastHeight = node.rowHeight;
    }
    if (width !== row.lastWidth) {
      e.style.width = `${width}px`;
      row.lastWidth = width;
    }
    const selected = node.isSelected();
    let cls = 'au-row au-fullwidth-row';
    cls += displayIndex % 2 === 1 ? ' au-row-odd' : ' au-row-even';
    if (node.group && !node.footer) cls += ' au-row-group';
    if (node.footer) cls += ' au-row-footer';
    if (selected === true) cls += ' au-row-selected';
    if (cls !== row.lastClassName) {
      e.className = cls;
      row.lastClassName = cls;
    }
    e.setAttribute('data-au-row-id', node.id);
    e.setAttribute('data-au-row-index', String(displayIndex));
    const ariaIndex = ariaOffset + displayIndex + 1;
    if (ariaIndex !== row.lastAriaIndex) {
      e.setAttribute('aria-rowindex', String(ariaIndex));
      row.lastAriaIndex = ariaIndex;
    }
    const expandable = isNodeExpandable(this.ctx, node);
    if (expandable) e.setAttribute('aria-expanded', node.expanded ? 'true' : 'false');
    else e.removeAttribute('aria-expanded');
    if (selectionActive) e.setAttribute('aria-selected', selected === true ? 'true' : 'false');
    else e.removeAttribute('aria-selected');

    // content
    if (groupRowsMode && node.group) {
      const key = `g|${node.__version}|${node.expanded ? 1 : 0}|${node.allChildrenCount}`;
      if (row.contentKey === key) return;
      row.contentKey = key;
      this.clearRowContent(row);
      const wrap = el('div', 'au-group-cell');
      wrap.style.paddingLeft = `${Math.max(0, node.level) * INDENT_PX}px`;
      const chevron = el('span', 'au-group-expand' + (node.expanded ? ' au-expanded' : '') + (expandable ? '' : ' au-hidden'));
      chevron.setAttribute('data-au-expand', '1');
      chevron.textContent = '▶';
      chevron.style.fontSize = '9px';
      wrap.appendChild(chevron);
      const keyEl = el('span', 'au-group-key');
      keyEl.textContent = node.key ?? '';
      wrap.appendChild(keyEl);
      if (node.allChildrenCount > 0) {
        const count = el('span', 'au-group-count');
        count.textContent = `(${node.allChildrenCount})`;
        wrap.appendChild(count);
      }
      row.elCell.appendChild(wrap);
      return;
    }

    // isFullWidthRow leaf: user fullWidthCellRenderer
    const key = `fw|${node.__version}`;
    if (row.contentKey === key) return;
    row.contentKey = key;
    this.clearRowContent(row);
    const renderer = this.ctx.options.get('fullWidthCellRenderer');
    const params = {
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      data: node.data,
      node,
      column: null,
      colDef: null,
      value: node.data,
      valueFormatted: '',
      rowIndex: displayIndex,
      refreshCell: () => this.ctx.scheduleRender(),
    } as unknown as CellRendererParams<TData>;
    if (!renderer) {
      row.elCell.textContent = '';
      return;
    }
    if (typeof renderer === 'object' && renderer !== null && '__frameworkComponent' in renderer) {
      if (this.ctx.frameworkAdapter) {
        // Same wrapper-mount mechanism as CellCtrl: fresh dedicated container
        // per mount; old wrappers are detached intact.
        const wrap = el('span', 'au-fw-mount');
        row.elCell.appendChild(wrap);
        row.fwWrapper = wrap;
        row.rendererCleanup = this.ctx.frameworkAdapter.render(
          (renderer as { __frameworkComponent: unknown }).__frameworkComponent,
          params as unknown as Record<string, unknown>,
          wrap,
        );
      }
      return;
    }
    if (typeof renderer === 'function') {
      const isClass = !!(renderer as { prototype?: { init?: unknown } }).prototype?.init;
      if (isClass) {
        const comp = new (renderer as new () => CellRendererComp<TData>)();
        row.rendererComp = comp;
        row.elCell.appendChild(comp.init(params));
        return;
      }
      const out = (renderer as (p: CellRendererParams<TData>) => string | HTMLElement | null)(params);
      if (out instanceof HTMLElement) row.elCell.appendChild(out);
      else {
        const span = el('span', 'au-cell-value');
        span.textContent = out ?? '';
        row.elCell.appendChild(span);
      }
    }
  }

  private clearRowContent(row: FullWidthRow<TData>): void {
    if (row.fwWrapper) {
      row.fwWrapper.remove();
      row.fwWrapper = null;
    }
    if (row.rendererCleanup) {
      row.rendererCleanup();
      row.rendererCleanup = null;
    }
    if (row.rendererComp) {
      row.rendererComp.destroy?.();
      row.rendererComp = null;
    }
    row.elCell.textContent = '';
  }

  private destroyRow(row: FullWidthRow<TData>): void {
    if (typeof document !== 'undefined' && document.activeElement && row.elRow.contains(document.activeElement)) {
      this.ctx.renderer.eRoot.focus({ preventScroll: true });
    }
    this.clearRowContent(row);
    row.elRow.remove();
  }

  getRowElement(rowId: string): HTMLElement | null {
    return this.rows.get(rowId)?.elRow ?? null;
  }

  getCellElement(rowId: string): HTMLElement | null {
    return this.rows.get(rowId)?.elCell ?? null;
  }

  invalidateAll(): void {
    for (const row of this.rows.values()) row.contentKey = '';
  }

  clear(): void {
    for (const row of this.rows.values()) this.destroyRow(row);
    this.rows.clear();
  }

  destroy(): void {
    this.clear();
  }
}
