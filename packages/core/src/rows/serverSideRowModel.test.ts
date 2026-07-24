import { describe, expect, it } from 'vitest';
import { createMockContext } from '../test/mockContext.js';
import { ServerSideRowModel } from './serverSideRowModel.js';
import { SelectionService } from '../interaction/selectionService.js';
import { Grid } from '../grid.js';
import type { GridOptions } from '../types/gridOptions.js';
import type {
  GroupKey,
  ServerSideDatasource,
  ServerSideRowsParams,
} from '../types/serverSide.js';
import type { CellEditRequestEvent } from '../types/events.js';

/**
 * Fake hierarchy shaped like Plank's cases: Region → Store → SKU, including a
 * BLANK (null) region and a numeric store key. Group rows carry
 * server-computed totals in `qty`.
 */
interface Row {
  region?: string | null;
  store?: string | number | null;
  sku?: string;
  qty: number;
}

const REGIONS: { key: GroupKey; stores: { key: GroupKey; skus: number }[] }[] = [
  { key: 'East', stores: [{ key: 101, skus: 3 }, { key: 'E-2', skus: 2 }] },
  { key: null, stores: [{ key: 'X-1', skus: 2 }] }, // blank region member
  { key: 'West', stores: [{ key: 201, skus: 25 }] },
];

function makeDatasource(): { ds: ServerSideDatasource<Row>; calls: ServerSideRowsParams<Row>[] } {
  const calls: ServerSideRowsParams<Row>[] = [];
  const ds: ServerSideDatasource<Row> = {
    getRows(params) {
      calls.push(params);
      const { groupKeys, startRow, endRow } = params;
      if (groupKeys.length === 0) {
        params.success({
          rowData: REGIONS.map((r) => ({
            region: r.key as string | null,
            qty: r.stores.reduce((s, st) => s + st.skus * 10, 0),
          })),
          rowCount: REGIONS.length,
        });
      } else if (groupKeys.length === 1) {
        const region = REGIONS.find((r) => r.key === groupKeys[0])!;
        params.success({
          rowData: region.stores.map((st) => ({
            region: region.key as string | null,
            store: st.key as string | number | null,
            qty: st.skus * 10,
          })),
          rowCount: region.stores.length,
        });
      } else {
        const region = REGIONS.find((r) => r.key === groupKeys[0])!;
        const store = region.stores.find((s) => s.key === groupKeys[1])!;
        const all = Array.from({ length: store.skus }, (_, i) => ({
          region: region.key as string | null,
          store: store.key as string | number | null,
          sku: `SKU-${String(groupKeys[1])}-${i}`,
          qty: 10,
        }));
        params.success({ rowData: all.slice(startRow, endRow), rowCount: store.skus });
      }
    },
  };
  return { ds, calls };
}

const SS_OPTIONS: GridOptions<Row> = {
  columnDefs: [
    { field: 'region', rowGroup: true },
    { field: 'store', rowGroup: true },
    { field: 'sku' },
    { field: 'qty', aggFunc: 'sum', editable: true },
  ],
  rowModelType: 'serverSide',
  cacheBlockSize: 10,
  isServerSideGroup: (d) => d.sku === undefined,
  getServerSideGroupKey: (d) => (d.store !== undefined ? (d.store as GroupKey) : (d.region as GroupKey)),
  getRowId: (p) =>
    p.data.sku ?? `g:${p.parentKeys?.join('/') ?? ''}:${String(p.data.store ?? p.data.region)}`,
};

function setup() {
  const { ds, calls } = makeDatasource();
  const { ctx } = createMockContext<Row>({ ...SS_OPTIONS, serverSideDatasource: ds });
  const model = new ServerSideRowModel<Row>(ctx);
  ctx.rowModel = model;
  model.start();
  return { ctx, model, calls };
}

