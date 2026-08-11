import { describe, expect, it } from 'vitest';
import { createMockContext } from '../test/mockContext.js';
import { dropSlotAtY } from './rowDragService.js';
import type { ClientSideRowModel } from '../rows/clientSideRowModel.js';

describe('dropSlotAtY (pure)', () => {
  const tops = [0, 32, 64, 96, 128];
  it('maps y to the nearest slot boundary by row midpoints', () => {
    expect(dropSlotAtY(tops, 4, -5)).toBe(0);
    expect(dropSlotAtY(tops, 4, 10)).toBe(0);
    expect(dropSlotAtY(tops, 4, 20)).toBe(1); // past row 0's midpoint
    expect(dropSlotAtY(tops, 4, 79)).toBe(2);
    expect(dropSlotAtY(tops, 4, 80)).toBe(3); // exactly on the midpoint → after
    expect(dropSlotAtY(tops, 4, 999)).toBe(4); // end slot
  });
  it('handles variable heights', () => {
    const t = [0, 32, 152, 184, 216]; // row 1 is 120 tall
    expect(dropSlotAtY(t, 4, 90)).toBe(1);
    expect(dropSlotAtY(t, 4, 100)).toBe(2);
  });
});

describe('managed reorder (moveRowToIndex)', () => {
  it('reorders the source leaves and rewrites source indexes', () => {
    const { ctx, start } = createMockContext<{ id: string }>({
      columnDefs: [{ field: 'id', rowDrag: true }],
      rowData: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      getRowId: (p) => p.data.id,
      rowDragManaged: true,
    });
    start();
    const model = ctx.rowModel as ClientSideRowModel<{ id: string }>;
    const a = model.getRowNode('a')!;
    model.moveRowToIndex(a, 3); // drop before row index 3 → a lands at 2
    const order = () => Array.from({ length: 4 }, (_, i) => model.getRow(i)!.id);
    expect(order()).toEqual(['b', 'c', 'a', 'd']);
    model.moveRowToIndex(a, 0);
    expect(order()).toEqual(['a', 'b', 'c', 'd']);
    model.moveRowToIndex(a, 4); // end slot
    expect(order()).toEqual(['b', 'c', 'd', 'a']);
  });
});
