import type { ColDef, ColDefOrGroup, ColGroupDef } from '../types/colDef';
import { isColGroupDef } from '../types/colDef';
import type { ColumnStateItem, PinnedPosition } from '../types/base';
import type { GridContext } from '../context';
import { Column, type CellDataType } from './column';
import { clamp, humanize, nextId } from '../utils/general';

export interface HeaderGroupNode<TData = unknown> {
  kind: 'group';
  groupId: string;
  headerName: string;
  headerClass?: string | string[];
  children: HeaderNode<TData>[];
  /** Leaf columns under this group currently displayed, per region computation. */
  leafColumns: Column<TData>[];
}

export type HeaderNode<TData = unknown> =
  | HeaderGroupNode<TData>
  | { kind: 'col'; column: Column<TData> };

export class ColumnModel<TData = unknown> {
  private ctx: GridContext<TData>;

  /** All primary columns in display order. */
  private primaryColumns: Column<TData>[] = [];
  private colsById = new Map<string, Column<TData>>();
  /** Pivot-generated columns (display order), when pivot result exists. */
  private secondaryColumns: Column<TData>[] | null = null;
  private secondaryHeaderTree: HeaderNode<TData>[] | null = null;
  /** Primary header group tree (from ColGroupDefs). */
  private primaryHeaderTree: HeaderNode<TData>[] = [];
  private autoGroupColumn: Column<TData> | null = null;
  private selectionColumn: Column<TData> | null = null;
  private viewportWidth = 0;
  /** Cache of displayed split; invalidated on any column change. */
  private displayedCache: {
    left: Column<TData>[];
    center: Column<TData>[];
    right: Column<TData>[];
    all: Column<TData>[];
  } | null = null;

  constructor(ctx: GridContext<TData>) {
    this.ctx = ctx;
  }

  /* ------------------------------------------------------------ boot / defs */

  setColumnDefs(defs: ColDefOrGroup<TData>[]): void {
    const prevById = this.colsById;
    const keepState = this.primaryColumns.length > 0 && !this.ctx.options.get('maintainColumnOrder');
    this.colsById = new Map();
    this.primaryColumns = [];
    this.primaryHeaderTree = this.buildTree(defs, prevById, keepState);
    this.syncAutoGroupColumn();
    this.invalidate();
    this.ctx.events.dispatch(this.baseEvent('newColumnsLoaded'));
    this.emitDisplayedChanged();
  }

  private buildTree(
    defs: ColDefOrGroup<TData>[],
    prevById: Map<string, Column<TData>>,
    keepState: boolean,
  ): HeaderNode<TData>[] {
    const nodes: HeaderNode<TData>[] = [];
    for (const def of defs) {
      if (isColGroupDef(def)) {
        const group: HeaderGroupNode<TData> = {
          kind: 'group',
          groupId: def.groupId ?? nextId('au-colgroup'),
          headerName: def.headerName ?? '',
          headerClass: def.headerClass,
          children: this.buildTree(def.children, prevById, keepState),
          leafColumns: [],
        };
        nodes.push(group);
      } else {
        const col = this.createColumn(def, prevById, keepState);
        nodes.push({ kind: 'col', column: col });
      }
    }
    return nodes;
  }

  private createColumn(
    def: ColDef<TData>,
    prevById: Map<string, Column<TData>>,
    keepState: boolean,
  ): Column<TData> {
    const merged = this.mergeColDef(def);
    const colId = merged.colId ?? merged.field ?? nextId('au-col');
    const col = new Column<TData>(colId, merged);
    const prev = prevById.get(colId);
    if (prev && keepState) {
      col.width = prev.width;
      col.actualWidth = prev.actualWidth;
      col.flex = prev.flex;
      col.visible = prev.visible;
      col.pinned = prev.pinned;
      col.sort = prev.sort;
      col.sortIndex = prev.sortIndex;
      col.rowGroupActive = prev.rowGroupActive;
      col.rowGroupIndex = prev.rowGroupIndex;
      col.pivotActive = prev.pivotActive;
      col.pivotIndex = prev.pivotIndex;
      col.aggFunc = prev.aggFunc ?? col.aggFunc;
      col.cellDataType = prev.cellDataType;
    }
    this.colsById.set(colId, col);
    this.primaryColumns.push(col);
    return col;
  }

