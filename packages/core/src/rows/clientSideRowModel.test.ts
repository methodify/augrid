import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../test/mockContext';
import type { ClientSideRowModel } from './clientSideRowModel';
import type { RowNode } from './rowNode';

interface Row {
  id: string;
  name: string;
  country?: string;
  sales?: number;
  h?: number;
}

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `name${i}`, sales: i }));
}

function setup(options: Parameters<typeof createMockContext<Row>>[0] = {}) {
  const { ctx, start } = createMockContext<Row>({
    columnDefs: [{ field: 'name' }, { field: 'sales' }],
    ...options,
  });
  start();
  return { ctx, model: ctx.rowModel as ClientSideRowModel<Row> };
}

afterEach(() => vi.useRealTimers());

describe('setRowData + basic reads', () => {
  it('loads rows with uniform tops and heights', () => {
    const { model } = setup({ rowData: rows(5) });
    expect(model.getRowCount()).toBe(5);
    expect(model.getRow(2)!.data!.name).toBe('name2');
    expect(model.getRow(2)!.rowIndex).toBe(2);
    expect(model.getRowTop(0)).toBe(0);
    expect(model.getRowTop(3)).toBe(3 * 32);
    expect(model.getRowHeightAt(1)).toBe(32);
    expect(model.getTotalHeight()).toBe(5 * 32);
    expect(model.isDataLoaded()).toBe(true);
  });

  it('respects the rowHeight option', () => {
    const { model } = setup({ rowData: rows(3), rowHeight: 50 });
    expect(model.getRowTop(2)).toBe(100);
    expect(model.getTotalHeight()).toBe(150);
  });

  it('getRowNode finds leaves by id with getRowId', () => {
    const { model } = setup({ rowData: rows(3), getRowId: (p) => p.data.id });
    expect(model.getRowNode('r1')!.data!.name).toBe('name1');
  });
});

describe('immutable setRowData (getRowId)', () => {
  it('preserves node identity for surviving ids and bumps version on changed data', () => {
    const { ctx, model } = setup({ rowData: rows(3), getRowId: (p) => p.data.id });
    const before = model.getRow(1)!;
    const v = before.__version;
    const next: Row[] = [
      { id: 'r1', name: 'renamed', sales: 99 }, // changed data, same id
      { id: 'r2', name: 'name2', sales: 2 },
      { id: 'r9', name: 'brand-new' }, // new id
    ];
    ctx.rowModel.setRowData!(next);
    expect(model.getRowCount()).toBe(3);
    const after = model.getRowNode('r1')!;
    expect(after).toBe(before); // same node object
    expect(after.data!.name).toBe('renamed');
    expect(after.__version).toBe(v + 1);
    expect(model.getRowNode('r0')).toBeUndefined(); // removed
    expect(model.getRowNode('r9')).toBeDefined();
    // display order follows new data order
    expect(model.getRow(0)!.id).toBe('r1');
    expect(model.getRow(2)!.id).toBe('r9');
  });
});

describe('applyTransaction', () => {
  it('add/update/remove with addIndex, and dispatches rowDataUpdated', () => {
    const { ctx, model } = setup({ rowData: rows(3), getRowId: (p) => p.data.id });
    const events: unknown[] = [];
    ctx.events.addEventListener('rowDataUpdated', (e) => events.push(e));

    const res = ctx.rowModel.applyTransaction!({
      add: [{ id: 'rX', name: 'inserted' }],
      addIndex: 1,
      update: [{ id: 'r2', name: 'updated', sales: -1 }],
      remove: [{ id: 'r0', name: 'name0' }],
    })!;

    expect(res.add.map((n) => n.data!.name)).toEqual(['inserted']);
    expect(res.update.map((n) => n.data!.name)).toEqual(['updated']);
    expect(res.remove.map((n) => n.id)).toEqual(['r0']);

    expect(model.getRowCount()).toBe(3);
    expect(model.getAllLeafNodes().map((n) => n.id)).toEqual(['r1', 'rX', 'r2']);
    expect(model.getRowNode('r2')!.data!.name).toBe('updated');
    expect(events).toHaveLength(1);
    const evt = events[0] as { type: string; add?: RowNode<Row>[]; remove?: RowNode<Row>[] };
    expect(evt.type).toBe('rowDataUpdated');
    expect(evt.add).toHaveLength(1);
    expect(evt.remove).toHaveLength(1);
  });

  it('without getRowId, update/remove match by object reference', () => {
    const data = rows(3);
    const { ctx, model } = setup({ rowData: data });
    ctx.rowModel.applyTransaction!({ remove: [data[0]] });
    expect(model.getRowCount()).toBe(2);
    expect(model.getRow(0)!.data).toBe(data[1]);
  });

  it('re-stamps __sourceIndex after mutation', () => {
    const { ctx, model } = setup({ rowData: rows(3), getRowId: (p) => p.data.id });
    ctx.rowModel.applyTransaction!({ add: [{ id: 'rZ', name: 'z' }], addIndex: 0 });
    expect(model.getAllLeafNodes().map((n) => n.__sourceIndex)).toEqual([0, 1, 2, 3]);
  });
});

