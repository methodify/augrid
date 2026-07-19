import type { GridContext, ITooltipService } from '../context';
import type { IColumn } from '../types/column';
import { getPath } from '../utils/general';

/**
 * Cell tooltips: resolves tooltipField / tooltipValueGetter on delegated cell
 * mouseover, shows a singleton fixed-position tooltip element after
 * tooltipShowDelay ms hovering the same cell.
 */
export class TooltipService implements ITooltipService {
  private ctx: GridContext<any>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private el: HTMLDivElement | null = null;
  /** "rowIndex:colId" of the cell currently pending or shown. */
  private currentKey: string | null = null;
  private shown = false;

  constructor(ctx: GridContext<any>) {
    this.ctx = ctx;
  }

  onCellMouseOver(cellEl: HTMLElement, rowIndex: number, colId: string): void {
    const tip = this.resolveTip(rowIndex, colId);
    if (tip == null || tip === '') {
      this.hide();
      return;
    }
    const key = `${rowIndex}:${colId}`;
    if (key === this.currentKey) return; // same cell: keep pending timer / shown tooltip
    this.hide();
    this.currentKey = key;
    const delay = this.ctx.options.get('tooltipShowDelay') ?? 600;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.show(cellEl, rowIndex, colId, tip);
    }, delay);
  }

  onLeaveGrid(): void {
    this.hide();
  }

  destroy(): void {
    this.hide();
    this.el?.remove();
    this.el = null;
  }

  /* ------------------------------------------------------------- internals */

  private resolveTip(rowIndex: number, colId: string): string | null {
    const node = this.ctx.rowModel.getRow(rowIndex);
    const column = this.ctx.columnModel.getColumn(colId);
    if (!node || !column) return null;
    const colDef = column.getColDef();
    if (colDef.tooltipField) {
      const v = getPath(node.data, colDef.tooltipField);
      return v == null ? null : String(v);
    }
    if (colDef.tooltipValueGetter) {
      const v = colDef.tooltipValueGetter({
        api: this.ctx.api,
        context: this.ctx.options.get('context'),
        data: node.data,
        node,
        // cast: kernel Column currently fails IColumn assignability (getAggFunc variance)
        column: column as unknown as IColumn<any>,
        colDef,
        value: this.ctx.values.getValue(node, column),
      });
      return v == null || v === '' ? null : String(v);
    }
    return null;
  }

  private show(cellEl: HTMLElement, rowIndex: number, colId: string, tip: string): void {
    if (typeof document === 'undefined') return;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'au-tooltip';
    }
    this.el.textContent = tip;
    if (!this.el.parentNode) document.body.appendChild(this.el);

    // Position below-left of the cell, clamped to the viewport.
    const rect = cellEl.getBoundingClientRect();
    const width = this.el.offsetWidth;
    const height = this.el.offsetHeight;
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + width > window.innerWidth) left = Math.max(0, window.innerWidth - width - 4);
    if (top + height > window.innerHeight) top = Math.max(0, rect.top - height - 4);
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;

    this.shown = true;
    this.ctx.events.dispatch({
      type: 'tooltipShow',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      value: tip,
      cell: { rowIndex, colId, rowPinned: null },
    });
  }

  private hide(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.currentKey = null;
    if (this.shown) {
      this.shown = false;
      this.el?.remove();
      this.ctx.events.dispatch({
        type: 'tooltipHide',
        api: this.ctx.api,
        context: this.ctx.options.get('context'),
      });
    }
  }
}