  /** defaults ladder: defaultColDef → columnTypes → colDef. */
  private mergeColDef(def: ColDef<TData>): ColDef<TData> {
    const defaults = this.ctx.options.get('defaultColDef');
    const types = this.ctx.options.get('columnTypes');
    let merged: ColDef<TData> = { ...(defaults ?? {}) };
    if (def.type && types) {
      const names = Array.isArray(def.type) ? def.type : [def.type];
      for (const n of names) if (types[n]) merged = { ...merged, ...types[n] };
    }
    return { ...merged, ...def };
  }

  /** Infer cellDataType for columns that did not declare one, from a sample row. */
  inferCellDataTypes(sample: TData | undefined): void {
    if (sample == null) return;
    for (const col of this.primaryColumns) {
      const declared = col.colDef.cellDataType;
      if (declared) {
        col.cellDataType = declared === false ? 'object' : declared;
        continue;
      }
      const v = this.ctx.values.getValue(this.sampleNode(sample), col);
      col.cellDataType =
        typeof v === 'number'
          ? 'number'
          : typeof v === 'boolean'
            ? 'boolean'
            : v instanceof Date
              ? 'date'
              : v != null && typeof v === 'object'
                ? 'object'
                : 'text';
    }
  }

  private sampleNodeCache: { data: TData } | null = null;
  private sampleNode(data: TData): never {
    // Lightweight fake node good enough for valueGetter field paths.
    this.sampleNodeCache = { data };
    return { data, id: '__sample', level: 0, group: false } as never;
  }

  /* --------------------------------------------------------------- lookups */

  getColumn(colId: string): Column<TData> | undefined {
    if (this.autoGroupColumn?.colId === colId) return this.autoGroupColumn;
    const primary = this.colsById.get(colId);
    if (primary) return primary;
    return this.secondaryColumns?.find((c) => c.colId === colId);
  }

  getPrimaryColumns(): Column<TData>[] {
    return this.primaryColumns;
  }

  getSecondaryColumns(): Column<TData>[] | null {
    return this.secondaryColumns;
  }

  getRowGroupColumns(): Column<TData>[] {
    return this.primaryColumns
      .filter((c) => c.rowGroupActive)
      .sort((a, b) => (a.rowGroupIndex ?? 0) - (b.rowGroupIndex ?? 0));
  }

  getPivotColumns(): Column<TData>[] {
    return this.primaryColumns
      .filter((c) => c.pivotActive)
      .sort((a, b) => (a.pivotIndex ?? 0) - (b.pivotIndex ?? 0));
  }

  /** Columns with an aggFunc — the value columns for grouping/pivoting. */
  getValueColumns(): Column<TData>[] {
    return this.primaryColumns.filter((c) => c.aggFunc != null);
  }

  isPivotMode(): boolean {
    return this.ctx.options.get('pivotMode') === true;
  }

  getAutoGroupColumn(): Column<TData> | null {
    return this.autoGroupColumn;
  }

  /* ------------------------------------------------- displayed columns split */

