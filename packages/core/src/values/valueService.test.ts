import { describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../test/mockContext.js';
import { Column } from '../columns/column.js';
import { RowNode } from '../rows/rowNode.js';
import { pivotColId } from '../rows/stages.js';

interface Row {
  id?: string;
  name?: string;
  price?: number;
  active?: boolean;
  when?: Date;
  nested?: { deep?: { label?: string } };
}

describe('ValueService — reads', () => {
  it('reads plain and dot-path fields', () => {
    const { ctx, start } = createMockContext<Row>({
      columnDefs: [{ field: 'name' }, { field: 'nested.deep.label', colId: 'label' }],
      rowData: [{ name: 'Ada', nested: { deep: { label: 'L1' } } }],
    });
    start();
    const node = ctx.rowModel.getRow(0)!;
    expect(ctx.values.getValue(node, ctx.columnModel.getColumn('name')!)).toBe('Ada');
    expect(ctx.values.getValue(node, ctx.columnModel.getColumn('label')!)).toBe('L1');
  });

  it('valueGetter function and string forms', () => {
    const { ctx, start } = createMockContext<Row>({
      columnDefs: [
        { colId: 'computed', valueGetter: (p) => (p.data?.price ?? 0) * 2 },
        { colId: 'byPath', valueGetter: 'nested.deep.label' },
      ],
      rowData: [{ price: 21, nested: { deep: { label: 'S' } } }],
    });
    start();
    const node = ctx.rowModel.getRow(0)!;
    expect(ctx.values.getValue(node, ctx.columnModel.getColumn('computed')!)).toBe(42);
    expect(ctx.values.getValue(node, ctx.columnModel.getColumn('byPath')!)).toBe('S');
  });

  it('valueGetter can read other columns via getValue (cross-column)', () => {
    const { ctx, start } = createMockContext<Row>({
      columnDefs: [
        { field: 'price' },
        { colId: 'withTax', valueGetter: (p) => (p.getValue('price') as number) * 1.25 },
      ],
      rowData: [{ price: 100 }],
    });
    start();
    const node = ctx.rowModel.getRow(0)!;
    expect(ctx.values.getValue(node, ctx.columnModel.getColumn('withTax')!)).toBe(125);
  });

  it('group nodes read aggData with priority over field/valueGetter', () => {
    const { ctx } = createMockContext<Row>({ columnDefs: [{ field: 'price' }] });
    const node = new RowNode<Row>(ctx);
    node.group = true;
    node.data = { price: 1 };
    node.aggData = { price: 42 };
    expect(ctx.values.getValue(node, ctx.columnModel.getColumn('price')!)).toBe(42);
  });

  it('secondary pivot columns read their aggData bucket', () => {
    const { ctx } = createMockContext<Row>({ columnDefs: [{ field: 'price' }] });
    const colId = pivotColId(['2020'], 'price');
    const col = new Column<Row>(colId, { colId });
    col.secondary = true;
    const node = new RowNode<Row>(ctx);
    node.group = true;
    node.aggData = { [colId]: 7 };
    expect(ctx.values.getValue(node, col)).toBe(7);
    // missing bucket → undefined
    node.aggData = {};
    expect(ctx.values.getValue(node, col)).toBeUndefined();
  });
});

describe('ValueService — formatting', () => {
  it('valueFormatter is used when present', () => {
    const { ctx, start } = createMockContext<Row>({
      columnDefs: [{ field: 'price', valueFormatter: (p) => `$${p.value}` }],
      rowData: [{ price: 5 }],
    });
    start();
    const node = ctx.rowModel.getRow(0)!;
    expect(ctx.values.getFormattedValue(node, ctx.columnModel.getColumn('price')!)).toBe('$5');
  });

  it('falls back to toDisplayString (dates use toLocaleDateString)', () => {
    const when = new Date(2024, 2, 3);
    const { ctx, start } = createMockContext<Row>({
      columnDefs: [{ field: 'when' }, { field: 'name' }],
      rowData: [{ when, name: undefined }],
    });
    start();
    const node = ctx.rowModel.getRow(0)!;
    expect(ctx.values.getFormattedValue(node, ctx.columnModel.getColumn('when')!)).toBe(
      when.toLocaleDateString(),
    );
    expect(ctx.values.getFormattedValue(node, ctx.columnModel.getColumn('name')!)).toBe('');
  });
});

describe('ValueService — parseValue', () => {
  function parserCtx() {
    const res = createMockContext<Row>({
      columnDefs: [
        { field: 'price', cellDataType: 'number' },
        { field: 'active', cellDataType: 'boolean' },
        { field: 'when', cellDataType: 'date' },
        { field: 'name', valueParser: (p) => `${p.newValue}!`, cellDataType: 'text' },
      ],
      rowData: [{ price: 1, active: true, when: new Date(), name: 'x' }],
    });
    res.start();
    return res.ctx;
  }

  it('parses numbers by cellDataType', () => {
    const ctx = parserCtx();
    const node = ctx.rowModel.getRow(0)!;
    const col = ctx.columnModel.getColumn('price')!;
    expect(col.cellDataType).toBe('number');
    expect(ctx.values.parseValue(node, col, '12.5')).toBe(12.5);
    expect(ctx.values.parseValue(node, col, '')).toBeNull();
    expect(ctx.values.parseValue(node, col, 'abc')).toBe('abc'); // unparseable stays string
  });

  it('parses booleans and dates by cellDataType', () => {
    const ctx = parserCtx();
    const node = ctx.rowModel.getRow(0)!;
    const boolCol = ctx.columnModel.getColumn('active')!;
    expect(ctx.values.parseValue(node, boolCol, 'true')).toBe(true);
    expect(ctx.values.parseValue(node, boolCol, '1')).toBe(true);
    expect(ctx.values.parseValue(node, boolCol, 'no')).toBe(false);
    const dateCol = ctx.columnModel.getColumn('when')!;
    const parsed = ctx.values.parseValue(node, dateCol, '2024-01-15') as Date;
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed.getUTCFullYear()).toBe(2024);
  });

  it('custom valueParser wins', () => {
    const ctx = parserCtx();
    const node = ctx.rowModel.getRow(0)!;
    const col = ctx.columnModel.getColumn('name')!;
    expect(ctx.values.parseValue(node, col, 'hey')).toBe('hey!');
  });

  it('non-string input passes through default parsing', () => {
    const ctx = parserCtx();
    const node = ctx.rowModel.getRow(0)!;
    const col = ctx.columnModel.getColumn('price')!;
    expect(ctx.values.parseValue(node, col, 33)).toBe(33);
  });
});