describe('async transactions', () => {
  it('queues and merges into a single recompute on the timer', () => {
    vi.useFakeTimers();
    const { model } = setup({ rowData: rows(2), getRowId: (p) => p.data.id });
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    model.applyTransactionAsync({ add: [{ id: 'a1', name: 'a1' }] }, cb1);
    model.applyTransactionAsync({ add: [{ id: 'a2', name: 'a2' }] }, cb2);
    expect(model.getRowCount()).toBe(2); // nothing applied yet
    vi.advanceTimersByTime(20);
    expect(model.getRowCount()).toBe(4);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
    // both callbacks receive the merged result
    expect(cb1.mock.calls[0][0].add).toHaveLength(2);
  });

  it('flushAsyncTransactions applies pending work immediately', () => {
    vi.useFakeTimers();
    const { model } = setup({ rowData: rows(1), getRowId: (p) => p.data.id });
    model.applyTransactionAsync({ add: [{ id: 'n1', name: 'n1' }] });
    model.flushAsyncTransactions();
    expect(model.getRowCount()).toBe(2);
    vi.advanceTimersByTime(50); // timer was cancelled; no double apply
    expect(model.getRowCount()).toBe(2);
  });
});

describe('grouping, expansion persistence, footers', () => {
  const GROUP_DATA: Row[] = [
    { id: 'g1', name: 'a', country: 'USA', sales: 100 },
    { id: 'g2', name: 'b', country: 'USA', sales: 200 },
    { id: 'g3', name: 'c', country: 'UK', sales: 50 },
  ];

  it('collapsed groups display as single rows; expansion reveals children', () => {
    const { model } = setup({
      columnDefs: [{ field: 'country', rowGroup: true }, { field: 'sales' }],
      rowData: GROUP_DATA,
      getRowId: (p) => p.data.id,
    });
    expect(model.getRowCount()).toBe(2); // USA, UK collapsed
    const usa = model.getRow(0)!;
    expect(usa.group).toBe(true);
    expect(usa.key).toBe('USA');
    usa.setExpanded(true);
    expect(model.getRowCount()).toBe(4);
    expect(model.getRow(1)!.data!.name).toBe('a');
  });

  it('expansion survives a transaction-triggered regroup', () => {
    const { ctx, model } = setup({
      columnDefs: [{ field: 'country', rowGroup: true }, { field: 'sales' }],
      rowData: GROUP_DATA,
      getRowId: (p) => p.data.id,
    });
    model.getRow(0)!.setExpanded(true); // expand USA
    expect(model.getRowCount()).toBe(4);
    ctx.rowModel.applyTransaction!({ add: [{ id: 'g4', name: 'd', country: 'USA', sales: 1 }] });
    // groups were rebuilt, but USA stays expanded
    const usa = model.getRow(0)!;
    expect(usa.key).toBe('USA');
    expect(usa.expanded).toBe(true);
    expect(model.getRowCount()).toBe(5); // USA + 3 leaves + UK
  });

  it('rowGroupOpened event fires on setExpanded', () => {
    const { ctx, model } = setup({
      columnDefs: [{ field: 'country', rowGroup: true }],
      rowData: GROUP_DATA,
    });
    const listener = vi.fn();
    ctx.events.addEventListener('rowGroupOpened', listener);
    model.getRow(0)!.setExpanded(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].expanded).toBe(true);
  });

  it('groupTotalRow bottom adds footers after expanded groups; grandTotalRow at the end', () => {
    const { model } = setup({
      columnDefs: [
        { field: 'country', rowGroup: true },
        { field: 'sales', aggFunc: 'sum' },
      ],
      rowData: GROUP_DATA,
      getRowId: (p) => p.data.id,
      groupDefaultExpanded: -1,
      groupTotalRow: 'bottom',
      grandTotalRow: 'bottom',
    });
    const all: RowNode<Row>[] = [];
    for (let i = 0; i < model.getRowCount(); i++) all.push(model.getRow(i)!);
    // USA, a, b, USA-footer, UK, c, UK-footer, grand-footer
    expect(all).toHaveLength(8);
    expect(all[3].footer).toBe(true);
    expect(all[3].key).toBe('USA');
    expect(all[3].aggData!.sales).toBe(300);
    expect(all[6].footer).toBe(true);
    expect(all[6].key).toBe('UK');
    const grand = all[7];
    expect(grand.footer).toBe(true);
    expect(grand.level).toBe(-1);
    expect(grand.aggData!.sales).toBe(350);
  });

  it('expandAll / getExpandedGroupPaths round-trip', () => {
    const { model } = setup({
      columnDefs: [{ field: 'country', rowGroup: true }],
      rowData: GROUP_DATA,
    });
    model.expandAll(true);
    expect(model.getRowCount()).toBe(5);
    expect(model.getExpandedGroupPaths().sort()).toEqual(['UK', 'USA']);
    model.expandAll(false);
    expect(model.getRowCount()).toBe(2);
    model.setExpandedGroupPaths(['UK']);
    expect(model.getRowCount()).toBe(3);
  });
});

