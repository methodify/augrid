import { describe, expect, it } from 'vitest';
import { FilterManager } from './filterManager';
import { createMockContext } from '../../test/mockContext';
import type { ColDef } from '../../types/colDef';
import type { FilterChangedEvent } from '../../types/events';
import type { FilterComp, FilterParams } from '../../types/filter';
import type { IRowNode } from '../../types/rowNode';

interface Row {
  name: string;
  age: number;
  country: string;
}

const rowData: Row[] = [
  { name: 'Alice', age: 30, country: 'UK' },
  { name: 'Bob', age: 40, country: 'UK' },
  { name: 'Carol', age: 25, country: 'FR' },
  { name: 'Dave', age: 35, country: 'FR' },
  { name: 'Eve', age: 45, country: 'DE' },
];

const columnDefs: ColDef<Row>[] = [
  { field: 'name' },
  { field: 'age' },
  { field: 'country' },
];

function setup(extraOptions: Record<string, unknown> = {}, defs: ColDef<Row>[] = columnDefs) {
  const { ctx, start } = createMockContext<Row>({
    columnDefs: defs,
    rowData,
    ...extraOptions,
  });
  const filters = new FilterManager<Row>(ctx);
  ctx.filters = filters;
  start();
  return { ctx, filters };
}

describe('FilterManager', () => {
  it('column text filter removes non-matching rows from the pipeline', () => {
    const { ctx, filters } = setup();
    expect(ctx.rowModel.getRowCount()).toBe(5);
    filters.setColumnModel_('name', {
      filterType: 'text',
      conditions: [{ type: 'contains', filter: 'a' }],
    });
    // Alice, Carol, Dave contain 'a' (case-insensitive)
    expect(ctx.rowModel.getRowCount()).toBe(3);
    expect(filters.isColumnActive('name')).toBe(true);
    expect(filters.isAnyFilterActive()).toBe(true);
  });

  it('setting a column model to null removes it and restores rows', () => {
    const { ctx, filters } = setup();
    filters.setColumnModel_('age', {
      filterType: 'number',
      conditions: [{ type: 'greaterThan', filter: 100 }],
    });
    expect(ctx.rowModel.getRowCount()).toBe(0);
    filters.setColumnModel_('age', null);
    expect(ctx.rowModel.getRowCount()).toBe(5);
    expect(filters.isColumnActive('age')).toBe(false);
    expect(filters.isAnyFilterActive()).toBe(false);
    expect(filters.createPredicate()).toBeNull();
  });

  it('dispatches filterChanged with model and source on every change', () => {
    const { ctx, filters } = setup();
    const events: FilterChangedEvent<Row>[] = [];
    ctx.events.addEventListener('filterChanged', (e) => events.push(e));
    filters.setColumnModel_(
      'name',
      { filterType: 'text', conditions: [{ type: 'equals', filter: 'bob' }] },
      'ui',
    );
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('ui');
    expect(events[0].filterModel.name).toEqual({
      filterType: 'text',
      conditions: [{ type: 'equals', filter: 'bob' }],
    });
    filters.setModel(null, 'api');
    expect(events).toHaveLength(2);
    expect(events[1].filterModel).toEqual({});
  });

  it('setModel replaces the whole map; getModel returns a copy', () => {
    const { ctx, filters } = setup();
    filters.setColumnModel_('name', {
      filterType: 'text',
      conditions: [{ type: 'equals', filter: 'alice' }],
    });
    expect(ctx.rowModel.getRowCount()).toBe(1);
    filters.setModel({
      age: { filterType: 'number', conditions: [{ type: 'greaterThan', filter: 30 }] },
    });
    // name filter replaced away; ages > 30: Bob, Dave, Eve
    expect(ctx.rowModel.getRowCount()).toBe(3);
    expect(filters.isColumnActive('name')).toBe(false);
    const model = filters.getModel();
    expect(Object.keys(model)).toEqual(['age']);
    delete model.age; // mutating the copy must not affect the manager
    expect(filters.isColumnActive('age')).toBe(true);
  });

  it('quick filter matches any column, multi-token requires all tokens', () => {
    const { ctx, filters } = setup();
    ctx.options.update({ quickFilterText: 'uk' });
    ctx.rowModel.onFilterChanged();
    expect(ctx.rowModel.getRowCount()).toBe(2); // Alice + Bob (country UK)
    expect(filters.isAnyFilterActive()).toBe(true);

    ctx.options.update({ quickFilterText: 'uk bob' });
    ctx.rowModel.onFilterChanged();
    expect(ctx.rowModel.getRowCount()).toBe(1); // only Bob matches both tokens
    expect(ctx.rowModel.getRow(0)?.data?.name).toBe('Bob');

    ctx.options.update({ quickFilterText: '' });
    ctx.rowModel.onFilterChanged();
    expect(ctx.rowModel.getRowCount()).toBe(5);
    expect(filters.isAnyFilterActive()).toBe(false);
  });

  it('quick filter respects suppressQuickFilter on a column', () => {
    const defs: ColDef<Row>[] = [
      { field: 'name' },
      { field: 'age' },
      { field: 'country', suppressQuickFilter: true },
    ];
    const { ctx } = setup({ quickFilterText: 'uk' }, defs);
    // 'uk' only appears in the suppressed country column → nothing matches
    expect(ctx.rowModel.getRowCount()).toBe(0);
  });

  it('external filter hooks participate in the predicate', () => {
    let active = false;
    const { ctx, filters } = setup({
      isExternalFilterPresent: () => active,
      doesExternalFilterPass: (node: IRowNode<Row>) => (node.data?.age ?? 0) < 30,
    });
    expect(ctx.rowModel.getRowCount()).toBe(5);
    expect(filters.createPredicate()).toBeNull();
    active = true;
    ctx.rowModel.onFilterChanged();
    expect(ctx.rowModel.getRowCount()).toBe(1); // Carol (25)
    expect(ctx.rowModel.getRow(0)?.data?.name).toBe('Carol');
    expect(filters.isAnyFilterActive()).toBe(true);
  });

  it('set filter end-to-end: collects distinct values and filters rows', () => {
    const { ctx, filters } = setup();
    expect(filters.getSetValues('country')).toEqual(['DE', 'FR', 'UK']);
    filters.setColumnModel_('country', { filterType: 'set', values: ['FR'] });
    expect(ctx.rowModel.getRowCount()).toBe(2); // Carol + Dave
    filters.setColumnModel_('country', { filterType: 'set', values: ['FR', 'DE'] });
    expect(ctx.rowModel.getRowCount()).toBe(3);
  });

  it('set filter values include null for blanks, sorted with null last', () => {
    const { ctx, start } = createMockContext<{ v: string | null }>({
      columnDefs: [{ field: 'v' }],
      rowData: [{ v: 'b' }, { v: null }, { v: 'a' }, { v: '' }, { v: 'b' }],
    });
    const filters = new FilterManager<{ v: string | null }>(ctx);
    ctx.filters = filters;
    start();
    expect(filters.getSetValues('v')).toEqual(['a', 'b', null]);
    filters.setColumnModel_('v', { filterType: 'set', values: [null] });
    expect(ctx.rowModel.getRowCount()).toBe(2); // null + ''
  });

  it('custom filter component class: init, setModel sync and doesFilterPass', () => {
    const instances: AgeAboveFilter[] = [];
    class AgeAboveFilter implements FilterComp<Row> {
      params!: FilterParams<Row>;
      threshold: number | null = null;
      constructor() {
        instances.push(this);
      }
      init(p: FilterParams<Row>): void {
        this.params = p;
      }
      doesFilterPass(_node: IRowNode<Row>, value: unknown): boolean {
        return this.threshold == null || (value as number) > this.threshold;
      }
      getModel(): unknown | null {
        return this.threshold;
      }
      setModel(m: unknown | null): void {
        this.threshold = m as number | null;
      }
    }
    const defs: ColDef<Row>[] = [
      { field: 'name' },
      { field: 'age', filter: AgeAboveFilter },
      { field: 'country' },
    ];
    const { ctx, filters } = setup({}, defs);
    filters.setColumnModel_('age', { filterType: 'custom', model: 34 });
    expect(ctx.rowModel.getRowCount()).toBe(3); // Bob 40, Dave 35, Eve 45
    expect(instances).toHaveLength(1);
    expect(instances[0].threshold).toBe(34); // model pushed into the comp
    expect(instances[0].params.colId).toBe('age');

    // Component-driven change flows back through onModelChange.
    instances[0].params.onModelChange(44);
    expect(ctx.rowModel.getRowCount()).toBe(1); // Eve only
    expect(filters.getModel().age).toEqual({ filterType: 'custom', model: 44 });
    instances[0].params.onModelChange(null);
    expect(ctx.rowModel.getRowCount()).toBe(5);
    expect(filters.isColumnActive('age')).toBe(false);
  });

  it('group rows are kept when any descendant passes the filter', () => {
    const defs: ColDef<Row>[] = [
      { field: 'name' },
      { field: 'age' },
      { field: 'country', rowGroup: true },
    ];
    const { ctx, filters } = setup({}, defs);
    // Collapsed groups: UK, FR, DE
    expect(ctx.rowModel.getRowCount()).toBe(3);
    filters.setColumnModel_('name', {
      filterType: 'text',
      conditions: [{ type: 'equals', filter: 'carol' }],
    });
    expect(ctx.rowModel.getRowCount()).toBe(1);
    const group = ctx.rowModel.getRow(0);
    expect(group?.group).toBe(true);
    expect(group?.key).toBe('FR');
    // Expanding shows the surviving leaf under the group.
    group?.setExpanded(true);
    expect(ctx.rowModel.getRowCount()).toBe(2);
    expect(ctx.rowModel.getRow(1)?.data?.name).toBe('Carol');
  });
});
