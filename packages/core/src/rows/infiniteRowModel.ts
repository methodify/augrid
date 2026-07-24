import type { GridContext } from '../context.js';
import type { IRowModel } from './rowModel.js';
import { RowNode } from './rowNode.js';
import type { Datasource, GetRowsParams } from '../types/gridOptions.js';

interface Block<TData> {
  /** Sparse: real nodes once loaded; placeholder nodes while loading/failed. */
  nodes: (RowNode<TData> | undefined)[];
  state: 'loading' | 'loaded' | 'failed';
  lastTouched: number;
}

/**
 * Server-backed lazy row model for flat data (no grouping). Rows are fetched
 * in blocks of `cacheBlockSize` via the `datasource` grid option; an LRU cache
 * keeps at most `maxBlocksInCache` loaded blocks (visible blocks are never
 * evicted). While a block is in flight, placeholder nodes (data undefined)
 * are returned so the renderer can show skeleton rows.
 */
export class InfiniteRowModel<TData = unknown> implements IRowModel<TData> {
  readonly type = 'infinite' as const;

  private ctx: GridContext<TData>;
  private blocks = new Map<number, Block<TData>>();
  /** Exact total row count once the datasource reports lastRow. */
  private knownRowCount: number | null = null;
  /** Speculative count while total is unknown (grows as blocks load). */
  private virtualRowCount: number;
  /** Monotonic counter for LRU touch stamps. */
  private touchCounter = 0;
  /** Bumped on purge/destroy; stale datasource callbacks are dropped. */
  private generation = 0;
  private started = false;

  constructor(ctx: GridContext<TData>) {
    this.ctx = ctx;
    this.virtualRowCount = this.blockSize();
  }

  /* ---------------------------------------------------------------- helpers */

  private blockSize(): number {
    return this.ctx.options.get('cacheBlockSize') ?? 100;
  }

  private rowH(): number {
    return this.ctx.options.get('rowHeight') ?? 32;
  }

  /* -------------------------------------------------------------- lifecycle */

  start(): void {
    this.started = true;
    this.loadBlock(0);
  }

  destroy(): void {
    this.generation++;
    this.blocks.clear();
  }

  /* ----------------------------------------------------------- row access */

  getRowCount(): number {
    return this.knownRowCount ?? this.virtualRowCount;
  }

  getRow(index: number): RowNode<TData> | undefined {
    if (index < 0) return undefined;
    const size = this.blockSize();
    const blockIndex = Math.floor(index / size);
    let block = this.blocks.get(blockIndex);
    if (!block) {
      this.loadBlock(blockIndex);
      block = this.blocks.get(blockIndex);
      if (!block) return undefined;
    }
    block.lastTouched = ++this.touchCounter;
    const offset = index - blockIndex * size;
    let node = block.nodes[offset];
    if (!node && block.state !== 'loaded') {
      // Placeholder so the renderer shows a skeleton row; cached per index.
      node = this.createPlaceholder(index);
      block.nodes[offset] = node;
    }
    return node;
  }

  getRowNode(id: string): RowNode<TData> | undefined {
    for (const block of this.blocks.values()) {
      if (block.state !== 'loaded') continue;
      for (const node of block.nodes) {
        if (node && node.id === id) return node;
      }
    }
    return undefined;
  }

  forEachNode(fn: (node: RowNode<TData>, index: number) => void): void {
    const keys = Array.from(this.blocks.keys()).sort((a, b) => a - b);
    for (const key of keys) {
      const block = this.blocks.get(key);
      if (!block || block.state !== 'loaded') continue;
      for (const node of block.nodes) {
        if (node) fn(node, node.rowIndex);
      }
    }
  }

  isDataLoaded(): boolean {
    for (const block of this.blocks.values()) {
      if (block.state === 'loaded') return true;
    }
    return false;
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
    const index = Math.floor(y / this.rowH());
    return Math.max(0, Math.min(count - 1, index));
  }

  /* ------------------------------------------------------------------ hooks */

  onGroupExpandedChanged(): void {
    // Grouping unsupported in the infinite model.
  }

  onRowDataPatched(): void {
    this.ctx.scheduleRender();
  }

  onSortChanged(): void {
    this.purgeCache();
  }

  onFilterChanged(): void {
    this.purgeCache();
  }

  refreshModel(): void {
    // Pipeline refresh has no meaning for server-backed data.
  }

  /* ------------------------------------------------------------------ cache */

  /**
   * Refetch loaded blocks in place — current data stays visible until each
   * block's replacement arrives, so scroll/focus/selection survive. With a
   * range, only blocks intersecting [fromRow, toRow] refetch (targeted
   * invalidation for server-authoritative data that changed underneath).
   */
  refreshCache(range?: { fromRow: number; toRow: number }): void {
    const size = this.blockSize();
    const loadedIndexes: number[] = [];
    for (const [index, block] of this.blocks) {
      if (block.state !== 'loaded') continue;
      if (range) {
        const first = index * size;
        const last = first + size - 1;
        if (last < range.fromRow || first > range.toRow) continue;
      }
      loadedIndexes.push(index);
    }
    for (const index of loadedIndexes) this.requestRows(index);
  }

