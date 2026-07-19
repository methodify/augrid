import { describe, expect, it, vi } from 'vitest';

import { createMockContext } from '../test/mockContext';
import { ColumnResizeService } from './columnResizeService';
import {
  ColumnDragService,
  computeDropTarget,
  computeIndicatorX,
  type RegionGeom,
} from './columnDragService';

interface Row {
  a?: number;
  b?: number;
  c?: number;
}

function mouse(type: string, init: MouseEventInit = {}): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
}

function setupResize(colDefs = [{ field: 'a', width: 100 }, { field: 'b', width: 100 }]) {
  const { ctx, start } = createMockContext<Row>({
    columnDefs: colDefs,
    rowData: [{ a: 1, b: 2 }],
  });
  const service = new ColumnResizeService(ctx);
  ctx.columnResize = service;
  start();
  const grip = document.createElement('div');
  service.attachResizeGrip(grip, 'a');
  return { ctx, service, grip };
}

function setupDrag(columnDefs: Record<string, unknown>[]) {
  const { ctx, start } = createMockContext<Row>({
    columnDefs: columnDefs as never,
    rowData: [{ a: 1, b: 2, c: 3 }],
  });
  const service = new ColumnDragService(ctx);
  ctx.columnDrag = service;
  start();
  ctx.columnModel.getDisplayed(); // resolve column lefts
  const headers = new Map<string, HTMLElement>();
  for (const col of ctx.columnModel.getPrimaryColumns()) {
    const h = document.createElement('div');
    service.attachHeaderDrag(h, col.colId);
    headers.set(col.colId, h);
  }
  return { ctx, service, headers };
}

describe('ColumnResizeService', () => {
  it('mousedown/mousemove/mouseup updates widths with finished flags', () => {
    const { ctx, grip } = setupResize();
    const spy = vi.spyOn(ctx.columnModel, 'setColumnWidths');
    const headerDirty = vi.spyOn(ctx.renderer, 'markHeaderDirty');

    grip.dispatchEvent(mouse('mousedown', { clientX: 200 }));
    document.dispatchEvent(mouse('mousemove', { clientX: 250 }));
    expect(spy).toHaveBeenLastCalledWith([{ colId: 'a', width: 150 }], false, 'ui');
    expect(ctx.columnModel.getColumn('a')!.actualWidth).toBe(150);
    expect(headerDirty).toHaveBeenCalled();

    document.dispatchEvent(mouse('mouseup', { clientX: 260 }));
    expect(spy).toHaveBeenLastCalledWith([{ colId: 'a', width: 160 }], true, 'ui');
    expect(ctx.columnModel.getColumn('a')!.actualWidth).toBe(160);

    // listeners removed: further moves do nothing
    const calls = spy.mock.calls.length;
    document.dispatchEvent(mouse('mousemove', { clientX: 400 }));
    expect(spy.mock.calls.length).toBe(calls);
  });

  it('Escape during resize restores the original width', () => {
    const { ctx, grip } = setupResize();
    const spy = vi.spyOn(ctx.columnModel, 'setColumnWidths');

    grip.dispatchEvent(mouse('mousedown', { clientX: 200 }));
    document.dispatchEvent(mouse('mousemove', { clientX: 300 }));
    expect(ctx.columnModel.getColumn('a')!.actualWidth).toBe(200);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(spy).toHaveBeenLastCalledWith([{ colId: 'a', width: 100 }], true, 'ui');
    expect(ctx.columnModel.getColumn('a')!.actualWidth).toBe(100);

    // gesture over: further moves do nothing
    const calls = spy.mock.calls.length;
    document.dispatchEvent(mouse('mousemove', { clientX: 500 }));
    document.dispatchEvent(mouse('mouseup', { clientX: 500 }));
    expect(spy.mock.calls.length).toBe(calls);
  });

  it('dblclick on grip autosizes via renderer.measureColumnWidth', () => {
    const { ctx, grip } = setupResize();
    ctx.renderer.measureColumnWidth = () => 321;
    const spy = vi.spyOn(ctx.columnModel, 'setColumnWidths');

    grip.dispatchEvent(mouse('dblclick'));
    expect(spy).toHaveBeenCalledWith([{ colId: 'a', width: 321 }], true, 'autosize');
    expect(ctx.columnModel.getColumn('a')!.actualWidth).toBe(321);
  });
});

