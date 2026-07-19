/**
 * NOTE ON HARNESS: this test should use createMockContext from ../test/mockContext,
 * but that harness value-imports rows/clientSideRowModel.ts, which currently has a
 * syntax error (line 415: `?? r.rowHeight || def` — mixing `??` with `||` without
 * parentheses is invalid JS/TS), so any module graph containing it fails to load.
 * Until the kernel is fixed, this file builds an equivalent context from the real
 * kernel pieces (OptionsService, EventService, ValueService, ColumnModel, gridApi,
 * RowNode, real group/filter pipeline stages) plus a minimal row model that mirrors
 * ClientSideRowModel's contract for the methods SelectionService uses.
 */
import { describe, expect, it } from 'vitest';
import type { GridContext, IFilterManager, ISortController } from '../context';
import type { GridOptions } from '../types/gridOptions';
import type { RowDataTransaction, RowDataTransactionResult } from '../types/api';
import type { IRowModel } from '../rows/rowModel';
import type { RowSelectedEvent, SelectionChangedEvent } from '../types/events';
import { OptionsService } from '../options';
import { EventService } from '../events/eventService';
import { ValueService } from '../values/valueService';
import { ColumnModel } from '../columns/columnModel';
import { createGridApi } from '../gridApi';
import { RowNode } from '../rows/rowNode';
import { runGroupStage, runFilterStage } from '../rows/stages';
import { SelectionService } from './selectionService';

interface Row {
  id: string;
  sport: string;
  athlete: string;
}

const rowData: Row[] = [
  { id: '1', sport: 'swim', athlete: 'Ann' },
  { id: '2', sport: 'swim', athlete: 'Bob' },
  { id: '3', sport: 'run', athlete: 'Cat' },
  { id: '4', sport: 'run', athlete: 'Dan' },
  { id: '5', sport: 'run', athlete: 'Eve' },
];

/** Minimal client-side row model: leaves → real group/filter stages → flatten. */
class TestRowModel {
  readonly type = 'clientSide' as const;
  private leaves: RowNode<Row>[] = [];
  private root: RowNode<Row> | null = null;
  private groupsByPath = new Map<string, RowNode<Row>>();
  private displayed: RowNode<Row>[] = [];

  constructor(private ctx: GridContext<Row>) {}

  start(): void {
    const data = (this.ctx.options.get('rowData') ?? []) as Row[];
    const getRowId = this.ctx.options.get('getRowId');
    this.leaves = data.map((d, i) => {
      const n = new RowNode<Row>(this.ctx, getRowId ? getRowId({ data: d, level: 0 }) : undefined);
      n.data = d;
      n.__sourceIndex = i;
      return n;
    });
    this.rebuild();
  }

  private rebuild(): void {
    const res = runGroupStage(this.ctx, this.leaves, null, this.ctx.options.get('groupDefaultExpanded') ?? 0);
    this.root = res.root;
    this.groupsByPath = res.groupsByPath;
    runFilterStage(this.root, null);
    this.displayed = [];
    const walk = (node: RowNode<Row>): void => {
      for (const ch of node.childrenAfterFilter ?? []) {
        this.displayed.push(ch);
        if (ch.group && ch.expanded) walk(ch);
      }
    };
    walk(this.root);
    this.displayed.forEach((n, i) => (n.rowIndex = i));
    // Mirrors ClientSideRowModel.refreshModel(): prune selection after updates.
    this.ctx.selection?.refresh();
  }

  getRowCount(): number {
    return this.displayed.length;
  }

  getRow(index: number): RowNode<Row> | undefined {
    return this.displayed[index];
  }

  getRowNode(id: string): RowNode<Row> | undefined {
    const leaf = this.leaves.find((n) => n.id === id);
    if (leaf) return leaf;
    for (const g of this.groupsByPath.values()) if (g.id === id) return g;
    return undefined;
  }

  forEachLeafNode(fn: (node: RowNode<Row>) => void): void {
    for (const n of this.leaves) fn(n);
  }

  forEachNodeAfterFilter(fn: (node: RowNode<Row>, index: number) => void): void {
    let i = 0;
    const visit = (node: RowNode<Row>): void => {
      for (const ch of node.childrenAfterFilter ?? []) {
        fn(ch, i++);
        if (ch.group) visit(ch);
      }
    };
    if (this.root) visit(this.root);
  }

