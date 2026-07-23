import { describe, expect, it, vi } from 'vitest';

import { createMockContext } from '../test/mockContext.js';
import { InfiniteRowModel } from './infiniteRowModel.js';
import type { Datasource, GetRowsParams, GridOptions } from '../types/gridOptions.js';

interface Row {
  id: number;
  name: string;
}

function makeRows(start: number, count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) rows.push({ id: start + i, name: `row-${start + i}` });
  return rows;
}

/** Datasource that answers synchronously. totalRows null → never reports lastRow. */
function syncDatasource(totalRows: number | null): {
  ds: Datasource<Row>;
  calls: GetRowsParams<Row>[];
} {
  const calls: GetRowsParams<Row>[] = [];
  const ds: Datasource<Row> = {
    getRows(params) {
      calls.push(params);
      if (totalRows == null) {
        params.success({ rowData: makeRows(params.startRow, params.endRow - params.startRow), lastRow: -1 });
      } else {
        const end = Math.min(params.endRow, totalRows);
        const count = Math.max(0, end - params.startRow);
        params.success({ rowData: makeRows(params.startRow, count), lastRow: totalRows });
      }
    },
  };
  return { ds, calls };
}

/** Datasource that only captures requests; tests invoke success/fail manually. */
function manualDatasource(): { ds: Datasource<Row>; pending: GetRowsParams<Row>[] } {
  const pending: GetRowsParams<Row>[] = [];
  const ds: Datasource<Row> = {
    getRows(params) {
      pending.push(params);
    },
  };
  return { ds, pending };
}

function setup(datasource: Datasource<Row>, extra: GridOptions<Row> = {}) {
  const { ctx } = createMockContext<Row>({
    columnDefs: [{ field: 'name' }],
    rowModelType: 'infinite',
    datasource,
    cacheBlockSize: 10,
    maxBlocksInCache: 3,
    rowHeight: 32,
    getRowId: (p) => String(p.data.id),
    ...extra,
  });
  const model = new InfiniteRowModel<Row>(ctx);
  ctx.rowModel = model;
  return { ctx, model };
}

