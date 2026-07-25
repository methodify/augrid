import type {
  SparklineDatum,
  SparklineOptions,
  SparklinePoint,
  SparklineSummary,
} from '../../types/sparkline.js';

/**
 * Sparkline geometry — pure math, no DOM. Everything the renderer needs is
 * derived here so the shapes are unit-testable and the DOM layer stays a thin
 * "set these attributes" pass (house rule: logic-first).
 *
 * All output is in SVG user units matching the cell's pixel box, so no
 * viewBox scaling distorts stroke widths.
 */

export interface Extent {
  min: number;
  max: number;
}

export interface Box {
  width: number;
  height: number;
  /** Inset on every side so strokes and markers are not clipped. */
  padding: number;
}

/** Finite numbers only; null/NaN are gaps and never affect the scale. */
export function finiteValues(values: readonly (number | null)[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Y-axis extent. `domain: 'auto'` scales to this cell alone; an explicit
 * [min, max] (or a column-shared extent passed in) makes rows comparable —
 * the difference between "this row's trend" and "this row versus the others".
 * A flat series gets a symmetric band so it renders as a centered line rather
 * than collapsing onto an edge.
 */
export function computeExtent(
  values: readonly (number | null)[],
  domain: SparklineOptions['domain'],
  shared?: Extent | null,
): Extent {
  if (Array.isArray(domain)) return normalizeExtent({ min: domain[0], max: domain[1] });
  if (domain === 'shared' && shared) return normalizeExtent(shared);
  const finite = finiteValues(values);
  if (finite.length === 0) return { min: 0, max: 1 };
  let min = finite[0]!;
  let max = finite[0]!;
  for (const v of finite) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return normalizeExtent({ min, max });
}

function normalizeExtent(extent: Extent): Extent {
  let { min, max } = extent;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    // Flat series: give it a band so the line sits in the middle.
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 0.5;
    return { min: min - pad, max: max + pad };
  }
  return { min, max };
}

/** Merge extents (used to build a column-shared domain). */
export function mergeExtents(extents: readonly Extent[]): Extent | null {
  let min = Infinity;
  let max = -Infinity;
  for (const e of extents) {
    if (e.min < min) min = e.min;
    if (e.max > max) max = e.max;
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

/**
 * Map values to pixel points; gaps stay null so the path can break.
 * `xs` gives explicit horizontal positions (irregular axes); without it
 * points are spaced evenly by index.
 */
export function scalePoints(
  values: readonly (number | null)[],
  extent: Extent,
  box: Box,
  xs?: readonly (number | null)[] | null,
): (SparklinePoint | null)[] {
  const { width, height, padding } = box;
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  const span = extent.max - extent.min || 1;
  const step = values.length > 1 ? innerW / (values.length - 1) : 0;

  // Irregular axis: scale x by its own extent so real gaps in time show as
  // real gaps in space.
  let xMin = 0;
  let xSpan = 0;
  const useXs = xs != null && xs.some((x) => typeof x === 'number' && Number.isFinite(x));
  if (useXs) {
    const finite = (xs as readonly (number | null)[]).filter(
      (x): x is number => typeof x === 'number' && Number.isFinite(x),
    );
    xMin = Math.min(...finite);
    xSpan = Math.max(...finite) - xMin || 1;
  }

  return values.map((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    let x: number;
    if (useXs) {
      const raw = xs![i];
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
      x = padding + ((raw - xMin) / xSpan) * innerW;
    } else {
      x = padding + (values.length > 1 ? i * step : innerW / 2);
    }
    const y = padding + innerH - ((v - extent.min) / span) * innerH;
    return { x: round(x), y: round(y), value: v, index: i };
  });
}

/** Y pixel for a data value (reference lines, zero baseline). */
export function valueToY(value: number, extent: Extent, box: Box): number {
  const innerH = Math.max(1, box.height - box.padding * 2);
  const span = extent.max - extent.min || 1;
  return round(box.padding + innerH - ((value - extent.min) / span) * innerH);
}

/** Path through the points, starting a new subpath after each gap. */
export function linePath(points: readonly (SparklinePoint | null)[]): string {
  let d = '';
  let penDown = false;
  for (const p of points) {
    if (!p) {
      penDown = false;
      continue;
    }
    d += `${penDown ? 'L' : 'M'}${p.x} ${p.y}`;
    penDown = true;
  }
  return d;
}

/**
 * Filled area under the line, closed to `baseY`. Each gap-free run becomes its
 * own closed subpath so gaps do not fill across.
 */
export function areaPath(points: readonly (SparklinePoint | null)[], baseY: number): string {
  let d = '';
  let run: SparklinePoint[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    if (run.length === 1) {
      // A lone point has no width to fill; emit a hairline so it stays visible.
      const p = run[0]!;
      d += `M${p.x} ${baseY}L${p.x} ${p.y}Z`;
    } else {
      d += `M${run[0]!.x} ${baseY}`;
      for (const p of run) d += `L${p.x} ${p.y}`;
      d += `L${run[run.length - 1]!.x} ${baseY}Z`;
    }
    run = [];
  };
  for (const p of points) {
    if (p) run.push(p);
    else flush();
  }
  flush();
  return d;
}

/**
 * Columns as ONE path per polarity (positive/negative) rather than a rect per
 * bar — the DOM cost of a sparkline stays constant no matter how many points
 * the series has.
 */
export function columnPaths(
  values: readonly (number | null)[],
  extent: Extent,
  box: Box,
  gapRatio = 0.25,
): { positive: string; negative: string } {
  const { width, height, padding } = box;
  const innerW = Math.max(1, width - padding * 2);
  const n = values.length;
  if (n === 0) return { positive: '', negative: '' };
  const slot = innerW / n;
  const barW = Math.max(1, round(slot * (1 - gapRatio)));
  const offset = (slot - barW) / 2;
  // Bars grow from zero when the range crosses it, else from the nearer edge.
  const baseValue = extent.min > 0 ? extent.min : extent.max < 0 ? extent.max : 0;
  const baseY = valueToY(baseValue, extent, box);

  let positive = '';
  let negative = '';
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const x = round(padding + i * slot + offset);
    const y = valueToY(v, extent, box);
    const top = Math.min(y, baseY);
    const h = Math.max(1, Math.abs(y - baseY));
    const seg = `M${x} ${round(top)}h${barW}v${round(h)}h${-barW}Z`;
    if (v < baseValue) negative += seg;
    else positive += seg;
  }
  return { positive, negative };
}

/**
 * Win/loss: equal-height marks above (win) or below (loss) the midline, with
 * zero rendered as nothing. Magnitude is deliberately ignored.
 */
export function winLossPaths(
  values: readonly (number | null)[],
  box: Box,
  gapRatio = 0.25,
): { positive: string; negative: string } {
  const { width, height, padding } = box;
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  const n = values.length;
  if (n === 0) return { positive: '', negative: '' };
  const slot = innerW / n;
  const barW = Math.max(1, round(slot * (1 - gapRatio)));
  const offset = (slot - barW) / 2;
  const mid = round(padding + innerH / 2);
  const barH = round(innerH / 2 - 1);

  let positive = '';
  let negative = '';
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) continue;
    const x = round(padding + i * slot + offset);
    const seg =
      v > 0
        ? `M${x} ${mid - barH}h${barW}v${barH}h${-barW}Z`
        : `M${x} ${mid}h${barW}v${barH}h${-barW}Z`;
    if (v > 0) positive += seg;
    else negative += seg;
  }
  return { positive, negative };
}