describe('ValueService — setValue', () => {
  it('writes via field, bumps version, dispatches cellValueChanged with old/new/source', () => {
    const { ctx, start } = createMockContext<Row>({
      columnDefs: [{ field: 'name' }],
      rowData: [{ name: 'old' }],
    });
    start();
    const node = ctx.rowModel.getRow(0)!;
    const v = node.__version;
    const listener = vi.fn();
    ctx.events.addEventListener('cellValueChanged', listener);

    const ok = ctx.values.setValue(node, 'name', 'new', 'test-src');
    expect(ok).toBe(true);
    expect(node.data!.name).toBe('new');
    expect(node.__version).toBe(v + 1);
    expect(listener).toHaveBeenCalledTimes(1);
    const evt = listener.mock.calls[0][0];
    expect(evt.oldValue).toBe('old');
    expect(evt.newValue).toBe('new');
    expect(evt.source).toBe('test-src');
    expect(evt.colId).toBe('name');
  });

  it('returns false and stays silent for identical values or unknown columns', () => {
    const { ctx, start } = createMockContext<Row>({
      columnDefs: [{ field: 'name' }],
      rowData: [{ name: 'same' }],
    });
    start();
    const node = ctx.rowModel.getRow(0)!;
    const listener = vi.fn();
    ctx.events.addEventListener('cellValueChanged', listener);
    expect(ctx.values.setValue(node, 'name', 'same')).toBe(false);
    expect(ctx.values.setValue(node, 'missing-col', 'x')).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('valueSetter controls the write', () => {
    const { ctx, start } = createMockContext<Row>({
      columnDefs: [
        {
          colId: 'custom',
          field: 'name',
          valueSetter: (p) => {
            if (p.newValue === 'reject') return false;
            p.data!.name = String(p.newValue).toUpperCase();
            return true;
          },
        },
      ],
      rowData: [{ name: 'a' }],
    });
    start();
    const node = ctx.rowModel.getRow(0)!;
    expect(ctx.values.setValue(node, 'custom', 'reject')).toBe(false);
    expect(node.data!.name).toBe('a');
    expect(ctx.values.setValue(node, 'custom', 'ok')).toBe(true);
    expect(node.data!.name).toBe('OK');
  });

  it('readOnlyEdit dispatches cellEditRequest and never mutates', () => {
    const { ctx, start } = createMockContext<Row>({
      readOnlyEdit: true,
      columnDefs: [{ field: 'name' }],
      rowData: [{ name: 'keep' }],
    });
    start();
    const node = ctx.rowModel.getRow(0)!;
    const v = node.__version;
    const changed = vi.fn();
    const request = vi.fn();
    ctx.events.addEventListener('cellValueChanged', changed);
    ctx.events.addEventListener('cellEditRequest', request);

    const ok = ctx.values.setValue(node, 'name', 'attempted', 'edit');
    expect(ok).toBe(true);
    expect(node.data!.name).toBe('keep'); // untouched
    expect(node.__version).toBe(v); // no version bump
    expect(changed).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    const evt = request.mock.calls[0][0];
    expect(evt.oldValue).toBe('keep');
    expect(evt.newValue).toBe('attempted');
  });
});
