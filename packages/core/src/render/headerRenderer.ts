import type { GridContext } from '../context.js';
import type { Column } from '../columns/column.js';
import type { HeaderNode } from '../columns/columnModel.js';
import { el } from '../utils/dom.js';
import type { HeaderComp, HeaderParams } from '../types/colDef.js';

interface SortIndicatorEntry {
  ind: HTMLElement;
  cell: HTMLElement;
}

/** Renders the column header rows (incl. group headers) and floating filters. */
export class HeaderRenderer<TData> {
  private headerComps: HeaderComp<TData>[] = [];
  private frameworkCleanups: (() => void)[] = [];
  private floatingCleanups: (() => void)[] = [];
  /** Build-time cache: colId → { indicator el, header cell el }. */
  private sortIndicators = new Map<string, SortIndicatorEntry>();
  /** colId → leaf header cell element, in displayed order. Rebuilt in refresh(). */
  private headerCellMap = new Map<string, HTMLElement>();
  private headerCheckbox: HTMLInputElement | null = null;
  /** Signature of the last-applied sort model; skip indicator writes when unchanged. */
  private lastSortSignature: string | null = null;
  /** Last-applied header checkbox state; skip writes when unchanged. */
  private lastHeaderCheckboxState: boolean | 'indeterminate' | null = null;

  constructor(
    private ctx: GridContext<TData>,
    private els: {
      header: HTMLElement;
      headerLeft: HTMLElement;
      headerCenterVp: HTMLElement;
      headerCenter: HTMLElement;
      headerRight: HTMLElement;
      floating: HTMLElement;
      floatingLeft: HTMLElement;
      floatingCenterVp: HTMLElement;
      floatingCenter: HTMLElement;
      floatingRight: HTMLElement;
    },
  ) {
    // Intermediate layout containers are transparent to the accessibility tree;
    // the role='row' wrappers built per header level are the semantic children.
    for (const e of [els.header, els.headerLeft, els.headerCenterVp, els.headerCenter, els.headerRight]) {
      e.setAttribute('role', 'presentation');
    }
    // ONE delegated keydown listener for the whole header (no per-cell listeners).
    this.els.header.addEventListener('keydown', this.onHeaderKeyDown);
  }

  refresh(): void {
    this.runCleanups();

    const layout = this.ctx.columnModel.getHeaderLayout();
    const headerHeight = this.ctx.options.get('headerHeight') ?? 36;
    const totalH = layout.depth * headerHeight;
    const widths = this.ctx.columnModel.getRegionWidths();
    // aria-colindex follows the displayed column order across all regions (1-based).
    const displayedAll = this.ctx.columnModel.getDisplayed().all;
    const colIndexes = new Map<string, number>();
    for (let i = 0; i < displayedAll.length; i++) colIndexes.set(displayedAll[i].colId, i + 1);

    const build = (container: HTMLElement, nodes: HeaderNode<TData>[], regionWidth: number) => {
      container.textContent = '';
      container.style.height = `${totalH}px`;
      container.style.width = `${regionWidth}px`;
      // One role='row' wrapper per header level (aria-rowindex 1-based from top).
      const rows: HTMLElement[] = [];
      for (let lvl = 0; lvl < layout.depth; lvl++) {
        const row = el('div', 'au-header-row', { role: 'row', 'aria-rowindex': String(lvl + 1) });
        row.style.position = 'absolute';
        row.style.left = '0';
        row.style.top = `${lvl * headerHeight}px`;
        row.style.width = '100%';
        row.style.height = `${headerHeight}px`;
        container.appendChild(row);
        rows.push(row);
      }
      const place = (node: HeaderNode<TData>, level: number) => {
        if (node.kind === 'col') {
          const col = node.column;
          const cell = this.buildColumnHeaderCell(col, headerHeight, level, layout.depth, colIndexes);
          rows[level].appendChild(cell);
        } else {
          const leaves = node.leafColumns.length > 0 ? node.leafColumns : [];
          if (leaves.length > 0) {
            const left = Math.min(...leaves.map((c) => c.left));
            const width = leaves.reduce((s, c) => s + c.actualWidth, 0);
            const cell = el('div', 'au-header-cell au-header-group-cell', { role: 'columnheader' });
            cell.style.left = `${left}px`;
            cell.style.width = `${width}px`;
            cell.style.top = '0px';
            cell.style.height = `${headerHeight}px`;
            if (node.headerClass) {
              cell.className += ' ' + (Array.isArray(node.headerClass) ? node.headerClass.join(' ') : node.headerClass);
            }
            const label = el('span', 'au-header-cell-text');
            label.textContent = node.headerName;
            cell.appendChild(label);
            rows[level].appendChild(cell);
          }
          for (const child of node.children) place(child, level + 1);
        }
      };
      for (const n of nodes) place(n, 0);
    };

    build(this.els.headerLeft, layout.left, widths.left);
    build(this.els.headerCenter, layout.center, widths.center);
    build(this.els.headerRight, layout.right, widths.right);
    this.els.headerLeft.style.width = `${widths.left}px`;
    this.els.headerRight.style.width = `${widths.right}px`;
    this.els.header.style.height = `${totalH}px`;

    this.refreshFloatingFilters(widths);
    this.updateSortIndicators();
  }

