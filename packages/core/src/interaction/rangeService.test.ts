/**
 * NOTE ON HARNESS: this test should use createMockContext from ../test/mockContext,
 * but that harness value-imports rows/clientSideRowModel.ts, which currently has a
 * syntax error (line 415: `?? r.rowHeight || def` — mixing `??` with `||` without
 * parentheses is invalid JS/TS), so any module graph containing it fails to
 * transform. Until the kernel is fixed, this file assembles an equivalent context
 * from the real kernel pieces (OptionsService, EventService, ValueService,
 * ColumnModel, gridApi, RowNode) plus a minimal flat row model covering the
 * IRowModel methods RangeService uses (getRow, getRowCount, onRowDataPatched).
 */
import { describe, expect, it, vi } from 'vitest';
import type { GridContext } from '../context.js';
import { RangeService } from './rangeService.js';
import {
  RANGE_IN,
  RANGE_TOP,
  RANGE_RIGHT,
  RANGE_BOTTOM,
  RANGE_LEFT,
  RANGE_HANDLE,
} from '../context.js';
import { OptionsService } from '../options.js';
import { EventService } from '../events/eventService.js';
import { ValueService } from '../values/valueService.js';
import { ColumnModel } from '../columns/columnModel.js';
import { createGridApi } from '../gridApi.js';
import { RowNode } from '../rows/rowNode.js';
import type { GridOptions } from '../types/gridOptions.js';
import type { CellPosition } from '../types/base.js';

interface Row {
  a: number;
  b: string;
  c: number;
  d: string;
}

const columnDefs = [{ field: 'a' }, { field: 'b' }, { field: 'c' }, { field: 'd' }];

function rows(): Row[] {
  return [
    { a: 1, b: 'x', c: 10, d: 'd0' },
    { a: 3, b: 'y', c: 20, d: 'd1' },
    { a: 100, b: 'z', c: 30, d: 'd2' },
    { a: 100, b: 'w', c: 40, d: 'd3' },
    { a: 100, b: 'v', c: 50, d: 'd4' },
    { a: 100, b: 'u', c: 60, d: 'd5' },
  ];
}

function setup(extra: Partial<GridOptions<Row>> = {}) {
  const ctx = { gridId: 'test-grid', destroyed: false } as unknown as GridContext<Row>;
  ctx.options = new OptionsService<Row>({
    cellSelection: true,
    columnDefs,
    rowData: rows(),
    ...extra,
  });
  ctx.events = new EventService<Row>();
  ctx.values = new ValueService(ctx);
  ctx.columnModel = new ColumnModel(ctx);
  ctx.scheduleRender = () => {};
  ctx.renderNow = () => {};
  ctx.selection = null as unknown as GridContext<Row>['selection'];
  ctx.editing = {
    isEditing: () => false,
    isEditingCell: () => false,
    getEditingCells: () => [],
    startEditing: () => false,
    stopEditing: () => false,
    mountEditorInto: () => {},
    commitValue: (node, colId, newValue, source) => ctx.values.setValue(node, colId, newValue, source),
    destroy: () => {},
  };
  ctx.renderer = {
    eRoot: document.createElement('div'),
  } as unknown as GridContext<Row>['renderer'];

  const nodes = (ctx.options.get('rowData') ?? []).map((d, i) => {
    const n = new RowNode<Row>(ctx);
    n.data = d;
    n.rowIndex = i;
    n.__sourceIndex = i;
    return n;
  });
  ctx.rowModel = {
    type: 'clientSide',
    start: () => {},
    destroy: () => {},
    getRowCount: () => nodes.length,
    getRow: (i: number) => nodes[i],
    getRowNode: (id: string) => nodes.find((n) => n.id === id),
    getTotalHeight: () => nodes.length * 32,
    getRowTop: (i: number) => i * 32,
    getRowHeightAt: () => 32,
    getRowIndexAtPixel: (y: number) => Math.floor(y / 32),
    isDataLoaded: () => true,
    forEachNode: (fn: (node: RowNode<Row>, index: number) => void) =>
      nodes.forEach((n, i) => fn(n, i)),
    onGroupExpandedChanged: () => {},
    onRowDataPatched: () => {},
    onSortChanged: () => {},
    onFilterChanged: () => {},
  } as unknown as GridContext<Row>['rowModel'];
  ctx.api = createGridApi(ctx);
  ctx.columnModel.setColumnDefs(ctx.options.get('columnDefs') ?? []);

  const svc = new RangeService<Row>(ctx);
  ctx.range = svc;
  return { ctx, svc };
}