  applyTransaction(tx: RowDataTransaction<Row>): RowDataTransactionResult<Row> | null {
    const getRowId = this.ctx.options.get('getRowId');
    const removed: RowNode<Row>[] = [];
    if (tx.remove && getRowId) {
      const ids = new Set(tx.remove.map((d) => getRowId({ data: d, level: 0 })));
      this.leaves = this.leaves.filter((n) => {
        if (ids.has(n.id)) {
          removed.push(n);
          return false;
        }
        return true;
      });
    }
    this.rebuild();
    return { add: [], update: [], remove: removed };
  }

  isDataLoaded(): boolean {
    return true;
  }

  onGroupExpandedChanged(): void {}
  onRowDataPatched(): void {}
  onSortChanged(): void {}
  onFilterChanged(): void {}
  destroy(): void {}
}

function setup(options: Partial<GridOptions<Row>> = {}) {
  const ctx = { gridId: 'test-grid', destroyed: false } as unknown as GridContext<Row>;
  ctx.options = new OptionsService<Row>({
    columnDefs: [{ field: 'sport' }, { field: 'athlete' }],
    rowData,
    getRowId: ({ data }) => data.id,
    ...options,
  });
  ctx.events = new EventService<Row>();
  ctx.values = new ValueService(ctx);
  ctx.columnModel = new ColumnModel(ctx);
  ctx.scheduleRender = () => {};
  ctx.renderNow = () => {};
  ctx.sort = { getSortModel: () => [], setSortModel: () => {}, progressSort: () => {}, destroy: () => {} } as ISortController<Row>;
  ctx.filters = {
    getModel: () => ({}),
    setModel: () => {},
    getColumnModel_: () => null,
    setColumnModel_: () => {},
    isColumnActive: () => false,
    isAnyFilterActive: () => false,
    createPredicate: () => null,
    getSetValues: () => [],
    mountFloatingFilter: () => {},
    destroy: () => {},
  } as IFilterManager<Row>;
  ctx.range = null;
  ctx.undoRedo = null;
  ctx.pagination = null;
  ctx.columnDrag = null;
  ctx.columnResize = null;
  ctx.tooltips = null;
  ctx.frameworkAdapter = null;
  ctx.renderer = {
    schedule: () => {},
    renderNow: () => {},
    markHeaderDirty: () => {},
    refreshCells: () => {},
    redrawAll: () => {},
    showOverlay: () => {},
    destroy: () => {},
  } as unknown as GridContext<Row>['renderer'];

  ctx.rowModel = new TestRowModel(ctx) as unknown as IRowModel<Row>;
  const selection = new SelectionService<Row>(ctx);
  ctx.selection = selection;
  ctx.api = createGridApi(ctx);
  ctx.columnModel.setColumnDefs(ctx.options.get('columnDefs') ?? []);
  ctx.rowModel.start();
  return { ctx, selection };
}

function click(opts: MouseEventInit = {}): MouseEvent {
  return new MouseEvent('click', opts);
}

function rowAt(ctx: GridContext<Row>, i: number): RowNode<Row> {
  const node = ctx.rowModel.getRow(i);
  if (!node) throw new Error(`no row at ${i}`);
  return node;
}