  /** Drop all blocks, reset counts, reload block 0. */
  purgeCache(): void {
    this.generation++;
    this.blocks.clear();
    this.knownRowCount = null;
    this.virtualRowCount = this.blockSize();
    if (this.started) this.loadBlock(0);
    this.ctx.scheduleRender();
  }

  /* ---------------------------------------------------------------- loading */

  private loadBlock(blockIndex: number): void {
    if (this.blocks.has(blockIndex)) return; // already loading/loaded/failed
    const block: Block<TData> = {
      nodes: new Array<RowNode<TData> | undefined>(this.blockSize()),
      state: 'loading',
      lastTouched: ++this.touchCounter,
    };
    this.blocks.set(blockIndex, block);
    const ds = this.ctx.options.get('datasource');
    if (!ds) {
      block.state = 'failed';
      return;
    }
    this.requestRows(blockIndex, ds);
  }

  private requestRows(blockIndex: number, ds?: Datasource<TData>): void {
    const datasource = ds ?? this.ctx.options.get('datasource');
    if (!datasource) return;
    const size = this.blockSize();
    const startRow = blockIndex * size;
    const gen = this.generation;
    const params: GetRowsParams<TData> = {
      startRow,
      endRow: startRow + size,
      sortModel: this.ctx.sort.getSortModel(),
      filterModel: this.ctx.filters.getModel(),
      success: (result) => this.onLoadSuccess(blockIndex, gen, result),
      fail: () => this.onLoadFail(blockIndex, gen),
    };
    datasource.getRows(params);
  }

  private onLoadSuccess(
    blockIndex: number,
    gen: number,
    result: { rowData: TData[]; lastRow?: number },
  ): void {
    if (gen !== this.generation || this.ctx.destroyed) return; // stale (purged)
    const block = this.blocks.get(blockIndex);
    if (!block) return;
    const size = this.blockSize();
    const h = this.rowH();
    const startRow = blockIndex * size;
    const getRowId = this.ctx.options.get('getRowId');
    const { rowData, lastRow } = result;

    // Block refresh replaces node instances; carry row state (selection,
    // anchor) across by id so a refetch is invisible to the user.
    const oldById = new Map<string, RowNode<TData>>();
    if (block.state === 'loaded' && getRowId) {
      for (const old of block.nodes) {
        if (old) oldById.set(old.id, old);
      }
    }

    const nodes = new Array<RowNode<TData> | undefined>(size);
    const count = Math.min(rowData.length, size);
    for (let i = 0; i < count; i++) {
      const data = rowData[i] as TData;
      const id = getRowId ? getRowId({ data, level: 0 }) : undefined;
      const node = new RowNode<TData>(this.ctx, id);
      node.data = data;
      node.rowIndex = startRow + i;
      node.rowHeight = h;
      node.rowTop = (startRow + i) * h;
      node.__sourceIndex = startRow + i;
      const old = id != null ? oldById.get(id) : undefined;
      if (old) this.ctx.selection.swapNode(old, node);
      nodes[i] = node;
    }
    block.nodes = nodes;
    block.state = 'loaded';
    block.lastTouched = ++this.touchCounter;

    if (lastRow != null && lastRow >= 0) {
      this.knownRowCount = lastRow;
    } else if (this.knownRowCount == null) {
      this.virtualRowCount = Math.max(
        this.virtualRowCount,
        startRow + rowData.length + (rowData.length === size ? size : 0),
      );
    }

    this.evictLru();
    this.ctx.events.dispatch({
      type: 'modelUpdated',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      step: 'data',
      newData: true,
    });
    this.ctx.scheduleRender();
  }

  private onLoadFail(blockIndex: number, gen: number): void {
    if (gen !== this.generation || this.ctx.destroyed) return;
    const block = this.blocks.get(blockIndex);
    if (!block) return;
    block.state = 'failed'; // placeholders remain → blank rows
    this.ctx.scheduleRender();
  }

  /** Evict least-recently-touched loaded blocks beyond maxBlocksInCache. */
  private evictLru(): void {
    const max = this.ctx.options.get('maxBlocksInCache') ?? 10;
    const loaded: { index: number; block: Block<TData> }[] = [];
    for (const [index, block] of this.blocks) {
      if (block.state === 'loaded') loaded.push({ index, block });
    }
    let remaining = loaded.length;
    if (remaining <= max) return;

    const size = this.blockSize();
    const visible = this.ctx.renderer?.getVisibleRowRange?.() ?? null;
    loaded.sort((a, b) => a.block.lastTouched - b.block.lastTouched);
    for (const { index } of loaded) {
      if (remaining <= max) break;
      const firstRow = index * size;
      const lastRow = firstRow + size - 1;
      const isVisible = visible !== null && lastRow >= visible.first && firstRow <= visible.last;
      if (isVisible) continue; // never evict the visible range
      this.blocks.delete(index);
      remaining--;
    }
  }

  private createPlaceholder(index: number): RowNode<TData> {
    const h = this.rowH();
    const node = new RowNode<TData>(this.ctx, `loading-${index}`);
    node.rowIndex = index;
    node.rowTop = index * h;
    node.rowHeight = h;
    return node;
  }
}
