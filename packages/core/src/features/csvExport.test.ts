import { describe, expect, it } from 'vitest';
import { createMockContext } from '../test/mockContext';
import { exportCsv } from './csvExport';
import type { GridOptions } from '../types/gridOptions';

interface Row {
  id: number;
  name: string;
  price: number;
}

function setup(options: Partial<GridOptions<Row>> = {}) {
  const { ctx, start } = createMockContext<Row>({
    columnDefs: [{ field: 'name' }, { field: 'price' }],
    rowData: [
      { id: 1, name: 'Widget', price: 10 },
      { id: 2, name: 'Gadget', price: 20 },
    ],
    ...options,
  });
  start();
  return ctx;
}

describe('exportCsv', () => {
  it('exports headers and rows for displayed columns', () => {
    const ctx = setup();
    expect(exportCsv(ctx)).toBe('Name,Price\nWidget,10\nGadget,20');
  });

  it('quotes values containing separators, quotes, and newlines', () => {
    const ctx = setup({
      rowData: [
        { id: 1, name: 'a,b', price: 1 },
        { id: 2, name: 'say "hi"', price: 2 },
        { id: 3, name: 'line1\nline2', price: 3 },
      ],
    });
    expect(exportCsv(ctx)).toBe(
      'Name,Price\n"a,b",1\n"say ""hi""",2\n"line1\nline2",3',
    );
  });

  it('uses formatted values by default and raw values when disabled', () => {
    const ctx = setup({
      columnDefs: [
        { field: 'name' },
        { field: 'price', valueFormatter: (p) => `$${p.value as number}` },
      ],
    });
    expect(exportCsv(ctx)).toBe('Name,Price\nWidget,$10\nGadget,$20');
    expect(exportCsv(ctx, { useFormattedValues: false })).toBe('Name,Price\nWidget,10\nGadget,20');
  });

  it('exports only selected rows with onlySelected', () => {
    const ctx = setup();
    ctx.selection.isSelected = (node) => node.data?.id === 2;
    expect(exportCsv(ctx, { onlySelected: true })).toBe('Name,Price\nGadget,20');
  });

  it('omits the header row with skipHeaders', () => {
    const ctx = setup();
    expect(exportCsv(ctx, { skipHeaders: true })).toBe('Widget,10\nGadget,20');
  });

  it('supports a custom column separator (and quotes it in values)', () => {
    const ctx = setup({
      rowData: [{ id: 1, name: 'a;b', price: 1 }],
    });
    expect(exportCsv(ctx, { columnSeparator: ';' })).toBe('Name;Price\n"a;b";1');
  });

  it('allColumns exports visible primary columns; grouped rows export leaves only', () => {
    const { ctx, start } = createMockContext<{ cat: string; val: number }>({
      columnDefs: [{ field: 'cat', rowGroup: true }, { field: 'val' }],
      rowData: [{ cat: 'a', val: 1 }],
      groupDefaultExpanded: -1,
    });
    start();
    // displayed: auto group column + val (grouped 'cat' hidden); group node skipped
    expect(exportCsv(ctx)).toBe('Group,Val\n,1');
    // allColumns: the grouped primary column is included instead
    expect(exportCsv(ctx, { allColumns: true })).toBe('Cat,Val\na,1');
  });
});
