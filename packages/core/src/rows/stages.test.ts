import { describe, expect, it } from 'vitest';
import { createMockContext } from '../test/mockContext';
import type { GridContext } from '../context';
import type { GridOptions } from '../types/gridOptions';
import { RowNode } from './rowNode';
import {
  PIVOT_SEP,
  pivotColId,
  runAggStage,
  runFilterStage,
  runGroupStage,
  runSortStage,
  type SortSpec,
} from './stages';

interface Row {
  country?: string;
  year?: string;
  sales?: number;
  name?: string;
  path?: string[];
  value?: number;
}

function ctxWith(options: GridOptions<Row>): GridContext<Row> {
  return createMockContext<Row>(options).ctx;
}

function makeLeaves(ctx: GridContext<Row>, data: Row[]): RowNode<Row>[] {
  return data.map((d, i) => {
    const n = new RowNode<Row>(ctx, `leaf-${i}`);
    n.data = d;
    n.__sourceIndex = i;
    return n;
  });
}

const SALES_DATA: Row[] = [
  { country: 'USA', year: '2020', sales: 100, name: 'a' },
  { country: 'USA', year: '2021', sales: 200, name: 'b' },
  { country: 'UK', year: '2020', sales: 50, name: 'c' },
  { country: 'USA', year: '2020', sales: 10, name: 'd' },
];

