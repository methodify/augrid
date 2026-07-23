import type { GridContext } from '../context.js';
import type { Column } from '../columns/column.js';
import { RowNode } from './rowNode.js';
import { defaultCompare, toDisplayString } from '../utils/general.js';
import type { AggFuncParams, ColDef } from '../types/colDef.js';

export const PIVOT_SEP = '\u001f';

/**
 * Separator for group-path strings (expansion persistence). A control char
 * (like PIVOT_SEP) so ordinary key strings cannot collide with the joiner.
 * Every segment is PREFIXED by the separator (path of ['USA','2020'] is
 * SEP+'USA'+SEP+'2020'), so the root prefix is always present: empty-string
 * keys and keys at different levels can never produce the same path (C8).
 */
export const GROUP_PATH_SEP = '\u001e';

/** Build a group path from key segments: each segment prefixed by the sep. */
export function joinGroupPath(segments: string[]): string {
  let p = '';
  for (const s of segments) p += GROUP_PATH_SEP + s;
  return p;
}

export function pivotColId(keys: string[], valueColId: string): string {
  return `pivot${PIVOT_SEP}${keys.join(PIVOT_SEP)}${PIVOT_SEP}${valueColId}`;
}

/* --------------------------------------------------------------- group stage */

export interface GroupStageResult<TData> {
  root: RowNode<TData>;
  /** All group nodes created, keyed by group path (for expansion restore). */
  groupsByPath: Map<string, RowNode<TData>>;
}

/**
 * Build the node tree. No grouping → leaves under root. Row grouping → nested
 * groups per rowGroup column values. Tree data → hierarchy from getDataPath.
 */
export function runGroupStage<TData>(
  ctx: GridContext<TData>,
  leaves: RowNode<TData>[],
  /** Per-path expansion overrides: path → expanded. Unset paths use defaults. (C34) */
  expansionOverrides: ReadonlyMap<string, boolean> | null,
  defaultExpanded: number,
): GroupStageResult<TData> {
  const root = new RowNode<TData>(ctx, 'au-root');
  root.group = true;
  root.level = -1;
  root.expanded = true;
  const groupsByPath = new Map<string, RowNode<TData>>();

  const treeData = ctx.options.get('treeData') === true;
  const getDataPath = ctx.options.get('getDataPath');

  if (treeData && getDataPath) {
    buildTree(ctx, root, leaves, getDataPath, groupsByPath);
  } else {
    const groupCols = ctx.columnModel.getRowGroupColumns();
    if (groupCols.length === 0) {
      root.childrenAfterGroup = leaves;
      for (const l of leaves) {
        l.parent = root;
        l.level = 0;
      }
    } else {
      buildGroups(ctx, root, leaves, groupCols, 0, '', groupsByPath);
    }
  }

  // Apply expansion state.
  for (const [path, node] of groupsByPath) {
    const override = expansionOverrides?.get(path);
    node.expanded = override !== undefined ? override : defaultExpanded === -1 || node.level < defaultExpanded;
  }
  return { root, groupsByPath };
}

function buildGroups<TData>(
  ctx: GridContext<TData>,
  parent: RowNode<TData>,
  leaves: RowNode<TData>[],
  groupCols: Column<TData>[],
  level: number,
  parentPath: string,
  groupsByPath: Map<string, RowNode<TData>>,
): void {
  const col = groupCols[level];
  const buckets = new Map<string, RowNode<TData>[]>();
  for (const leaf of leaves) {
    const key = toDisplayString(ctx.values.getValue(leaf, col));
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(leaf);
  }
  const children: RowNode<TData>[] = [];
  for (const [key, bucket] of buckets) {
    // No empty-parent special case: every segment is SEP-prefixed (C8).
    const path = `${parentPath}${GROUP_PATH_SEP}${key}`;
    const g = new RowNode<TData>(ctx, `row-group-${col.colId}-${path}`);
    g.group = true;
    g.key = key;
    g.field = col.colId;
    g.level = level;
    g.parent = parent;
    g.__groupPath = path;
    groupsByPath.set(path, g);
    if (level + 1 < groupCols.length) {
      buildGroups(ctx, g, bucket, groupCols, level + 1, path, groupsByPath);
    } else {
      g.childrenAfterGroup = bucket;
      for (const leaf of bucket) {
        leaf.parent = g;
        leaf.level = level + 1;
      }
    }
    children.push(g);
  }
  parent.childrenAfterGroup = children;
}