  getDisplayed(): { left: Column<TData>[]; center: Column<TData>[]; right: Column<TData>[]; all: Column<TData>[] } {
    if (this.displayedCache) return this.displayedCache;
    const groupCols = this.getRowGroupColumns();
    const grouping = groupCols.length > 0 || this.ctx.options.get('treeData') === true;
    const displayType = this.ctx.options.get('groupDisplayType');
    const pivotMode = this.isPivotMode();

    let cols: Column<TData>[] = [];
    this.syncSelectionColumn();
    if (this.selectionColumn) cols.push(this.selectionColumn);
    if (this.autoGroupColumn && grouping && displayType === 'singleColumn') {
      cols.push(this.autoGroupColumn);
    }
    if (pivotMode && this.secondaryColumns) {
      cols.push(...this.secondaryColumns);
    } else {
      for (const c of this.primaryColumns) {
        if (!c.visible) continue;
        if (pivotMode) continue; // pivot mode with no result yet: only group col
        if (c.rowGroupActive && displayType === 'singleColumn') continue;
        if (grouping && displayType === 'groupRows' && c.rowGroupActive) continue;
        cols.push(c);
      }
    }

    const left = cols.filter((c) => c.pinned === 'left');
    const right = cols.filter((c) => c.pinned === 'right');
    const center = cols.filter((c) => !c.pinned);
    this.resolveFlexAndPositions(left, center, right);
    this.displayedCache = { left, center, right, all: [...left, ...center, ...right] };
    return this.displayedCache;
  }

  getDisplayedColumns(): Column<TData>[] {
    return this.getDisplayed().all;
  }

  /** Sum of widths per region. */
  getRegionWidths(): { left: number; center: number; right: number } {
    const d = this.getDisplayed();
    const sum = (arr: Column<TData>[]) => {
      let s = 0;
      for (const c of arr) s += c.actualWidth;
      return s;
    };
    return { left: sum(d.left), center: sum(d.center), right: sum(d.right) };
  }

  setViewportWidth(w: number): void {
    if (w === this.viewportWidth) return;
    this.viewportWidth = w;
    const hasFlex = this.getDisplayed().all.some((c) => c.flex != null);
    if (hasFlex) {
      this.invalidate();
      this.ctx.scheduleRender();
    }
  }

  private resolveFlexAndPositions(
    left: Column<TData>[],
    center: Column<TData>[],
    right: Column<TData>[],
  ): void {
    // Flex applies to center columns against remaining viewport space.
    for (const c of [...left, ...right]) c.actualWidth = c.flex != null ? Math.max(c.width, c.minWidth) : c.width;
    const fixed = center.filter((c) => c.flex == null);
    const flexed = center.filter((c) => c.flex != null);
    for (const c of fixed) c.actualWidth = c.width;
    if (flexed.length > 0) {
      const pinnedW = [...left, ...right].reduce((s, c) => s + c.actualWidth, 0);
      const fixedW = fixed.reduce((s, c) => s + c.width, 0);
      let free = Math.max(0, this.viewportWidth - pinnedW - fixedW);
      let remaining = [...flexed];
      // Iteratively satisfy min/max constraints.
      for (let iter = 0; iter < 4 && remaining.length > 0; iter++) {
        const totalFlex = remaining.reduce((s, c) => s + (c.flex as number), 0);
        const clamped: Column<TData>[] = [];
        for (const c of remaining) {
          const ideal = totalFlex > 0 ? (free * (c.flex as number)) / totalFlex : c.minWidth;
          const w = clamp(Math.floor(ideal), c.minWidth, c.maxWidth);
          c.actualWidth = w;
          if (w !== Math.floor(ideal)) clamped.push(c);
        }
        if (clamped.length === 0) break;
        for (const c of clamped) free -= c.actualWidth;
        remaining = remaining.filter((c) => !clamped.includes(c));
      }
    }
    let x = 0;
    for (const c of left) {
      c.left = x;
      x += c.actualWidth;
    }
    x = 0;
    for (const c of center) {
      c.left = x;
      x += c.actualWidth;
    }
    x = 0;
    for (const c of right) {
      c.left = x;
      x += c.actualWidth;
    }
  }

  /* -------------------------------------------------------------- mutations */

  setColumnsVisible(colIds: string[], visible: boolean, source = 'api'): void {
    const changed: Column<TData>[] = [];
    for (const id of colIds) {
      const c = this.colsById.get(id);
      if (c && c.visible !== visible && !c.colDef.lockVisible) {
        c.visible = visible;
        changed.push(c);
      }
    }
    if (changed.length) this.afterColumnsChanged('columnVisible', changed, source);
  }

