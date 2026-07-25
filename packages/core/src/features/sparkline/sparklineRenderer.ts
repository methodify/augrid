import type { SparklineOptions } from '../../types/sparkline.js';
import {
  areaPath,
  columnPaths,
  computeExtent,
  linePath,
  markerPoints,
  scalePoints,
  toSeries,
  valueToY,
  winLossPaths,
  type Extent,
} from './sparkline.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * DOM layer for sparklines: creates the SVG once per recycled cell and
 * thereafter only rewrites attributes. Node count is constant per cell
 * (2 paths + a reference line + up to 4 markers) regardless of series
 * length, so a sparkline column costs the same as a text column in the
 * scroll path.
 */
export class SparklineCell {
  readonly root: SVGSVGElement;
  private shapeA: SVGPathElement;
  private shapeB: SVGPathElement;
  private refLine: SVGLineElement | null = null;
  private markerEls: SVGCircleElement[] = [];
  private lastKey = '';

  constructor() {
    this.root = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    this.root.setAttribute('class', 'au-sparkline');
    this.root.setAttribute('preserveAspectRatio', 'none');
    this.root.setAttribute('focusable', 'false');
    this.root.setAttribute('role', 'img');
    this.shapeA = document.createElementNS(SVG_NS, 'path');
    this.shapeB = document.createElementNS(SVG_NS, 'path');
    this.root.append(this.shapeB, this.shapeA); // fills under strokes
  }

  /**
   * Draw `value` (an array of numbers) at the given pixel box. `shared` is the
   * column-wide extent when `domain: 'shared'`.
   */
  update(
    value: unknown,
    options: SparklineOptions,
    width: number,
    height: number,
    shared: Extent | null,
  ): void {
    const { values, xs } = toSeries(value);
    const padding = options.padding ?? 2;
    const box = { width: Math.max(4, width), height: Math.max(4, height), padding };
    const type = options.type ?? 'line';

    // Skip all DOM writes when nothing observable changed (cells are recycled
    // across rows, so this fires constantly during scroll).
    const key = `${type}|${box.width}x${box.height}|${values.join(',')}|${
      shared ? `${shared.min}:${shared.max}` : ''
    }`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.root.setAttribute('width', String(box.width));
    this.root.setAttribute('height', String(box.height));
    this.root.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    this.root.setAttribute('aria-label', this.label(values, options));

    if (values.length === 0) {
      this.shapeA.setAttribute('d', '');
      this.shapeB.setAttribute('d', '');
      this.setMarkers([], options);
      this.setReference(null, options, box, { min: 0, max: 1 });
      return;
    }

    const stroke = options.color ?? 'var(--au-sparkline-color, var(--au-accent-color, #2563eb))';
    const lineWidth = String(options.lineWidth ?? 1.25);
    // Bars and area fills want different weights: an area under a line should
    // be a translucent wash, but a BAR must read at the same visual weight as
    // its negative counterpart — otherwise equal magnitudes look unequal.
    const isBar = type === 'column' || type === 'winLoss';
    const fill =
      options.fill ??
      (isBar
        ? 'var(--au-sparkline-bar-color, rgba(37, 99, 235, .75))'
        : 'var(--au-sparkline-fill, rgba(37, 99, 235, .18))');
    const negFill =
      options.negativeFill ?? 'var(--au-sparkline-negative-color, rgba(220, 38, 38, .75))';

    if (isBar) {
      const extent =
        type === 'winLoss'
          ? { min: -1, max: 1 }
          : computeExtent(values, options.domain, shared);
      const paths =
        type === 'winLoss'
          ? winLossPaths(values, box, options.columnGap)
          : columnPaths(values, extent, box, options.columnGap);
      this.shapeA.setAttribute('d', paths.positive);
      this.shapeA.setAttribute('fill', fill);
      this.shapeA.setAttribute('stroke', 'none');
      this.shapeB.setAttribute('d', paths.negative);
      this.shapeB.setAttribute('fill', negFill);
      this.shapeB.setAttribute('stroke', 'none');
      this.setMarkers([], options);
      this.setReference(options.referenceValue, options, box, extent);
      return;
    }

    const extent = computeExtent(values, options.domain, shared);
    const points = scalePoints(values, extent, box, xs);
    this.shapeA.setAttribute('d', linePath(points));
    this.shapeA.setAttribute('fill', 'none');
    this.shapeA.setAttribute('stroke', stroke);
    this.shapeA.setAttribute('stroke-width', lineWidth);
    this.shapeA.setAttribute('stroke-linejoin', 'round');
    this.shapeA.setAttribute('stroke-linecap', 'round');

    if (type === 'area') {
      const baseValue = extent.min > 0 ? extent.min : extent.max < 0 ? extent.max : 0;
      this.shapeB.setAttribute('d', areaPath(points, valueToY(baseValue, extent, box)));
      this.shapeB.setAttribute('fill', fill);
      this.shapeB.setAttribute('stroke', 'none');
    } else {
      this.shapeB.setAttribute('d', '');
    }

    this.setMarkers(
      options.markers ? markerPoints(points, options.markers) : [],
      options,
    );
    this.setReference(options.referenceValue, options, box, extent);
  }

  private setMarkers(
    marks: { point: { x: number; y: number }; kind: string }[],
    options: SparklineOptions,
  ): void {
    const size = String(options.markers?.size ?? 2);
    // Reuse existing circles; only grow/shrink the pool when the count changes.
    while (this.markerEls.length < marks.length) {
      const c = document.createElementNS(SVG_NS, 'circle');
      this.markerEls.push(c);
      this.root.appendChild(c);
    }
    while (this.markerEls.length > marks.length) {
      this.markerEls.pop()!.remove();
    }
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
      this.root.insertBefore(this.refLine, this.shapeA);
    }
    const y = String(valueToY(value, extent, box));
    this.refLine.setAttribute('x1', String(box.padding));
    this.refLine.setAttribute('x2', String(box.width - box.padding));
    this.refLine.setAttribute('y1', y);
    this.refLine.setAttribute('y2', y);
    if (options.referenceColor) this.refLine.setAttribute('stroke', options.referenceColor);
  }

  /** Screen readers get a summary; the SVG itself is decorative. */
  private label(values: (number | null)[], options: SparklineOptions): string {
    if (options.ariaLabel) return options.ariaLabel(values);
    const finite = values.filter((v): v is number => typeof v === 'number');
    if (finite.length === 0) return 'No data';
    const fmt = (n: number): string => String(Math.round(n * 100) / 100);
    const first = finite[0]!;
    const last = finite[finite.length - 1]!;
    const trend = last > first ? 'up' : last < first ? 'down' : 'flat';
    return (
      `${finite.length} points, ${trend} from ${fmt(first)} to ${fmt(last)}, ` +
      `min ${fmt(Math.min(...finite))}, max ${fmt(Math.max(...finite))}`
    );
  }
}
