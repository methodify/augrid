import type { SparklineOptions } from '../../types/sparkline.js';
import {
  areaPath,
  bandPaths,
  barShape,
  bulletShape,
  columnPaths,
  computeExtent,
  linePath,
  markerPoints,
  scalePoints,
  seriesExtentWithBounds,
  summarize,
  toSeries,
  valueToY,
  winLossPaths,
  type Extent,
} from './sparkline.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Marks whose cell value is a single number rather than a series. */
const SCALAR = new Set(['bar', 'bullet', 'delta']);

export interface SparklineDrawContext {
  /** Column-wide extent when `domain: 'shared'`. */
  shared: Extent | null;
  /** Resolved target/baseline for scalar marks. */
  target: number | null;
  baseline: number | null;
  /** Formatter for `showValue`, supplied by the cell (column's own formatter). */
  format: (value: number) => string;
}

/**
 * DOM layer for cell visuals: creates the SVG once per recycled cell and
 * thereafter only rewrites attributes. Node count stays constant per cell
 * regardless of series length (the whole series is one path), so a visual
 * column costs the same as a text column in the scroll path.
 */
export class SparklineCell {
  readonly root: HTMLElement;
  private svg: SVGSVGElement;
  private shapeA: SVGPathElement;
  private shapeB: SVGPathElement;
  private refLine: SVGLineElement | null = null;
  private rects: SVGRectElement[] = [];
  private markerEls: SVGCircleElement[] = [];
  private valueEl: HTMLElement | null = null;
  private lastKey = '';

  constructor() {
    // A flex wrapper so an optional value can sit beside the mark.
    this.root = document.createElement('span');
    this.root.className = 'au-sparkline-cell';
    this.svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    this.svg.setAttribute('class', 'au-sparkline');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.setAttribute('focusable', 'false');
    this.svg.setAttribute('role', 'img');
    this.shapeA = document.createElementNS(SVG_NS, 'path');
    this.shapeB = document.createElementNS(SVG_NS, 'path');
    this.svg.append(this.shapeB, this.shapeA); // fills under strokes
    this.root.appendChild(this.svg);
  }

  update(
    value: unknown,
    options: SparklineOptions,
    width: number,
    height: number,
    draw: SparklineDrawContext,
  ): void {
    const type = options.type ?? 'line';
    const scalar = SCALAR.has(type);
    const padding = options.padding ?? 2;
    const series = scalar ? null : toSeries(value);
    const scalarValue = scalar ? (typeof value === 'number' && Number.isFinite(value) ? value : null) : null;

    // Reserve space for the value text when composing number + mark.
    const showValue = options.showValue ?? false;
    const valueWidth = showValue === false ? 0 : (options.valueWidth ?? 56);
    const markWidth = Math.max(4, width - valueWidth);
    const box = { width: markWidth, height: Math.max(4, height), padding };

    const key = [
      type,
      `${box.width}x${box.height}`,
      scalar ? scalarValue : series!.values.join(','),
      series?.lows?.join(',') ?? '',
      series?.highs?.join(',') ?? '',
      draw.shared ? `${draw.shared.min}:${draw.shared.max}` : '',
      draw.target,
      draw.baseline,
      String(showValue),
    ].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.svg.setAttribute('width', String(box.width));
    this.svg.setAttribute('height', String(box.height));
    this.svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);

    const stroke = options.color ?? 'var(--au-sparkline-color, var(--au-accent-color, #2563eb))';
    const lineWidth = String(options.lineWidth ?? 1.25);
    const isBarLike = type === 'column' || type === 'winLoss';
    const fill =
      options.fill ??
      (isBarLike
        ? 'var(--au-sparkline-bar-color, rgba(37, 99, 235, .75))'
        : 'var(--au-sparkline-fill, rgba(37, 99, 235, .18))');
    const negFill =
      options.negativeFill ?? 'var(--au-sparkline-negative-color, rgba(220, 38, 38, .75))';