/** Points that get marker dots, per the options. Order: min, max, first, last. */
export function markerPoints(
  points: readonly (SparklinePoint | null)[],
  markers: NonNullable<SparklineOptions['markers']>,
): { point: SparklinePoint; kind: 'min' | 'max' | 'first' | 'last' }[] {
  const real = points.filter((p): p is SparklinePoint => p !== null);
  if (real.length === 0) return [];
  const out: { point: SparklinePoint; kind: 'min' | 'max' | 'first' | 'last' }[] = [];
  if (markers.min) {
    out.push({ point: real.reduce((a, b) => (b.value < a.value ? b : a)), kind: 'min' });
  }
  if (markers.max) {
    out.push({ point: real.reduce((a, b) => (b.value > a.value ? b : a)), kind: 'max' });
  }
  if (markers.first) out.push({ point: real[0]!, kind: 'first' });
  if (markers.last) out.push({ point: real[real.length - 1]!, kind: 'last' });
  return out;
}

export interface Series {
  /** Y values; null = gap (never coerced to zero). */
  values: (number | null)[];
  /** Explicit x positions when the data carried them, else null. */
  xs: (number | null)[] | null;
}

/**
 * Coerce a cell value into a series. Accepts `number[]`, `{x, y}[]`, dates as
 * x, and numeric strings; anything else yields an empty series so a
 * misconfigured column renders blank instead of throwing in the scroll path.
 */
