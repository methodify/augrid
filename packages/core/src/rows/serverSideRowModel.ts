import type { GridContext } from '../context.js';
import type { IRowModel } from './rowModel.js';
import { RowNode } from './rowNode.js';
import type { GroupKey, ServerSideDatasource, ServerSideRowsParams } from '../types/serverSide.js';

interface SSBlock<TData> {
  nodes: (RowNode<TData> | undefined)[];
  state: 'loading' | 'loaded' | 'failed';
}

/** One store = the (windowed) children list of one expanded parent. */
interface SSStore<TData> {
  /** Raw key path from root to this store's parent; [] = root. */
  path: GroupKey[];
  /** Lossless cache key: JSON.stringify(path) — preserves null vs '' vs 0. */
  key: string;
  level: number;
  parentNode: RowNode<TData> | null;
  blocks: Map<number, SSBlock<TData>>;
  /** Exact child count when the datasource reported it. */
  rowCount: number | null;
  /** Speculative count while unknown (grows as blocks load; never synthesized). */
  virtualCount: number;
}

interface Slot<TData> {
  store: SSStore<TData>;
  childIdx: number;
}

const pathKey = (path: GroupKey[]): string => JSON.stringify(path);

/**
 * Server-side row model (AUG-8/AUG-20): lazy per-parent group expansion for
 * hierarchies too large to materialize (Plank: ~240K leaves under a 7-level
 * product tree). Each expansion fetches that parent's children through
 * `serverSideDatasource.getRows` — block-windowed within the parent, so a
 * 73K-child parent pages instead of loading whole. Group rows carry
 * SERVER-computed aggregate values in their data; the grid never
 * re-aggregates. Commits to group rows are always event-routed
 * (cellEditRequest with the raw groupKeys path — see pivotContext).
 */
export class ServerSideRowModel<TData = unknown> implements IRowModel<TData> {
  readonly type = 'serverSide' as const;

  private ctx: GridContext<TData>;
  private stores = new Map<string, SSStore<TData>>();
  /** Expanded paths survive purge (sort/filter change) and re-open lazily. */
  private expandedPaths = new Set<string>();
  /** Flattened display slots; rebuilt on structural change. */
  private slots: Slot<TData>[] = [];
  private slotsDirty = true;
  private generation = 0;
  private started = false;
  private anyLoaded = false;

  constructor(ctx: GridContext<TData>) {
    this.ctx = ctx;
  }

  /* ---------------------------------------------------------------- helpers */

  private blockSize(): number {
    return this.ctx.options.get('cacheBlockSize') ?? 100;
  }

  private rowH(): number {
    return this.ctx.options.get('rowHeight') ?? 32;
  }

  private groupCols(): { colId: string; field: string }[] {
    return this.ctx.columnModel
      .getRowGroupColumns()
      .map((c) => ({ colId: c.colId, field: c.getColDef().field ?? c.colId }));
  }

  /* -------------------------------------------------------------- lifecycle */

  start(): void {
    this.started = true;
    const root = this.ensureStore([], null);
    this.loadBlock(root, 0);
  }

  destroy(): void {
    this.generation++;
    this.ctx.options.get('serverSideDatasource')?.destroy?.();
    this.stores.clear();
    this.slots = [];
  }

  /* ----------------------------------------------------------------- stores */

  private ensureStore(path: GroupKey[], parentNode: RowNode<TData> | null): SSStore<TData> {
    const key = pathKey(path);
    let store = this.stores.get(key);
    if (!store) {
      store = {
        path,
        key,
        level: path.length,
        parentNode,
        blocks: new Map(),
        rowCount: null,
        virtualCount: this.blockSize(),
      };
      this.stores.set(key, store);
    } else if (parentNode) {
      store.parentNode = parentNode; // reattach after node instances change
    }
    return store;
  }

  private storeSize(store: SSStore<TData>): number {
    return store.rowCount ?? store.virtualCount;
  }

  private loadedNode(store: SSStore<TData>, childIdx: number): RowNode<TData> | undefined {
    const size = this.blockSize();
    const block = store.blocks.get(Math.floor(childIdx / size));
    if (!block || block.state !== 'loaded') return undefined;
    return block.nodes[childIdx - Math.floor(childIdx / size) * size];
  }

  /* -------------------------------------------------------------- flattening */

  private ensureSlots(): void {
    if (!this.slotsDirty) return;
    this.slotsDirty = false;
    this.slots = [];
    const root = this.stores.get(pathKey([]));
    if (root) this.appendStore(root);
  }

  private appendStore(store: SSStore<TData>): void {
    const size = this.storeSize(store);
    for (let i = 0; i < size; i++) {
      this.slots.push({ store, childIdx: i });
      const node = this.loadedNode(store, i);
      if (node && node.group && node.expanded && node.__ssPath) {
        const child = this.stores.get(pathKey(node.__ssPath));
        if (child) {
          child.parentNode = node;
          this.appendStore(child);
        }
      }
    }
  }

  private invalidateSlots(): void {
    this.slotsDirty = true;
  }

  /* ------------------------------------------------------------- row access */