  setColumnsPinned(colIds: string[], pinned: PinnedPosition, source = 'api'): void {
    const changed: Column<TData>[] = [];
    for (const id of colIds) {
      const c = this.getColumn(id);
      if (c && c.pinned !== (pinned ?? null) && !c.colDef.lockPinned) {
        c.pinned = pinned ?? null;
        changed.push(c);
      }
    }
    if (changed.length) this.afterColumnsChanged('columnPinned', changed, source);
  }

  /** Move columns to a display index within the primary set. */
  moveColumns(colIds: string[], toIndex: number, source = 'api'): void {
    const moving = colIds
      .map((id) => this.colsById.get(id))
      .filter((c): c is Column<TData> => !!c && !c.colDef.suppressMovable && !c.colDef.lockPosition);
    if (moving.length === 0) return;
    const rest = this.primaryColumns.filter((c) => !moving.includes(c));
    const idx = clamp(toIndex, 0, rest.length);
    rest.splice(idx, 0, ...moving);
    this.primaryColumns = rest;
    this.rebuildFlatTreeAfterReorder();
    this.afterColumnsChanged('columnMoved', moving, source);
  }

  /** After reorder, header tree groups keep their columns; ungrouped flat list rebuilt. */
  private rebuildFlatTreeAfterReorder(): void {
    const grouped = new Set<Column<TData>>();
    const visit = (nodes: HeaderNode<TData>[]) => {
      for (const n of nodes) {
        if (n.kind === 'group') visit(n.children);
      }
    };
    visit(this.primaryHeaderTree);
    const hasGroups = this.primaryHeaderTree.some((n) => n.kind === 'group');
    if (!hasGroups) {
      this.primaryHeaderTree = this.primaryColumns.map((column) => ({ kind: 'col' as const, column }));
    }
    void grouped;
  }

  setColumnWidths(widths: { colId: string; width: number }[], finished = true, source = 'ui'): void {
    const changed: Column<TData>[] = [];
    for (const { colId, width } of widths) {
      const c = this.getColumn(colId);
      if (!c) continue;
      const w = clamp(Math.round(width), c.minWidth, c.maxWidth);
      if (c.width !== w || c.actualWidth !== w) {
        c.width = w;
        c.actualWidth = w;
        c.flex = null; // manual size overrides flex
        changed.push(c);
      }
    }
    if (changed.length) {
      this.invalidate();
      this.ctx.events.dispatch({
        ...this.baseEvent('columnResized'),
        columns: changed,
        source,
        finished,
      } as never);
      this.emitDisplayedChanged();
    }
  }

  sizeColumnsToFit(): void {
    const d = this.getDisplayed();
    const total = this.viewportWidth;
    if (total <= 0 || d.all.length === 0) return;
    const current = d.all.reduce((s, c) => s + c.actualWidth, 0);
    if (current <= 0) return;
    const scale = total / current;
    this.setColumnWidths(
      d.all.map((c) => ({ colId: c.colId, width: c.actualWidth * scale })),
      true,
      'sizeColumnsToFit',
    );
  }

  setRowGroupColumns(colIds: string[], source = 'api'): void {
    const changed: Column<TData>[] = [];
    for (const c of this.primaryColumns) {
      const idx = colIds.indexOf(c.colId);
      const active = idx >= 0;
      if (c.rowGroupActive !== active || (active && c.rowGroupIndex !== idx)) {
        c.rowGroupActive = active;
        c.rowGroupIndex = active ? idx : null;
        changed.push(c);
      }
    }
    if (changed.length) {
      this.syncAutoGroupColumn();
      this.afterColumnsChanged('columnRowGroupChanged', changed, source);
      this.ctx.rowModel.refreshModel?.('group');
    }
  }

  setPivotColumns(colIds: string[], source = 'api'): void {
    const changed: Column<TData>[] = [];
    for (const c of this.primaryColumns) {
      const idx = colIds.indexOf(c.colId);
      const active = idx >= 0;
      if (c.pivotActive !== active || (active && c.pivotIndex !== idx)) {
        c.pivotActive = active;
        c.pivotIndex = active ? idx : null;
        changed.push(c);
      }
    }
    if (changed.length) {
      this.afterColumnsChanged('columnPivotChanged', changed, source);
      this.ctx.rowModel.refreshModel?.('group');
    }
  }