describe('runGroupStage', () => {
  it('flat: no grouping puts leaves directly under root', () => {
    const ctx = ctxWith({ columnDefs: [{ field: 'name' }] });
    const leaves = makeLeaves(ctx, SALES_DATA);
    const { root, groupsByPath } = runGroupStage(ctx, leaves, null, 0);
    expect(root.childrenAfterGroup).toBe(leaves);
    expect(groupsByPath.size).toBe(0);
    expect(leaves[0].parent).toBe(root);
    expect(leaves[0].level).toBe(0);
  });

  it('1-level grouping: keys, levels, parent links, groupsByPath', () => {
    const ctx = ctxWith({
      columnDefs: [{ field: 'country', rowGroup: true }, { field: 'sales' }],
    });
    const leaves = makeLeaves(ctx, SALES_DATA);
    const { root, groupsByPath } = runGroupStage(ctx, leaves, null, 0);
    const groups = root.childrenAfterGroup!;
    expect(groups.map((g) => g.key)).toEqual(['USA', 'UK']);
    expect(groups.every((g) => g.group)).toBe(true);
    expect(groups.every((g) => g.level === 0)).toBe(true);
    expect(groups.every((g) => g.parent === root)).toBe(true);
    expect(groups[0].field).toBe('country');
    expect([...groupsByPath.keys()].sort()).toEqual(['UK', 'USA']);
    const usa = groupsByPath.get('USA')!;
    expect(usa.childrenAfterGroup).toHaveLength(3);
    expect(usa.childrenAfterGroup![0].parent).toBe(usa);
    expect(usa.childrenAfterGroup![0].level).toBe(1);
  });

  it('2-level grouping: nested groups and composite paths', () => {
    const ctx = ctxWith({
      columnDefs: [
        { field: 'country', rowGroup: true, rowGroupIndex: 0 },
        { field: 'year', rowGroup: true, rowGroupIndex: 1 },
        { field: 'sales' },
      ],
    });
    const leaves = makeLeaves(ctx, SALES_DATA);
    const { groupsByPath } = runGroupStage(ctx, leaves, null, 0);
    expect(groupsByPath.has('USA')).toBe(true);
    expect(groupsByPath.has('USA|2020')).toBe(true);
    expect(groupsByPath.has('USA|2021')).toBe(true);
    expect(groupsByPath.has('UK|2020')).toBe(true);
    const usa2020 = groupsByPath.get('USA|2020')!;
    expect(usa2020.level).toBe(1);
    expect(usa2020.parent).toBe(groupsByPath.get('USA'));
    expect(usa2020.childrenAfterGroup).toHaveLength(2);
    expect(usa2020.childrenAfterGroup![0].level).toBe(2);
  });

  it('expansion: defaultExpanded levels and per-path overrides', () => {
    const ctx = ctxWith({
      columnDefs: [
        { field: 'country', rowGroup: true, rowGroupIndex: 0 },
        { field: 'year', rowGroup: true, rowGroupIndex: 1 },
      ],
    });
    // defaultExpanded 1: only level 0 expanded
    let res = runGroupStage(ctx, makeLeaves(ctx, SALES_DATA), null, 1);
    expect(res.groupsByPath.get('USA')!.expanded).toBe(true);
    expect(res.groupsByPath.get('USA|2020')!.expanded).toBe(false);
    // -1: everything expanded
    res = runGroupStage(ctx, makeLeaves(ctx, SALES_DATA), null, -1);
    expect(res.groupsByPath.get('USA|2020')!.expanded).toBe(true);
    // overrides win over defaults, both directions
    res = runGroupStage(ctx, makeLeaves(ctx, SALES_DATA), new Set(['USA|2020', '!USA']), 0);
    expect(res.groupsByPath.get('USA|2020')!.expanded).toBe(true);
    expect(res.groupsByPath.get('USA')!.expanded).toBe(false);
    expect(res.groupsByPath.get('UK')!.expanded).toBe(false); // default 0
  });

  it('tree data: parent data row appearing BEFORE its children gets a children array', () => {
    const ctx = ctxWith({
      treeData: true,
      getDataPath: (d: Row) => d.path!,
      columnDefs: [{ field: 'name' }, { field: 'value', aggFunc: 'sum' }],
    });
    // parent first, child second: ensureParent must upgrade the data node in place
    const data: Row[] = [
      { path: ['A'], value: 10, name: 'parent' },
      { path: ['A', 'B'], value: 1, name: 'child' },
      { path: ['A', 'B', 'C'], value: 2, name: 'grandchild' },
    ];
    const leaves = makeLeaves(ctx, data);
    const { root, groupsByPath } = runGroupStage(ctx, leaves, null, -1);
    const a = groupsByPath.get('A')!;
    expect(a).toBe(leaves[0]);
    expect(a.group).toBe(true);
    expect(a.childrenAfterGroup!.map((c) => c.key)).toEqual(['B']);
    const b = groupsByPath.get('A|B')!;
    expect(b).toBe(leaves[1]);
    expect(b.group).toBe(true);
    expect(b.childrenAfterGroup!.map((c) => c.key)).toEqual(['C']);
    expect(root.childrenAfterGroup!.map((n) => n.key)).toEqual(['A']);
  });

  it('tree data: builds hierarchy from getDataPath, upgrades fillers, aggregates parents', () => {
    const ctx = ctxWith({
      treeData: true,
      getDataPath: (d: Row) => d.path!,
      columnDefs: [{ field: 'name' }, { field: 'value', aggFunc: 'sum' }],
    });
    // child before parent forces a filler node for 'A' which is later upgraded
    const data: Row[] = [
      { path: ['A', 'B'], value: 1, name: 'child' },
      { path: ['A'], value: 10, name: 'parent' },
      { path: ['C'], value: 5, name: 'other' },
    ];
    const leaves = makeLeaves(ctx, data);
    const { root, groupsByPath } = runGroupStage(ctx, leaves, null, -1);

    const a = groupsByPath.get('A')!;
    expect(a).toBe(leaves[1]); // filler upgraded to the data-backed node
    expect(a.group).toBe(true);
    expect(a.data).toEqual({ path: ['A'], value: 10, name: 'parent' });
    expect(a.childrenAfterGroup!.map((c) => c.key)).toEqual(['B']);
    expect(a.childrenAfterGroup![0].parent).toBe(a);
    expect(a.__treePath).toEqual(['A']);
    expect(leaves[0].__treePath).toEqual(['A', 'B']);
    expect(root.childrenAfterGroup!.map((n) => n.key)).toEqual(['A', 'C']);
    expect(root.childrenAfterGroup![1].group).toBe(false); // C is a plain leaf

    // parent aggregation shape: a data-backed group aggregates its descendants
    runFilterStage(root, null);
    runAggStage(ctx, root);
    expect(a.aggData).toEqual({ value: 1 });
    expect(root.allChildrenCount).toBe(3); // B + A(self, data-backed) + C
  });

  // KERNEL BUG: runAggStage.collectLeaves intentionally pushes data-backed group
  // nodes into the parent's leaf list (so their own data contributes to ancestor
  // aggregates), but ValueService.getValue prefers node.aggData for group nodes.
  // By the time the parent aggregates, the child group's aggData is already set,
  // so the parent reads the child's aggregate (double-counting its descendants)
  // instead of the child's own data value. For data [A/B:1, A:10, C:5] with
  // sum(value), root should be 1 + 10 + 5 = 16 but computes 1 + 1 + 5 = 7.
  it.fails('tree data: root aggregation includes data-backed group nodes’ own values', () => {
    const ctx = ctxWith({
      treeData: true,
      getDataPath: (d: Row) => d.path!,
      columnDefs: [{ field: 'name' }, { field: 'value', aggFunc: 'sum' }],
    });
    const data: Row[] = [
      { path: ['A', 'B'], value: 1 },
      { path: ['A'], value: 10 },
      { path: ['C'], value: 5 },
    ];
    const { root } = runGroupStage(ctx, makeLeaves(ctx, data), null, -1);
    runFilterStage(root, null);
    runAggStage(ctx, root);
    expect(root.aggData).toEqual({ value: 16 });
  });
});