    if (scalar) {
      this.drawScalar(type, scalarValue, options, box, draw, stroke, negFill);
    } else {
      this.drawSeries(type, series!, options, box, draw, { stroke, fill, negFill, lineWidth });
    }

    this.setValueText(value, options, scalar, series?.values ?? [], scalarValue, draw, valueWidth);
    this.svg.setAttribute('aria-label', this.label(type, scalar, series?.values ?? [], scalarValue, options, draw));
  }

  /* -------------------------------------------------------------- series */

  private drawSeries(
    type: string,
    series: ReturnType<typeof toSeries>,
    options: SparklineOptions,
    box: { width: number; height: number; padding: number },
    draw: SparklineDrawContext,
    colors: { stroke: string; fill: string; negFill: string; lineWidth: string },
  ): void {
    const { values, xs } = series;
    if (values.length === 0) {
      this.shapeA.setAttribute('d', '');
      this.shapeB.setAttribute('d', '');
      this.setRects([], '');
      this.setMarkers([], options);
      this.setReference(null, options, box, { min: 0, max: 1 });
      return;
    }

    if (type === 'column' || type === 'winLoss') {
      const extent =
        type === 'winLoss' ? { min: -1, max: 1 } : computeExtent(values, options.domain, draw.shared);
      const paths =
        type === 'winLoss'
          ? winLossPaths(values, box, options.columnGap)
          : columnPaths(values, extent, box, options.columnGap);
      this.setPath(this.shapeA, paths.positive, colors.fill);
      this.setPath(this.shapeB, paths.negative, colors.negFill);
      this.setRects([], '');
      this.setMarkers([], options);
      this.setReference(options.referenceValue, options, box, extent);
      return;
    }

    // line / area / band all share the line scale.
    const extent =
      type === 'band' && (series.lows || series.highs)
        ? (options.domain === 'shared' && draw.shared
            ? draw.shared
            : Array.isArray(options.domain)
              ? computeExtent(values, options.domain, draw.shared)
              : (seriesExtentWithBounds(series) ?? computeExtent(values, options.domain, draw.shared)))
        : computeExtent(values, options.domain, draw.shared);

    if (type === 'band') {
      const { envelope, line } = bandPaths(
        values,
        series.lows ?? values,
        series.highs ?? values,
        extent,
        box,
        xs,
      );
      this.setPath(this.shapeB, envelope, colors.fill);
      this.shapeA.setAttribute('d', line);
      this.shapeA.setAttribute('fill', 'none');
      this.shapeA.setAttribute('stroke', colors.stroke);
      this.shapeA.setAttribute('stroke-width', colors.lineWidth);
      this.setRects([], '');
      this.setMarkers([], options);
      this.setReference(options.referenceValue, options, box, extent);
      return;
    }

    const points = scalePoints(values, extent, box, xs);
    this.shapeA.setAttribute('d', linePath(points));
    this.shapeA.setAttribute('fill', 'none');
    this.shapeA.setAttribute('stroke', colors.stroke);
    this.shapeA.setAttribute('stroke-width', colors.lineWidth);
    this.shapeA.setAttribute('stroke-linejoin', 'round');
    this.shapeA.setAttribute('stroke-linecap', 'round');

    if (type === 'area') {
      const baseValue = extent.min > 0 ? extent.min : extent.max < 0 ? extent.max : 0;
      this.setPath(this.shapeB, areaPath(points, valueToY(baseValue, extent, box)), colors.fill);
    } else {
      this.shapeB.setAttribute('d', '');
    }
    this.setRects([], '');
    this.setMarkers(options.markers ? markerPoints(points, options.markers) : [], options);
    this.setReference(options.referenceValue, options, box, extent);
  }

  /* -------------------------------------------------------------- scalar */

  private drawScalar(
    type: string,
    value: number | null,
    options: SparklineOptions,
    box: { width: number; height: number; padding: number },
    draw: SparklineDrawContext,
    stroke: string,
    negFill: string,
  ): void {
    this.shapeA.setAttribute('d', '');
    this.shapeB.setAttribute('d', '');
    this.setMarkers([], options);
    this.setReference(null, options, box, { min: 0, max: 1 });
    if (value == null) {
      this.setRects([], '');
      return;
    }

    // Scalar marks compare ACROSS rows, so a column-shared domain is the
    // meaningful default; per-cell scaling would make every bar full-width.
    const extent = Array.isArray(options.domain)
      ? computeExtent([value], options.domain, null)
      : (draw.shared ?? { min: Math.min(0, value), max: Math.max(0, value) || 1 });

    const pos = options.positiveColor ?? 'var(--au-sparkline-bar-color, rgba(37, 99, 235, .75))';
    const neg = options.negativeColor ?? negFill;

    if (type === 'bar') {
      const s = barShape(value, extent, box);
      this.setRects(
        [{ x: s.x, y: s.y, width: s.width, height: s.height, rx: 1 }],
        s.negative ? neg : pos,
      );
      return;
    }

    if (type === 'delta') {
      const base = draw.baseline;
      const change = base == null ? value : value - base;
      const magnitudeExtent = draw.shared ?? { min: -Math.abs(change) || -1, max: Math.abs(change) || 1 };
      const s = barShape(change, magnitudeExtent, box);
      this.setRects(
        [{ x: s.x, y: s.y, width: s.width, height: s.height, rx: 1 }],
        change < 0 ? neg : pos,
      );
      return;
    }

    // bullet
    const s = bulletShape(value, draw.target, options.bands, extent, box);
    const rects: RectSpec[] = [];
    // Qualitative bands, palest first (widest drawn first so narrower overlay).
    [...s.bands].reverse().forEach((b, i) => {
      rects.push({
        x: b.x,
        y: s.y,
        width: b.width,
        height: s.height,
        rx: 1,
        className: `au-sparkline-band au-sparkline-band-${i}`,
      });
    });
    rects.push({ x: s.bar.x, y: s.bar.y, width: s.bar.width, height: s.bar.height, rx: 1, fill: pos });
    if (s.target) {
      rects.push({
        x: s.target.x - 1,
        y: s.target.y,
        width: 2,
        height: s.target.height,
        className: 'au-sparkline-target',
      });
    }
    this.setRects(rects, pos);
  }

  /* --------------------------------------------------------------- parts */

  private setPath(el: SVGPathElement, d: string, fill: string): void {
    el.setAttribute('d', d);
    el.setAttribute('fill', fill);
    el.setAttribute('stroke', 'none');
  }

  private setRects(specs: RectSpec[], defaultFill: string): void {
    while (this.rects.length < specs.length) {
      const r = document.createElementNS(SVG_NS, 'rect');
      this.rects.push(r);
      this.svg.insertBefore(r, this.shapeB);
    }
    while (this.rects.length > specs.length) this.rects.pop()!.remove();
    specs.forEach((s, i) => {
      const r = this.rects[i]!;
      r.setAttribute('x', String(s.x));
      r.setAttribute('y', String(s.y));
      r.setAttribute('width', String(Math.max(0, s.width)));
      r.setAttribute('height', String(s.height));
      r.setAttribute('rx', String(s.rx ?? 0));
      r.setAttribute('class', s.className ?? '');
      if (s.className) r.removeAttribute('fill');
      else r.setAttribute('fill', s.fill ?? defaultFill);
    });
  }

  private setMarkers(
    marks: { point: { x: number; y: number }; kind: string }[],
    options: SparklineOptions,
  ): void {
    const size = String(options.markers?.size ?? 2);
    while (this.markerEls.length < marks.length) {
      const c = document.createElementNS(SVG_NS, 'circle');
      this.markerEls.push(c);
      this.svg.appendChild(c);
    }
    while (this.markerEls.length > marks.length) this.markerEls.pop()!.remove();
    marks.forEach((m, i) => {
      const c = this.markerEls[i]!;
      c.setAttribute('cx', String(m.point.x));
      c.setAttribute('cy', String(m.point.y));
      c.setAttribute('r', size);
      c.setAttribute('class', `au-sparkline-marker au-sparkline-marker-${m.kind}`);
    });
  }

  private setReference(
    value: number | null | undefined,
    options: SparklineOptions,
    box: { width: number; height: number; padding: number },
    extent: Extent,
  ): void {
    if (value == null || !Number.isFinite(value)) {
      this.refLine?.remove();
      this.refLine = null;
      return;
    }
    if (!this.refLine) {
      this.refLine = document.createElementNS(SVG_NS, 'line');
      this.refLine.setAttribute('class', 'au-sparkline-reference');
      this.svg.insertBefore(this.refLine, this.shapeA);
    }
    const y = String(valueToY(value, extent, box));
    this.refLine.setAttribute('x1', String(box.padding));
    this.refLine.setAttribute('x2', String(box.width - box.padding));
    this.refLine.setAttribute('y1', y);
    this.refLine.setAttribute('y2', y);
    if (options.referenceColor) this.refLine.setAttribute('stroke', options.referenceColor);
  }

  /** Number beside the mark, formatted by the column so it matches the grid. */
  private setValueText(
    _raw: unknown,
    options: SparklineOptions,
    scalar: boolean,
    values: (number | null)[],
    scalarValue: number | null,
    draw: SparklineDrawContext,
    valueWidth: number,
  ): void {
    const show = options.showValue ?? false;
    if (show === false) {
      this.valueEl?.remove();
      this.valueEl = null;
      this.root.classList.remove('au-sparkline-cell-valued', 'au-sparkline-value-right');
      return;
    }
    if (!this.valueEl) {
      this.valueEl = document.createElement('span');
      this.valueEl.className = 'au-sparkline-value';
      this.root.insertBefore(this.valueEl, this.svg);
    }
    const right = options.valuePosition === 'right';
    this.root.classList.add('au-sparkline-cell-valued');
    this.root.classList.toggle('au-sparkline-value-right', right);
    // Keep DOM order matching visual order for copy/screen-reader sanity.
    if (right && this.valueEl.nextSibling === this.svg) this.root.appendChild(this.valueEl);
    else if (!right && this.svg.nextSibling === this.valueEl) this.root.insertBefore(this.valueEl, this.svg);
    this.valueEl.style.width = `${valueWidth}px`;

    const n = scalar || show === 'value' ? scalarValue : summarize(values, show as never);
    this.valueEl.textContent = n == null ? '' : draw.format(n);
  }

  private label(
    type: string,
    scalar: boolean,
    values: (number | null)[],
    scalarValue: number | null,
    options: SparklineOptions,
    draw: SparklineDrawContext,
  ): string {
    if (options.ariaLabel) return options.ariaLabel(values);
    const fmt = (n: number): string => draw.format(n);
    if (scalar) {
      if (scalarValue == null) return 'No data';
      if (type === 'bullet') {
        return draw.target == null
          ? fmt(scalarValue)
          : `${fmt(scalarValue)} against target ${fmt(draw.target)}` +
              ` (${scalarValue >= draw.target ? 'at or above' : 'below'})`;
      }
      if (type === 'delta' && draw.baseline != null) {
        const change = scalarValue - draw.baseline;
        return `${fmt(scalarValue)}, ${change >= 0 ? 'up' : 'down'} ${fmt(Math.abs(change))} from ${fmt(draw.baseline)}`;
      }
      return fmt(scalarValue);
    }
    const finite = values.filter((v): v is number => typeof v === 'number');
    if (finite.length === 0) return 'No data';
    const first = finite[0]!;
    const last = finite[finite.length - 1]!;
    const trend = last > first ? 'up' : last < first ? 'down' : 'flat';
    return (
      `${finite.length} points, ${trend} from ${fmt(first)} to ${fmt(last)}, ` +
      `min ${fmt(Math.min(...finite))}, max ${fmt(Math.max(...finite))}`
    );
  }
}

interface RectSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  fill?: string;
  className?: string;
}
