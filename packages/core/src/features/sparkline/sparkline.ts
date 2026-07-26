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
  if ((domain === 'shared' || domain === 'group') && shared) return normalizeExtent(shared);
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
  /** Envelope bounds for the `band` mark, when the data carried them. */
  lows: (number | null)[] | null;
  highs: (number | null)[] | null;
}

/**
 * Coerce a cell value into a series. Accepts `number[]`, `{x, y}[]`, dates as
 * x, and numeric strings; anything else yields an empty series so a
 * misconfigured column renders blank instead of throwing in the scroll path.
 */
export function toSeries(value: unknown): Series {
  if (!Array.isArray(value)) return { values: [], xs: null, lows: null, highs: null };
  const values: (number | null)[] = [];
  const xs: (number | null)[] = [];
  const lows: (number | null)[] = [];
  const highs: (number | null)[] = [];
  let sawX = false;
  let sawBounds = false;

  const num = (v: unknown): number | null => {
    // null/undefined/'' are GAPS, not zero — Number(null) === 0 would silently
    // turn a missing bucket into a real zero, which the whole design forbids.
    if (v == null || v === '') return null;
    const n = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  for (const v of value) {
    if (typeof v === 'number') {
      values.push(Number.isFinite(v) ? v : null);
      xs.push(null);
      lows.push(null);
      highs.push(null);
      continue;
    }
    if (v == null) {
      values.push(null);
      xs.push(null);
      lows.push(null);
      highs.push(null);
      continue;
    }
    if (typeof v === 'object' && 'y' in (v as Record<string, unknown>)) {
      const rec = v as Record<string, unknown>;
      values.push(num(rec.y));
      const x = num(rec.x);
      if (x !== null) sawX = true;
      xs.push(x);
      const low = num(rec.low);
      const high = num(rec.high);
      if (low !== null || high !== null) sawBounds = true;
      lows.push(low);
      highs.push(high);
      continue;
    }
    values.push(num(v));
    xs.push(null);
    lows.push(null);
    highs.push(null);
  }
  return {
    values,
    xs: sawX ? xs : null,
    lows: sawBounds ? lows : null,
    highs: sawBounds ? highs : null,
  };
}

/** Extent covering a series and (when present) its envelope bounds. */
export function seriesExtentWithBounds(series: Series): Extent | null {
  const all: (number | null)[] = [...series.values];
  if (series.lows) all.push(...series.lows);
  if (series.highs) all.push(...series.highs);
  return seriesExtent(all);
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

/* ------------------------------------------------------- scalar mark shapes */

export interface BarShape {
  /** Filled portion. */
  x: number;
  width: number;
  y: number;
  height: number;
  negative: boolean;
  /** Zero/baseline position, for drawing an axis rule when the range crosses it. */
  baselineX: number;
}

/**
 * Data bar: magnitude relative to the column's domain. When the domain spans
 * zero the bar grows left or right from the zero position, so positive and
 * negative values are immediately distinguishable rather than merely differently
 * coloured.
 */
export function barShape(value: number, extent: Extent, box: Box): BarShape {
  const { width, height, padding } = box;
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  const barH = Math.max(2, Math.round(innerH * 0.62));
  const y = padding + (innerH - barH) / 2;
  const span = extent.max - extent.min || 1;
  const toX = (v: number): number => padding + ((v - extent.min) / span) * innerW;
  // Baseline is zero when in range, else the nearer edge.
  const baseValue = extent.min > 0 ? extent.min : extent.max < 0 ? extent.max : 0;
  const baselineX = toX(baseValue);
  const valueX = toX(clampNumber(value, extent.min, extent.max));
  const x = Math.min(baselineX, valueX);
  const w = Math.max(1, Math.abs(valueX - baselineX));
  return {
    x: round(x),
    width: round(w),
    y: round(y),
    height: barH,
    negative: value < baseValue,
    baselineX: round(baselineX),
  };
}

export interface BulletShape {
  /** The measure bar (the actual value). */
  bar: { x: number; width: number; y: number; height: number };
  /** Target tick; null when no usable target was supplied. */
  target: { x: number; y: number; height: number } | null;
  /** Qualitative background bands, innermost first. */
  bands: { x: number; width: number }[];
  y: number;
  height: number;
}

/**
 * Bullet: actual against target, the planning question. A thin measure bar
 * over qualitative bands, with the target as a perpendicular tick — Few's
 * bullet graph, minus the axis labels a cell has no room for.
 */
export function bulletShape(
  value: number,
  target: number | null,
  bands: number[] | undefined,
  extent: Extent,
  box: Box,
): BulletShape {
  const { width, height, padding } = box;
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  const span = extent.max - extent.min || 1;
  const toX = (v: number): number =>
    padding + ((clampNumber(v, extent.min, extent.max) - extent.min) / span) * innerW;

  const barH = Math.max(2, Math.round(innerH * 0.34));
  const barY = padding + (innerH - barH) / 2;
  const zeroX = toX(extent.min > 0 ? extent.min : extent.max < 0 ? extent.max : 0);
  const valueX = toX(value);

  return {
    y: round(padding),
    height: round(innerH),
    bar: {
      x: round(Math.min(zeroX, valueX)),
      width: round(Math.max(1, Math.abs(valueX - zeroX))),
      y: round(barY),
      height: barH,
    },
    target:
      target != null && Number.isFinite(target)
        ? { x: round(toX(target)), y: round(padding + innerH * 0.12), height: round(innerH * 0.76) }
        : null,
    bands: (bands ?? [])
      .filter((b) => Number.isFinite(b))
      .sort((a, b) => a - b)
      .map((b) => ({ x: round(padding), width: round(Math.max(0, toX(b) - padding)) })),
  };
}

/** Band (envelope) path plus the actual line, for forecast-range marks. */
export function bandPaths(
  values: readonly (number | null)[],
  lows: readonly (number | null)[],
  highs: readonly (number | null)[],
  extent: Extent,
  box: Box,
  xs?: readonly (number | null)[] | null,
): { envelope: string; line: string } {
  const hi = scalePoints(highs, extent, box, xs);
  const lo = scalePoints(lows, extent, box, xs);
  const line = linePath(scalePoints(values, extent, box, xs));

  // One closed polygon per run where BOTH bounds exist.
  let envelope = '';
  let run: { hi: SparklinePoint; lo: SparklinePoint }[] = [];
  const flush = (): void => {
    if (run.length >= 2) {
      envelope += `M${run[0]!.hi.x} ${run[0]!.hi.y}`;
      for (const p of run.slice(1)) envelope += `L${p.hi.x} ${p.hi.y}`;
      for (const p of [...run].reverse()) envelope += `L${p.lo.x} ${p.lo.y}`;
      envelope += 'Z';
    }
    run = [];
  };
  for (let i = 0; i < hi.length; i++) {
    const h = hi[i];
    const l = lo[i];
    if (h && l) run.push({ hi: h, lo: l });
    else flush();
  }
  flush();
  return { envelope, line };
}

function clampNumber(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Two decimals is below one device pixel and keeps path strings short. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Inverse of scalePoints' x mapping: which point index is nearest to pixel
 * `x`? Gap entries are skipped (they have no mark to read). Null when the
 * series is empty. Pure, so hover hit-testing is testable without a DOM.
 */
export function nearestPointIndex(
  values: readonly (number | null)[],
  xs: readonly (number | null)[] | null,
  box: Box,
  x: number,
): number | null {
  const points = scalePoints(values, computeExtent(values, 'auto'), box, xs);
  let best: number | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    if (!p) continue;
    const d = Math.abs(p.x - x);
    if (d < bestDist) {
      bestDist = d;
      best = p.index;
    }
  }
  return best;
}

/**
 * For column/winLoss marks the cursor reads by SLOT, not by nearest center —
 * a bar occupies its whole slot. Returns the slot index under `x`, or null
 * when that slot holds a gap.
 */
export function slotIndexAt(
  values: readonly (number | null)[],
  box: Box,
  x: number,
): number | null {
  const n = values.length;
  if (n === 0) return null;
  const innerW = Math.max(1, box.width - box.padding * 2);
  const idx = Math.floor(((x - box.padding) / innerW) * n);
  const clamped = Math.max(0, Math.min(n - 1, idx));
  return typeof values[clamped] === 'number' && Number.isFinite(values[clamped] as number)
    ? clamped
    : null;
}