describe('InfiniteRowModel', () => {
  it('loads block 0 on start and dispatches modelUpdated', () => {
    const { ds, calls } = syncDatasource(null);
    const { ctx, model } = setup(ds);
    const events: string[] = [];
    ctx.events.addEventListener('modelUpdated', (e) => events.push(e.step));

    expect(model.isDataLoaded()).toBe(false);
    model.start();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.startRow).toBe(0);
    expect(calls[0]!.endRow).toBe(10);
    expect(model.isDataLoaded()).toBe(true);
    expect(model.getRow(0)?.data?.name).toBe('row-0');
    expect(model.getRow(9)?.data?.name).toBe('row-9');
    expect(model.getRowNode('5')?.data?.id).toBe(5);
    expect(events).toEqual(['data']);
  });

  it('returns cached placeholder rows while a block is loading', () => {
    const { ds, pending } = manualDatasource();
    const { model } = setup(ds);
    model.start();

    const ph = model.getRow(3);
    expect(ph).toBeDefined();
    expect(ph!.id).toBe('loading-3');
    expect(ph!.data).toBeUndefined();
    expect(ph!.rowIndex).toBe(3);
    expect(ph!.rowTop).toBe(3 * 32);
    expect(ph!.rowHeight).toBe(32);
    // Cached: same object on repeat access.
    expect(model.getRow(3)).toBe(ph);
    expect(model.isDataLoaded()).toBe(false);

    pending[0]!.success({ rowData: makeRows(0, 10), lastRow: -1 });
    const real = model.getRow(3);
    expect(real?.data?.id).toBe(3);
    expect(real).not.toBe(ph);
    expect(model.isDataLoaded()).toBe(true);
  });

  it('success with lastRow sets the exact row count and geometry', () => {
    const { ds } = syncDatasource(25);
    const { model } = setup(ds);
    model.start();

    expect(model.getRowCount()).toBe(25);
    expect(model.getTotalHeight()).toBe(25 * 32);
    expect(model.getRowTop(5)).toBe(160);
    expect(model.getRowHeightAt(3)).toBe(32);
    expect(model.getRowIndexAtPixel(-5)).toBe(0);
    expect(model.getRowIndexAtPixel(33)).toBe(1);
    expect(model.getRowIndexAtPixel(99999)).toBe(24);
  });

  it('unknown lastRow grows the virtual row count as blocks load', () => {
    const { ds, pending } = manualDatasource();
    const { model } = setup(ds);
    model.start();
    expect(model.getRowCount()).toBe(10); // min one block while nothing known

    // Full block 0 → grow to loaded end + one speculative block.
    pending[0]!.success({ rowData: makeRows(0, 10), lastRow: -1 });
    expect(model.getRowCount()).toBe(20);

    // Full block 1 → 30.
    model.getRow(15);
    pending[1]!.success({ rowData: makeRows(10, 10) }); // lastRow omitted
    expect(model.getRowCount()).toBe(30);

    // Short block 2 (4 rows, still no lastRow) → no speculative growth.
    model.getRow(25);
    pending[2]!.success({ rowData: makeRows(20, 4), lastRow: -1 });
    expect(model.getRowCount()).toBe(30);
  });

  it('sort/filter changes purge the cache and pass sortModel/filterModel', () => {
    const { ds, calls } = syncDatasource(100);
    const { ctx, model } = setup(ds);
    const filterModel: ReturnType<typeof ctx.filters.getModel> = {
      name: { filterType: 'text', conditions: [{ type: 'contains', filter: 'x' }] },
    };
    ctx.filters.getModel = () => filterModel;
    model.start();
    model.getRow(15); // load block 1
    expect(calls).toHaveLength(2);

    // Stub sort service applies the model then calls rowModel.onSortChanged().
    ctx.sort.setSortModel([{ colId: 'name', sort: 'desc' }]);

    expect(calls).toHaveLength(3); // purge → reload block 0 only
    const reload = calls[2]!;
    expect(reload.startRow).toBe(0);
    expect(reload.sortModel).toEqual([{ colId: 'name', sort: 'desc' }]);
    expect(reload.filterModel).toBe(filterModel);

    // Old block 1 dropped: only block 0 is loaded now.
    const indexes: number[] = [];
    model.forEachNode((n) => indexes.push(n.rowIndex));
    expect(indexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    model.onFilterChanged();
    expect(calls).toHaveLength(4);
    expect(calls[3]!.startRow).toBe(0);
  });

  it('evicts least-recently-used loaded blocks beyond maxBlocksInCache, sparing visible rows', () => {
    const { ds, calls } = syncDatasource(100);
    const { ctx, model } = setup(ds);
    // Only block 0 is on screen.
    (ctx.renderer as { getVisibleRowRange(): { first: number; last: number } }).getVisibleRowRange =
      () => ({ first: 0, last: 9 });
    model.start(); // block 0
    model.getRow(10); // block 1
    model.getRow(20); // block 2
    model.getRow(30); // block 3 → 4 loaded > max 3 → evict LRU non-visible (block 1)

    const indexes: number[] = [];
    model.forEachNode((n) => indexes.push(n.rowIndex));
    expect(indexes).toHaveLength(30);
    expect(indexes).toContain(0); // visible block spared despite being oldest
    expect(indexes).toContain(20);
    expect(indexes).toContain(30);
    expect(indexes).not.toContain(15); // block 1 evicted

    expect(model.getRowNode('15')).toBeUndefined();
    expect(model.getRowNode('35')?.data?.id).toBe(35);

    // Accessing the evicted block refetches it.
    const callCount = calls.length;
    model.getRow(12);
    expect(calls.length).toBe(callCount + 1);
    expect(model.getRow(12)?.data?.id).toBe(12);
  });

  it('generation guard drops stale success callbacks after purge', () => {
    const { ds, pending } = manualDatasource();
    const { model } = setup(ds);
    model.start();
    pending[0]!.success({ rowData: makeRows(0, 10), lastRow: 100 });
    expect(model.getRowCount()).toBe(100);

    model.getRow(15); // in-flight request for block 1 (old generation)
    model.purgeCache(); // gen++, cache cleared, block 0 re-requested
    expect(pending).toHaveLength(3);
    expect(model.getRowCount()).toBe(10); // counts reset

    // Stale block-1 response must be ignored entirely.
    pending[1]!.success({ rowData: makeRows(999, 10), lastRow: 2000 });
    expect(model.getRowNode('999')).toBeUndefined();
    expect(model.getRowCount()).toBe(10);
    expect(model.isDataLoaded()).toBe(false);

    // Fresh response still lands.
    pending[2]!.success({ rowData: makeRows(0, 10), lastRow: 40 });
    expect(model.getRowCount()).toBe(40);
    expect(model.getRow(0)?.data?.id).toBe(0);
  });

  it('failed blocks render as blank rows and do not refetch on access', () => {
    const { ds, pending } = manualDatasource();
    const { model } = setup(ds);
    model.start();
    pending[0]!.fail();

    const blank = model.getRow(2);
    expect(blank).toBeDefined();
    expect(blank!.data).toBeUndefined();
    expect(model.getRow(2)).toBe(blank);
    expect(pending).toHaveLength(1); // no re-request on access
    expect(model.isDataLoaded()).toBe(false);

    // A stale fail after purge is ignored too.
    model.getRow(15);
    model.purgeCache();
    pending[1]!.fail();
    pending[2]!.success({ rowData: makeRows(0, 10), lastRow: 10 });
    expect(model.getRowCount()).toBe(10);
  });

  it('refreshCache refetches loaded blocks while keeping current data visible', () => {
    const { ds, pending } = manualDatasource();
    const { model } = setup(ds);
    model.start();
    pending[0]!.success({ rowData: makeRows(0, 10), lastRow: 10 });
    expect(model.getRow(0)?.data?.name).toBe('row-0');

    model.refreshCache();
    expect(pending).toHaveLength(2);
    // Old data stays visible until the refetch lands.
    expect(model.getRow(0)?.data?.name).toBe('row-0');

    pending[1]!.success({
      rowData: makeRows(0, 10).map((r) => ({ ...r, name: `fresh-${r.id}` })),
      lastRow: 10,
    });
    expect(model.getRow(0)?.data?.name).toBe('fresh-0');
  });

  it('generates ids when getRowId is absent and does not double-load a block', () => {
    const { ds, calls } = syncDatasource(30);
    const { model } = setup(ds, { getRowId: undefined });
    model.start();
    model.getRow(0);
    model.getRow(5);
    model.getRow(9);
    expect(calls).toHaveLength(1); // block 0 requested exactly once
    const node = model.getRow(0);
    expect(node?.id).toBeTruthy();
    expect(node?.id.startsWith('loading-')).toBe(false);
  });
});
