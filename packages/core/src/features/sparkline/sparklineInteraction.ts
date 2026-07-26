import type { GridContext } from '../../context.js';
import type { Column } from '../../columns/column.js';
import type { RowNode } from '../../rows/rowNode.js';
import { nearestPointIndex, slotIndexAt, toSeries } from './sparkline.js';
import { el, closestWithAttr } from '../../utils/dom.js';

/** Series marks that respond to hover/click (scalar marks read as one value). */
const SERIES_TYPES = new Set(['line', 'area', 'column', 'winLoss', 'band']);

interface Hit<TData> {
  node: RowNode<TData>;
  column: Column<TData>;
  index: number;
  value: number;
  x: number | null;
  cellEl: HTMLElement;
}

/**
 * Hover readout + point-click events for sparkline cells. One delegated
 * pointermove/pointerleave/click set at the grid root — never per-cell
 * listeners — with hit-testing done by the same pure geometry the renderer
 * draws with, so the point under the cursor is the point that's painted.
 *
 * The readout is a singleton element reusing the tooltip styling, living
 * outside the cells so they stay recyclable with no interaction state inside.
 */
export class SparklineInteraction<TData = unknown> {
  private tipEl: HTMLElement | null = null;
  private lastKey = '';
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onLeave: () => void;
  private readonly onClick: (e: MouseEvent) => void;

  constructor(private ctx: GridContext<TData>) {
    this.onMove = (e) => this.handleMove(e);
    this.onLeave = () => this.hide();
    this.onClick = (e) => this.handleClick(e);
    ctx.rootEl.addEventListener('pointermove', this.onMove);
    ctx.rootEl.addEventListener('pointerleave', this.onLeave);
    ctx.rootEl.addEventListener('click', this.onClick);
  }

  destroy(): void {
    this.ctx.rootEl.removeEventListener('pointermove', this.onMove);
    this.ctx.rootEl.removeEventListener('pointerleave', this.onLeave);
    this.ctx.rootEl.removeEventListener('click', this.onClick);
    this.tipEl?.remove();
    this.tipEl = null;
  }

  /* ------------------------------------------------------------ hit-testing */

  private hitFromEvent(e: MouseEvent): Hit<TData> | null {
    const target = e.target as Element | null;
    if (!target) return null;
    const cellEl = closestWithAttr(target, 'data-au-col', this.ctx.rootEl);
    if (!cellEl) return null;
    const colId = cellEl.getAttribute('data-au-col')!;
    const column = this.ctx.columnModel.getColumn(colId);
    const spark = column?.getColDef().sparkline;
    if (!column || !spark || spark.suppressInteraction) return null;
    const type = spark.type ?? 'line';
    if (!SERIES_TYPES.has(type)) return null;

    const rowEl = closestWithAttr(cellEl, 'data-au-row-id', this.ctx.rootEl);
    if (!rowEl) return null;
    const rowIndex = Number(rowEl.getAttribute('data-au-row-index'));
    const node = this.ctx.rowModel.getRow(rowIndex);
    if (!node) return null;

    const series = toSeries(this.ctx.values.getValue(node, column));
    if (series.values.length === 0) return null;

    // Map the cursor into the SVG's viewBox coordinates via its actual rect —
    // exact even when flex stretches the SVG (preserveAspectRatio is 'none',
    // so drawn size and attribute size can differ). Hover isn't the scroll
    // path: one rect read is fine here.
    const svgEl = cellEl.querySelector('.au-sparkline') as SVGSVGElement | null;
    if (!svgEl) return null;
    const srect = svgEl.getBoundingClientRect();
    if (srect.width <= 0) return null;
    const boxWidth = Number(svgEl.getAttribute('width')) || srect.width;
    const box = {
      width: boxWidth,
      height: Number(svgEl.getAttribute('height')) || srect.height,
      padding: spark.padding ?? 2,
    };
    const localX = ((e.clientX - srect.left) / srect.width) * boxWidth;

    const index =
      type === 'column' || type === 'winLoss'
        ? slotIndexAt(series.values, box, localX)
        : nearestPointIndex(series.values, series.xs, box, localX);
    if (index == null) return null;
    const value = series.values[index];
    if (typeof value !== 'number') return null;
    return { node, column, index, value, x: series.xs?.[index] ?? null, cellEl };
  }

  /* ------------------------------------------------------------ interaction */

  private handleMove(e: PointerEvent): void {
    const hit = this.hitFromEvent(e);
    if (!hit) {
      this.hide();
      return;
    }
    const key = `${hit.node.id}|${hit.column.colId}|${hit.index}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const spark = hit.column.getColDef().sparkline!;
    const series = toSeries(this.ctx.values.getValue(hit.node, hit.column));
    const text = spark.pointLabel
      ? spark.pointLabel({
          index: hit.index,
          count: series.values.length,
          value: hit.value,
          x: hit.x,
        })
      : `${hit.index + 1}/${series.values.length}: ${this.ctx.values.formatValue(hit.node, hit.column, hit.value)}`;

    this.showTip(text, e);
  }

  private handleClick(e: MouseEvent): void {
    const hit = this.hitFromEvent(e);
    if (!hit) return;
    this.ctx.events.dispatch({
      type: 'sparklinePointClicked',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      node: hit.node,
      data: hit.node.data,
      colId: hit.column.colId,
      rowIndex: hit.node.rowIndex,
      index: hit.index,
      value: hit.value,
      x: hit.x,
      event: e,
    });
  }

  /* ---------------------------------------------------------------- display */

  private showTip(text: string, e: PointerEvent): void {
    if (!this.tipEl) {
      // Reuses the tooltip skin; position is fixed so no ancestor clipping.
      this.tipEl = el('div', 'au-tooltip au-sparkline-tip');
      document.body.appendChild(this.tipEl);
    }
    this.tipEl.textContent = text;
    this.tipEl.style.left = `${e.clientX + 12}px`;
    this.tipEl.style.top = `${e.clientY - 28}px`;
    this.tipEl.style.display = 'block';
  }

  private hide(): void {
    this.lastKey = '';
    if (this.tipEl) this.tipEl.style.display = 'none';
  }
}
