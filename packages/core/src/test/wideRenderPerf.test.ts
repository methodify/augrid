import { expect, it } from 'vitest';
import { Grid } from '../grid.js';
import type { ColDefOrGroup } from '../types/colDef.js';
import { budget } from './perfBudget.js';

/**
 * Column-axis stress guard (a real consumer's shape): ~30+ destination column
 * groups × 5-11 measures ≈ 400 columns under a two-row grouped header, a
 * small pinned-left region, thousands of rows. The invariants:
 *  - rendered cells stay O(visible columns), not O(400)
 *  - vertical AND horizontal scroll passes stay flat as columns cycle
 *    through the virtualization window (incl. grouped-header maintenance)
 * jsdom numbers are JS-cost only (no layout/paint); real browsers run these
 * passes several times faster.
 */

type WideRow = Record<string, number | string> & { id: number };

const GROUPS = 40;
const MEASURES = 10; // 40 × 10 = 400 scrolling columns + 3 pinned
const ROWS = 5_000;

function makeWideDefs(): ColDefOrGroup<WideRow>[] {
  const defs: ColDefOrGroup<WideRow>[] = [
    { field: 'src1', headerName: 'Supply A', pinned: 'left', width: 110 },
    { field: 'src2', headerName: 'Supply B', pinned: 'left', width: 110 },
    { field: 'name', pinned: 'left', width: 140 },
  ];
  for (let g = 0; g < GROUPS; g++) {
    defs.push({
      headerName: `Dest ${g}`,
      children: Array.from({ length: MEASURES }, (_, m) => ({
        field: `g${g}m${m}`,
        headerName: `M${m}`,
        width: 90,
        cellDataType: 'number' as const,
      })),
    });
  }
  return defs;
}

function makeWideRows(n: number): WideRow[] {
  return Array.from({ length: n }, (_, i) => {
    const row: WideRow = { id: i, name: `item ${i}`, src1: i % 500, src2: (i * 3) % 400 };
    // Populate only the first groups' fields — valueGetter falls back to
    // undefined for the rest, matching sparse planning data. Cheaper to build,
    // same render cost per visible cell.
    for (let g = 0; g < 6; g++) {
      for (let m = 0; m < MEASURES; m++) row[`g${g}m${m}`] = (i * (g + 1) + m) % 1000;
    }
    return row;
  });
}

it(`render stays O(viewport) at ${GROUPS * MEASURES} columns in ${GROUPS} groups (planning-grid shape)`, () => {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const t0 = performance.now();
  const grid = new Grid<WideRow>(host, {
    columnDefs: makeWideDefs(),
    rowData: makeWideRows(ROWS),
    getRowId: (p) => String(p.data.id),
  });
  const ctx = grid.getContext();
  ctx.renderer.setViewportSizeForTesting(1600, 700);
  ctx.renderer.renderNow();
  const initial = performance.now() - t0;
  console.log(`initial render (${GROUPS * MEASURES} cols × ${ROWS} rows):`, initial.toFixed(1), 'ms (jsdom)');

  // Column virtualization: only the visible window of the 400 columns renders.
  const firstRowCells = host.querySelector('.au-center-spacer .au-row')!.querySelectorAll('.au-cell').length;
  // 1600px / 90px ≈ 18 visible + overscan; 400 would mean virtualization is off.
  expect(firstRowCells).toBeLessThan(60);
  // Grouped header: only groups over the window materialize.
  const groupHeaderCells = host.querySelectorAll('.au-header-group-cell').length;
  // Group-row cells are not column-windowed today (one bounded row; ~40 nodes
  // at this scale is cheap and they never rebuild on horizontal scroll).
  expect(groupHeaderCells).toBeLessThanOrEqual(GROUPS);

  // Vertical scroll passes (constant column window).
  let t = performance.now();
  const V_PASSES = 40;
  for (let i = 0; i < V_PASSES; i++) {
    ctx.renderer.ensureIndexVisible((i * 517) % (ROWS - 100), 'top');
    ctx.renderer.renderNow();
  }
  const vertical = (performance.now() - t) / V_PASSES;
  console.log('vertical scroll pass:', vertical.toFixed(2), 'ms (jsdom)');
  expect(vertical).toBeLessThan(budget(35));

  // Horizontal scroll passes — the wide axis: columns AND grouped header
  // cells cycle through the virtualization window.
  t = performance.now();
  const H_PASSES = 40;
  for (let i = 0; i < H_PASSES; i++) {
    ctx.renderer.ensureColumnVisible(`g${(i * 7) % GROUPS}m${i % MEASURES}`);
    ctx.renderer.renderNow();
  }
  const horizontal = (performance.now() - t) / H_PASSES;
  console.log('horizontal scroll pass:', horizontal.toFixed(2), 'ms (jsdom)');
  expect(horizontal).toBeLessThan(budget(35));

  // Full-width sweep left→far-right→left (worst case: every column cycles).
  t = performance.now();
  ctx.renderer.ensureColumnVisible(`g${GROUPS - 1}m${MEASURES - 1}`);
  ctx.renderer.renderNow();
  ctx.renderer.ensureColumnVisible('g0m0');
  ctx.renderer.renderNow();
  console.log('edge-to-edge sweep (2 passes):', (performance.now() - t).toFixed(1), 'ms (jsdom)');

  grid.destroy();
}, 30_000);
