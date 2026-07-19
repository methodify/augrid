import { describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../test/mockContext';
import type { HeaderGroupNode } from './columnModel';

interface Row {
  name: string;
  price: number;
  qty: number;
  country?: string;
  year?: string;
  sales?: number;
}

describe('ColumnModel — defaults ladder & colId', () => {
  it('merges defaultColDef < columnTypes < colDef', () => {
    const { ctx } = createMockContext<Row>({
      defaultColDef: { width: 120, resizable: false, sortable: false },
      columnTypes: { money: { width: 150, headerName: 'Money' } },
      columnDefs: [
        { field: 'price', type: 'money', width: 180 },
        { field: 'qty', type: 'money' },
        { field: 'name' },
      ],
    });
    const cm = ctx.columnModel;
    expect(cm.getColumn('price')!.width).toBe(180); // colDef wins over type
    expect(cm.getColumn('qty')!.width).toBe(150); // type wins over default
    expect(cm.getColumn('name')!.width).toBe(120); // default applies
    expect(cm.getColumn('qty')!.getColDef().headerName).toBe('Money');
    expect(cm.getColumn('name')!.isResizable()).toBe(false);
    expect(cm.getColumn('name')!.isSortable()).toBe(false);
  });

  it('colId falls back to field; explicit colId wins', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [{ field: 'name' }, { field: 'price', colId: 'cost' }],
    });
    expect(ctx.columnModel.getColumn('name')).toBeDefined();
    expect(ctx.columnModel.getColumn('cost')).toBeDefined();
    expect(ctx.columnModel.getColumn('cost')!.getColDef().field).toBe('price');
    expect(ctx.columnModel.getColumn('price')).toBeUndefined();
  });
});

describe('ColumnModel — visibility & pinning', () => {
  it('setColumnsVisible hides columns and dispatches columnVisible', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [{ field: 'name' }, { field: 'price' }],
    });
    const listener = vi.fn();
    ctx.events.addEventListener('columnVisible', listener);
    ctx.columnModel.setColumnsVisible(['name'], false);
    const shown = ctx.columnModel.getDisplayedColumns().map((c) => c.colId);
    expect(shown).toEqual(['price']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as { columns: { colId: string }[] }).columns[0].colId).toBe('name');
    // no-op when already hidden
    ctx.columnModel.setColumnsVisible(['name'], false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('setColumnsPinned moves columns between regions and dispatches columnPinned', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [{ field: 'name' }, { field: 'price' }, { field: 'qty' }],
    });
    const listener = vi.fn();
    ctx.events.addEventListener('columnPinned', listener);
    ctx.columnModel.setColumnsPinned(['qty'], 'left');
    ctx.columnModel.setColumnsPinned(['name'], 'right');
    const d = ctx.columnModel.getDisplayed();
    expect(d.left.map((c) => c.colId)).toEqual(['qty']);
    expect(d.right.map((c) => c.colId)).toEqual(['name']);
    expect(d.center.map((c) => c.colId)).toEqual(['price']);
    expect(d.all.map((c) => c.colId)).toEqual(['qty', 'price', 'name']);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('ColumnModel — moving', () => {
  it('moveColumns reorders the primary set', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [{ field: 'name' }, { field: 'price' }, { field: 'qty' }],
    });
    const listener = vi.fn();
    ctx.events.addEventListener('columnMoved', listener);
    ctx.columnModel.moveColumns(['qty'], 0);
    expect(ctx.columnModel.getPrimaryColumns().map((c) => c.colId)).toEqual(['qty', 'name', 'price']);
    expect(ctx.columnModel.getDisplayedColumns().map((c) => c.colId)).toEqual(['qty', 'name', 'price']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('suppressMovable columns are not moved', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [{ field: 'name', suppressMovable: true }, { field: 'price' }],
    });
    const listener = vi.fn();
    ctx.events.addEventListener('columnMoved', listener);
    ctx.columnModel.moveColumns(['name'], 1);
    expect(ctx.columnModel.getPrimaryColumns().map((c) => c.colId)).toEqual(['name', 'price']);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('ColumnModel — widths, flex, sizeColumnsToFit', () => {
  it('resolves flex against remaining viewport width', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [
        { field: 'name', width: 200 },
        { field: 'price', flex: 1 },
        { field: 'qty', flex: 2 },
      ],
    });
    ctx.columnModel.setViewportWidth(600);
    const d = ctx.columnModel.getDisplayed();
    const byId = new Map(d.all.map((c) => [c.colId, c]));
    expect(byId.get('name')!.actualWidth).toBe(200);
    expect(byId.get('price')!.actualWidth).toBe(133); // floor(400 * 1/3)
    expect(byId.get('qty')!.actualWidth).toBe(266); // floor(400 * 2/3)
    const sum = ctx.columnModel.getRegionWidths().center;
    expect(sum).toBeGreaterThanOrEqual(598);
    expect(sum).toBeLessThanOrEqual(600);
    // left offsets accumulate
    expect(byId.get('name')!.left).toBe(0);
    expect(byId.get('price')!.left).toBe(200);
    expect(byId.get('qty')!.left).toBe(333);
  });

  it('flex respects minWidth and redistributes freed space', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [
        { field: 'name', width: 200 },
        { field: 'price', flex: 1, minWidth: 150 },
        { field: 'qty', flex: 2, minWidth: 40 },
      ],
    });
    ctx.columnModel.setViewportWidth(400);
    const d = ctx.columnModel.getDisplayed();
    const byId = new Map(d.all.map((c) => [c.colId, c]));
    expect(byId.get('price')!.actualWidth).toBe(150); // clamped to minWidth
    expect(byId.get('qty')!.actualWidth).toBe(50); // remaining free space
  });

  it('setColumnWidths clamps to min/max', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [
        { field: 'name', minWidth: 50, maxWidth: 300 },
      ],
    });
    ctx.columnModel.setColumnWidths([{ colId: 'name', width: 10 }]);
    expect(ctx.columnModel.getColumn('name')!.actualWidth).toBe(50);
    ctx.columnModel.setColumnWidths([{ colId: 'name', width: 5000 }]);
    expect(ctx.columnModel.getColumn('name')!.actualWidth).toBe(300);
  });

  it('sizeColumnsToFit scales all displayed columns to the viewport', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [
        { field: 'name', width: 100 },
        { field: 'price', width: 100 },
      ],
    });
    ctx.columnModel.setViewportWidth(500);
    ctx.columnModel.sizeColumnsToFit();
    expect(ctx.columnModel.getColumn('name')!.actualWidth).toBe(250);
    expect(ctx.columnModel.getColumn('price')!.actualWidth).toBe(250);
    expect(ctx.columnModel.getRegionWidths().center).toBe(500);
  });
});

