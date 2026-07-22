import { describe, expect, it } from 'vitest';
import { createMockContext } from '../test/mockContext';
import { buildPivotCellContext, isAggregateTarget } from './pivotContext';
import type { GridOptions } from '../types/gridOptions';
import type { RowNode } from '../rows/rowNode';

interface Row {
  item: string;
  color: string;
  store: string;
  market: string;
  onHand: number;
  alloc: number;
}

const DATA: Row[] = [
  { item: 'Shirt', color: 'Red', market: 'EU', store: 'S1', onHand: 10, alloc: 1 },
  { item: 'Shirt', color: 'Red', market: 'EU', store: 'S2', onHand: 20, alloc: 2 },
  { item: 'Shirt', color: 'Blue', market: 'EU', store: 'S1', onHand: 30, alloc: 3 },
  { item: 'Pants', color: 'Red', market: 'US', store: 'S3', onHand: 40, alloc: 4 },
];

function pivotSetup(extra: Partial<GridOptions<Row>> = {}) {
  const { ctx, start } = createMockContext<Row>({
    columnDefs: [
      { field: 'item', rowGroup: true },
      { field: 'color', rowGroup: true },
      { field: 'market', pivot: true },
      { field: 'store', pivot: true },
      { field: 'onHand', aggFunc: 'sum' },
      { field: 'alloc', aggFunc: 'sum', editable: true },
    ],
    rowData: DATA,
    pivotMode: true,
    groupDefaultExpanded: -1,
    ...extra,
  });
  start();
  return ctx;
}

describe('buildPivotCellContext', () => {
  it('resolves rowKeys, pivotKeys, valueColId, level for a pivot cell', () => {
    const ctx = pivotSetup();
    // Find the deepest group row Shirt>Red and the alloc column for EU/S1.
    let node: RowNode<Row> | undefined;
    for (let i = 0; i < ctx.rowModel.getRowCount(); i++) {
      const n = ctx.rowModel.getRow(i)!;
      if (n.level === 1 && n.key === 'Red' && n.parent?.key === 'Shirt') node = n;
    }
    expect(node).toBeTruthy();
    const col = ctx.columnModel
      .getSecondaryColumns()!
      .find((c) => c.pivotValueColId === 'alloc' && c.pivotKeys?.join('|') === 'EU|S1')!;
    expect(col).toBeTruthy();

    const pc = buildPivotCellContext(ctx, node!, col)!;
    expect(pc.rowKeys).toEqual([
      { colId: 'item', key: 'Shirt' },
      { colId: 'color', key: 'Red' },
    ]);
    expect(pc.pivotKeys).toEqual([
      { colId: 'market', key: 'EU' },
      { colId: 'store', key: 'S1' },
    ]);
    expect(pc.valueColId).toBe('alloc');
    expect(pc.level).toBe(1);
    // Leaf rows narrowed to the pivot tuple: only the S1 Red Shirt row.
    expect(pc.getLeafRows()).toEqual([DATA[0]]);
  });

  it('group-level context includes all leaf rows matching the pivot tuple', () => {
    const ctx = pivotSetup();
    const shirt = ctx.rowModel.getRow(0)!; // level-0 'Shirt' group
    expect(shirt.key).toBe('Shirt');
    const euS1alloc = ctx.columnModel
      .getSecondaryColumns()!
      .find((c) => c.pivotValueColId === 'alloc' && c.pivotKeys?.join('|') === 'EU|S1')!;
    const pc = buildPivotCellContext(ctx, shirt, euS1alloc)!;
    expect(pc.rowKeys).toEqual([{ colId: 'item', key: 'Shirt' }]);
    expect(pc.level).toBe(0);
    // Shirt ∧ EU ∧ S1 → Red/S1 and Blue/S1 rows.
    expect(pc.getLeafRows()).toEqual([DATA[0], DATA[2]]);
  });

  it('plain grouped mode: empty pivotKeys, all group leaves', () => {
    const { ctx, start } = createMockContext<Row>({
      columnDefs: [
        { field: 'item', rowGroup: true },
        { field: 'alloc', aggFunc: 'sum', editable: true },
      ],
      rowData: DATA,
      groupDefaultExpanded: -1,
    });
    start();
    const shirt = ctx.rowModel.getRow(0)!;
    const alloc = ctx.columnModel.getColumn('alloc')!;
    const pc = buildPivotCellContext(ctx, shirt, alloc)!;
    expect(pc.pivotKeys).toEqual([]);
    expect(pc.rowKeys).toEqual([{ colId: 'item', key: 'Shirt' }]);
    expect(pc.valueColId).toBe('alloc');
    expect(pc.getLeafRows()).toEqual([DATA[0], DATA[1], DATA[2]]);
  });

  it('leaf cells under grouping get parent rowKeys; flat leaf cells get null', () => {
    const { ctx, start } = createMockContext<Row>({
      columnDefs: [{ field: 'item', rowGroup: true }, { field: 'alloc' }],
      rowData: DATA,
      groupDefaultExpanded: -1,
    });
    start();
    // Displayed: groups + leaves. Find a leaf.
    let leaf: RowNode<Row> | undefined;
    for (let i = 0; i < ctx.rowModel.getRowCount(); i++) {
      const n = ctx.rowModel.getRow(i)!;
      if (!n.group) leaf = leaf ?? n;
    }
    const alloc = ctx.columnModel.getColumn('alloc')!;
    const pc = buildPivotCellContext(ctx, leaf!, alloc)!;
    expect(pc.rowKeys.length).toBe(1);
    expect(pc.rowKeys[0].colId).toBe('item');

    // Flat grid: no context.
    const flat = createMockContext<Row>({ columnDefs: [{ field: 'alloc' }], rowData: DATA });
    flat.start();
    const flatLeaf = flat.ctx.rowModel.getRow(0)!;
    expect(buildPivotCellContext(flat.ctx, flatLeaf, flat.ctx.columnModel.getColumn('alloc')!)).toBeNull();
  });

  it('auto group column context uses the grouped source colId', () => {
    const ctx = pivotSetup();
    const shirt = ctx.rowModel.getRow(0)!;
    const groupCol = ctx.columnModel.getAutoGroupColumn()!;
    const pc = buildPivotCellContext(ctx, shirt, groupCol)!;
    expect(pc.valueColId).toBe('item');
    expect(pc.rowKeys).toEqual([{ colId: 'item', key: 'Shirt' }]);
  });
});

describe('isAggregateTarget', () => {
  it('classifies pivot cells, group value cells, group headers; excludes footers and leaves', () => {
    const ctx = pivotSetup();
    const shirt = ctx.rowModel.getRow(0)!;
    const secondary = ctx.columnModel.getSecondaryColumns()![0];
    const groupCol = ctx.columnModel.getAutoGroupColumn()!;
    expect(isAggregateTarget(shirt, secondary)).toBe(true);
    expect(isAggregateTarget(shirt, groupCol)).toBe(true);

    const footer = new (shirt.constructor as new (c: unknown) => RowNode<Row>)(ctx);
    footer.group = true;
    footer.footer = true;
    expect(isAggregateTarget(footer, secondary)).toBe(false);

    const flat = createMockContext<Row>({
      columnDefs: [{ field: 'alloc', aggFunc: 'sum' }],
      rowData: DATA,
    });
    flat.start();
    const leaf = flat.ctx.rowModel.getRow(0)!;
    expect(isAggregateTarget(leaf, flat.ctx.columnModel.getColumn('alloc')!)).toBe(false);
  });
});
