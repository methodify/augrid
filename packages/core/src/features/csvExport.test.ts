import { describe, expect, it } from 'vitest';
import { createMockContext } from '../test/mockContext.js';
import { exportCsv } from './csvExport.js';
import type { GridOptions } from '../types/gridOptions.js';

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

  it('neutralizes formula-injection prefixes in string values', () => {
    const ctx = setup({
      rowData: [
        { id: 1, name: '=SUM(A1:A9)', price: 1 },
        { id: 2, name: '+cmd', price: 2 },
        { id: 3, name: '-cmd', price: 3 },
        { id: 4, name: '@cmd', price: 4 },
        { id: 5, name: '\tcmd', price: 5 },
        { id: 6, name: '\rcmd', price: 6 },
      ],
    });
    expect(exportCsv(ctx)).toBe(
      "Name,Price\n'=SUM(A1:A9),1\n'+cmd,2\n'-cmd,3\n'@cmd,4\n'\tcmd,5\n\"'\rcmd\",6",
    );
  });

  it('does not neutralize negative numbers (typeof number exempt)', () => {
    const ctx = setup({
      rowData: [{ id: 1, name: 'ok', price: -5 }],
    });
    expect(exportCsv(ctx)).toBe('Name,Price\nok,-5');
    expect(exportCsv(ctx, { useFormattedValues: false })).toBe('Name,Price\nok,-5');
    // ...even when a formatter renders the number with a leading minus.
    const formatted = setup({
      columnDefs: [
        { field: 'name' },
        { field: 'price', valueFormatter: (p) => `-${Math.abs(p.value as number)}` },
      ],
      rowData: [{ id: 1, name: 'ok', price: 5 }],
    });
    expect(exportCsv(formatted)).toBe('Name,Price\nok,-5');
  });

  it('neutralization composes with CSV quoting', () => {
    const ctx = setup({
      rowData: [{ id: 1, name: '=a,b', price: 1 }],
    });
    expect(exportCsv(ctx)).toBe('Name,Price\n"\'=a,b",1');
  });

  it('neutralizes formula prefixes in header names', () => {
    const ctx = setup({
      columnDefs: [{ field: 'name', headerName: '=EVIL()' }, { field: 'price' }],
      rowData: [{ id: 1, name: 'ok', price: 1 }],
    });
    expect(exportCsv(ctx)).toBe("'=EVIL(),Price\nok,1");
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
