import { describe, expect, it, vi } from 'vitest';

import { ClipboardService } from './clipboardService';
import { createMockContext } from '../test/mockContext';
import type { GridContext, IRangeService } from '../context';
import type { CellRange } from '../types/base';
import type { GridOptions } from '../types/gridOptions';

interface Car {
  make: string;
  model: string;
  price: number;
}

const rowData: Car[] = [
  { make: 'Toyota', model: 'Celica', price: 35000 },
  { make: 'Ford', model: 'Mondeo', price: 32000 },
  { make: 'Porsche', model: 'Boxster', price: 72000 },
  { make: 'Kia', model: 'Rio', price: 18000 },
];

const columnDefs = [
  { field: 'make', editable: true },
  { field: 'model', editable: true },
  { field: 'price', editable: true },
];

function rangeStub<TData>(ranges: CellRange[]): IRangeService<TData> {
  return {
    getCellRanges: () => ranges,
    addCellRange: (r) => ranges.push(r),
    setRangeToCell: () => {},
    extendLatestRangeToCell: () => {},
    getLatestRangeEnd: () => null,
    clearCellSelection: () => {
      ranges.length = 0;
    },
    getCellFlags: () => 0,
    onCellMouseDown: () => {},
    onFillHandleMouseDown: () => {},
    destroy: () => {},
  };
}