describe('SelectionService', () => {
  it('is a no-op when rowSelection is unset', () => {
    const { ctx, selection } = setup({ rowSelection: undefined });
    const node = rowAt(ctx, 0);
    selection.setSelected([node], true);
    selection.handleRowClick(node, click());
    selection.selectAll();
    expect(selection.getSelectedNodes()).toEqual([]);
    expect(node.__selected).toBe(false);
    expect(selection.isSelected(node)).toBe(false);
  });

  it('singleRow: selecting a node clears the previous one', () => {
    const { ctx, selection } = setup({ rowSelection: 'singleRow' });
    const a = rowAt(ctx, 0);
    const b = rowAt(ctx, 1);
    selection.setSelected([a], true);
    expect(selection.isSelected(a)).toBe(true);
    expect(a.__selected).toBe(true);
    selection.setSelected([b], true);
    expect(selection.getSelectedNodes()).toEqual([b]);
    expect(a.__selected).toBe(false);
    expect(b.__selected).toBe(true);
  });

  it('multiRow: setSelected accumulates and deselects individually', () => {
    const { ctx, selection } = setup({ rowSelection: 'multiRow' });
    const a = rowAt(ctx, 0);
    const b = rowAt(ctx, 1);
    selection.setSelected([a, b], true);
    expect(selection.getSelectedNodes()).toEqual([a, b]);
    selection.setSelected([a], false);
    expect(selection.getSelectedNodes()).toEqual([b]);
    expect(a.isSelected()).toBe(false);
    expect(b.isSelected()).toBe(true);
  });

  it('honors isRowSelectable', () => {
    const { ctx, selection } = setup({
      rowSelection: {
        mode: 'multiRow',
        isRowSelectable: (node) => (node.data as Row).athlete !== 'Bob',
      },
    });
    const a = rowAt(ctx, 0);
    const bob = rowAt(ctx, 1);
    selection.setSelected([a, bob], true);
    expect(selection.getSelectedNodes()).toEqual([a]);
    expect(bob.__selected).toBe(false);
  });

  it('dispatches rowSelected per changed node and one selectionChanged', () => {
    const { ctx, selection } = setup({ rowSelection: 'multiRow' });
    const rowEvents: RowSelectedEvent<Row>[] = [];
    const selEvents: SelectionChangedEvent<Row>[] = [];
    ctx.events.addEventListener('rowSelected', (e) => rowEvents.push(e));
    ctx.events.addEventListener('selectionChanged', (e) => selEvents.push(e));
    const a = rowAt(ctx, 0);
    const b = rowAt(ctx, 1);
    selection.setSelected([a, b], true, 'mySource');
    expect(rowEvents).toHaveLength(2);
    expect(rowEvents[0]).toMatchObject({
      node: a,
      data: a.data,
      rowIndex: a.rowIndex,
      selected: true,
    });
    expect(selEvents).toHaveLength(1);
    expect(selEvents[0].selectedNodes).toEqual([a, b]);
    expect(selEvents[0].source).toBe('mySource');

    selection.setSelected([a], false, 'off');
    expect(rowEvents[2]).toMatchObject({ node: a, selected: false });
    expect(selEvents[1].selectedNodes).toEqual([b]);
    expect(selEvents[1].source).toBe('off');
    // no-change calls dispatch nothing
    selection.setSelected([b], true);
    expect(selEvents).toHaveLength(2);
  });

  it('multiRow click semantics: plain click clears others, ctrl toggles, deselection option', () => {
    const { ctx, selection } = setup({
      rowSelection: { mode: 'multiRow', enableDeselection: true },
    });
    const a = rowAt(ctx, 0);
    const b = rowAt(ctx, 1);
    const c = rowAt(ctx, 2);

    selection.handleRowClick(a, click());
    expect(selection.getSelectedNodes()).toEqual([a]);

    // ctrl+click adds without clearing
    selection.handleRowClick(b, click({ ctrlKey: true }));
    expect(selection.getSelectedNodes()).toEqual([a, b]);
    // meta+click again toggles off
    selection.handleRowClick(b, click({ metaKey: true }));
    expect(selection.getSelectedNodes()).toEqual([a]);

    // plain click on another row clears others
    selection.handleRowClick(c, click());
    expect(selection.getSelectedNodes()).toEqual([c]);

    // plain click on already-selected row deselects (enableDeselection)
    selection.handleRowClick(c, click());
    expect(selection.getSelectedNodes()).toEqual([]);
  });

  it('multiRow plain click without enableDeselection keeps row selected', () => {
    const { ctx, selection } = setup({ rowSelection: 'multiRow' });
    const a = rowAt(ctx, 0);
    selection.handleRowClick(a, click());
    selection.handleRowClick(a, click());
    expect(selection.getSelectedNodes()).toEqual([a]);
  });

  it('shift+click selects the range from the last non-shift anchor', () => {
    const { ctx, selection } = setup({ rowSelection: 'multiRow' });
    selection.handleRowClick(rowAt(ctx, 1), click());
    selection.handleRowClick(rowAt(ctx, 3), click({ shiftKey: true }));
    expect(
      selection
        .getSelectedNodes()
        .map((n) => n.rowIndex)
        .sort(),
    ).toEqual([1, 2, 3]);

    // anchor unchanged by shift+click: shift-click up ranges from the same anchor
    selection.handleRowClick(rowAt(ctx, 0), click({ shiftKey: true }));
    expect(
      selection
        .getSelectedNodes()
        .map((n) => n.rowIndex)
        .sort(),
    ).toEqual([0, 1, 2, 3]);
  });

  it('ignores clicks when enableClickSelection is false', () => {
    const { ctx, selection } = setup({
      rowSelection: { mode: 'multiRow', enableClickSelection: false },
    });
    selection.handleRowClick(rowAt(ctx, 0), click());
    expect(selection.getSelectedNodes()).toEqual([]);
  });

  it('singleRow click selects; toggles only with enableDeselection', () => {
    const { ctx, selection } = setup({ rowSelection: 'singleRow' });
    const a = rowAt(ctx, 0);
    const b = rowAt(ctx, 1);
    selection.handleRowClick(a, click());
    expect(selection.getSelectedNodes()).toEqual([a]);
    selection.handleRowClick(a, click());
    expect(selection.getSelectedNodes()).toEqual([a]); // no deselection by default
    selection.handleRowClick(b, click());
    expect(selection.getSelectedNodes()).toEqual([b]);

    const t = setup({ rowSelection: { mode: 'singleRow', enableDeselection: true } });
    const n = rowAt(t.ctx, 0);
    t.selection.handleRowClick(n, click());
    t.selection.handleRowClick(n, click());
    expect(t.selection.getSelectedNodes()).toEqual([]);
  });

  it('selectAll / deselectAll / header checkbox and header state', () => {
    const { ctx, selection } = setup({ rowSelection: 'multiRow' });
    expect(selection.getHeaderState()).toBe(false);

    selection.setSelected([rowAt(ctx, 0)], true);
    expect(selection.getHeaderState()).toBe('indeterminate');

    selection.handleHeaderCheckbox(true);
    expect(selection.getSelectedNodes()).toHaveLength(rowData.length);
    expect(selection.getHeaderState()).toBe(true);

    const selEvents: SelectionChangedEvent<Row>[] = [];
    ctx.events.addEventListener('selectionChanged', (e) => selEvents.push(e));
    selection.handleHeaderCheckbox(false);
    expect(selection.getSelectedNodes()).toEqual([]);
    expect(selection.getHeaderState()).toBe(false);
    expect(selEvents[0].source).toBe('header');
  });

  it('selectAll is a no-op in singleRow mode', () => {
    const { selection } = setup({ rowSelection: 'singleRow' });
    selection.selectAll();
    expect(selection.getSelectedNodes()).toEqual([]);
  });

  it('groupSelects descendants: selecting a group stores its leaves; indeterminate state', () => {
    const { ctx, selection } = setup({
      columnDefs: [{ field: 'sport', rowGroup: true }, { field: 'athlete' }],
      rowSelection: { mode: 'multiRow', groupSelects: 'descendants' },
    });
    const group = rowAt(ctx, 0); // 'swim' or 'run' group row
    expect(group.group).toBe(true);

    selection.setSelected([group], true);
    const selected = selection.getSelectedNodes();
    expect(selected.every((n) => !n.group)).toBe(true); // leaves stored, not the group
    expect(selected).toHaveLength(group.childrenAfterFilter?.length ?? 0);
    expect(selected.length).toBeGreaterThan(1);
    expect(selection.isSelected(group)).toBe(true);

    // deselect one leaf -> group indeterminate
    const leaf = selected[0];
    selection.setSelected([leaf], false);
    expect(selection.isSelected(group)).toBeUndefined();

    // deselect the group -> all leaves off, group false
    selection.setSelected([group], false);
    expect(selection.isSelected(group)).toBe(false);
    expect(selection.getSelectedNodes()).toEqual([]);
  });

  it('refresh() prunes nodes removed by applyTransaction and fires selectionChanged', () => {
    const { ctx, selection } = setup({ rowSelection: 'multiRow' });
    const a = rowAt(ctx, 0);
    const b = rowAt(ctx, 1);
    selection.setSelected([a, b], true);

    const selEvents: SelectionChangedEvent<Row>[] = [];
    ctx.events.addEventListener('selectionChanged', (e) => selEvents.push(e));

    ctx.rowModel.applyTransaction?.({ remove: [a.data as Row] });

    expect(selection.getSelectedNodes()).toEqual([b]);
    expect(a.__selected).toBe(false);
    const evt = selEvents.find((e) => e.source === 'modelUpdate');
    expect(evt).toBeDefined();
    expect(evt?.selectedNodes).toEqual([b]);
  });

  it('calls scheduleRender on selection change', () => {
    const { ctx, selection } = setup({ rowSelection: 'multiRow' });
    let calls = 0;
    ctx.scheduleRender = () => calls++;
    selection.setSelected([rowAt(ctx, 0)], true);
    expect(calls).toBe(1);
  });
});