function buildTree<TData>(
  ctx: GridContext<TData>,
  root: RowNode<TData>,
  leaves: RowNode<TData>[],
  getDataPath: (data: TData) => string[],
  groupsByPath: Map<string, RowNode<TData>>,
): void {
  // Paths joined with GROUP_PATH_SEP (control char): collision-safe for
  // ordinary keys, including empty strings and keys containing '|' (C8).
  const byPath = new Map<string, RowNode<TData>>();
  root.childrenAfterGroup = [];

  const ensureParent = (path: string[], upTo: number): RowNode<TData> => {
    if (upTo === 0) return root;
    const key = joinGroupPath(path.slice(0, upTo));
    let node = byPath.get(key);
    if (node) {
      // A data-backed row becoming a parent: give it a children array.
      if (!node.childrenAfterGroup) node.childrenAfterGroup = [];
      return node;
    }
    // filler group
    node = new RowNode<TData>(ctx, `row-group-tree-${key}`);
    node.group = true;
    node.key = path[upTo - 1];
    node.level = upTo - 1;
    node.__groupPath = key;
    node.__treePath = path.slice(0, upTo);
    node.childrenAfterGroup = [];
    const parent = ensureParent(path, upTo - 1);
    node.parent = parent;
    (parent.childrenAfterGroup as RowNode<TData>[]).push(node);
    byPath.set(key, node);
    groupsByPath.set(key, node);
    return node;
  };

  // First pass: place data nodes at their paths.
  for (const leaf of leaves) {
    const path = getDataPath(leaf.data as TData);
    if (!path || path.length === 0) continue;
    const key = joinGroupPath(path);
    leaf.key = path[path.length - 1];
    leaf.level = path.length - 1;
    leaf.__treePath = path;
    const existingFiller = byPath.get(key);
    if (existingFiller && existingFiller.group && existingFiller.data === undefined) {
      // Upgrade filler to data-backed node: move children.
      leaf.group = true;
      leaf.childrenAfterGroup = existingFiller.childrenAfterGroup;
      for (const ch of leaf.childrenAfterGroup ?? []) ch.parent = leaf;
      const parent = existingFiller.parent as RowNode<TData>;
      const idx = (parent.childrenAfterGroup as RowNode<TData>[]).indexOf(existingFiller);
      (parent.childrenAfterGroup as RowNode<TData>[])[idx] = leaf;
      leaf.parent = parent;
      leaf.__groupPath = key;
      byPath.set(key, leaf);
      groupsByPath.set(key, leaf);
    } else {
      const parent = ensureParent(path, path.length - 1);
      leaf.parent = parent;
      (parent.childrenAfterGroup as RowNode<TData>[]).push(leaf);
      byPath.set(key, leaf);
    }
  }
  // Second pass: mark nodes with children as groups.
  for (const node of byPath.values()) {
    if (node.childrenAfterGroup && node.childrenAfterGroup.length > 0) {
      node.group = true;
      if (node.__groupPath == null) node.__groupPath = joinGroupPath(node.__treePath ?? []);
      groupsByPath.set(node.__groupPath, node);
    }
  }
}

/* -------------------------------------------------------------- filter stage */

export function runFilterStage<TData>(
  root: RowNode<TData>,
  predicate: ((node: RowNode<TData>) => boolean) | null,
): void {
  const visit = (node: RowNode<TData>): number => {
    let count = 0;
    if (!node.childrenAfterGroup) {
      node.childrenAfterFilter = undefined;
      node.allChildrenCount = 0;
      return 0;
    }
    const kept: RowNode<TData>[] = [];
    for (const child of node.childrenAfterGroup) {
      if (child.group) {
        const childCount = visit(child);
        const selfPasses = child.data !== undefined && (!predicate || predicate(child));
        if (childCount > 0 || selfPasses) {
          kept.push(child);
          count += childCount + (child.data !== undefined ? 1 : 0);
        }
      } else if (!predicate || predicate(child)) {
        kept.push(child);
        count++;
      }
    }
    node.childrenAfterFilter = kept;
    node.allChildrenCount = count;
    return count;
  };
  visit(root);
}

