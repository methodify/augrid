import { describe, expect, it } from 'vitest';
import { createMockContext } from '../../test/mockContext.js';
import { Grid } from '../../grid.js';
import {
  areaPath,
  columnPaths,
  computeExtent,
  leastSquaresSlope,
  linePath,
  markerPoints,
  mergeExtents,
  scalePoints,
  seriesExtent,
  summarize,
  toSeries,
  valueToY,
  winLossPaths,
} from './sparkline.js';
import type { ColDef } from '../../types/colDef.js';

const BOX = { width: 100, height: 20, padding: 0 };

/* ------------------------------------------------------------------ series */

describe('toSeries', () => {
  it('accepts numbers, nulls, numeric strings, and {x,y} objects', () => {
    expect(toSeries([1, 2, 3])).toEqual({ values: [1, 2, 3], xs: null });
    expect(toSeries([1, null, 3]).values).toEqual([1, null, 3]);
    expect(toSeries(['4', '5']).values).toEqual([4, 5]);
    expect(toSeries([{ y: 7 }, { y: null }]).values).toEqual([7, null]);
    // NaN/Infinity are gaps, never plotted as zero.
    expect(toSeries([Number.NaN, Infinity, 2]).values).toEqual([null, null, 2]);
  });

  it('carries explicit x positions (irregular axes), including Dates', () => {
    const s = toSeries([
      { x: 0, y: 1 },
      { x: 10, y: 2 },
    ]);
    expect(s.xs).toEqual([0, 10]);
    const d = toSeries([{ x: new Date(2026, 0, 1), y: 1 }]);
    expect(d.xs![0]).toBe(new Date(2026, 0, 1).getTime());
  });

  it('returns an empty series for non-arrays instead of throwing', () => {
    expect(toSeries(undefined).values).toEqual([]);
    expect(toSeries('nope').values).toEqual([]);
    expect(toSeries(42).values).toEqual([]);
  });
});

/* ------------------------------------------------------------------- scale */

describe('scale engine', () => {
  it('auto domain uses the series extent; gaps never affect it', () => {
    expect(computeExtent([2, null, 8], 'auto')).toEqual({ min: 2, max: 8 });
  });

  it('a flat series gets a band so it renders centered, not on an edge', () => {
    const extent = computeExtent([5, 5, 5], 'auto');
    expect(extent.min).toBeLessThan(5);
    expect(extent.max).toBeGreaterThan(5);
    const points = scalePoints([5, 5, 5], extent, BOX);
    expect(points[0]!.y).toBeCloseTo(BOX.height / 2, 5);
  });

  it('explicit and shared domains override the series', () => {
    expect(computeExtent([1, 2], [0, 100])).toEqual({ min: 0, max: 100 });
    expect(computeExtent([1, 2], 'shared', { min: -5, max: 50 })).toEqual({ min: -5, max: 50 });
    // 'shared' with no computed extent falls back to the cell's own.
    expect(computeExtent([1, 2], 'shared', null)).toEqual({ min: 1, max: 2 });
  });

  it('handles reversed/degenerate explicit domains and empty series', () => {
    expect(computeExtent([1], [10, 0])).toEqual({ min: 0, max: 10 });
    expect(computeExtent([], 'auto')).toEqual({ min: 0, max: 1 });
    expect(computeExtent([null, null], 'auto')).toEqual({ min: 0, max: 1 });
  });

  it('scales points into the box, inverted (higher value = smaller y)', () => {
    const pts = scalePoints([0, 10], { min: 0, max: 10 }, BOX);
    expect(pts[0]).toMatchObject({ x: 0, y: 20, value: 0, index: 0 });
    expect(pts[1]).toMatchObject({ x: 100, y: 0, value: 10, index: 1 });
  });

  it('spaces points by explicit x when present (irregular axis)', () => {
    // x = 0, 1, 9 → the last gap is 8x wider than the first.
    const pts = scalePoints([1, 2, 3], { min: 1, max: 3 }, BOX, [0, 1, 9]);
    expect(pts[0]!.x).toBe(0);
    expect(pts[1]!.x).toBeCloseTo(100 / 9, 1);
    expect(pts[2]!.x).toBe(100);
  });

  it('centers a single point', () => {
    expect(scalePoints([5], { min: 0, max: 10 }, BOX)[0]!.x).toBe(50);
  });

  it('mergeExtents unions, ignoring empties', () => {
    expect(mergeExtents([{ min: 1, max: 4 }, { min: -2, max: 2 }])).toEqual({ min: -2, max: 4 });
    expect(mergeExtents([])).toBeNull();
    expect(seriesExtent([null, null])).toBeNull();
  });
});

/* ------------------------------------------------------------------- paths */