describe('ServerSideRowModel', () => {
  it('loads the root, expands lazily, and caches collapsed stores', () => {
    const { model, calls } = setup();
    expect(model.getRowCount()).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.groupKeys).toEqual([]);
    expect(calls[0]!.rowGroupCols.map((c) => c.field)).toEqual(['region', 'store']);
    expect(calls[0]!.valueCols).toEqual([{ colId: 'qty', aggFunc: 'sum' }]);

    const east = model.getRow(0)!;
    expect(east.group).toBe(true);
    expect(east.key).toBe('East');
    expect(model.isRowExpandable(east)).toBe(true);
    east.setExpanded(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.groupKeys).toEqual(['East']);
    expect(model.getRowCount()).toBe(5); // 3 regions + East's 2 stores

    // numeric store key preserved raw
    const store101 = model.getRow(1)!;
    expect(store101.__serverKey).toBe(101);
    expect(store101.key).toBe('101');

    east.setExpanded(false);
    expect(model.getRowCount()).toBe(3);
    east.setExpanded(true); // cached: no new fetch
    expect(calls).toHaveLength(2);
    expect(model.getRowCount()).toBe(5);
  });

  it('null (blank) members are real keys: distinct from "" and lossless in refresh targeting', () => {
    const { model, calls } = setup();
    const blank = model.getRow(1)!; // the null-region row
    expect(blank.__serverKey).toBeNull();
    expect(blank.key).toBe(''); // display only
    blank.setExpanded(true);
    expect(calls[calls.length - 1]!.groupKeys).toEqual([null]);

    // Targeted refresh of the blank branch refetches exactly that store.
    const before = calls.length;
    model.refreshStores({ groupKeys: [null] });
    expect(calls.length).toBe(before + 1);
    expect(calls[calls.length - 1]!.groupKeys).toEqual([null]);
    // '' is a DIFFERENT path — no store, no fetch.
    model.refreshStores({ groupKeys: [''] });
    expect(calls.length).toBe(before + 1);
  });

  it('blocks window within a wide parent; rowCount stays honest', () => {
    const { model, calls } = setup();
    const west = model.getRow(2)!;
    west.setExpanded(true); // 1 store
    const store = model.getRow(3)!;
    store.setExpanded(true); // 25 SKUs, blockSize 10
    const skuCall = calls[calls.length - 1]!;
    expect(skuCall.groupKeys).toEqual(['West', 201]);
    expect(skuCall.startRow).toBe(0);
    expect(skuCall.endRow).toBe(10);
    // Exact count reported → exact row count: 3 regions + 1 store + 25 SKUs.
    expect(model.getRowCount()).toBe(3 + 1 + 25);
    expect(store.allChildrenCount).toBe(25);

    // Scrolling deep into the parent loads its later block only.
    const before = calls.length;
    const deep = model.getRow(3 + 15)!; // 15th SKU → block 1 of that store
    expect(calls.length).toBe(before + 1);
    expect(calls[calls.length - 1]!.startRow).toBe(10);
    expect(deep).toBeTruthy();
  });

  it('sort change purges stores but expanded paths re-open lazily', () => {
    const { ctx, model, calls } = setup();
    model.getRow(0)!.setExpanded(true);
    expect(model.getRowCount()).toBe(5);
    const before = calls.length;

    ctx.rowModel.onSortChanged();
    // Root refetches; when East's row lands expanded, its store reloads too.
    expect(model.getRowCount()).toBe(5);
    expect(calls.length).toBe(before + 2);
    const east = model.getRow(0)!;
    expect(east.expanded).toBe(true);
  });

  it('refreshStores in place preserves selection by getRowId', () => {
    const { ctx, model } = setup();
    ctx.options.update({ rowSelection: 'multiRow' });
    ctx.selection = new SelectionService(ctx);
    const east = model.getRow(0)!;
    ctx.selection.setSelected([east], true, 'test');

    model.refreshStores({ groupKeys: [] });
    const fresh = model.getRow(0)!;
    expect(fresh).not.toBe(east);
    expect(fresh.isSelected()).toBe(true);
    expect(ctx.selection.getSelectedNodes()[0]).toBe(fresh);
  });
});

describe('ServerSideRowModel + Grid (DOM / write-back)', () => {
  function mount() {
    const { ds, calls } = makeDatasource();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new Grid<Row>(host, { ...SS_OPTIONS, serverSideDatasource: ds });
    grid.getContext().renderer.setViewportSizeForTesting(900, 400);
    grid.getContext().renderer.renderNow();
    return { grid, host, calls };
  }

  it('renders chevrons on group rows via the model expandability hook', () => {
    const { grid, host } = mount();
    const chevrons = host.querySelectorAll('[data-au-expand]:not(.au-hidden)');
    expect(chevrons.length).toBeGreaterThanOrEqual(3);
    grid.destroy();
  });

  it('group-row commits are event-routed with the RAW key path; data never mutates', () => {
    const { grid, host } = mount();
    const ctx = grid.getContext();
    const events: CellEditRequestEvent<Row>[] = [];
    grid.api.addEventListener('cellEditRequest', (e) => events.push(e));

    // Expand blank region → its store row; edit qty on the store group row.
    const blank = ctx.rowModel.getRow(1)!;
    blank.setExpanded(true);
    ctx.renderer.renderNow();
    const storeRow = ctx.rowModel.getRow(2)!; // X-1 under null region
    expect(storeRow.group).toBe(true);
    const qtyBefore = storeRow.data!.qty;
    const committed = ctx.editing.commitValue(storeRow, 'qty', 999, 'edit');
    expect(committed).toBe(true);
    expect(storeRow.data!.qty).toBe(qtyBefore); // never mutated locally

    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.newValue).toBe(999);
    // Raw path: null region preserved as null (not ''), store key as string.
    expect(e.pivot?.rowKeys).toEqual([
      { colId: 'region', key: null },
      { colId: 'store', key: 'X-1' },
    ]);
    expect(e.pivot?.valueColId).toBe('qty');
    // Leaf enumeration is cached-only and must not trigger fetches.
    const callCountBefore = grid.getContext().rowModel.getRowCount();
    expect(e.pivot?.getLeafRows()).toEqual([]); // SKUs never loaded
    expect(grid.getContext().rowModel.getRowCount()).toBe(callCountBefore);
    grid.destroy();
  });

  it('editable callback still consults colDef; placeholders are not editable', () => {
    const { grid } = mount();
    const ctx = grid.getContext();
    const east = ctx.rowModel.getRow(0)!;
    // sku column is not editable on group rows (not an editable colDef)
    expect(ctx.editing.commitValue(east, 'sku', 'x', 'edit')).toBe(false);
    grid.destroy();
  });
});