describe('runFilterStage', () => {
  it('applies predicate to leaves and keeps groups with passing descendants', () => {
    const ctx = ctxWith({
      columnDefs: [{ field: 'country', rowGroup: true }, { field: 'sales' }],
    });
    const leaves = makeLeaves(ctx, SALES_DATA);
    const { root, groupsByPath } = runGroupStage(ctx, leaves, null, 0);
    runFilterStage(root, (n) => (n.data?.sales ?? 0) >= 100);
    // UK (max 50) dropped, USA kept with 2 of 3 leaves
    expect(root.childrenAfterFilter!.map((g) => g.key)).toEqual(['USA']);
    const usa = groupsByPath.get('USA')!;
    expect(usa.childrenAfterFilter!.map((n) => n.data!.name)).toEqual(['a', 'b']);
    expect(usa.allChildrenCount).toBe(2);
    expect(root.allChildrenCount).toBe(2);
  });

  it('null predicate keeps everything', () => {
    const ctx = ctxWith({ columnDefs: [{ field: 'name' }] });
    const leaves = makeLeaves(ctx, SALES_DATA);
    const { root } = runGroupStage(ctx, leaves, null, 0);
    runFilterStage(root, null);
    expect(root.childrenAfterFilter).toHaveLength(4);
    expect(root.allChildrenCount).toBe(4);
  });
});

describe('runAggStage', () => {
  function aggSetup(aggFunc: string) {
    const ctx = ctxWith({
      columnDefs: [
        { field: 'country', rowGroup: true },
        { field: 'sales', aggFunc: aggFunc as never },
      ],
      aggFuncs: { spread: (p) => {
        const nums = p.values.filter((v): v is number => typeof v === 'number');
        return Math.max(...nums) - Math.min(...nums);
      } },
    });
    const leaves = makeLeaves(ctx, SALES_DATA);
    const { root, groupsByPath } = runGroupStage(ctx, leaves, null, 0);
    runFilterStage(root, null);
    runAggStage(ctx, root);
    return { root, usa: groupsByPath.get('USA')!, uk: groupsByPath.get('UK')! };
  }

  it('sum', () => {
    const { root, usa, uk } = aggSetup('sum');
    expect(usa.aggData!.sales).toBe(310);
    expect(uk.aggData!.sales).toBe(50);
    expect(root.aggData!.sales).toBe(360);
  });

  it('min / max', () => {
    expect(aggSetup('min').usa.aggData!.sales).toBe(10);
    expect(aggSetup('max').usa.aggData!.sales).toBe(200);
  });

  it('avg / count', () => {
    const { usa } = aggSetup('avg');
    expect(usa.aggData!.sales).toBeCloseTo(310 / 3);
    expect(aggSetup('count').usa.aggData!.sales).toBe(3);
  });

  it('first / last follow childrenAfterFilter order', () => {
    expect(aggSetup('first').usa.aggData!.sales).toBe(100);
    expect(aggSetup('last').usa.aggData!.sales).toBe(10);
  });

  it('custom aggFuncs from options take precedence', () => {
    const { usa } = aggSetup('spread');
    expect(usa.aggData!.sales).toBe(190); // 200 - 10
  });

  it('pivot mode buckets aggregates per pivot path and returns sorted paths', () => {
    const ctx = ctxWith({
      pivotMode: true,
      columnDefs: [
        { field: 'country', rowGroup: true },
        { field: 'year', pivot: true },
        { field: 'sales', aggFunc: 'sum' },
      ],
    });
    const leaves = makeLeaves(ctx, SALES_DATA);
    const { root, groupsByPath } = runGroupStage(ctx, leaves, null, 0);
    runFilterStage(root, null);
    const paths = runAggStage(ctx, root);
    expect(paths).toEqual([['2020'], ['2021']]); // sorted unique

    const usa = groupsByPath.get('USA')!;
    expect(usa.aggData![pivotColId(['2020'], 'sales')]).toBe(110); // 100 + 10
    expect(usa.aggData![pivotColId(['2021'], 'sales')]).toBe(200);
    expect(usa.aggData!.sales).toBe(310); // row total across buckets
    const uk = groupsByPath.get('UK')!;
    expect(uk.aggData![pivotColId(['2020'], 'sales')]).toBe(50);
    expect(uk.aggData![pivotColId(['2021'], 'sales')]).toBeUndefined();
    expect(pivotColId(['2020'], 'sales')).toBe(`pivot${PIVOT_SEP}2020${PIVOT_SEP}sales`);
  });

  it('clears aggData when no value columns exist', () => {
    const ctx = ctxWith({ columnDefs: [{ field: 'name' }] });
    const leaves = makeLeaves(ctx, SALES_DATA);
    const { root } = runGroupStage(ctx, leaves, null, 0);
    runFilterStage(root, null);
    runAggStage(ctx, root);
    expect(root.aggData).toBeUndefined();
  });
});

