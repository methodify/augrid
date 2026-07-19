import { describe, it, expect, vi } from 'vitest';
import { FocusService } from './focusService';
import type { GridContext, IRangeService } from '../context';
import type { GridOptions } from '../types/gridOptions';
import type { CellFocusedEvent } from '../types/events';
import type { CellPosition, CellRange } from '../types/base';

import { createMockContext } from '../test/mockContext';

interface Row {
  a: number;
  b: string;
  c: string;
}

const rowData: Row[] = Array.from({ length: 10 }, (_, i) => ({
  a: i,
  b: `b${i}`,
  c: `c${i}`,
}));

function setup(extra: Partial<GridOptions<Row>> = {}) {
  const { ctx, start } = createMockContext<Row>({
    columnDefs: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
    rowData,
    ...extra,
  });
  const focus = new FocusService<Row>(ctx);
  ctx.focus = focus;
  start();
  return { ctx, focus };
}

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { cancelable: true, ...init });
}

function makeRangeStub(): IRangeService<Row> & {
  ranges: CellRange[];
  setCalls: CellPosition[];
  extendCalls: CellPosition[];
} {
  const stub = {
    ranges: [] as CellRange[],
    setCalls: [] as CellPosition[],
    extendCalls: [] as CellPosition[],
    getCellRanges: () => stub.ranges,
    addCellRange: (r: CellRange) => {
      stub.ranges.push(r);
    },
    setRangeToCell: (pos: CellPosition) => {
      stub.setCalls.push(pos);
      stub.ranges = [{ startRowIndex: pos.rowIndex, endRowIndex: pos.rowIndex, colIds: [pos.colId] }];
    },
    extendLatestRangeToCell: (pos: CellPosition) => {
      stub.extendCalls.push(pos);
    },
    clearCellSelection: () => {
      stub.ranges = [];
    },
    getCellFlags: () => 0,
    onCellMouseDown: () => {},
    onFillHandleMouseDown: () => {},
    destroy: () => {},
  };
  return stub;
}