describe('computeDropTarget / computeIndicatorX (pure)', () => {
  const regions: RegionGeom = {
    rootWidth: 400,
    left: [{ colId: 'l1', left: 0, width: 50 }],
    center: [
      { colId: 'c1', left: 0, width: 100 },
      { colId: 'c2', left: 100, width: 100 },
    ],
    right: [{ colId: 'r1', left: 0, width: 60 }],
  };

  it('hits left region by midpoints', () => {
    expect(computeDropTarget(regions, 20, 0)).toEqual({ region: 'left', indexInRegion: 0 });
    expect(computeDropTarget(regions, 40, 0)).toEqual({ region: 'left', indexInRegion: 1 });
  });

  it('hits center region, accounting for scrollLeft', () => {
    expect(computeDropTarget(regions, 60, 0)).toEqual({ region: 'center', indexInRegion: 0 });
    expect(computeDropTarget(regions, 120, 0)).toEqual({ region: 'center', indexInRegion: 1 });
    expect(computeDropTarget(regions, 260, 0)).toEqual({ region: 'center', indexInRegion: 2 });
    // scrolled 100px right: pointer just past the pinned edge is over c2's first half
    expect(computeDropTarget(regions, 60, 100)).toEqual({ region: 'center', indexInRegion: 1 });
  });

  it('hits right region (starts at rootWidth - rightWidth)', () => {
    expect(computeDropTarget(regions, 350, 0)).toEqual({ region: 'right', indexInRegion: 0 });
    expect(computeDropTarget(regions, 375, 0)).toEqual({ region: 'right', indexInRegion: 1 });
  });

  it('empty pinned regions fall through to center', () => {
    const noPins: RegionGeom = { ...regions, left: [], right: [] };
    expect(computeDropTarget(noPins, 10, 0)).toEqual({ region: 'center', indexInRegion: 0 });
    expect(computeDropTarget(noPins, 390, 0)).toEqual({ region: 'center', indexInRegion: 2 });
    const empty: RegionGeom = { rootWidth: 400, left: [], center: [], right: [] };
    expect(computeDropTarget(empty, 100, 0)).toEqual({ region: 'center', indexInRegion: 0 });
  });

  it('computeIndicatorX maps insertion edges to root-relative x, clamped', () => {
    expect(computeIndicatorX(regions, { region: 'left', indexInRegion: 0 }, 0)).toBe(0);
    expect(computeIndicatorX(regions, { region: 'left', indexInRegion: 1 }, 0)).toBe(50);
    expect(computeIndicatorX(regions, { region: 'center', indexInRegion: 1 }, 0)).toBe(150);
    expect(computeIndicatorX(regions, { region: 'center', indexInRegion: 2 }, 0)).toBe(250);
    expect(computeIndicatorX(regions, { region: 'right', indexInRegion: 0 }, 0)).toBe(340);
    expect(computeIndicatorX(regions, { region: 'right', indexInRegion: 1 }, 0)).toBe(400);
    // scrolled: edge shifts left with the columns, clamped at 0
    expect(computeIndicatorX(regions, { region: 'center', indexInRegion: 0 }, 100)).toBe(0);
  });
});

