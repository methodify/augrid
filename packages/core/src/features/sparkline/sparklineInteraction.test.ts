import { describe, expect, it } from 'vitest';
import { Grid } from '../../grid.js';
import { nearestPointIndex, slotIndexAt } from './sparkline.js';
import { SparklineDomains } from './sparklineDomains.js';
import { createMockContext } from '../../test/mockContext.js';
import type { ColDef } from '../../types/colDef.js';
import type { SparklinePointClickedEvent } from '../../types/events.js';

const BOX = { width: 100, height: 20, padding: 0 };

describe('hit-testing (pure)', () => {
  it('nearestPointIndex snaps to the closest point, skipping gaps', () => {
    // 5 points at x = 0, 25, 50, 75, 100
    expect(nearestPointIndex([1, 2, 3, 4, 5], null, BOX, 0)).toBe(0);
    expect(nearestPointIndex([1, 2, 3, 4, 5], null, BOX, 30)).toBe(1);
    expect(nearestPointIndex([1, 2, 3, 4, 5], null, BOX, 99)).toBe(4);
    // Gap at index 2: cursor over it snaps to a REAL neighbour.
    expect(nearestPointIndex([1, 2, null, 4, 5], null, BOX, 50)).not.toBe(2);
    expect(nearestPointIndex([], null, BOX, 50)).toBeNull();
  });

  it('nearestPointIndex honours irregular x positions', () => {
    // xs 0, 10, 90, 100 → pixel 40 is nearest the second point (x=10px)
    const xs = [0, 10, 90, 100];
    expect(nearestPointIndex([1, 2, 3, 4], xs, BOX, 40)).toBe(1);
    expect(nearestPointIndex([1, 2, 3, 4], xs, BOX, 70)).toBe(2);
  });

  it('slotIndexAt reads bars by slot, returning null over a gap slot', () => {
    // 4 slots of 25px each
    expect(slotIndexAt([1, 2, 3, 4], BOX, 10)).toBe(0);
    expect(slotIndexAt([1, 2, 3, 4], BOX, 60)).toBe(2);
    expect(slotIndexAt([1, 2, 3, 4], BOX, 99)).toBe(3);
    expect(slotIndexAt([1, null, 3, 4], BOX, 30)).toBeNull(); // gap slot
    expect(slotIndexAt([1, 2], BOX, -5)).toBe(0); // clamped
    expect(slotIndexAt([], BOX, 50)).toBeNull();
  });
});

describe("domain: 'group'", () => {
  interface GRow { cat: string; sku: string; trend: number[] }
  it('scopes the extent to the row group, falling back to column-wide when flat', () => {
    const { ctx, start } = createMockContext<GRow>({
      columnDefs: [
        { field: 'cat', rowGroup: true },
        { field: 'sku' },
        { colId: 'trend', valueGetter: (p) => p.data?.trend, sparkline: { type: 'line', domain: 'group' } },
      ] as ColDef<GRow>[],
      rowData: [
        { cat: 'small', sku: 'a', trend: [1, 2, 3] },
        { cat: 'small', sku: 'b', trend: [2, 4, 6] },
        { cat: 'big', sku: 'c', trend: [100, 200, 300] },
        { cat: 'big', sku: 'd', trend: [150, 250, 500] },
      ],
      groupDefaultExpanded: -1,
    });
    start();
    const domains = new SparklineDomains(ctx);
    // Find one leaf in each group.
    let smallLeaf, bigLeaf;
    for (let i = 0; i < ctx.rowModel.getRowCount(); i++) {
      const n = ctx.rowModel.getRow(i)!;
      if (n.data?.sku === 'a') smallLeaf = n;
      if (n.data?.sku === 'c') bigLeaf = n;
    }
    expect(domains.getForGroup('trend', smallLeaf!)).toEqual({ min: 1, max: 6 });
    expect(domains.getForGroup('trend', bigLeaf!)).toEqual({ min: 100, max: 500 });
    // Column-wide for comparison spans both.
    expect(domains.get('trend')).toEqual({ min: 1, max: 500 });
    domains.destroy();
  });

  it('flat grid: group domain equals the column-wide domain', () => {
    const { ctx, start } = createMockContext<{ t: number[] }>({
      columnDefs: [{ colId: 't', valueGetter: (p) => p.data?.t, sparkline: { domain: 'group' } }] as ColDef<{ t: number[] }>[],
      rowData: [{ t: [1, 5] }, { t: [2, 9] }],
    });
    start();
    const domains = new SparklineDomains(ctx);
    const leaf = ctx.rowModel.getRow(0)!;
    expect(domains.getForGroup('t', leaf)).toEqual(domains.get('t'));
    domains.destroy();
  });
});