  setValueColumns(entries: { colId: string; aggFunc: ColDef<TData>['aggFunc'] }[], source = 'api'): void {
    const changed: Column<TData>[] = [];
    const map = new Map(entries.map((e) => [e.colId, e.aggFunc]));
    for (const c of this.primaryColumns) {
      const next = map.has(c.colId) ? map.get(c.colId)! : null;
      if (c.aggFunc !== next) {
        c.aggFunc = next;
        changed.push(c);
      }
    }
    if (changed.length) {
      this.afterColumnsChanged('columnValueChanged', changed, source);
      this.ctx.rowModel.refreshModel?.('aggregate');
    }
  }

  /* ------------------------------------------------------- secondary (pivot) */

  /**
   * Called by the pivot stage with generated column defs, grouped per pivot
   * key path. Passing null clears pivot result columns.
   */
  setSecondaryColumns(
    defs: { keys: string[]; valueCol: Column<TData>; colDef: ColDef<TData> }[] | null,
  ): void {
    if (defs === null) {
      if (this.secondaryColumns === null) return;
      this.secondaryColumns = null;
      this.secondaryHeaderTree = null;
      this.invalidate();
      this.emitDisplayedChanged();
      return;
    }
    const cols: Column<TData>[] = [];
    // Build header tree by shared pivot key prefixes.
    const rootChildren: HeaderNode<TData>[] = [];
    const groupCache = new Map<string, HeaderGroupNode<TData>>();
    for (const def of defs) {
      const colId = def.colDef.colId ?? nextId('au-pivot');
      const col = new Column<TData>(colId, def.colDef);
      col.secondary = true;
      col.pivotKeys = def.keys;
      col.pivotValueColId = def.valueCol.colId;
      col.cellDataType = def.valueCol.cellDataType;
      cols.push(col);
      // attach to header tree
      let children = rootChildren;
      let pathKey = '';
      for (const key of def.keys) {
        pathKey += '|' + key;
        let g = groupCache.get(pathKey);
        if (!g) {
          g = { kind: 'group', groupId: nextId('au-pgroup'), headerName: key, children: [], leafColumns: [] };
          groupCache.set(pathKey, g);
          children.push(g);
        }
        children = g.children;
      }
      children.push({ kind: 'col', column: col });
    }
    this.secondaryColumns = cols;
    this.secondaryHeaderTree = rootChildren;
    this.invalidate();
    this.emitDisplayedChanged();
  }

  /* ------------------------------------------------------- selection column */

  private syncSelectionColumn(): void {
    const sel = this.ctx.options.get('rowSelection');
    const conf = typeof sel === 'string' ? { mode: sel } : sel;
    const wantCheckboxes =
      !!conf && (conf.checkboxes === true || (conf.mode === 'multiRow' && conf.checkboxes !== false));
    if (wantCheckboxes) {
      if (!this.selectionColumn) {
        this.selectionColumn = new Column<TData>('au-selection-col', {
          colId: 'au-selection-col',
          headerName: '',
          width: 44,
          minWidth: 44,
          maxWidth: 44,
          resizable: false,
          sortable: false,
          suppressMovable: true,
          lockPosition: 'left',
          editable: false,
        });
      }
      const anyLeft = this.primaryColumns.some((c) => c.visible && c.pinned === 'left');
      this.selectionColumn.pinned = anyLeft || this.autoGroupColumn?.pinned === 'left' ? 'left' : null;
    } else {
      this.selectionColumn = null;
    }
  }

  getSelectionColumn(): Column<TData> | null {
    return this.selectionColumn;
  }

  /* --------------------------------------------------------- auto group col */

