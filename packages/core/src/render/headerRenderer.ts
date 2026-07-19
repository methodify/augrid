import type { GridContext } from '../context';
import type { Column } from '../columns/column';
import type { HeaderNode } from '../columns/columnModel';
import { el } from '../utils/dom';
import type { HeaderComp, HeaderParams } from '../types/colDef';

/** Renders the column header rows (incl. group headers) and floating filters. */
export class HeaderRenderer<TData> {
  private headerComps: HeaderComp<TData>[] = [];
  private frameworkCleanups: (() => void)[] = [];
  private sortIndicators = new Map<string, HTMLElement>();
  private headerCheckbox: HTMLInputElement | null = null;

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
  ) {}

  refresh(): void {
    for (const c of this.headerComps) c.destroy?.();
    this.headerComps = [];
    for (const f of this.frameworkCleanups) f();
    this.frameworkCleanups = [];
    this.sortIndicators.clear();
    this.headerCheckbox = null;

    const layout = this.ctx.columnModel.getHeaderLayout();
    const headerHeight = this.ctx.options.get('headerHeight') ?? 36;
    const totalH = layout.depth * headerHeight;
    const widths = this.ctx.columnModel.getRegionWidths();

    const build = (container: HTMLElement, nodes: HeaderNode<TData>[], regionWidth: number) => {
      container.textContent = '';
      container.style.height = `${totalH}px`;
      container.style.width = `${regionWidth}px`;
      const place = (node: HeaderNode<TData>, level: number) => {
        if (node.kind === 'col') {
          const col = node.column;
          const cell = this.buildColumnHeaderCell(col, headerHeight, level, layout.depth);
          container.appendChild(cell);
        } else {
          const leaves = node.leafColumns.length > 0 ? node.leafColumns : [];
          if (leaves.length > 0) {
            const left = Math.min(...leaves.map((c) => c.left));
            const width = leaves.reduce((s, c) => s + c.actualWidth, 0);
            const cell = el('div', 'au-header-cell au-header-group-cell', { role: 'columnheader' });
            cell.style.left = `${left}px`;
            cell.style.width = `${width}px`;
            cell.style.top = `${level * headerHeight}px`;
            cell.style.height = `${headerHeight}px`;
            if (node.headerClass) {
              cell.className += ' ' + (Array.isArray(node.headerClass) ? node.headerClass.join(' ') : node.headerClass);
            }
            const label = el('span', 'au-header-cell-text');
            label.textContent = node.headerName;
            cell.appendChild(label);
            container.appendChild(cell);
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

  private buildColumnHeaderCell(
    col: Column<TData>,
    headerHeight: number,
    level: number,
    depth: number,
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
    cell.style.top = `${level * headerHeight}px`;
    cell.style.height = `${(depth - level) * headerHeight}px`;
    if (def.headerTooltip) cell.title = def.headerTooltip;

    if (col.colId === 'au-selection-col') {
      const sel = this.ctx.options.get('rowSelection');
      const conf = typeof sel === 'string' ? { mode: sel } : sel;
      if (conf && conf.mode === 'multiRow' && conf.headerCheckbox !== false) {
        const cb = el('input', 'au-checkbox', { type: 'checkbox', 'data-au-header-checkbox': '1' }) as HTMLInputElement;
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
      if (col.isSortable() && !col.isAutoGroupCol) {
        cell.className += ' au-sortable';
        cell.setAttribute('data-au-sort-col', col.colId);
        const ind = el('span', 'au-sort-indicator');
        label.appendChild(ind);
        this.sortIndicators.set(col.colId, ind);
      }
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
    const multi = model.length > 1;
    for (const [colId, ind] of this.sortIndicators) {
      const col = this.ctx.columnModel.getColumn(colId);
      const sort = col?.sort ?? null;
      const cellEl = ind.closest('.au-header-cell');
      if (sort == null) {
        ind.textContent = '';
        cellEl?.setAttribute('aria-sort', 'none');
      } else {
        const arrow = sort === 'asc' ? '↑' : '↓';
        const idx = model.findIndex((m) => m.colId === colId);
        ind.innerHTML = '';
        ind.append(arrow);
        if (multi && idx >= 0) {
          const order = el('span', 'au-sort-order');
          order.textContent = String(idx + 1);
          ind.appendChild(order);
        }
        cellEl?.setAttribute('aria-sort', sort === 'asc' ? 'ascending' : 'descending');
      }
    }
  }

  updateHeaderCheckbox(): void {
    if (!this.headerCheckbox) return;
    const state = this.ctx.selection?.getHeaderState() ?? false;
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
          this.ctx.filters.mountFloatingFilter(cell, col);
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

  destroy(): void {
    for (const c of this.headerComps) c.destroy?.();
    for (const f of this.frameworkCleanups) f();
    this.headerComps = [];
    this.frameworkCleanups = [];
  }
}