describe('ColumnDragService', () => {
  const centerDefs = [
    { field: 'a', width: 100 },
    { field: 'b', width: 100 },
    { field: 'c', width: 100 },
  ];

  it('drop before another column calls moveColumns with its primary index', () => {
    const { ctx, headers } = setupDrag(centerDefs);
    const move = vi.spyOn(ctx.columnModel, 'moveColumns');

    // drag c to before a (jsdom rects are 0, so pointerX === clientX)
    headers.get('c')!.dispatchEvent(mouse('mousedown', { clientX: 300, clientY: 5 }));
    document.dispatchEvent(mouse('mousemove', { clientX: 30, clientY: 5 }));
    expect(document.querySelector('.au-drag-ghost')).not.toBeNull();
    expect(ctx.renderer.eRoot.querySelector('.au-drop-indicator')).not.toBeNull();

    document.dispatchEvent(mouse('mouseup', { clientX: 30, clientY: 5 }));
    expect(move).toHaveBeenCalledWith(['c'], 0, 'ui');
    expect(ctx.columnModel.getPrimaryColumns().map((col) => col.colId)).toEqual(['c', 'a', 'b']);
    // cleanup happened
    expect(document.querySelector('.au-drag-ghost')).toBeNull();
    expect(ctx.renderer.eRoot.querySelector('.au-drop-indicator')).toBeNull();
  });

  it('drop past the last column appends to the end of the primary set', () => {
    const { ctx, headers } = setupDrag(centerDefs);
    const move = vi.spyOn(ctx.columnModel, 'moveColumns');

    headers.get('a')!.dispatchEvent(mouse('mousedown', { clientX: 50, clientY: 5 }));
    document.dispatchEvent(mouse('mousemove', { clientX: 260, clientY: 5 }));
    document.dispatchEvent(mouse('mouseup', { clientX: 260, clientY: 5 }));

    expect(move).toHaveBeenCalledWith(['a'], 3, 'ui');
    expect(ctx.columnModel.getPrimaryColumns().map((col) => col.colId)).toEqual(['b', 'c', 'a']);
  });

  it('cross-region drop pins the column and moves it', () => {
    const { ctx, headers } = setupDrag([
      { field: 'a', width: 50, pinned: 'left' },
      { field: 'b', width: 100 },
      { field: 'c', width: 100 },
    ]);
    const pin = vi.spyOn(ctx.columnModel, 'setColumnsPinned');
    const move = vi.spyOn(ctx.columnModel, 'moveColumns');

    // drag b into the left-pinned region (pointerX 10 < leftWidth 50, before a's midpoint)
    headers.get('b')!.dispatchEvent(mouse('mousedown', { clientX: 100, clientY: 5 }));
    document.dispatchEvent(mouse('mousemove', { clientX: 10, clientY: 5 }));
    document.dispatchEvent(mouse('mouseup', { clientX: 10, clientY: 5 }));

    expect(pin).toHaveBeenCalledWith(['b'], 'left', 'ui');
    expect(move).toHaveBeenCalledWith(['b'], 0, 'ui');
    expect(ctx.columnModel.getColumn('b')!.pinned).toBe('left');
    expect(ctx.columnModel.getPrimaryColumns().map((col) => col.colId)).toEqual(['b', 'a', 'c']);
  });

  it('does not start a drag under the 4px threshold and Escape cancels', () => {
    const { ctx, headers } = setupDrag(centerDefs);
    const move = vi.spyOn(ctx.columnModel, 'moveColumns');
    const pin = vi.spyOn(ctx.columnModel, 'setColumnsPinned');

    // below threshold: no ghost, no move on mouseup
    headers.get('a')!.dispatchEvent(mouse('mousedown', { clientX: 10, clientY: 10 }));
    document.dispatchEvent(mouse('mousemove', { clientX: 12, clientY: 12 }));
    expect(document.querySelector('.au-drag-ghost')).toBeNull();
    document.dispatchEvent(mouse('mouseup', { clientX: 12, clientY: 12 }));
    expect(move).not.toHaveBeenCalled();

    // Escape cancels an active drag with full cleanup
    headers.get('a')!.dispatchEvent(mouse('mousedown', { clientX: 10, clientY: 10 }));
    document.dispatchEvent(mouse('mousemove', { clientX: 200, clientY: 10 }));
    expect(document.querySelector('.au-drag-ghost')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.au-drag-ghost')).toBeNull();
    expect(ctx.renderer.eRoot.querySelector('.au-drop-indicator')).toBeNull();
    document.dispatchEvent(mouse('mouseup', { clientX: 200, clientY: 10 }));
    expect(move).not.toHaveBeenCalled();
    expect(pin).not.toHaveBeenCalled();
  });

  it('destroy during an active gesture removes document listeners and DOM', () => {
    const { ctx, service, headers } = setupDrag(centerDefs);
    const move = vi.spyOn(ctx.columnModel, 'moveColumns');

    headers.get('a')!.dispatchEvent(mouse('mousedown', { clientX: 10, clientY: 10 }));
    document.dispatchEvent(mouse('mousemove', { clientX: 200, clientY: 10 }));
    expect(document.querySelector('.au-drag-ghost')).not.toBeNull();

    service.destroy();
    expect(document.querySelector('.au-drag-ghost')).toBeNull();
    document.dispatchEvent(mouse('mouseup', { clientX: 200, clientY: 10 }));
    expect(move).not.toHaveBeenCalled();
  });
});