  getRowCount(): number {
    this.ensureSlots();
    return this.slots.length;
  }

  getRow(index: number): RowNode<TData> | undefined {
    this.ensureSlots();
    const slot = this.slots[index];
    if (!slot) return undefined;
    const { store, childIdx } = slot;
    const size = this.blockSize();
    const blockIdx = Math.floor(childIdx / size);
    let block = store.blocks.get(blockIdx);
    if (!block) {
      this.loadBlock(store, blockIdx);
      block = store.blocks.get(blockIdx);
      if (!block) return undefined;
    }
    const offset = childIdx - blockIdx * size;
    let node = block.nodes[offset];
    if (!node && block.state !== 'loaded') {
      node = this.createPlaceholder(store, childIdx);
      block.nodes[offset] = node;
    }
    if (node) {
      node.rowIndex = index;
      node.rowTop = index * this.rowH();
    }
    return node;
  }

  getRowNode(id: string): RowNode<TData> | undefined {
    for (const store of this.stores.values()) {
      for (const block of store.blocks.values()) {
        if (block.state !== 'loaded') continue;
        for (const node of block.nodes) {
          if (node && node.id === id) return node;
        }
      }
    }
    return undefined;
  }

  forEachNode(fn: (node: RowNode<TData>, index: number) => void): void {
    for (const store of this.stores.values()) {
      for (const block of store.blocks.values()) {
        if (block.state !== 'loaded') continue;
        for (const node of block.nodes) {
          if (node) fn(node, node.rowIndex);
        }
      }
    }
  }

  isDataLoaded(): boolean {
    return this.anyLoaded;
  }

  isRowExpandable(node: RowNode<TData>): boolean {
    return node.group && !node.footer;
  }

  /* --------------------------------------------------------------- geometry */

  getTotalHeight(): number {
    return this.getRowCount() * this.rowH();
  }

  getRowTop(index: number): number {
    return index * this.rowH();
  }

  getRowHeightAt(_index: number): number {
    return this.rowH();
  }

  getRowIndexAtPixel(y: number): number {
    const count = this.getRowCount();
    if (count <= 0) return 0;
    return Math.max(0, Math.min(count - 1, Math.floor(y / this.rowH())));
  }

  /* ------------------------------------------------------------------ hooks */

  onGroupExpandedChanged(node: RowNode<TData> | null): void {
    if (!node || !node.group || !node.__ssPath) return;
    const key = pathKey(node.__ssPath);
    if (node.expanded) {
      this.expandedPaths.add(key);
      const store = this.ensureStore(node.__ssPath, node);
      if (store.blocks.size === 0) this.loadBlock(store, 0);
    } else {
      this.expandedPaths.delete(key);
      // Store stays cached: re-expand is instant and refreshable.
    }
    this.invalidateSlots();
    this.dispatchModelUpdated();
  }

  onRowDataPatched(): void {
    this.ctx.scheduleRender();
  }

  onSortChanged(): void {
    this.purgeAll();
  }

  onFilterChanged(): void {
    this.purgeAll();
  }

  refreshModel(): void {
    // Pipeline refresh has no meaning for server-computed data.
  }

  /** Drop every store (expansion paths survive and re-open lazily as loads land). */
  private purgeAll(): void {
    this.generation++;
    this.stores.clear();
    this.invalidateSlots();
    if (this.started) {
      const root = this.ensureStore([], null);
      this.loadBlock(root, 0);
    }
    this.ctx.scheduleRender();
  }

  /* ------------------------------------------------------------- refreshing */

  /**
   * Refetch loaded blocks IN PLACE (rows stay visible until replaced;
   * selection carries by getRowId). `groupKeys` targets one parent's store —
   * null members and numeric keys round-trip exactly. `fromRow`/`toRow`
   * (offsets WITHIN the parent) narrow to intersecting blocks.
   */
  refreshStores(params?: { groupKeys?: GroupKey[]; fromRow?: number; toRow?: number }): void {
    const targets: SSStore<TData>[] = [];
    if (params?.groupKeys) {
      const store = this.stores.get(pathKey(params.groupKeys));
      if (store) targets.push(store);
    } else {
      targets.push(...this.stores.values());
    }
    const size = this.blockSize();
    const from = params?.fromRow ?? 0;
    const to = params?.toRow ?? Number.MAX_SAFE_INTEGER;
    for (const store of targets) {
      for (const [blockIdx, block] of store.blocks) {
        if (block.state !== 'loaded') continue;
        const first = blockIdx * size;
        if (first + size - 1 < from || first > to) continue;
        this.requestRows(store, blockIdx);
      }
    }
  }

  /* ---------------------------------------------------------------- loading */

  private loadBlock(store: SSStore<TData>, blockIdx: number): void {
    if (store.blocks.has(blockIdx)) return;
    store.blocks.set(blockIdx, {
      nodes: new Array<RowNode<TData> | undefined>(this.blockSize()),
      state: 'loading',
    });
    this.requestRows(store, blockIdx);
  }