  /**
   * colId → leaf header cell element (displayed order), rebuilt in refresh().
   * The renderer's cheap geometry path uses this to update left/width without
   * a full header rebuild.
   */
  getHeaderCellMap(): Map<string, HTMLElement> {
    return this.headerCellMap;
  }

  private buildColumnHeaderCell(
    col: Column<TData>,
    headerHeight: number,
    level: number,
    depth: number,
    colIndexes: Map<string, number>,
  ): HTMLElement {
    const cell = el('div', 'au-header-cell', {
      role: 'columnheader',
      'data-au-header-col': col.colId,
    });
    if (col.cellDataType === 'number' && !col.isAutoGroupCol) cell.className += ' au-cell-number';
    const def = col.getColDef();
    if (def.headerClass) {
      cell.className += ' ' + (Array.isArray(def.headerClass) ? def.headerClass.join(' ') : def.headerClass);
    }
    cell.style.left = `${col.left}px`;
    cell.style.width = `${col.actualWidth}px`;
    // Cell lives inside its starting level's role='row' wrapper; a leaf cell
    // spanning multiple visual levels keeps the increased height.
    cell.style.top = '0px';
    cell.style.height = `${(depth - level) * headerHeight}px`;
    if (def.headerTooltip) cell.title = def.headerTooltip;
    const colIndex = colIndexes.get(col.colId);
    if (colIndex != null) cell.setAttribute('aria-colindex', String(colIndex));
    const sortable = col.isSortable() && !col.isAutoGroupCol && col.colId !== 'au-selection-col';
    cell.tabIndex = sortable ? 0 : -1;
    this.headerCellMap.set(col.colId, cell);

    if (col.colId === 'au-selection-col') {
      const sel = this.ctx.options.get('rowSelection');
      const conf = typeof sel === 'string' ? { mode: sel } : sel;
      if (conf && conf.mode === 'multiRow' && conf.headerCheckbox !== false) {
        const cb = el('input', 'au-checkbox', {
          type: 'checkbox',
          'data-au-header-checkbox': '1',
          tabindex: '-1',
          'aria-label': 'Select all rows',
        }) as HTMLInputElement;
        cell.appendChild(cb);
        cell.style.justifyContent = 'center';
        this.headerCheckbox = cb;
        this.updateHeaderCheckbox();
      }
      return cell;
    }

    // custom header component
    const custom = def.headerComponent;
    const params: HeaderParams<TData> = {
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      column: col,
      colDef: def,
      displayName: this.headerLabel(col),
      progressSort: (multi: boolean) => this.ctx.sort.progressSort(col, multi, 'header'),
    };
    if (custom && typeof custom === 'object' && '__frameworkComponent' in custom) {
      if (this.ctx.frameworkAdapter) {
        const cleanup = this.ctx.frameworkAdapter.render(
          custom.__frameworkComponent,
          params as unknown as Record<string, unknown>,
          cell,
        );
        this.frameworkCleanups.push(cleanup);
      }
    } else if (typeof custom === 'function') {
      const comp = new (custom as new () => HeaderComp<TData>)();
      cell.appendChild(comp.init(params));
      this.headerComps.push(comp);
    } else {
      const label = el('span', 'au-header-cell-label');
      const text = el('span', 'au-header-cell-text');
      text.textContent = params.displayName;
      label.appendChild(text);
      cell.appendChild(label);
      if (sortable) {
        cell.className += ' au-sortable';
        cell.setAttribute('data-au-sort-col', col.colId);
        const ind = el('span', 'au-sort-indicator');
        label.appendChild(ind);
        this.sortIndicators.set(col.colId, { ind, cell });
      }
    }

    const menuSuppressed =
      this.ctx.options.is('suppressHeaderMenuButton') || def.suppressHeaderMenuButton === true;
    if (!menuSuppressed && this.ctx.columnMenu && !col.isAutoGroupCol && col.colId !== 'au-selection-col') {
      const btn = el('span', 'au-header-menu-btn', {
        'data-au-col-menu': col.colId,
        role: 'button',
        tabindex: '-1',
        'aria-label': `Column menu for ${this.headerLabel(col)}`,
      });
      btn.textContent = '⋮';
      cell.appendChild(btn);
    }
    if (col.isResizable() && this.ctx.columnResize) {
      const grip = el('div', 'au-header-resize', { 'data-au-resize': col.colId });
      cell.appendChild(grip);
      this.ctx.columnResize.attachResizeGrip(grip, col.colId);
    }
    if (this.ctx.columnDrag && !def.suppressMovable && !col.isAutoGroupCol && col.colId !== 'au-selection-col') {
      this.ctx.columnDrag.attachHeaderDrag(cell, col.colId);
    }
    return cell;
  }