function setup(options: GridOptions<Car> = {}) {
  const { ctx, start } = createMockContext<Car>({ columnDefs, rowData, ...options });
  const clipboard = new ClipboardService<Car>(ctx);
  ctx.clipboard = clipboard;
  start();
  return { ctx, clipboard };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function focusAt(ctx: GridContext<Car>, rowIndex: number, colId: string) {
  ctx.focus.getFocusedCell = () => ({ rowIndex, colId, rowPinned: null });
}

describe('ClipboardService.getCopyText', () => {
  it('serializes an explicit cell range as TSV', () => {
    const { ctx, clipboard } = setup();
    ctx.range = rangeStub([{ startRowIndex: 0, endRowIndex: 1, colIds: ['make', 'model'] }]);
    expect(clipboard.getCopyText()).toBe('Toyota\tCelica\nFord\tMondeo');
  });

  it('stacks multiple ranges vertically when column counts match, else uses only the latest', () => {
    const { ctx, clipboard } = setup();
    const same: CellRange[] = [
      { startRowIndex: 0, endRowIndex: 0, colIds: ['make', 'model'] },
      { startRowIndex: 2, endRowIndex: 2, colIds: ['model', 'price'] },
    ];
    ctx.range = rangeStub(same);
    expect(clipboard.getCopyText()).toBe('Toyota\tCelica\nBoxster\t72000');

    const mixed: CellRange[] = [
      { startRowIndex: 0, endRowIndex: 0, colIds: ['make', 'model', 'price'] },
      { startRowIndex: 3, endRowIndex: 3, colIds: ['make'] },
    ];
    ctx.range = rangeStub(mixed);
    expect(clipboard.getCopyText()).toBe('Kia');
  });

  it('serializes selected rows across displayed columns in display order', () => {
    const { ctx, clipboard } = setup();
    const n0 = ctx.rowModel.getRow(0)!;
    const n2 = ctx.rowModel.getRow(2)!;
    ctx.selection.getSelectedNodes = () => [n2, n0]; // out of display order
    expect(clipboard.getCopyText()).toBe('Toyota\tCelica\t35000\nPorsche\tBoxster\t72000');
  });

  it('serializes only the focused cell when no range or selection exists', () => {
    const { ctx, clipboard } = setup();
    focusAt(ctx, 1, 'model');
    expect(clipboard.getCopyText()).toBe('Mondeo');
  });

  it('prepends a header row when includeHeaders / copyHeadersToClipboard is set', () => {
    const { ctx, clipboard } = setup({ copyHeadersToClipboard: true });
    ctx.range = rangeStub([{ startRowIndex: 0, endRowIndex: 0, colIds: ['make', 'price'] }]);
    expect(clipboard.getCopyText()).toBe('Make\tPrice\nToyota\t35000');
    // Explicit argument overrides the option.
    expect(clipboard.getCopyText(false)).toBe('Toyota\t35000');
  });

  it('applies processCellForClipboard and the custom delimiter', () => {
    const { ctx, clipboard } = setup({
      clipboardDelimiter: ';',
      processCellForClipboard: (p) => `[${String(p.value)}]`,
    });
    ctx.range = rangeStub([{ startRowIndex: 0, endRowIndex: 0, colIds: ['make', 'model'] }]);
    expect(clipboard.getCopyText()).toBe('[Toyota];[Celica]');
  });

  it('formats null as empty string and dates as ISO yyyy-mm-dd, stripping tabs/newlines', () => {
    interface Rec {
      when: Date | null;
      note: string;
    }
    const { ctx, start } = createMockContext<Rec>({
      columnDefs: [{ field: 'when' }, { field: 'note' }],
      rowData: [
        { when: new Date(Date.UTC(2024, 2, 15)), note: 'a\tb\nc' },
        { when: null, note: 'plain' },
      ],
    });
    const clipboard = new ClipboardService<Rec>(ctx);
    ctx.clipboard = clipboard;
    start();
    ctx.range = rangeStub([{ startRowIndex: 0, endRowIndex: 1, colIds: ['when', 'note'] }]);
    expect(clipboard.getCopyText()).toBe('2024-03-15\ta b c\n\tplain');
  });
});

describe('ClipboardService.cut', () => {
  it('copies then clears range cells via commitValue', () => {
    const { ctx, clipboard } = setup();
    ctx.range = rangeStub([{ startRowIndex: 0, endRowIndex: 1, colIds: ['make', 'model'] }]);
    const spy = vi.fn(() => true);
    ctx.editing.commitValue = spy;
    clipboard.cut();
    expect(spy).toHaveBeenCalledTimes(4);
    expect(spy).toHaveBeenCalledWith(ctx.rowModel.getRow(0), 'make', null, 'cut');
    expect(spy).toHaveBeenCalledWith(ctx.rowModel.getRow(1), 'model', null, 'cut');
  });

  it('clears selected rows across editable columns only', () => {
    const { ctx, start } = createMockContext<Car>({
      columnDefs: [
        { field: 'make', editable: true },
        { field: 'model' }, // not editable
        { field: 'price', editable: true },
      ],
      rowData,
    });
    const clipboard = new ClipboardService<Car>(ctx);
    ctx.clipboard = clipboard;
    start();
    const n1 = ctx.rowModel.getRow(1)!;
    ctx.selection.getSelectedNodes = () => [n1];
    const spy = vi.fn(() => true);
    ctx.editing.commitValue = spy;
    clipboard.cut();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(n1, 'make', null, 'cut');
    expect(spy).toHaveBeenCalledWith(n1, 'price', null, 'cut');
  });

  it('range cut through the REAL editability gate: copies all cells, clears only editable ones', async () => {
    const { ctx } = (() => {
      const r = createMockContext<Car>({
        columnDefs: [
          { field: 'make', editable: true },
          { field: 'model' }, // read-only
          { field: 'price' }, // read-only
        ],
        // fresh copies: this test REALLY mutates rows (no commitValue spy)
        rowData: rowData.map((row) => ({ ...row })),
      });
      return { ctx: r.ctx, start: r.start(), _: undefined };
    })();
    const { EditingService } = await import('./editingService');
    ctx.editing = new EditingService<Car>(ctx);
    const clipboard = new ClipboardService<Car>(ctx);
    ctx.clipboard = clipboard;
    ctx.range = rangeStub([{ startRowIndex: 0, endRowIndex: 1, colIds: ['make', 'model', 'price'] }]);

    // the serialized block includes read-only values…
    expect(clipboard.getCopyText()).toBe('Toyota\tCelica\t35000\nFord\tMondeo\t32000');
    clipboard.cut();
    const r0 = ctx.rowModel.getRow(0)!.data!;
    const r1 = ctx.rowModel.getRow(1)!.data!;
    // …but only the editable column was cleared.
    expect(r0.make).toBeNull();
    expect(r1.make).toBeNull();
    expect(r0.model).toBe('Celica');
    expect(r0.price).toBe(35000);
    ctx.editing.destroy();
  });
});

describe('ClipboardService.paste', () => {
  it('tiles a copied matrix from the focused cell through commitValue with parse=true', async () => {
    const { ctx, clipboard } = setup();
    const ranges: CellRange[] = [{ startRowIndex: 0, endRowIndex: 1, colIds: ['make', 'model'] }];
    ctx.range = rangeStub(ranges);
    clipboard.copy(false); // lastCopied = 2x2 matrix
    ranges.length = 0; // clear ranges → anchor falls back to focus
    focusAt(ctx, 1, 'model');
    const spy = vi.fn(() => true);
    ctx.editing.commitValue = spy;
    clipboard.paste();
    await flush();
    expect(spy).toHaveBeenCalledTimes(4);
    expect(spy).toHaveBeenCalledWith(ctx.rowModel.getRow(1), 'model', 'Toyota', 'paste', true);
    expect(spy).toHaveBeenCalledWith(ctx.rowModel.getRow(1), 'price', 'Celica', 'paste', true);
    expect(spy).toHaveBeenCalledWith(ctx.rowModel.getRow(2), 'model', 'Ford', 'paste', true);
    expect(spy).toHaveBeenCalledWith(ctx.rowModel.getRow(2), 'price', 'Mondeo', 'paste', true);
    // Range set to pasted extent.
    expect(ranges).toEqual([{ startRowIndex: 1, endRowIndex: 2, colIds: ['model', 'price'] }]);
  });

  it('skips paste targets past the last row and last displayed column', async () => {
    const { ctx, clipboard } = setup();
    ctx.range = rangeStub([{ startRowIndex: 1, endRowIndex: 3, colIds: ['model', 'price'] }]);
    clipboard.copy(false); // 3 rows x 2 cols
    ctx.range = rangeStub([]);
    focusAt(ctx, 3, 'price'); // last row, last column
    const spy = vi.fn(() => true);
    ctx.editing.commitValue = spy;
    clipboard.paste();
    await flush();
    // Only (row 3, price) fits; extra rows/columns dropped.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(ctx.rowModel.getRow(3), 'price', 'Mondeo', 'paste', true);
  });

  it('fills a multi-cell range when pasting a single value', async () => {
    const { ctx, clipboard } = setup();
    focusAt(ctx, 0, 'make');
    clipboard.copy(false); // lastCopied = 'Toyota' (focused cell only)
    ctx.range = rangeStub([{ startRowIndex: 1, endRowIndex: 2, colIds: ['make', 'model'] }]);
    const spy = vi.fn(() => true);
    ctx.editing.commitValue = spy;
    clipboard.paste();
    await flush();
    expect(spy).toHaveBeenCalledTimes(4);
    for (const r of [1, 2]) {
      for (const colId of ['make', 'model']) {
        expect(spy).toHaveBeenCalledWith(ctx.rowModel.getRow(r), colId, 'Toyota', 'paste', true);
      }
    }
  });

  it('routes values through processCellFromClipboard with parse=false', async () => {
    const { ctx, clipboard } = setup({
      processCellFromClipboard: (p) => Number(p.value) || p.value,
    });
    focusAt(ctx, 0, 'price');
    clipboard.copy(false); // '35000'
    const spy = vi.fn(() => true);
    ctx.editing.commitValue = spy;
    clipboard.paste();
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(ctx.rowModel.getRow(0), 'price', 35000, 'paste', false);
  });

  it('dispatches pasteStart and pasteEnd with source clipboard', async () => {
    const { ctx, clipboard } = setup();
    focusAt(ctx, 0, 'make');
    clipboard.copy(false);
    const events: string[] = [];
    ctx.events.addEventListener('pasteStart', (e) => events.push(`${e.type}:${e.source}`));
    ctx.events.addEventListener('pasteEnd', (e) => events.push(`${e.type}:${e.source}`));
    clipboard.paste();
    await flush();
    expect(events).toEqual(['pasteStart:clipboard', 'pasteEnd:clipboard']);
  });

  it('does nothing when suppressClipboardPaste is set', async () => {
    const { ctx, clipboard } = setup({ suppressClipboardPaste: true });
    focusAt(ctx, 0, 'make');
    clipboard.copy(false);
    const spy = vi.fn(() => true);
    ctx.editing.commitValue = spy;
    const events: string[] = [];
    ctx.events.addEventListener('pasteStart', () => events.push('start'));
    clipboard.paste();
    await flush();
    expect(spy).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('aborts (no commits) when there is no clipboard text or no anchor', async () => {
    const { ctx, clipboard } = setup();
    const spy = vi.fn(() => true);
    ctx.editing.commitValue = spy;
    clipboard.paste(); // nothing copied, no navigator.clipboard in jsdom
    await flush();
    expect(spy).not.toHaveBeenCalled();

    focusAt(ctx, 0, 'make');
    clipboard.copy(false);
    ctx.focus.getFocusedCell = () => null; // no anchor
    clipboard.paste();
    await flush();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('ClipboardService.copy', () => {
  it('stores the text in the internal buffer used as paste fallback', async () => {
    const { ctx, clipboard } = setup();
    ctx.range = rangeStub([{ startRowIndex: 0, endRowIndex: 0, colIds: ['make'] }]);
    clipboard.copy(false);
    (ctx.range as IRangeService<Car>).clearCellSelection();
    focusAt(ctx, 2, 'make');
    const spy = vi.fn(() => true);
    ctx.editing.commitValue = spy;
    clipboard.paste();
    await flush();
    expect(spy).toHaveBeenCalledWith(ctx.rowModel.getRow(2), 'make', 'Toyota', 'paste', true);
  });
});