describe('ColumnModel — column state', () => {
  it('getColumnState/applyColumnState round-trips incl. order', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [{ field: 'name' }, { field: 'price' }, { field: 'qty' }],
    });
    const cm = ctx.columnModel;
    const saved = cm.getColumnState();
    expect(saved.map((s) => s.colId)).toEqual(['name', 'price', 'qty']);
    expect(saved[0].orderIndex).toBe(0);

    // mutate everything
    cm.setColumnsVisible(['price'], false);
    cm.setColumnsPinned(['qty'], 'left');
    cm.setColumnWidths([{ colId: 'name', width: 333 }]);
    cm.moveColumns(['qty'], 0);
    expect(cm.getPrimaryColumns().map((c) => c.colId)).toEqual(['qty', 'name', 'price']);

    const ok = cm.applyColumnState({ state: saved, applyOrder: true });
    expect(ok).toBe(true);
    expect(cm.getPrimaryColumns().map((c) => c.colId)).toEqual(['name', 'price', 'qty']);
    expect(cm.getColumn('price')!.visible).toBe(true);
    expect(cm.getColumn('qty')!.pinned).toBeNull();
    expect(cm.getColumn('name')!.width).toBe(200);
  });

  it('applyColumnState returns false for unknown colIds and supports defaultState', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [{ field: 'name' }, { field: 'price' }],
    });
    const cm = ctx.columnModel;
    expect(cm.applyColumnState({ state: [{ colId: 'nope', width: 100 }] })).toBe(false);
    cm.applyColumnState({ defaultState: { hide: true } });
    expect(cm.getColumn('name')!.visible).toBe(false);
    expect(cm.getColumn('price')!.visible).toBe(false);
  });

  it('applyColumnState can restore sort state', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [{ field: 'name' }, { field: 'price' }],
    });
    ctx.columnModel.applyColumnState({
      state: [{ colId: 'price', sort: 'desc', sortIndex: 0 }],
    });
    expect(ctx.columnModel.getColumn('price')!.sort).toBe('desc');
    expect(ctx.columnModel.getColumn('price')!.sortIndex).toBe(0);
  });
});

