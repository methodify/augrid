import { expect, it } from 'vitest';
import { Grid } from '../grid.js';
import type { ColDef } from '../types/colDef.js';
import { budget } from './perfBudget.js';

interface Row {
  id: number; a: string; b: string; c: number; d: number; e: number; f: string; g: number;
}

function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i, a: `alpha ${i}`, b: `beta ${i % 97}`, c: i % 1000, d: (i * 7) % 500,
    e: i % 12, f: `f${i % 31}`, g: i,
  }));
}

const columnDefs: ColDef<Row>[] = [
  { field: 'a', pinned: 'left' }, { field: 'b' }, { field: 'c' }, { field: 'd' },
  { field: 'e' }, { field: 'f' }, { field: 'g' },
];

/**
 * Render-pass cost guard: a full virtualized render pass over 100k rows must
 * stay far under a frame budget. jsdom DOM ops are slower than real browsers,
 * so the threshold is generous; regressions of the O(visible) invariant (e.g.
 * accidentally rendering all rows) blow through it by orders of magnitude.
 */
it('scroll render passes stay cheap at 100k rows', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const grid = new Grid<Row>(host, {
    columnDefs,
    rowData: makeRows(100_000),
    getRowId: (p) => String(p.data.id),
  });
  const ctx = grid.getContext();
  ctx.renderer.setViewportSizeForTesting(1200, 600);
  ctx.renderer.renderNow();

  const rendered = host.querySelectorAll('.au-row').length;
  // 600px viewport / 32px rows ≈ 19 rows + 2×3 buffer ≈ 25; ×2 regions (left+center)
  expect(rendered).toBeLessThan(80);

  const passes = 60;
  const t0 = performance.now();
  for (let i = 0; i < passes; i++) {
    ctx.renderer.ensureIndexVisible((i * 1637) % 99_000, 'top');
    ctx.renderer.renderNow();
  }
  const perPass = (performance.now() - t0) / passes;
  console.log("render pass:", perPass.toFixed(2), "ms (jsdom)");
  // Real browsers run this in ~1-3ms; jsdom is ~5-10x slower. 25ms = regression.
  expect(perPass).toBeLessThan(budget(25));

  grid.destroy();
}, 30_000);
