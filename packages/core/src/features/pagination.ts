import type { GridContext, IPaginationService } from '../context.js';
import { clamp } from '../utils/general.js';

/** Row-model extras used by pagination (client model only; optional). */
interface PagingRowModel {
  getDisplayedRowCountAllPages?: () => number;
  setPageWindow?: (start: number, end: number) => void;
  clearPageWindow?: () => void;
}

interface PanelRefs {
  container: HTMLElement;
  label: HTMLElement;
  first: HTMLButtonElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  last: HTMLButtonElement;
  select: HTMLSelectElement | null;
}

/**
 * Pages the displayed rows by applying a window over the row model, and owns
 * the pager panel UI at the bottom of the grid.
 */
export class PaginationService<TData = unknown> implements IPaginationService<TData> {
  private ctx: GridContext<TData>;
  private page = 0;
  private pageSize: number;
  private total = 0;
  private totalPages = 1;
  private panel: PanelRefs | null = null;

  private readonly onModelUpdated = (): void => {
    this.recompute();
  };

  private readonly onGridSizeChanged = (): void => {
    if (this.ctx.options.is('paginationAutoPageSize')) {
      this.applyAutoPageSize();
      this.recompute();
    }
  };

  constructor(ctx: GridContext<TData>) {
    this.ctx = ctx;
    this.pageSize = ctx.options.get('paginationPageSize') ?? 100;
    if (ctx.options.is('paginationAutoPageSize')) this.applyAutoPageSize();
    ctx.events.addEventListener('modelUpdated', this.onModelUpdated);
    ctx.events.addEventListener('gridSizeChanged', this.onGridSizeChanged);
    // Model may already hold data (service created after boot): window it now.
    if (ctx.rowModel && ctx.rowModel.isDataLoaded()) this.recompute();
  }

  isActive(): boolean {
    return this.ctx.options.is('pagination');
  }

  getCurrentPage(): number {
    return this.page;
  }

  getTotalPages(): number {
    return this.totalPages;
  }

  getPageSize(): number {
    return this.pageSize;
  }

  goToPage(page: number): void {
    this.page = clamp(page, 0, this.totalPages - 1);
    this.applyWindow();
    this.dispatchChanged();
    this.updatePanel();
    this.ctx.scheduleRender();
  }

  setPageSize(size: number): void {
    if (!(size > 0)) return;
    this.pageSize = Math.floor(size);
    this.recomputeTotals();
    this.applyWindow();
    this.dispatchChanged();
    this.updatePanel();
    this.ctx.scheduleRender();
  }

  /* ------------------------------------------------------------- internals */

  private applyAutoPageSize(): void {
    const height = this.ctx.renderer?.getViewportSize?.().height ?? 0;
    const rowHeight = this.ctx.options.get('rowHeight') ?? 32;
    this.pageSize = Math.max(1, Math.floor(height / rowHeight));
  }

  private pagingModel(): PagingRowModel {
    return this.ctx.rowModel as unknown as PagingRowModel;
  }

  private recomputeTotals(): void {
    this.total = this.pagingModel().getDisplayedRowCountAllPages?.() ?? this.ctx.rowModel.getRowCount();
    this.totalPages = Math.max(1, Math.ceil(this.total / this.pageSize));
    this.page = clamp(this.page, 0, this.totalPages - 1);
  }

  private recompute(): void {
    this.recomputeTotals();
    this.applyWindow();
    this.updatePanel();
  }

  private applyWindow(): void {
    this.pagingModel().setPageWindow?.(this.page * this.pageSize, (this.page + 1) * this.pageSize);
  }

  private dispatchChanged(): void {
    this.ctx.events.dispatch({
      type: 'paginationChanged',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      page: this.page,
      pageSize: this.pageSize,
      totalPages: this.totalPages,
    });
  }

  /* ----------------------------------------------------------------- panel */

  mountPanel(container: HTMLElement): void {
    container.classList.add('au-paging');
    container.style.display = '';
    container.textContent = '';

    let select: HTMLSelectElement | null = null;
    const selectorOpt = this.ctx.options.get('paginationPageSizeSelector');
    if (selectorOpt !== false) {
      const sizes = Array.isArray(selectorOpt) ? selectorOpt : [20, 50, 100];
      select = document.createElement('select');
      select.className = 'au-paging-size';
      for (const s of sizes) {
        const opt = document.createElement('option');
        opt.value = String(s);
        opt.textContent = s.toLocaleString();
        select.appendChild(opt);
      }
      this.ensureSizeOption(select, this.pageSize);
      select.value = String(this.pageSize);
      select.addEventListener('change', () => {
        this.setPageSize(Number(select!.value));
      });
      container.appendChild(select);
    }

    const makeButton = (className: string, text: string, onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = className;
      btn.textContent = text;
      btn.addEventListener('click', onClick);
      container.appendChild(btn);
      return btn;
    };

    const first = makeButton('au-paging-first', '«', () => this.goToPage(0));
    const prev = makeButton('au-paging-prev', '‹', () => this.goToPage(this.page - 1));

    const label = document.createElement('span');
    label.className = 'au-paging-label';
    container.appendChild(label);

    const next = makeButton('au-paging-next', '›', () => this.goToPage(this.page + 1));
    const last = makeButton('au-paging-last', '»', () => this.goToPage(this.totalPages - 1));

    this.panel = { container, label, first, prev, next, last, select };
    this.updatePanel();
  }

  private ensureSizeOption(select: HTMLSelectElement, size: number): void {
    const value = String(size);
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i].value === value) return;
    }
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = size.toLocaleString();
    select.appendChild(opt);
  }

  private updatePanel(): void {
    const p = this.panel;
    if (!p) return;
    const start = this.total === 0 ? 0 : this.page * this.pageSize + 1;
    const end = Math.min(this.total, (this.page + 1) * this.pageSize);
    p.label.textContent = `${start.toLocaleString()}–${end.toLocaleString()} of ${this.total.toLocaleString()}`;
    const atFirst = this.page <= 0;
    const atLast = this.page >= this.totalPages - 1;
    p.first.disabled = atFirst;
    p.prev.disabled = atFirst;
    p.next.disabled = atLast;
    p.last.disabled = atLast;
    if (p.select) {
      this.ensureSizeOption(p.select, this.pageSize);
      p.select.value = String(this.pageSize);
    }
  }

  destroy(): void {
    this.ctx.events.removeEventListener('modelUpdated', this.onModelUpdated);
    this.ctx.events.removeEventListener('gridSizeChanged', this.onGridSizeChanged);
    this.pagingModel().clearPageWindow?.();
    if (this.panel) {
      this.panel.container.style.display = 'none';
      this.panel.container.textContent = '';
      this.panel = null;
    }
  }
}