/* --------------------------------------------------- aggregation / pivot stage */

const PROVIDED_AGGS: Record<string, (values: unknown[]) => unknown> = {
  sum: (vs) => {
    let s = 0;
    let any = false;
    for (const v of vs)
      if (typeof v === 'number') {
        s += v;
        any = true;
      }
    return any ? s : null;
  },
  min: (vs) => {
    let m: number | null = null;
    for (const v of vs) if (typeof v === 'number' && (m === null || v < m)) m = v;
    return m;
  },
  max: (vs) => {
    let m: number | null = null;
    for (const v of vs) if (typeof v === 'number' && (m === null || v > m)) m = v;
    return m;
  },
  count: (vs) => vs.length,
  avg: (vs) => {
    let s = 0;
    let n = 0;
    for (const v of vs)
      if (typeof v === 'number') {
        s += v;
        n++;
      }
    return n > 0 ? s / n : null;
  },
  first: (vs) => (vs.length > 0 ? vs[0] : null),
  last: (vs) => (vs.length > 0 ? vs[vs.length - 1] : null),
};

function resolveAggFn<TData>(
  ctx: GridContext<TData>,
  aggFunc: ColDef<TData>['aggFunc'],
): ((params: AggFuncParams<TData>) => unknown) | null {
  if (aggFunc == null) return null;
  if (typeof aggFunc === 'function') return aggFunc;
  const custom = ctx.options.get('aggFuncs');
  if (custom && custom[aggFunc]) return custom[aggFunc];
  const provided = PROVIDED_AGGS[aggFunc];
  if (provided) return (p) => provided(p.values);
  return null;
}

/**
 * Bottom-up aggregation. Standard mode: aggData[valueColId]. Pivot mode:
 * aggData[pivotColId(keys, valueColId)] per pivot key path, plus generation of
 * the unique pivot paths (returned for secondary column creation).
 */
export function runAggStage<TData>(ctx: GridContext<TData>, root: RowNode<TData>): string[][] {
  const valueCols = ctx.columnModel.getValueColumns();
  const pivotMode = ctx.columnModel.isPivotMode();
  const pivotCols = pivotMode ? ctx.columnModel.getPivotColumns() : [];
  const pivotActive = pivotMode && pivotCols.length > 0;
  const pathSet = new Map<string, string[]>();

  if (valueCols.length === 0 && !pivotActive) {
    clearAgg(root);
    return [];
  }

  const leafPivotKey = new Map<RowNode<TData>, string[]>();
  const getPivotPath = (leaf: RowNode<TData>): string[] => {
    let p = leafPivotKey.get(leaf);
    if (!p) {
      p = pivotCols.map((c) => toDisplayString(ctx.values.getValue(leaf, c)));
      leafPivotKey.set(leaf, p);
      const joined = p.join(PIVOT_SEP);
      if (!pathSet.has(joined)) pathSet.set(joined, p);
    }
    return p;
  };

  const collectLeaves = (node: RowNode<TData>, out: RowNode<TData>[]): void => {
    for (const ch of node.childrenAfterFilter ?? []) {
      if (ch.group) {
        collectLeaves(ch, out);
        if (ch.data !== undefined) out.push(ch);
      } else out.push(ch);
    }
  };

  const visit = (node: RowNode<TData>): void => {
    for (const ch of node.childrenAfterFilter ?? []) if (ch.group) visit(ch);
    const leaves: RowNode<TData>[] = [];
    collectLeaves(node, leaves);
    const agg: Record<string, unknown> = {};
    if (pivotActive) {
      // bucket leaves per pivot path
      const buckets = new Map<string, RowNode<TData>[]>();
      for (const leaf of leaves) {
        const path = getPivotPath(leaf);
        const k = path.join(PIVOT_SEP);
        let arr = buckets.get(k);
        if (!arr) {
          arr = [];
          buckets.set(k, arr);
        }
        arr.push(leaf);
      }
      for (const vc of valueCols) {
        const fn = resolveAggFn(ctx, vc.aggFunc);
        if (!fn) continue;
        for (const [k, bucket] of buckets) {
          const values = bucket.map((l) => ctx.values.getValue(l, vc));
          agg[pivotColId(k.split(PIVOT_SEP), vc.colId)] = fn({
            values,
            colId: vc.colId,
            rowNode: node,
            api: ctx.api,
            context: ctx.options.get('context'),
          });
        }
        // Row total across all buckets
        const values = leaves.map((l) => ctx.values.getValue(l, vc));
        agg[vc.colId] = fn({
          values,
          colId: vc.colId,
          rowNode: node,
          api: ctx.api,
          context: ctx.options.get('context'),
        });
      }
    } else {
      for (const vc of valueCols) {
        const fn = resolveAggFn(ctx, vc.aggFunc);
        if (!fn) continue;
        const values = leaves.map((l) => ctx.values.getValue(l, vc));
        agg[vc.colId] = fn({
          values,
          colId: vc.colId,
          rowNode: node,
          api: ctx.api,
          context: ctx.options.get('context'),
        });
      }
    }
    node.aggData = agg;
  };
  visit(root);

  // Sorted unique pivot paths.
  return [...pathSet.values()].sort((a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const c = defaultCompare(a[i], b[i]);
      if (c !== 0) return c;
    }
    return 0;
  });
}