describe('pagination window', () => {
  it('setPageWindow slices displayed rows and rebases tops; clearPageWindow restores', () => {
    const { model } = setup({ rowData: rows(10) });
    model.setPageWindow(2, 5);
    expect(model.getRowCount()).toBe(3);
    expect(model.getRow(0)!.data!.name).toBe('name2');
    expect(model.getRow(0)!.rowIndex).toBe(0);
    expect(model.getRowTop(0)).toBe(0);
    expect(model.getTotalHeight()).toBe(3 * 32);
    expect(model.getDisplayedRowCountAllPages()).toBe(10);
    model.clearPageWindow();
    expect(model.getRowCount()).toBe(10);
  });
});

describe('row heights and pixel lookup', () => {
  it('variable heights via getRowHeight drive rowTops and binary search', () => {
    const data: Row[] = [
      { id: 'h0', name: 'x', h: 20 },
      { id: 'h1', name: 'y', h: 40 },
      { id: 'h2', name: 'z', h: 60 },
    ];
    const { model } = setup({
      rowData: data,
      getRowHeight: (p) => p.data?.h ?? null,
    });
    expect(model.getRowTop(0)).toBe(0);
    expect(model.getRowTop(1)).toBe(20);
    expect(model.getRowTop(2)).toBe(60);
    expect(model.getTotalHeight()).toBe(120);
    expect(model.getRowHeightAt(2)).toBe(60);
    expect(model.getRowIndexAtPixel(0)).toBe(0);
    expect(model.getRowIndexAtPixel(19)).toBe(0);
    expect(model.getRowIndexAtPixel(25)).toBe(1);
    expect(model.getRowIndexAtPixel(60)).toBe(2);
    expect(model.getRowIndexAtPixel(9999)).toBe(2);
  });

  it('uniform-height pixel lookup is O(1) math with clamping', () => {
    const { model } = setup({ rowData: rows(100) });
    expect(model.getRowIndexAtPixel(0)).toBe(0);
    expect(model.getRowIndexAtPixel(31)).toBe(0);
    expect(model.getRowIndexAtPixel(32)).toBe(1);
    expect(model.getRowIndexAtPixel(3200 * 10)).toBe(99);
    expect(model.getRowIndexAtPixel(-5)).toBe(0);
  });
});

describe('pinned rows', () => {
  it('builds pinned top/bottom rows from options', () => {
    const { model } = setup({
      rowData: rows(2),
      pinnedTopRowData: [{ id: 'pt0', name: 'top0' }, { id: 'pt1', name: 'top1' }],
      pinnedBottomRowData: [{ id: 'pb0', name: 'bottom0' }],
    });
    expect(model.getPinnedRows('top')).toHaveLength(2);
    expect(model.getPinnedRows('bottom')).toHaveLength(1);
    const t1 = model.getPinnedRow('top', 1)!;
    expect(t1.rowPinned).toBe('top');
    expect(t1.data!.name).toBe('top1');
    expect(t1.rowIndex).toBe(1);
    // pinned rows are not part of the main row count
    expect(model.getRowCount()).toBe(2);
  });
});

describe('traversals', () => {
  it('forEachLeafNode visits every leaf; forEachNode includes groups', () => {
    const { model } = setup({
      columnDefs: [{ field: 'country', rowGroup: true }],
      rowData: [
        { id: 't1', name: 'a', country: 'USA' },
        { id: 't2', name: 'b', country: 'UK' },
      ],
    });
    const leaves: string[] = [];
    model.forEachLeafNode((n) => leaves.push(n.data!.name));
    expect(leaves).toEqual(['a', 'b']);
    let groups = 0;
    let total = 0;
    model.forEachNode((n) => {
      total++;
      if (n.group) groups++;
    });
    expect(groups).toBe(2);
    expect(total).toBe(4);
  });

  it('forEachNodeAfterFilterAndSort follows the sorted order', () => {
    const { ctx, model } = setup({ rowData: rows(3) });
    ctx.sort.setSortModel([{ colId: 'sales', sort: 'desc' }]);
    const seen: number[] = [];
    model.forEachNodeAfterFilterAndSort((n) => seen.push(n.data!.sales!));
    expect(seen).toEqual([2, 1, 0]);
    // displayed order matches
    expect(model.getRow(0)!.data!.sales).toBe(2);
  });
});