  private requestRows(store: SSStore<TData>, blockIdx: number): void {
    const ds: ServerSideDatasource<TData> | undefined = this.ctx.options.get('serverSideDatasource');
    const block = store.blocks.get(blockIdx);
    if (!ds) {
      if (block) block.state = 'failed';
      return;
    }
    const size = this.blockSize();
    const startRow = blockIdx * size;
    const gen = this.generation;
    const params: ServerSideRowsParams<TData> = {
      groupKeys: store.path,
      rowGroupCols: this.groupCols(),
      valueCols: this.ctx.columnModel
        .getValueColumns()
        .map((c) => ({ colId: c.colId, aggFunc: (c.aggFunc as string | null) ?? undefined })),
      startRow,
      endRow: startRow + size,
      sortModel: this.ctx.sort.getSortModel(),
      filterModel: this.ctx.filters.getModel(),
      success: (result) => this.onLoadSuccess(store, blockIdx, gen, result),
      fail: () => this.onLoadFail(store, blockIdx, gen),
    };
    ds.getRows(params);
  }

  private onLoadSuccess(
    store: SSStore<TData>,
    blockIdx: number,
    gen: number,
    result: { rowData: TData[]; rowCount?: number },
  ): void {
    if (gen !== this.generation || this.ctx.destroyed) return;
    const block = store.blocks.get(blockIdx);
    if (!block) return;
    const size = this.blockSize();
    const startRow = blockIdx * size;
    const getRowId = this.ctx.options.get('getRowId');
    const isGroup = this.ctx.options.get('isServerSideGroup');
    const getKey = this.ctx.options.get('getServerSideGroupKey');
    const groupCols = this.groupCols();
    const levelCol = groupCols[store.level];

    // Carry selection/anchor across refetched node instances by id.
    const oldById = new Map<string, RowNode<TData>>();
    if (block.state === 'loaded' && getRowId) {
      for (const old of block.nodes) {
        if (old) oldById.set(old.id, old);
      }
    }

    const parentKeys = store.path.map((k) => (k == null ? '' : String(k)));
    const nodes = new Array<RowNode<TData> | undefined>(size);
    const count = Math.min(result.rowData.length, size);
    for (let i = 0; i < count; i++) {
      const data = result.rowData[i] as TData;
      const group = isGroup ? isGroup(data) : store.level < groupCols.length;
      const rawKey: GroupKey = group
        ? getKey
          ? getKey(data)
          : (((data as Record<string, unknown>)[levelCol?.field ?? ''] ?? null) as GroupKey)
        : null;
      const id = getRowId ? getRowId({ data, level: store.level, parentKeys }) : undefined;
      const node = new RowNode<TData>(this.ctx, id);
      node.data = data;
      node.level = store.level;
      node.group = group;
      node.field = group ? (levelCol?.colId ?? null) : null;
      node.parent = store.parentNode;
      node.rowHeight = this.rowH();
      node.__sourceIndex = startRow + i;
      if (group) {
        node.__serverKey = rawKey;
        node.key = rawKey == null ? '' : String(rawKey);
        node.__ssPath = [...store.path, rawKey];
        const childKey = pathKey(node.__ssPath);
        if (this.expandedPaths.has(childKey)) {
          node.expanded = true;
          const child = this.ensureStore(node.__ssPath, node);
          if (child.blocks.size === 0) this.loadBlock(child, 0);
        }
        const child = this.stores.get(childKey);
        node.allChildrenCount = child?.rowCount ?? 0;
      }
      const old = id != null ? oldById.get(id) : undefined;
      if (old) this.ctx.selection.swapNode(old, node);
      nodes[i] = node;
    }
    block.nodes = nodes;
    block.state = 'loaded';
    this.anyLoaded = true;

    if (result.rowCount != null && result.rowCount >= 0) {
      store.rowCount = result.rowCount;
      if (store.parentNode) store.parentNode.allChildrenCount = result.rowCount;
    } else if (store.rowCount == null) {
      // Honest speculation: grow only by evidence (full block → assume more).
      store.virtualCount = Math.max(
        store.virtualCount,
        startRow + result.rowData.length + (result.rowData.length === size ? size : 0),
      );
      if (result.rowData.length < size) store.rowCount = startRow + result.rowData.length;
    }

    this.invalidateSlots();
    this.dispatchModelUpdated();
  }

  private onLoadFail(store: SSStore<TData>, blockIdx: number, gen: number): void {
    if (gen !== this.generation || this.ctx.destroyed) return;
    const block = store.blocks.get(blockIdx);
    if (block) block.state = 'failed';
    this.ctx.scheduleRender();
  }

  private createPlaceholder(store: SSStore<TData>, childIdx: number): RowNode<TData> {
    const node = new RowNode<TData>(this.ctx, `ss-loading-${store.key}-${childIdx}`);
    node.level = store.level;
    node.parent = store.parentNode;
    node.rowHeight = this.rowH();
    return node;
  }

  private dispatchModelUpdated(): void {
    this.ctx.events.dispatch({
      type: 'modelUpdated',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      step: 'data',
      newData: true,
    });
    this.ctx.scheduleRender();
  }
}