describe('ColumnModel — header layout', () => {
  it('builds group tree with depth and splits groups across pinned regions', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [
        {
          headerName: 'Product',
          children: [{ field: 'name', pinned: 'left' }, { field: 'price' }],
        },
        { field: 'qty' },
      ],
    });
    const layout = ctx.columnModel.getHeaderLayout();
    expect(layout.depth).toBe(2);
    // left region: the group survives with only its pinned child
    expect(layout.left).toHaveLength(1);
    const leftGroup = layout.left[0] as HeaderGroupNode<Row>;
    expect(leftGroup.kind).toBe('group');
    expect(leftGroup.headerName).toBe('Product');
    expect(leftGroup.leafColumns.map((c) => c.colId)).toEqual(['name']);
    // center: pruned group with remaining child + plain column
    const centerGroup = layout.center[0] as HeaderGroupNode<Row>;
    expect(centerGroup.kind).toBe('group');
    expect(centerGroup.leafColumns.map((c) => c.colId)).toEqual(['price']);
    expect(layout.center[1]).toMatchObject({ kind: 'col' });
  });

  it('flat defs have depth 1', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [{ field: 'name' }, { field: 'price' }],
    });
    expect(ctx.columnModel.getHeaderLayout().depth).toBe(1);
  });
});

describe('ColumnModel — auto group & selection columns', () => {
  it('injects the auto group column when rowGroup is active (singleColumn)', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [{ field: 'country', rowGroup: true }, { field: 'name' }],
    });
    const cm = ctx.columnModel;
    expect(cm.getAutoGroupColumn()).not.toBeNull();
    expect(cm.getAutoGroupColumn()!.isAutoGroupCol).toBe(true);
    const ids = cm.getDisplayedColumns().map((c) => c.colId);
    expect(ids[0]).toBe('au-group-col');
    expect(ids).not.toContain('country'); // group col hidden in singleColumn mode
    expect(ids).toContain('name');
    expect(cm.getRowGroupColumns().map((c) => c.colId)).toEqual(['country']);
  });

  it('removes the auto group column when grouping is cleared', () => {
    const { ctx } = createMockContext<Row>({
      columnDefs: [{ field: 'country', rowGroup: true }, { field: 'name' }],
    });
    ctx.columnModel.setRowGroupColumns([]);
    expect(ctx.columnModel.getAutoGroupColumn()).toBeNull();
    expect(ctx.columnModel.getDisplayedColumns().map((c) => c.colId)).toEqual(['country', 'name']);
  });

  it('injects the selection checkbox column for multiRow selection', () => {
    const { ctx } = createMockContext<Row>({
      rowSelection: 'multiRow',
      columnDefs: [{ field: 'name' }],
    });
    const ids = ctx.columnModel.getDisplayedColumns().map((c) => c.colId);
    expect(ids[0]).toBe('au-selection-col');
    expect(ctx.columnModel.getSelectionColumn()).not.toBeNull();
    expect(ctx.columnModel.getSelectionColumn()!.width).toBe(44);
  });

  it('does not inject a selection column for singleRow selection', () => {
    const { ctx } = createMockContext<Row>({
      rowSelection: 'singleRow',
      columnDefs: [{ field: 'name' }],
    });
    const ids = ctx.columnModel.getDisplayedColumns().map((c) => c.colId);
    expect(ids).not.toContain('au-selection-col');
  });
});

describe('ColumnModel — secondary (pivot) columns', () => {
  it('setSecondaryColumns replaces displayed columns in pivot mode and builds a keyed header tree', () => {
    const { ctx } = createMockContext<Row>({
      pivotMode: true,
      columnDefs: [{ field: 'sales' }],
    });
    const cm = ctx.columnModel;
    const vc = cm.getPrimaryColumns()[0];
    cm.setSecondaryColumns([
      { keys: ['2019'], valueCol: vc, colDef: { colId: 'p-2019', headerName: 'Sales' } },
      { keys: ['2020'], valueCol: vc, colDef: { colId: 'p-2020', headerName: 'Sales' } },
    ]);
    expect(cm.getSecondaryColumns()!.map((c) => c.colId)).toEqual(['p-2019', 'p-2020']);
    expect(cm.getDisplayedColumns().map((c) => c.colId)).toEqual(['p-2019', 'p-2020']);
    expect(cm.getColumn('p-2019')!.secondary).toBe(true);
    expect(cm.getColumn('p-2019')!.pivotKeys).toEqual(['2019']);
    expect(cm.getColumn('p-2019')!.pivotValueColId).toBe('sales');

    const layout = cm.getHeaderLayout();
    expect(layout.depth).toBe(2);
    const groups = layout.center as HeaderGroupNode<Row>[];
    expect(groups.map((g) => g.headerName)).toEqual(['2019', '2020']);
    expect(groups[0].children).toHaveLength(1);

    // clearing restores primary columns
    cm.setSecondaryColumns(null);
    expect(cm.getSecondaryColumns()).toBeNull();
  });
});