describe('runSortStage', () => {
  function specs(ctx: GridContext<Row>, ...items: [string, 'asc' | 'desc'][]): SortSpec<Row>[] {
    return items.map(([colId, direction]) => ({
      column: ctx.columnModel.getColumn(colId)!,
      direction,
    }));
  }

  it('sorts leaves by a column asc and desc', () => {
    const ctx = ctxWith({ columnDefs: [{ field: 'sales' }, { field: 'name' }] });
    const leaves = makeLeaves(ctx, SALES_DATA);
    const { root } = runGroupStage(ctx, leaves, null, 0);
    runFilterStage(root, null);
    runSortStage(ctx, root, specs(ctx, ['sales', 'asc']));
    expect(root.childrenAfterSort!.map((n) => n.data!.sales)).toEqual([10, 50, 100, 200]);
    runSortStage(ctx, root, specs(ctx, ['sales', 'desc']));
    expect(root.childrenAfterSort!.map((n) => n.data!.sales)).toEqual([200, 100, 50, 10]);
    // childrenAfterFilter untouched
    expect(root.childrenAfterFilter!.map((n) => n.data!.name)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('multi-column sort uses later specs as tiebreaks', () => {
    const ctx = ctxWith({ columnDefs: [{ field: 'country' }, { field: 'sales' }] });
    const leaves = makeLeaves(ctx, SALES_DATA);
    const { root } = runGroupStage(ctx, leaves, null, 0);
    runFilterStage(root, null);
    runSortStage(ctx, root, specs(ctx, ['country', 'asc'], ['sales', 'desc']));
    expect(root.childrenAfterSort!.map((n) => n.data!.name)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('stable tiebreak preserves source order for equal values', () => {
    const ctx = ctxWith({ columnDefs: [{ field: 'country' }, { field: 'name' }] });
    const leaves = makeLeaves(ctx, SALES_DATA);
    const { root } = runGroupStage(ctx, leaves, null, 0);
    runFilterStage(root, null);
    runSortStage(ctx, root, specs(ctx, ['country', 'desc']));
    // USA rows a, b, d keep their original relative order
    expect(root.childrenAfterSort!.map((n) => n.data!.name)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('custom comparator is honored', () => {
    const ctx = ctxWith({
      columnDefs: [
        {
          field: 'name',
          // reverse alphabetical via inverted comparator
          comparator: (a, b) => String(b).localeCompare(String(a)),
        },
      ],
    });
    const leaves = makeLeaves(ctx, SALES_DATA);
    const { root } = runGroupStage(ctx, leaves, null, 0);
    runFilterStage(root, null);
    runSortStage(ctx, root, specs(ctx, ['name', 'asc']));
    expect(root.childrenAfterSort!.map((n) => n.data!.name)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('sorts group rows by their key when sorting on the group column', () => {
    const ctx = ctxWith({
      columnDefs: [{ field: 'country', rowGroup: true }, { field: 'sales' }],
    });
    const leaves = makeLeaves(ctx, SALES_DATA);
    const { root } = runGroupStage(ctx, leaves, null, 0);
    runFilterStage(root, null);
    runSortStage(ctx, root, specs(ctx, ['country', 'asc']));
    expect(root.childrenAfterSort!.map((g) => g.key)).toEqual(['UK', 'USA']);
    runSortStage(ctx, root, specs(ctx, ['country', 'desc']));
    expect(root.childrenAfterSort!.map((g) => g.key)).toEqual(['USA', 'UK']);
  });

  it('sorts group rows by agg value when sorting on a value column', () => {
    const ctx = ctxWith({
      columnDefs: [
        { field: 'country', rowGroup: true },
        { field: 'sales', aggFunc: 'sum' },
      ],
    });
    const leaves = makeLeaves(ctx, SALES_DATA);
    const { root } = runGroupStage(ctx, leaves, null, 0);
    runFilterStage(root, null);
    runAggStage(ctx, root);
    runSortStage(ctx, root, specs(ctx, ['sales', 'asc']));
    // UK sum 50 < USA sum 310
    expect(root.childrenAfterSort!.map((g) => g.key)).toEqual(['UK', 'USA']);
  });

  it('no specs keeps filtered order without copying', () => {
    const ctx = ctxWith({ columnDefs: [{ field: 'name' }] });
    const leaves = makeLeaves(ctx, SALES_DATA);
    const { root } = runGroupStage(ctx, leaves, null, 0);
    runFilterStage(root, null);
    runSortStage(ctx, root, []);
    expect(root.childrenAfterSort).toBe(root.childrenAfterFilter);
  });
});