function clearAgg<TData>(node: RowNode<TData>): void {
  node.aggData = undefined;
  for (const ch of node.childrenAfterFilter ?? []) if (ch.group) clearAgg(ch);
}

/* ---------------------------------------------------------------- sort stage */

export interface SortSpec<TData> {
  column: Column<TData>;
  direction: 'asc' | 'desc';
}

export function runSortStage<TData>(
  ctx: GridContext<TData>,
  root: RowNode<TData>,
  sortSpecs: SortSpec<TData>[],
): void {
  const accented = ctx.options.get('accentedSort') === true;

  const valueFor = (node: RowNode<TData>, spec: SortSpec<TData>): unknown => {
    const col = spec.column;
    if (node.group && node.data === undefined) {
      if (col.isAutoGroupCol) return node.key;
      if (col.colId === node.field) return node.key;
      if (node.aggData && col.colId in node.aggData) return node.aggData[col.colId];
      // Group sorted by a leaf column: use group key when this column IS a
      // higher-level group column, else undefined (stable order).
      if (col.rowGroupActive) return node.key;
      return undefined;
    }
    return ctx.values.getValue(node, col);
  };

  const compare = (a: RowNode<TData>, b: RowNode<TData>): number => {
    for (const spec of sortSpecs) {
      const av = valueFor(a, spec);
      const bv = valueFor(b, spec);
      const userCmp = spec.column.getColDef().comparator;
      let c: number;
      if (userCmp) c = userCmp(av, bv, a, b, spec.direction === 'desc');
      else c = defaultCompare(av, bv, accented);
      if (c !== 0) return spec.direction === 'desc' ? -c : c;
    }
    return a.__sourceIndex - b.__sourceIndex;
  };

  // C42: with no explicit sort, group levels honor initialGroupOrderComparator
  // when provided (fallback: current key/insertion order).
  const initialGroupOrder = ctx.options.get('initialGroupOrderComparator');

  const visit = (node: RowNode<TData>): void => {
    if (!node.childrenAfterFilter) {
      node.childrenAfterSort = undefined;
      return;
    }
    if (sortSpecs.length === 0) {
      if (initialGroupOrder && node.childrenAfterFilter.some((c) => c.group)) {
        node.childrenAfterSort = [...node.childrenAfterFilter].sort(
          (a, b) => initialGroupOrder({ nodeA: a, nodeB: b }),
        );
      } else {
        node.childrenAfterSort = node.childrenAfterFilter;
      }
    } else {
      node.childrenAfterSort = [...node.childrenAfterFilter].sort(compare);
    }
    for (const ch of node.childrenAfterSort) if (ch.group) visit(ch);
  };
  visit(root);

  const postSort = ctx.options.get('postSortRows');
  if (postSort && root.childrenAfterSort) {
    postSort({ nodes: root.childrenAfterSort });
  }
}