describe('FocusService', () => {
  describe('focused cell state', () => {
    it('sets the focused cell and dispatches cellFocused', () => {
      const { ctx, focus } = setup();
      const events: CellFocusedEvent<Row>[] = [];
      ctx.events.addEventListener('cellFocused', (e) => events.push(e));

      focus.setFocusedCell(2, 'b');

      expect(focus.getFocusedCell()).toEqual({ rowIndex: 2, colId: 'b', rowPinned: null });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ rowIndex: 2, colId: 'b', rowPinned: null });
    });

    it('clamps rowIndex to the model row count', () => {
      const { focus } = setup();
      focus.setFocusedCell(999, 'a');
      expect(focus.getFocusedCell()).toEqual({ rowIndex: 9, colId: 'a', rowPinned: null });
      focus.setFocusedCell(-5, 'a');
      expect(focus.getFocusedCell()!.rowIndex).toBe(0);
    });

    it('ignores unknown colId', () => {
      const { ctx, focus } = setup();
      const events: CellFocusedEvent<Row>[] = [];
      ctx.events.addEventListener('cellFocused', (e) => events.push(e));

      focus.setFocusedCell(1, 'nope');

      expect(focus.getFocusedCell()).toBeNull();
      expect(events).toHaveLength(0);
    });

    it('clearFocusedCell nulls state and dispatches cellFocused with nulls', () => {
      const { ctx, focus } = setup();
      focus.setFocusedCell(1, 'a');
      const events: CellFocusedEvent<Row>[] = [];
      ctx.events.addEventListener('cellFocused', (e) => events.push(e));

      focus.clearFocusedCell();

      expect(focus.getFocusedCell()).toBeNull();
      expect(events[0]).toMatchObject({ rowIndex: null, colId: null, rowPinned: null });
    });

    it('setFocusedCell scrolls the cell into view and schedules a render', () => {
      const { ctx, focus } = setup();
      const ensureRow = vi.spyOn(ctx.renderer, 'ensureIndexVisible');
      const ensureCol = vi.spyOn(ctx.renderer, 'ensureColumnVisible');
      const sched = vi.fn();
      ctx.scheduleRender = sched;

      focus.setFocusedCell(4, 'c');

      expect(ensureRow).toHaveBeenCalledWith(4);
      expect(ensureCol).toHaveBeenCalledWith('c');
      expect(sched).toHaveBeenCalled();
    });
  });

  describe('navigateBy', () => {
    it('moves by deltas and clamps at grid bounds', () => {
      const { focus } = setup();
      focus.setFocusedCell(0, 'a');

      expect(focus.navigateBy(1, 1)).toEqual({ rowIndex: 1, colId: 'b', rowPinned: null });
      // clamp at top-left
      expect(focus.navigateBy(-99, -99)).toEqual({ rowIndex: 0, colId: 'a', rowPinned: null });
      // clamp at bottom-right
      expect(focus.navigateBy(99, 99)).toEqual({ rowIndex: 9, colId: 'c', rowPinned: null });
    });

    it('returns null with no focused cell', () => {
      const { focus } = setup();
      expect(focus.navigateBy(1, 0)).toBeNull();
    });

    it('honors the navigateToNextCell hook (override and block)', () => {
      const hook = vi.fn(
        (params: {
          key: string;
          previousCellPosition: CellPosition;
          nextCellPosition: CellPosition | null;
        }) => {
          if (params.nextCellPosition?.rowIndex === 1) {
            return { rowIndex: 7, colId: 'c', rowPinned: null };
          }
          return null; // block everything else
        },
      );
      const { focus } = setup({ navigateToNextCell: hook });
      focus.setFocusedCell(0, 'a');

      // override: down from row 0 redirects to (7, c)
      expect(focus.navigateBy(1, 0)).toEqual({ rowIndex: 7, colId: 'c', rowPinned: null });
      // block: hook returns null
      expect(focus.navigateBy(1, 0)).toBeNull();
      expect(focus.getFocusedCell()).toEqual({ rowIndex: 7, colId: 'c', rowPinned: null });
    });

    it('extendRange extends the latest range without moving focus', () => {
      const { ctx, focus } = setup();
      const range = makeRangeStub();
      ctx.range = range;
      focus.setFocusedCell(2, 'b');

      const next = focus.navigateBy(1, 0, true);

      expect(next).toEqual({ rowIndex: 3, colId: 'b', rowPinned: null });
      expect(range.extendCalls).toEqual([{ rowIndex: 3, colId: 'b', rowPinned: null }]);
      expect(focus.getFocusedCell()).toEqual({ rowIndex: 2, colId: 'b', rowPinned: null });
    });

    it('collapses the range to the new cell when moving with a range service', () => {
      const { ctx, focus } = setup();
      const range = makeRangeStub();
      ctx.range = range;
      focus.setFocusedCell(2, 'b');

      focus.navigateBy(0, 1);

      expect(focus.getFocusedCell()).toEqual({ rowIndex: 2, colId: 'c', rowPinned: null });
      expect(range.setCalls.at(-1)).toEqual({ rowIndex: 2, colId: 'c', rowPinned: null });
    });
  });

  describe('keyboard: arrows / tab / home / end / page', () => {
    it('arrow keys move focus and preventDefault', () => {
      const { focus } = setup();
      focus.setFocusedCell(1, 'b');

      const e = keydown({ key: 'ArrowRight' });
      focus.onKeyDown(e);
      expect(focus.getFocusedCell()).toEqual({ rowIndex: 1, colId: 'c', rowPinned: null });
      expect(e.defaultPrevented).toBe(true);

      focus.onKeyDown(keydown({ key: 'ArrowDown' }));
      expect(focus.getFocusedCell()).toEqual({ rowIndex: 2, colId: 'c', rowPinned: null });
      focus.onKeyDown(keydown({ key: 'ArrowUp' }));
      focus.onKeyDown(keydown({ key: 'ArrowLeft' }));
      expect(focus.getFocusedCell()).toEqual({ rowIndex: 1, colId: 'b', rowPinned: null });
    });

    it('ctrl+arrow jumps to grid edges', () => {
      const { focus } = setup();
      focus.setFocusedCell(4, 'b');

      focus.onKeyDown(keydown({ key: 'ArrowDown', ctrlKey: true }));
      expect(focus.getFocusedCell()!.rowIndex).toBe(9);
      focus.onKeyDown(keydown({ key: 'ArrowUp', ctrlKey: true }));
      expect(focus.getFocusedCell()!.rowIndex).toBe(0);
      focus.onKeyDown(keydown({ key: 'ArrowRight', ctrlKey: true }));
      expect(focus.getFocusedCell()!.colId).toBe('c');
      focus.onKeyDown(keydown({ key: 'ArrowLeft', ctrlKey: true }));
      expect(focus.getFocusedCell()!.colId).toBe('a');
    });

    it('Tab wraps past the last column to the first column of the next row', () => {
      const { focus } = setup();
      focus.setFocusedCell(0, 'c');

      const e = keydown({ key: 'Tab' });
      focus.onKeyDown(e);

      expect(focus.getFocusedCell()).toEqual({ rowIndex: 1, colId: 'a', rowPinned: null });
      expect(e.defaultPrevented).toBe(true);
    });

    it('Shift+Tab wraps before the first column to the last column of the previous row', () => {
      const { focus } = setup();
      focus.setFocusedCell(1, 'a');

      focus.onKeyDown(keydown({ key: 'Tab', shiftKey: true }));

      expect(focus.getFocusedCell()).toEqual({ rowIndex: 0, colId: 'c', rowPinned: null });
    });

    it('Tab at the very last cell does not move and does not preventDefault', () => {
      const { focus } = setup();
      focus.setFocusedCell(9, 'c');

      const e = keydown({ key: 'Tab' });
      focus.onKeyDown(e);

      expect(focus.getFocusedCell()).toEqual({ rowIndex: 9, colId: 'c', rowPinned: null });
      expect(e.defaultPrevented).toBe(false);
    });

    it('Home/End go to first/last column; Ctrl+Home/End to grid corners', () => {
      const { focus } = setup();
      focus.setFocusedCell(5, 'b');

      focus.onKeyDown(keydown({ key: 'Home' }));
      expect(focus.getFocusedCell()).toEqual({ rowIndex: 5, colId: 'a', rowPinned: null });
      focus.onKeyDown(keydown({ key: 'End' }));
      expect(focus.getFocusedCell()).toEqual({ rowIndex: 5, colId: 'c', rowPinned: null });
      focus.onKeyDown(keydown({ key: 'Home', ctrlKey: true }));
      expect(focus.getFocusedCell()).toEqual({ rowIndex: 0, colId: 'a', rowPinned: null });
      focus.onKeyDown(keydown({ key: 'End', ctrlKey: true }));
      expect(focus.getFocusedCell()).toEqual({ rowIndex: 9, colId: 'c', rowPinned: null });
    });

    it('PageDown/PageUp move by floor(viewportHeight / rowHeight) rows', () => {
      // mock renderer viewport is 600 high; rowHeight 100 → page of 6
      const { focus } = setup({ rowHeight: 100 });
      focus.setFocusedCell(0, 'a');

      focus.onKeyDown(keydown({ key: 'PageDown' }));
      expect(focus.getFocusedCell()!.rowIndex).toBe(6);
      focus.onKeyDown(keydown({ key: 'PageUp' }));
      expect(focus.getFocusedCell()!.rowIndex).toBe(0);
    });
  });

  describe('keyboard: editing entry points', () => {
    it('Enter starts editing the focused cell', () => {
      const { ctx, focus } = setup();
      const startEditing = vi.fn((..._args: unknown[]) => true);
      ctx.editing.startEditing = startEditing;
      focus.setFocusedCell(3, 'b');

      const e = keydown({ key: 'Enter' });
      focus.onKeyDown(e);

      expect(startEditing).toHaveBeenCalledTimes(1);
      expect(startEditing.mock.calls[0]![0]).toMatchObject({ rowIndex: 3, colId: 'b' });
      expect(e.defaultPrevented).toBe(true);
    });

    it('F2 starts editing', () => {
      const { ctx, focus } = setup();
      const startEditing = vi.fn((..._args: unknown[]) => true);
      ctx.editing.startEditing = startEditing;
      focus.setFocusedCell(2, 'a');

      focus.onKeyDown(keydown({ key: 'F2' }));

      expect(startEditing).toHaveBeenCalledTimes(1);
    });

    it('typing a printable character starts editing with that key', () => {
      const { ctx, focus } = setup();
      const startEditing = vi.fn((..._args: unknown[]) => true);
      ctx.editing.startEditing = startEditing;
      focus.setFocusedCell(1, 'b');

      const e = keydown({ key: 'x' });
      focus.onKeyDown(e);

      expect(startEditing.mock.calls[0]![0]).toMatchObject({ rowIndex: 1, colId: 'b', key: 'x' });
      expect(e.defaultPrevented).toBe(true);
    });

    it('does not preventDefault when typing fails to start an edit', () => {
      const { ctx, focus } = setup();
      ctx.editing.startEditing = vi.fn(() => false);
      focus.setFocusedCell(1, 'b');

      const e = keydown({ key: 'x' });
      focus.onKeyDown(e);

      expect(e.defaultPrevented).toBe(false);
    });

    it('while editing: Escape cancels, other keys are left to the editor', () => {
      const { ctx, focus } = setup();
      ctx.editing.isEditing = () => true;
      const stopEditing = vi.fn(() => true);
      ctx.editing.stopEditing = stopEditing;
      focus.setFocusedCell(2, 'b');

      const arrow = keydown({ key: 'ArrowDown' });
      focus.onKeyDown(arrow);
      expect(arrow.defaultPrevented).toBe(false);
      expect(focus.getFocusedCell()!.rowIndex).toBe(2); // arrows ignored while editing

      focus.onKeyDown(keydown({ key: 'Escape' }));
      expect(stopEditing).toHaveBeenCalledWith(true);
    });

    it('while editing: Enter commits then navigates down (enterNavigatesVerticallyAfterEdit)', () => {
      const { ctx, focus } = setup();
      let editing = true;
      ctx.editing.isEditing = () => editing;
      ctx.editing.stopEditing = vi.fn(() => {
        editing = false;
        return true;
      });
      focus.setFocusedCell(2, 'b');

      focus.onKeyDown(keydown({ key: 'Enter' }));

      expect(ctx.editing.stopEditing).toHaveBeenCalledWith(false);
      expect(focus.getFocusedCell()).toEqual({ rowIndex: 3, colId: 'b', rowPinned: null });
    });

    it('while editing: Tab commits and moves to the next cell', () => {
      const { ctx, focus } = setup();
      let editing = true;
      ctx.editing.isEditing = () => editing;
      ctx.editing.stopEditing = vi.fn(() => {
        editing = false;
        return true;
      });
      focus.setFocusedCell(2, 'b');

      const e = keydown({ key: 'Tab' });
      focus.onKeyDown(e);

      expect(focus.getFocusedCell()).toEqual({ rowIndex: 2, colId: 'c', rowPinned: null });
      expect(e.defaultPrevented).toBe(true);
    });
  });

  describe('keyboard: delete / selection / clipboard / undo', () => {
    it('Delete clears the focused cell via commitValue', () => {
      const { ctx, focus } = setup();
      const commit = vi.fn((..._args: unknown[]) => true);
      ctx.editing.commitValue = commit;
      focus.setFocusedCell(4, 'b');

      const e = keydown({ key: 'Delete' });
      focus.onKeyDown(e);

      expect(commit).toHaveBeenCalledTimes(1);
      const [node, colId, value, source] = commit.mock.calls[0]!;
      expect(node).toBe(ctx.rowModel.getRow(4));
      expect(colId).toBe('b');
      expect(value).toBeNull();
      expect(source).toBe('edit');
      expect(e.defaultPrevented).toBe(true);
    });

    it('Delete clears every cell of every range when ranges exist', () => {
      const { ctx, focus } = setup();
      const commit = vi.fn((..._args: unknown[]) => true);
      ctx.editing.commitValue = commit;
      const range = makeRangeStub();
      range.ranges = [{ startRowIndex: 3, endRowIndex: 1, colIds: ['a', 'b'] }];
      ctx.range = range;
      focus.setFocusedCell(0, 'a');

      focus.onKeyDown(keydown({ key: 'Backspace' }));

      // rows 1..3 × cols a,b = 6 cells
      expect(commit).toHaveBeenCalledTimes(6);
      const cells = commit.mock.calls.map((c) => [c[0], c[1]]);
      expect(cells).toContainEqual([ctx.rowModel.getRow(1), 'a']);
      expect(cells).toContainEqual([ctx.rowModel.getRow(3), 'b']);
    });

    it('Ctrl+A calls selection.selectAll when there is no range service', () => {
      const { ctx, focus } = setup();
      const selectAll = vi.fn();
      ctx.selection.selectAll = selectAll;

      const e = keydown({ key: 'a', ctrlKey: true });
      focus.onKeyDown(e);

      expect(selectAll).toHaveBeenCalledTimes(1);
      expect(e.defaultPrevented).toBe(true);
    });

    it('Ctrl+A adds an all-cells range when a range service exists', () => {
      const { ctx, focus } = setup();
      const range = makeRangeStub();
      ctx.range = range;

      focus.onKeyDown(keydown({ key: 'a', metaKey: true }));

      expect(range.ranges).toEqual([{ startRowIndex: 0, endRowIndex: 9, colIds: ['a', 'b', 'c'] }]);
    });

    it('Space toggles row selection when rowSelection is on', () => {
      const { ctx, focus } = setup({ rowSelection: 'multiRow' });
      const setSelected = vi.fn();
      ctx.selection.setSelected = setSelected;
      focus.setFocusedCell(2, 'a');

      const e = keydown({ key: ' ' });
      focus.onKeyDown(e);

      expect(setSelected).toHaveBeenCalledWith([ctx.rowModel.getRow(2)], true, 'keyboard');
      expect(e.defaultPrevented).toBe(true);

      // no rowSelection → no call
      const { ctx: ctx2, focus: focus2 } = setup();
      const setSelected2 = vi.fn();
      ctx2.selection.setSelected = setSelected2;
      focus2.setFocusedCell(2, 'a');
      focus2.onKeyDown(keydown({ key: ' ' }));
      expect(setSelected2).not.toHaveBeenCalled();
    });

    it('Ctrl+C copies without preventDefault; Ctrl+V pastes with preventDefault', () => {
      const { ctx, focus } = setup();
      const copy = vi.fn();
      const paste = vi.fn();
      ctx.clipboard.copy = copy;
      ctx.clipboard.paste = paste;
      focus.setFocusedCell(0, 'a');

      const c = keydown({ key: 'c', ctrlKey: true });
      focus.onKeyDown(c);
      expect(copy).toHaveBeenCalledTimes(1);
      expect(c.defaultPrevented).toBe(false);

      const v = keydown({ key: 'v', ctrlKey: true });
      focus.onKeyDown(v);
      expect(paste).toHaveBeenCalledTimes(1);
      expect(v.defaultPrevented).toBe(true);
    });

    it('Ctrl+V does nothing when suppressClipboardPaste is set', () => {
      const { ctx, focus } = setup({ suppressClipboardPaste: true });
      const paste = vi.fn();
      ctx.clipboard.paste = paste;
      focus.setFocusedCell(0, 'a');

      const v = keydown({ key: 'v', ctrlKey: true });
      focus.onKeyDown(v);

      expect(paste).not.toHaveBeenCalled();
      expect(v.defaultPrevented).toBe(false);
    });

    it('Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo', () => {
      const { ctx, focus } = setup();
      const undo = vi.fn();
      const redo = vi.fn();
      ctx.undoRedo = { undo, redo, undoSize: () => 0, redoSize: () => 0, destroy: () => {} };

      focus.onKeyDown(keydown({ key: 'z', ctrlKey: true }));
      expect(undo).toHaveBeenCalledTimes(1);
      focus.onKeyDown(keydown({ key: 'z', ctrlKey: true, shiftKey: true }));
      expect(redo).toHaveBeenCalledTimes(1);
      focus.onKeyDown(keydown({ key: 'y', ctrlKey: true }));
      expect(redo).toHaveBeenCalledTimes(2);
    });
  });

  describe('lifecycle', () => {
    it('ignores keys after destroy and clears focus', () => {
      const { focus } = setup();
      focus.setFocusedCell(1, 'a');
      focus.destroy();

      expect(focus.getFocusedCell()).toBeNull();
      const e = keydown({ key: 'ArrowDown' });
      focus.onKeyDown(e);
      expect(e.defaultPrevented).toBe(false);
    });
  });
});