describe('path geometry', () => {
  it('line path breaks at gaps instead of bridging them', () => {
    const pts = scalePoints([0, null, 10], { min: 0, max: 10 }, BOX);
    const d = linePath(pts);
    expect(d.startsWith('M')).toBe(true);
    // Two subpaths: the gap starts a new M rather than an L across it.
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).not.toContain('L100 0M');
  });

  it('area path closes each gap-free run to the baseline separately', () => {
    const pts = scalePoints([0, 10, null, 5], { min: 0, max: 10 }, BOX);
    const d = areaPath(pts, valueToY(0, { min: 0, max: 10 }, BOX));
    expect(d.match(/Z/g)).toHaveLength(2); // one closed run per side of the gap
  });

  it('columns render as one path per polarity, split at zero', () => {
    const extent = computeExtent([-5, 5], 'auto');
    const { positive, negative } = columnPaths([-5, 5], extent, BOX);
    expect(positive).not.toBe('');
    expect(negative).not.toBe('');
    // Constant node count: every bar lives in the same path string.
    expect(columnPaths([1, 2, 3, 4, 5], extent, BOX).positive.match(/M/g)).toHaveLength(5);
  });

  it('columns grow from the nearer edge when the range excludes zero', () => {
    const extent = computeExtent([10, 20], 'auto');
    const { positive, negative } = columnPaths([10, 20], extent, BOX);
    expect(negative).toBe(''); // all positive relative to the baseline
    expect(positive.match(/M/g)).toHaveLength(2);
  });

  it('win/loss ignores magnitude and drops zeros', () => {
    const { positive, negative } = winLossPaths([5, -1, 0, 100], BOX);
    expect(positive.match(/M/g)).toHaveLength(2); // 5 and 100, equal height
    expect(negative.match(/M/g)).toHaveLength(1); // -1
    // Both wins are identical marks apart from their x offset.
    const heights = [...positive.matchAll(/v(-?[\d.]+)/g)].map((m) => m[1]);
    expect(new Set(heights).size).toBe(1);
  });

  it('picks marker points by kind', () => {
    const pts = scalePoints([3, 9, 1, 5], { min: 1, max: 9 }, BOX);
    const marks = markerPoints(pts, { min: true, max: true, first: true, last: true });
    expect(marks.map((m) => [m.kind, m.point.value])).toEqual([
      ['min', 1],
      ['max', 9],
      ['first', 3],
      ['last', 5],
    ]);
  });
});

/* ---------------------------------------------------------------- summaries */

describe('summaries (what sorting a series column means)', () => {
  it('reduces a series per kind, skipping gaps', () => {
    const s = [2, null, 4, 6];
    expect(summarize(s, 'first')).toBe(2);
    expect(summarize(s, 'last')).toBe(6);
    expect(summarize(s, 'min')).toBe(2);
    expect(summarize(s, 'max')).toBe(6);
    expect(summarize(s, 'sum')).toBe(12);
    expect(summarize(s, 'mean')).toBe(4);
    expect(summarize([], 'last')).toBeNull();
    expect(summarize([null], 'sum')).toBeNull();
  });

  it('slope measures trend direction and steepness', () => {
    expect(leastSquaresSlope([1, 2, 3, 4])).toBeCloseTo(1, 6);
    expect(leastSquaresSlope([4, 3, 2, 1])).toBeCloseTo(-1, 6);
    expect(leastSquaresSlope([5, 5, 5])).toBeCloseTo(0, 6);
    expect(leastSquaresSlope([1, 10])).toBeCloseTo(9, 6);
    expect(leastSquaresSlope([7])).toBe(0); // one point has no trend
  });
});

/* ------------------------------------------------------- grid integration */

interface Row {
  id: number;
  name: string;
  trend: (number | null)[];
}

const ROWS: Row[] = [
  { id: 1, name: 'flat', trend: [5, 5, 5, 5] },
  { id: 2, name: 'rising', trend: [1, 2, 8, 20] },
  { id: 3, name: 'falling', trend: [30, 20, 10, 2] },
  { id: 4, name: 'gappy', trend: [4, null, 6] },
];

const COLS = (sparkline: ColDef<Row>['sparkline']): ColDef<Row>[] => [
  { field: 'name' },
  { field: 'trend', sparkline, width: 120 },
];

function mount(sparkline: ColDef<Row>['sparkline'] = { type: 'line' }, extra: object = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const grid = new Grid<Row>(host, {
    columnDefs: COLS(sparkline),
    rowData: ROWS,
    getRowId: (p) => String(p.data.id),
    ...extra,
  });
  grid.getContext().renderer.setViewportSizeForTesting(600, 300);
  grid.getContext().renderer.renderNow();
  return { grid, host };
}