  private syncAutoGroupColumn(): void {
    const grouping =
      this.getRowGroupColumns().length > 0 || this.ctx.options.get('treeData') === true;
    const displayType = this.ctx.options.get('groupDisplayType');
    if (grouping && displayType === 'singleColumn') {
      if (!this.autoGroupColumn) {
        const userDef = this.ctx.options.get('autoGroupColumnDef') ?? {};
        const def: ColDef<TData> = {
          headerName: 'Group',
          minWidth: 160,
          width: 220,
          ...userDef,
          colId: 'au-group-col',
        };
        this.autoGroupColumn = new Column<TData>('au-group-col', def);
        this.autoGroupColumn.isAutoGroupCol = true;
        this.autoGroupColumn.pinned = def.pinned === true || def.pinned === 'left' ? 'left' : def.pinned === 'right' ? 'right' : null;
      }
    } else {
      this.autoGroupColumn = null;
    }
  }

  /* ------------------------------------------------------------ header tree */

  /** Header rows for rendering: depth-first tree per region, plus depth count. */
  getHeaderLayout(): {
    depth: number;
    left: HeaderNode<TData>[];
    center: HeaderNode<TData>[];
    right: HeaderNode<TData>[];
  } {
    const displayed = this.getDisplayed();
    const tree =
      this.isPivotMode() && this.secondaryHeaderTree ? this.secondaryHeaderTree : this.primaryHeaderTree;

    const build = (region: Column<TData>[]): HeaderNode<TData>[] => {
      const inRegion = new Set(region);
      const auto: HeaderNode<TData>[] = [];
      if (this.autoGroupColumn && inRegion.has(this.autoGroupColumn)) {
        auto.push({ kind: 'col', column: this.autoGroupColumn });
      }
      const prune = (nodes: HeaderNode<TData>[]): HeaderNode<TData>[] => {
        const out: HeaderNode<TData>[] = [];
        for (const n of nodes) {
          if (n.kind === 'col') {
            if (inRegion.has(n.column)) out.push(n);
          } else {
            const kids = prune(n.children);
            if (kids.length > 0) {
              const leafColumns = collectLeaves(kids);
              out.push({ ...n, children: kids, leafColumns });
            }
          }
        }
        return out;
      };
      // Columns displayed but absent from the def tree (secondary w/o groups etc.)
      const covered = new Set<Column<TData>>();
      const markCovered = (nodes: HeaderNode<TData>[]) => {
        for (const n of nodes) {
          if (n.kind === 'col') covered.add(n.column);
          else markCovered(n.children);
        }
      };
      markCovered(tree);
      const pruned = prune(tree);
      const extras: HeaderNode<TData>[] = region
        .filter((c) => !covered.has(c) && c !== this.autoGroupColumn)
        .map((column) => ({ kind: 'col' as const, column }));
      // Order top-level nodes by first-leaf display order.
      const all = [...auto, ...pruned, ...extras];
      const firstLeafIdx = (n: HeaderNode<TData>): number => {
        const leaf = n.kind === 'col' ? n.column : collectLeaves(n.children)[0];
        return region.indexOf(leaf as Column<TData>);
      };
      all.sort((a, b) => firstLeafIdx(a) - firstLeafIdx(b));
      return all;
    };

    const depthOf = (nodes: HeaderNode<TData>[]): number => {
      let d = 1;
      for (const n of nodes) {
        if (n.kind === 'group') d = Math.max(d, 1 + depthOf(n.children));
      }
      return d;
    };

    const left = build(displayed.left);
    const center = build(displayed.center);
    const right = build(displayed.right);
    const depth = Math.max(depthOf(left), depthOf(center), depthOf(right));
    return { depth, left, center, right };
  }

  /* ------------------------------------------------------------ column state */

  getColumnState(): ColumnStateItem[] {
    return this.primaryColumns.map((c, i) => ({
      colId: c.colId,
      width: c.width,
      flex: c.flex,
      hide: !c.visible,
      pinned: c.pinned,
      sort: c.sort,
      sortIndex: c.sortIndex,
      rowGroup: c.rowGroupActive,
      rowGroupIndex: c.rowGroupIndex,
      pivot: c.pivotActive,
      pivotIndex: c.pivotIndex,
      aggFunc: typeof c.aggFunc === 'string' ? c.aggFunc : null,
      orderIndex: i,
    }));
  }