describe('ServerSideRowModel loading UX (AUG-23)', () => {
  /** Datasource that captures requests; tests resolve manually. */
  function manualDatasource(): {
    ds: ServerSideDatasource<Row>;
    pending: ServerSideRowsParams<Row>[];
  } {
    const pending: ServerSideRowsParams<Row>[] = [];
    return { ds: { getRows: (p) => void pending.push(p) }, pending };
  }

  function manualSetup() {
    const { ds, pending } = manualDatasource();
    const { ctx } = createMockContext<Row>({ ...SS_OPTIONS, serverSideDatasource: ds });
    const model = new ServerSideRowModel<Row>(ctx);
    ctx.rowModel = model;
    model.start();
    return { ctx, model, pending };
  }

  it('expand shows ONE loading row — never a speculative block — until the first block lands', () => {
    const { model, pending } = manualSetup();
    // Root store: a single loading placeholder while block 0 is in flight.
    expect(model.getRowCount()).toBe(1);
    expect(model.getRow(0)!.__loading).toBe(true);
    pending[0]!.success({
      rowData: [
        { region: 'East', qty: 50 },
        { region: 'West', qty: 250 },
      ],
      rowCount: 2,
    });
    expect(model.getRowCount()).toBe(2);
    expect(model.getRow(0)!.__loading).toBe(false);

    // Tree expand: exactly one extra row appears (the loading row), not
    // cacheBlockSize (10 here) blank rows.
    model.getRow(0)!.setExpanded(true);
    expect(model.getRowCount()).toBe(3); // 2 regions + 1 loading placeholder
    const placeholder = model.getRow(1)!;
    expect(placeholder.__loading).toBe(true);
    expect(placeholder.group).toBe(false); // no chevron on skeletons

    pending[1]!.success({
      rowData: [
        { region: 'East', store: 101, qty: 30 },
        { region: 'East', store: 'E-2', qty: 20 },
      ],
      rowCount: 2,
    });
    expect(model.getRowCount()).toBe(4);
    expect(model.getRow(1)!.__loading).toBe(false);
    expect(model.getRow(1)!.key).toBe('101');
  });

  it('a known child count allocates exactly that many skeleton rows on expand', () => {
    const { model, pending } = manualSetup();
    pending[0]!.success({ rowData: [{ region: 'East', qty: 50 }], rowCount: 1 });
    const east = model.getRow(0)!;
    east.allChildrenCount = 7; // known from a prior load
    east.setExpanded(true);
    // 1 region + 7 skeletons, no snap-back when data lands with the same count.
    expect(model.getRowCount()).toBe(8);
    for (let i = 1; i <= 7; i++) expect(model.getRow(i)!.__loading).toBe(true);
  });

  it('renders skeleton bars in loading cells and clears them when data lands (DOM)', () => {
    const { ds, pending } = manualDatasource();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new Grid<Row>(host, { ...SS_OPTIONS, serverSideDatasource: ds });
    grid.getContext().renderer.setViewportSizeForTesting(900, 400);
    grid.getContext().renderer.renderNow();

    expect(host.querySelectorAll('.au-cell-loading').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('.au-skeleton').length).toBeGreaterThan(0);

    pending[0]!.success({ rowData: [{ region: 'East', qty: 50 }], rowCount: 1 });
    grid.getContext().renderer.renderNow();
    expect(host.querySelectorAll('.au-cell-loading').length).toBe(0);
    expect(host.querySelectorAll('.au-skeleton').length).toBe(0);
    expect(host.textContent).toContain('East');
    grid.destroy();
  });
});