describe('hover + click (DOM)', () => {
  interface Row { id: number; trend: number[] }
  function mount(sparkline: ColDef<Row>['sparkline'] = { type: 'line' }) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new Grid<Row>(host, {
      columnDefs: [{ colId: 'trend', valueGetter: (p) => p.data?.trend, sparkline, width: 120 }] as ColDef<Row>[],
      rowData: [{ id: 1, trend: [10, 20, 30, 40, 50] }],
      getRowId: (p) => String(p.data.id),
    });
    grid.getContext().renderer.setViewportSizeForTesting(600, 300);
    grid.getContext().renderer.renderNow();
    // jsdom has no layout: give the sparkline SVG a real rect so viewBox
    // mapping works (the interaction divides by rect width).
    const svg = host.querySelector('.au-sparkline')!;
    const w = Number(svg.getAttribute('width'));
    const h = Number(svg.getAttribute('height'));
    (svg as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    return { grid, host, svg, w };
  }

  const moveAt = (svg: Element, clientX: number) => {
    // PointerEvent isn't in jsdom: MouseEvent with the right type works for
    // our listener, which only reads clientX/target.
    const e = new MouseEvent('pointermove', { bubbles: true, clientX });
    svg.dispatchEvent(e);
  };

  it('hover shows a readout for the point under the cursor', () => {
    const { grid, svg, w } = mount();
    moveAt(svg, 1); // far left → first point
    let tip = document.querySelector('.au-sparkline-tip') as HTMLElement;
    expect(tip).toBeTruthy();
    expect(tip.textContent).toBe('1/5: 10');
    moveAt(svg, w - 1); // far right → last point
    tip = document.querySelector('.au-sparkline-tip') as HTMLElement;
    expect(tip.textContent).toBe('5/5: 50');
    grid.destroy();
    expect(document.querySelector('.au-sparkline-tip')).toBeNull(); // cleaned up
  });

  it('pointLabel overrides the readout text', () => {
    const { grid, svg } = mount({
      type: 'line',
      pointLabel: (p) => `Wk ${p.index + 1}: ${p.value}`,
    });
    moveAt(svg, 1);
    expect(document.querySelector('.au-sparkline-tip')!.textContent).toBe('Wk 1: 10');
    grid.destroy();
  });

  it('click dispatches sparklinePointClicked with the hit point', () => {
    const { grid, svg, w } = mount();
    const events: SparklinePointClickedEvent<Row>[] = [];
    grid.api.addEventListener('sparklinePointClicked', (e) => events.push(e));
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: w - 1 }));
    expect(events).toHaveLength(1);
    expect(events[0]!.index).toBe(4);
    expect(events[0]!.value).toBe(50);
    expect(events[0]!.colId).toBe('trend');
    expect(events[0]!.data?.id).toBe(1);
    grid.destroy();
  });

  it('suppressInteraction disables both hover and click', () => {
    const { grid, svg } = mount({ type: 'line', suppressInteraction: true });
    const events: unknown[] = [];
    grid.api.addEventListener('sparklinePointClicked', (e) => events.push(e));
    moveAt(svg, 1);
    expect(document.querySelector('.au-sparkline-tip')).toBeNull();
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1 }));
    expect(events).toHaveLength(0);
    grid.destroy();
  });

  it('scalar marks (bar) do not produce point interactions', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new Grid<{ id: number; v: number }>(host, {
      columnDefs: [{ field: 'v', sparkline: { type: 'bar' }, width: 120 }] as ColDef<{ id: number; v: number }>[],
      rowData: [{ id: 1, v: 42 }],
      getRowId: (p) => String(p.data.id),
    });
    grid.getContext().renderer.setViewportSizeForTesting(600, 300);
    grid.getContext().renderer.renderNow();
    const svg = host.querySelector('.au-sparkline')!;
    svg.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 10 }));
    expect(document.querySelector('.au-sparkline-tip')).toBeNull();
    grid.destroy();
  });
});