export function toSeries(value: unknown): Series {
  if (!Array.isArray(value)) return { values: [], xs: null };
  const values: (number | null)[] = [];
  const xs: (number | null)[] = [];
  let sawX = false;

  for (const v of value) {
    if (typeof v === 'number') {
      values.push(Number.isFinite(v) ? v : null);
      xs.push(null);
      continue;
    }
    if (v == null) {
      values.push(null);
      xs.push(null);
      continue;
    }
    if (typeof v === 'object') {
      const rec = v as Record<string, unknown>;
      if ('y' in rec) {
        const y = rec.y;
        values.push(typeof y === 'number' && Number.isFinite(y) ? y : null);
        const x = rec.x;
        const xn = x instanceof Date ? x.getTime() : typeof x === 'number' ? x : Number(x);
        if (Number.isFinite(xn)) {
          xs.push(xn);
          sawX = true;
        } else {
          xs.push(null);
        }
        continue;
      }
    }
    const n = Number(v);
    values.push(Number.isFinite(n) ? n : null);
    xs.push(null);
  }
  return { values, xs: sawX ? xs : null };
}

/**
 * Reduce a series to one number for sorting (and value display). Returns null
 * for an empty series so those rows sort together rather than as zero.
 */
export function summarize(
  values: readonly (number | null)[],
  kind: SparklineSummary = 'last',
): number | null {
  const finite = finiteValues(values);
  if (finite.length === 0) return null;
  switch (kind) {
    case 'first':
      return finite[0]!;
    case 'last':
      return finite[finite.length - 1]!;
    case 'min':
      return Math.min(...finite);
    case 'max':
      return Math.max(...finite);
    case 'sum':
      return finite.reduce((s, v) => s + v, 0);
    case 'mean':
      return finite.reduce((s, v) => s + v, 0) / finite.length;
    case 'slope':
      return leastSquaresSlope(values);
  }
}

/**
 * Least-squares slope over (index, value), skipping gaps — "who is rising
 * fastest". A single point has no trend, so it reports 0.
 */
export function leastSquaresSlope(values: readonly (number | null)[]): number {
  let n = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  values.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    n++;
    sumX += i;
    sumY += v;
    sumXY += i * v;
    sumXX += i * i;
  });
  if (n < 2) return 0;
  const denom = n * sumXX - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

/** Extent of a series, or null when it holds no finite values. */
export function seriesExtent(values: readonly (number | null)[]): Extent | null {
  const finite = finiteValues(values);
  if (finite.length === 0) return null;
  return { min: Math.min(...finite), max: Math.max(...finite) };
}

/** Two decimals is below one device pixel and keeps path strings short. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