  applyColumnState(params: {
    state?: ColumnStateItem[];
    applyOrder?: boolean;
    defaultState?: Partial<ColumnStateItem>;
  }): boolean {
    const { state, applyOrder, defaultState } = params;
    let ok = true;
    const touched: Column<TData>[] = [];
    const apply = (c: Column<TData>, s: Partial<ColumnStateItem>) => {
      if (s.width !== undefined) {
        c.width = clamp(s.width, c.minWidth, c.maxWidth);
        c.actualWidth = c.width;
      }
      if (s.flex !== undefined) c.flex = s.flex;
      if (s.hide !== undefined) c.visible = !s.hide;
      if (s.pinned !== undefined) c.pinned = s.pinned ?? null;
      if (s.sort !== undefined) c.sort = s.sort;
      if (s.sortIndex !== undefined) c.sortIndex = s.sortIndex;
      if (s.rowGroup !== undefined) {
        c.rowGroupActive = s.rowGroup;
        c.rowGroupIndex = s.rowGroupIndex ?? (s.rowGroup ? (c.rowGroupIndex ?? 0) : null);
      } else if (s.rowGroupIndex !== undefined) c.rowGroupIndex = s.rowGroupIndex;
      if (s.pivot !== undefined) {
        c.pivotActive = s.pivot;
        c.pivotIndex = s.pivotIndex ?? (s.pivot ? (c.pivotIndex ?? 0) : null);
      } else if (s.pivotIndex !== undefined) c.pivotIndex = s.pivotIndex;
      if (s.aggFunc !== undefined) c.aggFunc = s.aggFunc;
      touched.push(c);
    };
    if (state) {
      for (const item of state) {
        const c = this.colsById.get(item.colId);
        if (!c) {
          ok = false;
          continue;
        }
        apply(c, { ...defaultState, ...item });
      }
      if (applyOrder) {
        const order = new Map(state.map((s, i) => [s.colId, s.orderIndex ?? i]));
        this.primaryColumns.sort((a, b) => {
          const ai = order.has(a.colId) ? order.get(a.colId)! : Number.MAX_SAFE_INTEGER;
          const bi = order.has(b.colId) ? order.get(b.colId)! : Number.MAX_SAFE_INTEGER;
          return ai - bi;
        });
        this.rebuildFlatTreeAfterReorder();
      }
    } else if (defaultState) {
      for (const c of this.primaryColumns) apply(c, defaultState);
    }
    this.syncAutoGroupColumn();
    this.invalidate();
    this.ctx.events.dispatch({ ...this.baseEvent('columnStateChanged' as never), columns: touched, source: 'applyColumnState' } as never);
    this.emitDisplayedChanged();
    this.ctx.rowModel.refreshModel?.('group');
    this.ctx.rowModel.onSortChanged();
    return ok;
  }

  /* ---------------------------------------------------------------- helpers */

  private afterColumnsChanged(eventType: string, columns: Column<TData>[], source: string): void {
    this.syncAutoGroupColumn();
    this.invalidate();
    this.ctx.events.dispatch({ ...this.baseEvent(eventType as never), columns, source } as never);
    this.emitDisplayedChanged();
  }

  private emitDisplayedChanged(): void {
    this.ctx.events.dispatch(this.baseEvent('displayedColumnsChanged'));
    this.ctx.scheduleRender();
  }

  private baseEvent<T extends string>(type: T): { type: T; api: never; context: unknown } {
    return {
      type,
      api: this.ctx.api as never,
      context: this.ctx.options.get('context'),
    };
  }

  invalidate(): void {
    this.displayedCache = null;
  }
}

function collectLeaves<TData>(nodes: HeaderNode<TData>[]): Column<TData>[] {
  const out: Column<TData>[] = [];
  for (const n of nodes) {
    if (n.kind === 'col') out.push(n.column);
    else out.push(...collectLeaves(n.children));
  }
  return out;
}
