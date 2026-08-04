import type { GridContext, ITooltipService } from '../context.js';
import type { Column } from '../columns/column.js';
import type { IColumn } from '../types/column.js';
import type { TooltipComp, TooltipCompParams } from '../types/colDef.js';
import { getPath } from '../utils/general.js';

/** Sparkline marks whose hover readout owns the cell's hover surface. */
const SPARKLINE_SERIES_TYPES = new Set(['line', 'area', 'column', 'winLoss', 'band']);

interface ResolvedTip<TData> {
  node: NonNullable<ReturnType<GridContext<TData>['rowModel']['getRow']>>;
  column: Column<TData>;
  /** Resolved tooltipField/tooltipValueGetter string; null when none configured. */
  tip: string | null;
}

/**
 * Cell tooltips: resolves tooltipField / tooltipValueGetter on delegated cell
 * mouseover, shows a singleton fixed-position tooltip element after
 * tooltipShowDelay ms hovering the same cell. `tooltipComponent` renders rich
 * content into the grid-managed element; `tooltipInteraction` keeps the
 * tooltip open while the pointer is over it.
 *
 * Hover-surface precedence (decided, not emergent — AUG-34): (1) a series
 * sparkline's point readout owns its column's hover unless the column sets
 * `suppressInteraction`; (2) this service (string or component tooltips);
 * (3) app-side cellMouseOver/cellMouseOut hovercards — those events always
 * fire regardless, they are data, not a visual surface.
 */
export class TooltipService implements ITooltipService {
  private ctx: GridContext<any>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private el: HTMLDivElement | null = null;
  /** "rowIndex:colId" of the cell currently pending or shown. */
  private currentKey: string | null = null;
  private shown = false;
  /** Pointer is currently over the tooltip element (tooltipInteraction). */
  private tipHovered = false;
  /** Unmount hook for mounted component content (framework or class). */
  private compCleanup: (() => void) | null = null;

  constructor(ctx: GridContext<any>) {
    this.ctx = ctx;
  }

  onCellMouseOver(cellEl: HTMLElement, rowIndex: number, colId: string): void {
    const resolved = this.resolve(rowIndex, colId);
    if (!resolved) {
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
      this.show(cellEl, rowIndex, colId, resolved);
    }, delay);
  }

  onLeaveGrid(): void {
    this.hide();
  }

  destroy(): void {
    this.doHide();
    this.el?.remove();
    this.el = null;
  }

  /* ------------------------------------------------------------- internals */

  private resolve(rowIndex: number, colId: string): ResolvedTip<any> | null {
    const node = this.ctx.rowModel.getRow(rowIndex);
    const column = this.ctx.columnModel.getColumn(colId);
    if (!node || !column) return null;
    const colDef = column.getColDef();

    // Precedence rule (1): the sparkline point readout owns this hover.
    const spark = colDef.sparkline;
    if (
      spark &&
      SPARKLINE_SERIES_TYPES.has(spark.type ?? 'line') &&
      !spark.suppressInteraction
    ) {
      return null;
    }

    let tip: string | null = null;
    if (colDef.tooltipField) {
      const v = getPath(node.data, colDef.tooltipField);
      tip = v == null ? null : String(v);
    } else if (colDef.tooltipValueGetter) {
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
      tip = v == null || v === '' ? null : String(v);
    }

    const hasStringSource = !!colDef.tooltipField || !!colDef.tooltipValueGetter;
    if (tip == null || tip === '') {
      // The string gates visibility when configured. A component with no
      // string source shows on every hover of the column's cells.
      if (!colDef.tooltipComponent || hasStringSource) return null;
    }
    return { node, column, tip };
  }

  private show(
    cellEl: HTMLElement,
    rowIndex: number,
    colId: string,
    resolved: ResolvedTip<any>,
  ): void {
    if (typeof document === 'undefined') return;
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'au-tooltip';
      this.el.setAttribute('role', 'tooltip');
      // tooltipInteraction: track pointer presence over the tooltip itself.
      this.el.addEventListener('mouseenter', () => {
        this.tipHovered = true;
        if (this.hideTimer) {
          clearTimeout(this.hideTimer);
          this.hideTimer = null;
        }
      });
      this.el.addEventListener('mouseleave', () => {
        this.tipHovered = false;
        if (this.ctx.options.is('tooltipInteraction')) this.doHide();
      });
    }

    this.clearContent();
    const colDef = resolved.column.getColDef();
    const comp = colDef.tooltipComponent;
    if (comp) {
      const params: TooltipCompParams<any> = {
        api: this.ctx.api,
        context: this.ctx.options.get('context'),
        data: resolved.node.data,
        node: resolved.node,
        column: resolved.column as unknown as IColumn<any>,
        colDef,
        value: this.ctx.values.getValue(resolved.node, resolved.column),
        tip: resolved.tip,
        rowIndex,
      };
      if (typeof comp === 'object' && '__frameworkComponent' in comp) {
        if (this.ctx.frameworkAdapter) {
          this.compCleanup = this.ctx.frameworkAdapter.render(
            comp.__frameworkComponent,
            params as unknown as Record<string, unknown>,
            this.el,
          );
        }
      } else {
        const inst = new (comp as new () => TooltipComp<any>)();
        this.el.appendChild(inst.init(params));
        this.compCleanup = () => inst.destroy?.();
      }
    } else {
      this.el.textContent = resolved.tip!;
    }
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
      value: resolved.tip ?? '',
      cell: { rowIndex, colId, rowPinned: null },
    });
  }

  private hide(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.currentKey = null;
    if (!this.shown) return;
    if (this.ctx.options.is('tooltipInteraction')) {
      // Grace period so the pointer can travel from the cell into the
      // tooltip (the cell's mouseout fires before the tooltip's mouseenter).
      if (this.tipHovered) return; // hides on tooltip mouseleave
      if (this.hideTimer == null) {
        this.hideTimer = setTimeout(() => {
          this.hideTimer = null;
          if (!this.tipHovered) this.doHide();
        }, 150);
      }
      return;
    }
    this.doHide();
  }

  private doHide(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.currentKey = null;
    this.tipHovered = false;
    if (this.shown) {
      this.shown = false;
      this.clearContent();
      this.el?.remove();
      this.ctx.events.dispatch({
        type: 'tooltipHide',
        api: this.ctx.api,
        context: this.ctx.options.get('context'),
      });
    }
  }

  private clearContent(): void {
    this.compCleanup?.();
    this.compCleanup = null;
    if (this.el) this.el.textContent = '';
  }
}
