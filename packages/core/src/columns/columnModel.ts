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
  /**
   * Synthetic group columns, in group-level order. Empty when not grouping or
   * when groupDisplayType is 'groupRows'. One entry for 'singleColumn', one per
   * active rowGroup column for 'multipleColumns'.
   */
  private autoGroupColumns: Column<TData>[] = [];
  /** colId → group level for auto group columns (renderer queries this). */
  private autoGroupLevels = new Map<string, number>();
  /** colId → source rowGroup colId (null for the single/treeData auto column). */
  private autoGroupSourceIds = new Map<string, string | null>();
  /** Identity of the current auto column set; rebuild only when it changes. */
  private autoGroupSignature = '';
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
    // Per-column state is ALWAYS preserved across setColumnDefs for surviving
    // colIds. maintainColumnOrder is purely an ordering concern (below).
    const keepState = this.primaryColumns.length > 0;
    const prevOrder =
      keepState && this.ctx.options.get('maintainColumnOrder') === true
        ? new Map(this.primaryColumns.map((c, i) => [c.colId, i]))
        : null;
    this.colsById = new Map();
    this.primaryColumns = [];
    this.primaryHeaderTree = this.buildTree(defs, prevById, keepState);
    if (prevOrder && prevOrder.size > 0) {
      // maintainColumnOrder: surviving columns keep the PREVIOUS display order;
      // brand-new columns are appended at the end in def order.
      const surviving: Column<TData>[] = [];
      const added: Column<TData>[] = [];
      for (const c of this.primaryColumns) {
        (prevOrder.has(c.colId) ? surviving : added).push(c);
      }
      surviving.sort((a, b) => prevOrder.get(a.colId)! - prevOrder.get(b.colId)!);
      this.primaryColumns = [...surviving, ...added];
      this.rebuildFlatTreeAfterReorder();
    }
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
      if (declared !== undefined) {
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
    for (const auto of this.autoGroupColumns) {
      if (auto.colId === colId) return auto;
    }
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

  /**
   * Options updates (groupDisplayType etc.) only invalidate the displayed
   * cache; resync the auto columns lazily before answering from them. When the
   * cache exists it was built after a sync, so the set is already current.
   */
  private ensureAutoGroupSynced(): void {
    if (!this.displayedCache) this.syncAutoGroupColumn();
  }

  /** First auto group column (compat accessor). */
  getAutoGroupColumn(): Column<TData> | null {
    this.ensureAutoGroupSynced();
    return this.autoGroupColumns[0] ?? null;
  }

  /** All auto group columns in group-level order. */
  getAutoGroupColumns(): Column<TData>[] {
    this.ensureAutoGroupSynced();
    return this.autoGroupColumns;
  }

  /** Group level of an auto group column, or null if colId is not one. */
  getAutoGroupLevel(colId: string): number | null {
    this.ensureAutoGroupSynced();
    return this.autoGroupLevels.get(colId) ?? null;
  }

  /**
   * Source rowGroup colId for a 'multipleColumns' auto group column; null for
   * the single auto column or unknown colIds.
   */
  getAutoGroupSourceColId(colId: string): string | null {
    this.ensureAutoGroupSynced();
    return this.autoGroupSourceIds.get(colId) ?? null;
  }

  /* ------------------------------------------------- displayed columns split */

  getDisplayed(): { left: Column<TData>[]; center: Column<TData>[]; right: Column<TData>[]; all: Column<TData>[] } {
    if (this.displayedCache) return this.displayedCache;
    // Lazily resync: groupDisplayType option updates only invalidate the cache.
    this.syncAutoGroupColumn();
    const pivotMode = this.isPivotMode();

    const cols: Column<TData>[] = [];
    this.syncSelectionColumn();
    if (this.selectionColumn) cols.push(this.selectionColumn);
    // Auto group columns first, in level order. Empty when not grouping or
    // when groupDisplayType is 'groupRows' (group nodes render as full-width rows).
    cols.push(...this.autoGroupColumns);
    if (pivotMode && this.secondaryColumns) {
      cols.push(...this.secondaryColumns);
    } else {
      for (const c of this.primaryColumns) {
        if (!c.visible) continue;
        if (pivotMode) continue; // pivot mode with no result yet: only group col
        // Grouped source columns are hidden in every groupDisplayType.
        if (c.rowGroupActive) continue;
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
    // Carry sort/width state over from previous secondary columns by colId so
    // regenerating the pivot result (path set changed) does not wipe user state.
    const prevSecondaryById = this.secondaryColumns
      ? new Map(this.secondaryColumns.map((c) => [c.colId, c]))
      : null;
    const cols: Column<TData>[] = [];
    // Build header tree by shared pivot key prefixes.
    const rootChildren: HeaderNode<TData>[] = [];
    const groupCache = new Map<string, HeaderGroupNode<TData>>();
    for (const def of defs) {
      const colId = def.colDef.colId ?? nextId('au-pivot');
      const col = new Column<TData>(colId, def.colDef);
      const prev = prevSecondaryById?.get(colId);
      if (prev) {
        col.sort = prev.sort;
        col.sortIndex = prev.sortIndex;
        col.width = prev.width;
        col.actualWidth = prev.actualWidth;
        col.flex = prev.flex;
      }
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
      const autoLeft = this.autoGroupColumns.some((c) => c.pinned === 'left');
      this.selectionColumn.pinned = anyLeft || autoLeft ? 'left' : null;
    } else {
      this.selectionColumn = null;
    }
  }

  getSelectionColumn(): Column<TData> | null {
    return this.selectionColumn;
  }

  /* --------------------------------------------------------- auto group col */

  private syncAutoGroupColumn(): void {
    const rowGroupCols = this.getRowGroupColumns();
    const grouping = rowGroupCols.length > 0 || this.ctx.options.get('treeData') === true;
    const displayType = this.ctx.options.get('groupDisplayType');

    // Desired auto column set for the current displayType + rowGroup set.
    interface AutoSpec {
      colId: string;
      headerName: string | undefined;
      level: number;
      sourceColId: string | null;
    }
    const specs: AutoSpec[] = [];
    if (grouping && displayType !== 'groupRows') {
      if (displayType === 'multipleColumns' && rowGroupCols.length > 0) {
        // One auto group column per active rowGroup column, in rowGroupIndex order.
        for (let level = 0; level < rowGroupCols.length; level++) {
          const src = rowGroupCols[level];
          specs.push({
            colId: `au-group-col-${src.colId}`,
            headerName: src.getHeaderName(),
            level,
            sourceColId: src.colId,
          });
        }
      } else {
        // 'singleColumn', or treeData under 'multipleColumns' (no source cols).
        specs.push({ colId: 'au-group-col', headerName: undefined, level: 0, sourceColId: null });
      }
    }

    const signature =
      String(displayType) + '|' + specs.map((s) => `${s.colId}:${s.headerName ?? ''}`).join(',');
    if (signature === this.autoGroupSignature) return; // identity stable: keep columns
    this.autoGroupSignature = signature;

    const prevById = new Map(this.autoGroupColumns.map((c) => [c.colId, c]));
    this.autoGroupLevels.clear();
    this.autoGroupSourceIds.clear();
    const userDef = this.ctx.options.get('autoGroupColumnDef') ?? {};
    this.autoGroupColumns = specs.map((spec) => {
      const def: ColDef<TData> = {
        headerName: 'Group',
        minWidth: 160,
        width: 220,
        ...userDef,
        ...(spec.headerName !== undefined ? { headerName: spec.headerName } : {}),
        colId: spec.colId,
      };
      const col = new Column<TData>(spec.colId, def);
      col.isAutoGroupCol = true;
      col.pinned =
        def.pinned === true || def.pinned === 'left' ? 'left' : def.pinned === 'right' ? 'right' : null;
      const prev = prevById.get(spec.colId);
      if (prev) {
        // Surviving auto columns keep their user state across rebuilds.
        col.width = prev.width;
        col.actualWidth = prev.actualWidth;
        col.flex = prev.flex;
        col.sort = prev.sort;
        col.sortIndex = prev.sortIndex;
        col.pinned = prev.pinned;
      }
      this.autoGroupLevels.set(spec.colId, spec.level);
      this.autoGroupSourceIds.set(spec.colId, spec.sourceColId);
      return col;
    });
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
      const autoSet = new Set(this.autoGroupColumns);
      const auto: HeaderNode<TData>[] = [];
      for (const c of this.autoGroupColumns) {
        if (inRegion.has(c)) auto.push({ kind: 'col', column: c });
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
        .filter((c) => !covered.has(c) && !autoSet.has(c))
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