function pos(rowIndex: number, colId: string): CellPosition {
  return { rowIndex, colId, rowPinned: null };
}

describe('RangeService — ranges', () => {
  it('setRangeToCell creates a single-cell range and returns copies', () => {
    const { svc } = setup();
    svc.setRangeToCell(pos(2, 'b'));
    const ranges = svc.getCellRanges();
    expect(ranges).toEqual([{ startRowIndex: 2, endRowIndex: 2, colIds: ['b'] }]);
    // mutating the returned copy must not affect internal state
    ranges[0].colIds.push('zzz');
    ranges[0].startRowIndex = 99;
    expect(svc.getCellRanges()).toEqual([{ startRowIndex: 2, endRowIndex: 2, colIds: ['b'] }]);
  });

  it('extendLatestRangeToCell keeps the anchor and recomputes the column run in display order', () => {
    const { svc } = setup();
    svc.setRangeToCell(pos(1, 'b'));
    svc.extendLatestRangeToCell(pos(3, 'd'));
    expect(svc.getCellRanges()).toEqual([
      { startRowIndex: 1, endRowIndex: 3, colIds: ['b', 'c', 'd'] },
    ]);
    // extend the other way: anchor (1,'b') stays; columns still in display order
    svc.extendLatestRangeToCell(pos(0, 'a'));
    expect(svc.getCellRanges()).toEqual([
      { startRowIndex: 1, endRowIndex: 0, colIds: ['a', 'b'] },
    ]);
  });

  it('ctrl+mousedown adds an additional range; plain mousedown clears others', () => {
    const { svc } = setup();
    svc.onCellMouseDown(pos(0, 'a'), new MouseEvent('mousedown'));
    document.dispatchEvent(new MouseEvent('mouseup'));
    svc.onCellMouseDown(pos(2, 'c'), new MouseEvent('mousedown', { ctrlKey: true }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(svc.getCellRanges()).toEqual([
      { startRowIndex: 0, endRowIndex: 0, colIds: ['a'] },
      { startRowIndex: 2, endRowIndex: 2, colIds: ['c'] },
    ]);
    // shift+mousedown extends the latest range
    svc.onCellMouseDown(pos(4, 'd'), new MouseEvent('mousedown', { shiftKey: true }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(svc.getCellRanges()[1]).toEqual({ startRowIndex: 2, endRowIndex: 4, colIds: ['c', 'd'] });
    // plain mousedown replaces everything
    svc.onCellMouseDown(pos(1, 'b'), new MouseEvent('mousedown'));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(svc.getCellRanges()).toEqual([{ startRowIndex: 1, endRowIndex: 1, colIds: ['b'] }]);
    svc.destroy();
  });

  it('suppressMultiRanges makes ctrl+mousedown replace instead of add', () => {
    const { svc } = setup({ cellSelection: { suppressMultiRanges: true } });
    svc.onCellMouseDown(pos(0, 'a'), new MouseEvent('mousedown'));
    document.dispatchEvent(new MouseEvent('mouseup'));
    svc.onCellMouseDown(pos(2, 'c'), new MouseEvent('mousedown', { ctrlKey: true }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(svc.getCellRanges()).toEqual([{ startRowIndex: 2, endRowIndex: 2, colIds: ['c'] }]);
    svc.destroy();
  });

  it('clearCellSelection empties ranges and fires a finished event', () => {
    const { ctx, svc } = setup();
    svc.setRangeToCell(pos(1, 'a'));
    const spy = vi.fn();
    ctx.events.addEventListener('cellSelectionChanged', spy);
    svc.clearCellSelection();
    expect(svc.getCellRanges()).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ ranges: [], finished: true });
  });

  it('dispatches cellSelectionChanged with finished=true on API changes and finished=false during drag preview', () => {
    const { ctx, svc } = setup();
    const events: { finished: boolean; ranges: unknown }[] = [];
    ctx.events.addEventListener('cellSelectionChanged', (e) =>
      events.push({ finished: e.finished, ranges: e.ranges }),
    );
    svc.setRangeToCell(pos(0, 'a'));
    expect(events[0]).toMatchObject({
      finished: true,
      ranges: [{ startRowIndex: 0, endRowIndex: 0, colIds: ['a'] }],
    });
    svc._extendLatestRangeToCell(pos(2, 'b'), false);
    expect(events[1]).toMatchObject({
      finished: false,
      ranges: [{ startRowIndex: 0, endRowIndex: 2, colIds: ['a', 'b'] }],
    });
  });

  it('addCellRange pushes a range and ignores the selection checkbox column', () => {
    const { svc } = setup();
    svc.addCellRange({ startRowIndex: 0, endRowIndex: 1, colIds: ['a', 'b'] });
    svc.addCellRange({ startRowIndex: 3, endRowIndex: 4, colIds: ['au-selection-col', 'c'] });
    expect(svc.getCellRanges()).toEqual([
      { startRowIndex: 0, endRowIndex: 1, colIds: ['a', 'b'] },
      { startRowIndex: 3, endRowIndex: 4, colIds: ['c'] },
    ]);
    // selection-col-only cell is never a range target
    svc.setRangeToCell(pos(0, 'au-selection-col'));
    expect(svc.getCellRanges().length).toBe(2);
  });
});

describe('RangeService — getCellFlags', () => {
  it('reports in-range and edge bits, normalizing inverted row order', () => {
    const { svc } = setup();
    svc.setRangeToCell(pos(3, 'b'));
    svc.extendLatestRangeToCell(pos(1, 'd')); // anchor row 3, end row 1 (inverted)
    expect(svc.getCellFlags(1, 'b')).toBe(RANGE_IN | RANGE_TOP | RANGE_LEFT);
    expect(svc.getCellFlags(1, 'd')).toBe(RANGE_IN | RANGE_TOP | RANGE_RIGHT);
    expect(svc.getCellFlags(3, 'b')).toBe(RANGE_IN | RANGE_BOTTOM | RANGE_LEFT);
    expect(svc.getCellFlags(3, 'd')).toBe(RANGE_IN | RANGE_BOTTOM | RANGE_RIGHT);
    expect(svc.getCellFlags(2, 'c')).toBe(RANGE_IN);
    expect(svc.getCellFlags(0, 'b')).toBe(0);
    expect(svc.getCellFlags(2, 'a')).toBe(0);
  });

  it('sets RANGE_HANDLE on the bottom-right cell of the latest range only when handle enabled', () => {
    const noHandle = setup(); // cellSelection: true → no fill handle
    noHandle.svc.setRangeToCell(pos(0, 'a'));
    noHandle.svc.extendLatestRangeToCell(pos(1, 'b'));
    expect(noHandle.svc.getCellFlags(1, 'b') & RANGE_HANDLE).toBe(0);

    const { svc } = setup({ cellSelection: { handle: 'fill' } });
    svc.setRangeToCell(pos(0, 'a'));
    svc.extendLatestRangeToCell(pos(1, 'b'));
    svc.addCellRange({ startRowIndex: 3, endRowIndex: 4, colIds: ['c', 'd'] });
    // handle lives on the LATEST range's bottom-right cell
    expect(svc.getCellFlags(1, 'b') & RANGE_HANDLE).toBe(0);
    expect(svc.getCellFlags(4, 'd') & RANGE_HANDLE).toBe(RANGE_HANDLE);
    expect(svc.getCellFlags(4, 'c') & RANGE_HANDLE).toBe(0);
    expect(svc.getCellFlags(3, 'd') & RANGE_HANDLE).toBe(0);
  });
});

describe('RangeService — fill', () => {
  it('fill down repeats non-numeric values cyclically', () => {
    const { ctx, svc } = setup({ cellSelection: { handle: true } });
    svc._executeFill({ minRow: 0, maxRow: 1, colIds: ['b'] }, 'down', 3);
    expect(ctx.rowModel.getRow(2)!.data!.b).toBe('x');
    expect(ctx.rowModel.getRow(3)!.data!.b).toBe('y');
    expect(ctx.rowModel.getRow(4)!.data!.b).toBe('x');
  });

  it('fill down linear-extends a numeric series using the last consecutive delta', () => {
    const { ctx, svc } = setup({ cellSelection: { handle: true } });
    // col a rows 0..1 = [1, 3] → delta 2 → 5, 7
    const final = svc._executeFill({ minRow: 0, maxRow: 1, colIds: ['a'] }, 'down', 2);
    expect(ctx.rowModel.getRow(2)!.data!.a).toBe(5);
    expect(ctx.rowModel.getRow(3)!.data!.a).toBe(7);
    expect(final).toEqual({ startRowIndex: 0, endRowIndex: 3, colIds: ['a'] });
  });

  it('fill up traverses values away from the source (reversed order)', () => {
    const { ctx, svc } = setup({ cellSelection: { handle: true } });
    // col c rows 2..3 = [30, 40]; upward order [40, 30] → delta -10 → row 1 gets 20, row 0 gets 10
    svc._executeFill({ minRow: 2, maxRow: 3, colIds: ['c'] }, 'up', 2);
    expect(ctx.rowModel.getRow(1)!.data!.c).toBe(20);
    expect(ctx.rowModel.getRow(0)!.data!.c).toBe(10);
  });

  it('fill right fills row-wise into following displayed columns', () => {
    const { ctx, svc } = setup({ cellSelection: { handle: true } });
    // source col b rows 0..1 (single value per row → repeat)
    const final = svc._executeFill({ minRow: 0, maxRow: 1, colIds: ['b'] }, 'right', 2);
    expect(ctx.rowModel.getRow(0)!.data!.c).toBe('x');
    expect(ctx.rowModel.getRow(0)!.data!.d).toBe('x');
    expect(ctx.rowModel.getRow(1)!.data!.c).toBe('y');
    expect(ctx.rowModel.getRow(1)!.data!.d).toBe('y');
    expect(final).toEqual({ startRowIndex: 0, endRowIndex: 1, colIds: ['b', 'c', 'd'] });
  });

  it('fillOperation override wins; undefined return falls back to default', () => {
    const seen: number[] = [];
    const { ctx, svc } = setup({
      cellSelection: { handle: true },
      fillOperation: (params) => {
        seen.push(params.fillIndex);
        expect(params.direction).toBe('down');
        expect(params.colId).toBe('a');
        expect(params.initialValues).toEqual([1, 3]);
        return params.fillIndex === 0 ? 999 : undefined;
      },
    });
    svc._executeFill({ minRow: 0, maxRow: 1, colIds: ['a'] }, 'down', 2);
    expect(seen).toEqual([0, 1]);
    expect(ctx.rowModel.getRow(2)!.data!.a).toBe(999); // override
    expect(ctx.rowModel.getRow(3)!.data!.a).toBe(7); // default linear extend
  });

  it('routes writes through editing.commitValue with source "fill"', () => {
    const { ctx, svc } = setup({ cellSelection: { handle: true } });
    const spy = vi.spyOn(ctx.editing, 'commitValue');
    svc._executeFill({ minRow: 0, maxRow: 0, colIds: ['b'] }, 'down', 2);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, ctx.rowModel.getRow(1), 'b', 'x', 'fill');
    expect(spy).toHaveBeenNthCalledWith(2, ctx.rowModel.getRow(2), 'b', 'x', 'fill');
  });

  it('clamps fill extent to grid bounds', () => {
    const { svc } = setup({ cellSelection: { handle: true } });
    const down = svc._fillExtent({ minRow: 4, maxRow: 5, colIds: ['a'] }, 'down', 10);
    expect(down.endRowIndex).toBe(5); // only 6 rows
    const right = svc._fillExtent({ minRow: 0, maxRow: 0, colIds: ['c'] }, 'right', 10);
    expect(right.colIds).toEqual(['c', 'd']);
    const up = svc._fillExtent({ minRow: 1, maxRow: 2, colIds: ['a'] }, 'up', 10);
    expect(Math.min(up.startRowIndex, up.endRowIndex)).toBe(0);
  });

  it('picks the fill axis by larger pointer travel', () => {
    const { svc } = setup({ cellSelection: { handle: true } });
    const source = { minRow: 1, maxRow: 2, colIds: ['b', 'c'] };
    // vertical travel dominates → down
    expect(svc._computeFillTarget(source, { rowIndex: 5, colId: 'b' }, 3, 50)).toEqual({
      direction: 'down',
      count: 3,
    });
    // horizontal travel dominates → right
    expect(svc._computeFillTarget(source, { rowIndex: 1, colId: 'd' }, 50, 3)).toEqual({
      direction: 'right',
      count: 1,
    });
    // upward
    expect(svc._computeFillTarget(source, { rowIndex: 0, colId: 'b' }, 0, -40)).toEqual({
      direction: 'up',
      count: 1,
    });
    // leftward
    expect(svc._computeFillTarget(source, { rowIndex: 1, colId: 'a' }, -40, 0)).toEqual({
      direction: 'left',
      count: 1,
    });
    // inside the source on the chosen axis → no fill
    expect(svc._computeFillTarget(source, { rowIndex: 2, colId: 'c' }, 2, 5)).toBeNull();
  });

  it('mouseup after a fill drag applies values, sets the final range, and fires fillEnd', () => {
    const { ctx, svc } = setup({ cellSelection: { handle: true } });
    svc.setRangeToCell(pos(0, 'a'));
    svc.extendLatestRangeToCell(pos(1, 'a'));
    const fillEnd = vi.fn();
    const selChanged = vi.fn();
    ctx.events.addEventListener('fillEnd', fillEnd);
    // simulate the drag state a mousemove sequence would have produced
    svc._fillSource = { minRow: 0, maxRow: 1, colIds: ['a'] };
    svc._lastFill = { direction: 'down', count: 2 };
    ctx.events.addEventListener('cellSelectionChanged', selChanged);
    svc._onFillDragUp();
    expect(ctx.rowModel.getRow(2)!.data!.a).toBe(5);
    expect(ctx.rowModel.getRow(3)!.data!.a).toBe(7);
    expect(svc.getCellRanges()).toEqual([{ startRowIndex: 0, endRowIndex: 3, colIds: ['a'] }]);
    expect(fillEnd).toHaveBeenCalledTimes(1);
    expect(fillEnd.mock.calls[0][0]).toMatchObject({
      initialRange: { startRowIndex: 0, endRowIndex: 1, colIds: ['a'] },
      finalRange: { startRowIndex: 0, endRowIndex: 3, colIds: ['a'] },
    });
    expect(selChanged).toHaveBeenCalledTimes(1);
    expect(selChanged.mock.calls[0][0]).toMatchObject({ finished: true });
  });

  it('mouseup with no extension (drag into source) leaves the range unchanged and fires no fillEnd', () => {
    const { ctx, svc } = setup({ cellSelection: { handle: true } });
    svc.setRangeToCell(pos(0, 'a'));
    svc.extendLatestRangeToCell(pos(1, 'a'));
    const fillEnd = vi.fn();
    ctx.events.addEventListener('fillEnd', fillEnd);
    svc._fillSource = { minRow: 0, maxRow: 1, colIds: ['a'] };
    svc._lastFill = null;
    svc._onFillDragUp();
    expect(svc.getCellRanges()).toEqual([{ startRowIndex: 0, endRowIndex: 1, colIds: ['a'] }]);
    expect(fillEnd).not.toHaveBeenCalled();
    expect(ctx.rowModel.getRow(2)!.data!.a).toBe(100); // untouched
  });
});