describe('sparkline cells (DOM)', () => {
  it('renders one SVG per cell with a constant node count regardless of series length', () => {
    const { grid, host } = mount({ type: 'line', markers: { last: true } });
    const svgs = host.querySelectorAll('.au-sparkline');
    expect(svgs.length).toBe(ROWS.length);
    const long = mount({ type: 'line', markers: { last: true } }, {
      rowData: [{ id: 9, name: 'long', trend: Array.from({ length: 500 }, (_, i) => i) }],
    });
    // 500 points, still: 2 shape paths + 1 marker.
    expect(long.host.querySelector('.au-sparkline')!.children.length).toBe(3);
    expect(host.querySelector('.au-sparkline')!.children.length).toBe(3);
    grid.destroy();
    long.grid.destroy();
  });

  it('draws a path with real geometry and an aria summary', () => {
    const { grid, host } = mount();
    const svg = host.querySelectorAll('.au-sparkline')[1]!; // 'rising'
    const d = svg.querySelector('path:last-of-type')!.getAttribute('d')!;
    expect(d).toMatch(/^M[\d.]+ [\d.]+L/); // moveTo then lineTo
    expect(svg.getAttribute('aria-label')).toContain('up from 1 to 20');
    expect(svg.getAttribute('role')).toBe('img');
    grid.destroy();
  });

  it('gap rows break the line into two subpaths', () => {
    const { grid, host } = mount();
    const svg = host.querySelectorAll('.au-sparkline')[3]!; // 'gappy'
    const d = svg.querySelector('path:last-of-type')!.getAttribute('d')!;
    expect(d.match(/M/g)).toHaveLength(2);
    grid.destroy();
  });

  it('shared domain makes rows comparable: a flat row sits low against tall peers', () => {
    const auto = mount({ type: 'line', domain: 'auto' });
    const shared = mount({ type: 'line', domain: 'shared' });
    const yOf = (host: HTMLElement, row: number): number =>
      Number(
        /M[\d.]+ ([\d.]+)/.exec(
          host.querySelectorAll('.au-sparkline')[row]!.querySelector('path:last-of-type')!.getAttribute('d')!,
        )![1],
      );
    // 'flat' (all 5s) centers under auto…
    expect(yOf(auto.host, 0)).toBeCloseTo((32 - 8) / 2, 0);
    // …but sits near the bottom when scaled against the column's max of 30.
    expect(yOf(shared.host, 0)).toBeGreaterThan(yOf(auto.host, 0));
    auto.grid.destroy();
    shared.grid.destroy();
  });

  it('renders column and winLoss types with polarity fills', () => {
    const col = mount({ type: 'column' }, { rowData: [{ id: 1, name: 'v', trend: [-3, 4] }] });
    const paths = col.host.querySelectorAll('.au-sparkline path');
    expect(paths[0]!.getAttribute('d')).toContain('M'); // negative path
    expect(paths[1]!.getAttribute('d')).toContain('M'); // positive path
    col.grid.destroy();

    const wl = mount({ type: 'winLoss' }, { rowData: [{ id: 1, name: 'v', trend: [1, -1, 0] }] });
    expect(wl.host.querySelector('.au-sparkline path')!.getAttribute('d')).toContain('M');
    wl.grid.destroy();
  });

  it('adds a reference line only when a reference value is given', () => {
    const without = mount({ type: 'line' });
    expect(without.host.querySelector('.au-sparkline-reference')).toBeNull();
    without.grid.destroy();
    const withRef = mount({ type: 'line', referenceValue: 5 });
    expect(withRef.host.querySelector('.au-sparkline-reference')).toBeTruthy();
    withRef.grid.destroy();
  });

  it('leaves the cell empty for a non-array value instead of drawing garbage', () => {
    const { grid, host } = mount({ type: 'line' }, {
      rowData: [{ id: 1, name: 'bad', trend: 'oops' as unknown as number[] }],
    });
    const d = host.querySelector('.au-sparkline path:last-of-type')!.getAttribute('d');
    expect(d).toBe('');
    expect(host.querySelector('.au-sparkline')!.getAttribute('aria-label')).toBe('No data');
    grid.destroy();
  });
});

describe('sparkline column semantics', () => {
  it('sorts by the series summary (default last), not by array identity', () => {
    const { grid } = mount({ type: 'line' });
    grid.api.setSortModel([{ colId: 'trend', sort: 'asc' }]);
    const order = (): string[] => {
      const out: string[] = [];
      grid.api.forEachNodeAfterFilterAndSort((n) => out.push(n.data!.name));
      return out;
    };
    // last values: flat 5, rising 20, falling 2, gappy 6
    expect(order()).toEqual(['falling', 'flat', 'gappy', 'rising']);
    grid.destroy();
  });

  it('sortBy: slope orders by trend direction (who is rising fastest)', () => {
    const { grid } = mount({ type: 'line', sortBy: 'slope' });
    grid.api.setSortModel([{ colId: 'trend', sort: 'desc' }]);
    const out: string[] = [];
    grid.api.forEachNodeAfterFilterAndSort((n) => out.push(n.data!.name));
    expect(out[0]).toBe('rising');
    expect(out[out.length - 1]).toBe('falling');
    grid.destroy();
  });

  it('clipboard and CSV emit the underlying series, not [object Object]', () => {
    const { grid } = mount();
    const csv = grid.api.getDataAsCsv({ useFormattedValues: false });
    expect(csv).toContain('1 2 8 20');
    expect(csv).not.toContain('[object');
    // Gaps round-trip as empty slots.
    expect(csv).toContain('4  6');
    grid.destroy();
  });
});
