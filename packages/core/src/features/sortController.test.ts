import { describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../test/mockContext.js';
import { SortController } from './sortController.js';
import type { SortChangedEvent } from '../types/events.js';

interface Row {
  name: string;
  age: number;
}

function setup(colDefs?: object[]) {
  const { ctx, start } = createMockContext<Row>({
    columnDefs: (colDefs ?? [{ field: 'name' }, { field: 'age' }]) as never,
    rowData: [
      { name: 'Charlie', age: 30 },
      { name: 'Alice', age: 25 },
      { name: 'Bob', age: 35 },
    ],
  });
  ctx.sort = new SortController(ctx);
  start();
  return ctx;
}

describe('SortController', () => {
  it('cycles asc → desc → none with the default sorting order', () => {
    const ctx = setup();
    const col = ctx.columnModel.getColumn('name')!;

    ctx.sort.progressSort(col, false);
    expect(ctx.sort.getSortModel()).toEqual([{ colId: 'name', sort: 'asc' }]);

    ctx.sort.progressSort(col, false);
    expect(ctx.sort.getSortModel()).toEqual([{ colId: 'name', sort: 'desc' }]);

    ctx.sort.progressSort(col, false);
    expect(ctx.sort.getSortModel()).toEqual([]);
  });

  it('respects a custom colDef.sortingOrder', () => {
    const ctx = setup([{ field: 'name', sortingOrder: ['desc', 'asc'] }, { field: 'age' }]);
    const col = ctx.columnModel.getColumn('name')!;

    ctx.sort.progressSort(col, false);
    expect(ctx.sort.getSortModel()).toEqual([{ colId: 'name', sort: 'desc' }]);

    ctx.sort.progressSort(col, false);
    expect(ctx.sort.getSortModel()).toEqual([{ colId: 'name', sort: 'asc' }]);

    // wraps around, never reaching null
    ctx.sort.progressSort(col, false);
    expect(ctx.sort.getSortModel()).toEqual([{ colId: 'name', sort: 'desc' }]);
  });

  it('multi=true appends, updates in place, and removes entries', () => {
    const ctx = setup();
    const name = ctx.columnModel.getColumn('name')!;
    const age = ctx.columnModel.getColumn('age')!;

    ctx.sort.progressSort(name, false); // name asc
    ctx.sort.progressSort(age, true); // + age asc
    expect(ctx.sort.getSortModel()).toEqual([
      { colId: 'name', sort: 'asc' },
      { colId: 'age', sort: 'asc' },
    ]);

    // update name in place: stays at position 0
    ctx.sort.progressSort(name, true);
    expect(ctx.sort.getSortModel()).toEqual([
      { colId: 'name', sort: 'desc' },
      { colId: 'age', sort: 'asc' },
    ]);

    // cycle name to none: removed, age remains
    ctx.sort.progressSort(name, true);
    expect(ctx.sort.getSortModel()).toEqual([{ colId: 'age', sort: 'asc' }]);
  });

  it('multi=false replaces the whole model with the clicked column', () => {
    const ctx = setup();
    const name = ctx.columnModel.getColumn('name')!;
    const age = ctx.columnModel.getColumn('age')!;

    ctx.sort.setSortModel([{ colId: 'name', sort: 'asc' }]);
    ctx.sort.progressSort(age, false); // age null → asc, name dropped
    expect(ctx.sort.getSortModel()).toEqual([{ colId: 'age', sort: 'asc' }]);
    expect(name.sort).toBeNull();

    // clicking a desc column non-multi cycles it to none → empty model
    ctx.sort.setSortModel([
      { colId: 'name', sort: 'asc' },
      { colId: 'age', sort: 'desc' },
    ]);
    ctx.sort.progressSort(age, false);
    expect(ctx.sort.getSortModel()).toEqual([]);
  });

  it('round-trips the sort model and assigns sortIndex by position', () => {
    const ctx = setup();
    const model = [
      { colId: 'age', sort: 'desc' as const },
      { colId: 'name', sort: 'asc' as const },
    ];
    ctx.sort.setSortModel(model);
    expect(ctx.sort.getSortModel()).toEqual(model);
    expect(ctx.columnModel.getColumn('age')!.sortIndex).toBe(0);
    expect(ctx.columnModel.getColumn('name')!.sortIndex).toBe(1);
  });

  it('dispatches sortChanged with model and source', () => {
    const ctx = setup();
    const listener = vi.fn();
    ctx.events.addEventListener('sortChanged', listener);

    ctx.sort.setSortModel([{ colId: 'name', sort: 'asc' }], 'test-source');
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as SortChangedEvent<Row>;
    expect(event.sortModel).toEqual([{ colId: 'name', sort: 'asc' }]);
    expect(event.source).toBe('test-source');

    // progressSort default source is 'header'
    ctx.sort.progressSort(ctx.columnModel.getColumn('age')!, false);
    expect((listener.mock.calls[1][0] as SortChangedEvent<Row>).source).toBe('header');
  });

  it('re-sorts the displayed rows through the pipeline', () => {
    const ctx = setup();
    ctx.sort.setSortModel([{ colId: 'age', sort: 'asc' }]);
    expect([0, 1, 2].map((i) => ctx.rowModel.getRow(i)!.data!.age)).toEqual([25, 30, 35]);

    ctx.sort.setSortModel([{ colId: 'age', sort: 'desc' }]);
    expect([0, 1, 2].map((i) => ctx.rowModel.getRow(i)!.data!.age)).toEqual([35, 30, 25]);

    ctx.sort.setSortModel([]);
    expect([0, 1, 2].map((i) => ctx.rowModel.getRow(i)!.data!.age)).toEqual([30, 25, 35]);
  });

  it('ignores progressSort on non-sortable columns', () => {
    const ctx = setup([{ field: 'name', sortable: false }, { field: 'age' }]);
    const col = ctx.columnModel.getColumn('name')!;
    ctx.sort.progressSort(col, false);
    expect(ctx.sort.getSortModel()).toEqual([]);
  });
});