  /** Delegated keyboard support: Enter/Space sort, ArrowLeft/Right roving focus. */
  private onHeaderKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as Element | null;
    const cell = target?.closest?.('.au-header-cell') as HTMLElement | null;
    if (!cell || !this.els.header.contains(cell)) return;
    if (e.key === 'Enter' || e.key === ' ') {
      const colId = cell.getAttribute('data-au-sort-col');
      if (!colId) return;
      const col = this.ctx.columnModel.getColumn(colId);
      if (!col) return;
      e.preventDefault();
      e.stopPropagation();
      this.ctx.sort.progressSort(col, e.shiftKey, 'header');
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const cells: HTMLElement[] = [];
      for (const c of this.headerCellMap.values()) cells.push(c);
      const idx = cells.indexOf(cell);
      if (idx < 0) return;
      const next = cells[idx + (e.key === 'ArrowRight' ? 1 : -1)];
      if (next) {
        e.preventDefault();
        e.stopPropagation();
        next.focus();
      }
    }
  };

  private headerLabel(col: Column<TData>): string {
    let name = col.getHeaderName();
    if (
      col.aggFunc != null &&
      typeof col.aggFunc === 'string' &&
      !this.ctx.columnModel.isPivotMode() &&
      this.ctx.columnModel.getRowGroupColumns().length > 0 &&
      this.ctx.options.get('suppressAggFuncInHeader') !== true
    ) {
      name = `${col.aggFunc}(${name})`;
    }
    return name;
  }

  updateSortIndicators(): void {
    const model = this.ctx.sort?.getSortModel() ?? [];
    let sig = '';
    for (let i = 0; i < model.length; i++) sig += `${model[i].colId}:${model[i].sort}:${i}|`;
    if (sig === this.lastSortSignature) return;
    this.lastSortSignature = sig;
    const multi = model.length > 1;
    for (const [colId, entry] of this.sortIndicators) {
      const col = this.ctx.columnModel.getColumn(colId);
      const sort = col?.sort ?? null;
      if (sort == null) {
        entry.ind.textContent = '';
        entry.cell.setAttribute('aria-sort', 'none');
      } else {
        const arrow = sort === 'asc' ? '↑' : '↓';
        const idx = model.findIndex((m) => m.colId === colId);
        entry.ind.textContent = arrow;
        if (multi && idx >= 0) {
          const order = el('span', 'au-sort-order');
          order.textContent = String(idx + 1);
          entry.ind.appendChild(order);
        }
        entry.cell.setAttribute('aria-sort', sort === 'asc' ? 'ascending' : 'descending');
      }
    }
  }

  updateHeaderCheckbox(): void {
    if (!this.headerCheckbox) return;
    const state = this.ctx.selection?.getHeaderState() ?? false;
    if (state === this.lastHeaderCheckboxState) return;
    this.lastHeaderCheckboxState = state;
    this.headerCheckbox.checked = state === true;
    this.headerCheckbox.indeterminate = state === 'indeterminate';
  }

  private refreshFloatingFilters(widths: { left: number; center: number; right: number }): void {
    const show = this.shouldShowFloating();
    this.els.floating.style.display = show ? '' : 'none';
    if (!show) return;
    const h = this.ctx.options.get('floatingFiltersHeight') ?? 36;
    this.els.floating.style.height = `${h}px`;
    const displayed = this.ctx.columnModel.getDisplayed();

    const build = (container: HTMLElement, cols: Column<TData>[], regionWidth: number) => {
      container.textContent = '';
      container.style.width = `${regionWidth}px`;
      container.style.height = `${h}px`;
      for (const col of cols) {
        const cell = el('div', 'au-floating-cell', { 'data-au-float-col': col.colId });
        cell.style.left = `${col.left}px`;
        cell.style.width = `${col.actualWidth}px`;
        container.appendChild(cell);
        if (this.colHasFloating(col)) {
          const cleanup = this.ctx.filters.mountFloatingFilter(cell, col);
          if (typeof cleanup === 'function') this.floatingCleanups.push(cleanup);
        }
      }
    };
    build(this.els.floatingLeft, displayed.left, widths.left);
    build(this.els.floatingCenter, displayed.center, widths.center);
    build(this.els.floatingRight, displayed.right, widths.right);
    this.els.floatingLeft.style.width = `${widths.left}px`;
    this.els.floatingRight.style.width = `${widths.right}px`;
  }

  private shouldShowFloating(): boolean {
    if (this.ctx.options.get('floatingFilter') === true) return true;
    return this.ctx.columnModel.getDisplayedColumns().some((c) => c.getColDef().floatingFilter === true);
  }

  private colHasFloating(col: Column<TData>): boolean {
    const def = col.getColDef();
    if (def.filter === undefined || def.filter === false) return false;
    if (def.floatingFilter === false) return false;
    return def.floatingFilter === true || this.ctx.options.get('floatingFilter') === true;
  }

  /** Tear down everything produced by the last build: comps, framework mounts,
   * floating-filter mounts, and build-time caches. */
  private runCleanups(): void {
    for (const c of this.headerComps) c.destroy?.();
    this.headerComps = [];
    for (const f of this.frameworkCleanups) f();
    this.frameworkCleanups = [];
    for (const f of this.floatingCleanups) f();
    this.floatingCleanups = [];
    this.sortIndicators.clear();
    this.headerCellMap.clear();
    this.headerCheckbox = null;
    this.lastSortSignature = null;
    this.lastHeaderCheckboxState = null;
  }

  destroy(): void {
    this.els.header.removeEventListener('keydown', this.onHeaderKeyDown);
    this.runCleanups();
  }
}
