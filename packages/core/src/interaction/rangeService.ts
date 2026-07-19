import type { GridContext, IRangeService } from '../context';
import {
  RANGE_IN,
  RANGE_TOP,
  RANGE_RIGHT,
  RANGE_BOTTOM,
  RANGE_LEFT,
  RANGE_HANDLE,
} from '../context';
import type { CellPosition, CellRange } from '../types/base';
import type { CellSelectionOptions } from '../types/gridOptions';
import type { RowNode } from '../rows/rowNode';
import { closestWithAttr } from '../utils/dom';

const SELECTION_COL = 'au-selection-col';

/** Precomputed per-range paint metadata (rebuilt on every range change). */
interface RangeMeta {
  minRow: number;
  maxRow: number;
  colSet: Set<string>;
  firstCol: string;
  lastCol: string;
}

/** Normalized snapshot of the source range for a fill operation. */
interface FillSource {
  minRow: number;
  maxRow: number;
  colIds: string[];
}

export type FillDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Cell range selection + fill handle. Enabled when gridOption `cellSelection`
 * is truthy; the fill handle additionally requires `cellSelection.handle` to
 * be `true` or `'fill'`.
 */
export class RangeService<TData = unknown> implements IRangeService<TData> {
  private ctx: GridContext<TData>;
  /** startRowIndex is the anchor row (may be > endRowIndex). */
  private ranges: CellRange[] = [];
  /** Anchor cell per range, aligned with `ranges`. */
  private anchors: { rowIndex: number; colId: string }[] = [];
  private meta: RangeMeta[] = [];
  private fillEnabledCache = false;

  /* drag state */
  private dragMove: ((e: MouseEvent) => void) | null = null;
  private dragUp: ((e: MouseEvent) => void) | null = null;
  private lastDragPos: { rowIndex: number; colId: string } | null = null;

  /* fill-handle drag state (underscore-public for tests) */
  _fillSource: FillSource | null = null;
  private fillStart: { x: number; y: number } | null = null;
  _lastFill: { direction: FillDirection; count: number } | null = null;

  constructor(ctx: GridContext<TData>) {
    this.ctx = ctx;
  }

  /* ------------------------------------------------------------- accessors */

  getCellRanges(): CellRange[] {
    return this.copyRanges();
  }

  /* ------------------------------------------------------------- mutations */

  setRangeToCell(pos: CellPosition, clearOthers = true): void {
    if (pos.colId === SELECTION_COL) return;
    const range: CellRange = {
      startRowIndex: pos.rowIndex,
      endRowIndex: pos.rowIndex,
      colIds: [pos.colId],
    };
    if (clearOthers) {
      this.ranges = [range];
      this.anchors = [{ rowIndex: pos.rowIndex, colId: pos.colId }];
    } else {
      this.ranges.push(range);
      this.anchors.push({ rowIndex: pos.rowIndex, colId: pos.colId });
    }
    this.changed(true);
  }

  addCellRange(range: CellRange): void {
    const colIds = range.colIds.filter((c) => c !== SELECTION_COL);
    if (colIds.length === 0) return;
    const copy: CellRange = {
      startRowIndex: range.startRowIndex,
      endRowIndex: range.endRowIndex,
      colIds: [...colIds],
    };
    if (this.isSuppressMulti()) {
      this.ranges = [copy];
      this.anchors = [{ rowIndex: copy.startRowIndex, colId: colIds[0] }];
    } else {
      this.ranges.push(copy);
      this.anchors.push({ rowIndex: copy.startRowIndex, colId: colIds[0] });
    }
    this.changed(true);
  }

  extendLatestRangeToCell(pos: CellPosition): void {
    this._extendLatestRangeToCell(pos, true);
  }

  /** Internal extend with control over the `finished` flag (drag previews). */
  _extendLatestRangeToCell(pos: CellPosition, finished: boolean): void {
    if (pos.colId === SELECTION_COL) return;
    if (this.ranges.length === 0) {
      this.setRangeToCell(pos);
      return;
    }
    const idx = this.ranges.length - 1;
    const anchor = this.anchors[idx];
    const colIds = this.computeColRun(anchor.colId, pos.colId);
    if (!colIds) return;
    this.ranges[idx] = {
      startRowIndex: anchor.rowIndex,
      endRowIndex: pos.rowIndex,
      colIds,
    };
    this.changed(finished);
  }

  clearCellSelection(): void {
    this.ranges = [];
    this.anchors = [];
    this.changed(true);
  }

  /* ----------------------------------------------------------- paint flags */

  getCellFlags(rowIndex: number, colId: string): number {
    let flags = 0;
    const meta = this.meta;
    for (let i = 0; i < meta.length; i++) {
      const m = meta[i];
      if (rowIndex < m.minRow || rowIndex > m.maxRow || !m.colSet.has(colId)) continue;
      flags |= RANGE_IN;
      if (rowIndex === m.minRow) flags |= RANGE_TOP;
      if (rowIndex === m.maxRow) flags |= RANGE_BOTTOM;
      if (colId === m.firstCol) flags |= RANGE_LEFT;
      if (colId === m.lastCol) flags |= RANGE_RIGHT;
      if (
        this.fillEnabledCache &&
        i === meta.length - 1 &&
        rowIndex === m.maxRow &&
        colId === m.lastCol
      ) {
        flags |= RANGE_HANDLE;
      }
    }
    return flags;
  }

  /* ----------------------------------------------------------------- mouse */

  onCellMouseDown(pos: CellPosition, e: MouseEvent): void {
    if (pos.rowPinned != null || pos.colId === SELECTION_COL) return;
    if ((e.ctrlKey || e.metaKey) && !this.isSuppressMulti()) {
      this.setRangeToCell(pos, false);
    } else if (e.shiftKey) {
      this._extendLatestRangeToCell(pos, true);
    } else {
      this.setRangeToCell(pos, true);
    }
    this.beginRangeDrag(pos);
  }

  onFillHandleMouseDown(e: MouseEvent): void {
    if (!this.isFillEnabled() || this.ranges.length === 0) return;
    const latest = this.ranges[this.ranges.length - 1];
    this._fillSource = {
      minRow: Math.min(latest.startRowIndex, latest.endRowIndex),
      maxRow: Math.max(latest.startRowIndex, latest.endRowIndex),
      colIds: [...latest.colIds],
    };
    this.fillStart = { x: e.clientX, y: e.clientY };
    this._lastFill = null;
    this.removeDragListeners();
    this.dragMove = (ev) => this.onFillDragMove(ev);
    this.dragUp = () => this._onFillDragUp();
    document.addEventListener('mousemove', this.dragMove);
    document.addEventListener('mouseup', this.dragUp);
  }

  destroy(): void {
    this.removeDragListeners();
    this.ranges = [];
    this.anchors = [];
    this.meta = [];
  }

  /* ----------------------------------------------------- range drag internals */

  private beginRangeDrag(startPos: CellPosition): void {
    this.removeDragListeners();
    this.lastDragPos = { rowIndex: startPos.rowIndex, colId: startPos.colId };
    this.dragMove = (ev) => {
      const pos = this._hitTest(ev.clientX, ev.clientY);
      if (!pos) return;
      const last = this.lastDragPos;
      if (last && last.rowIndex === pos.rowIndex && last.colId === pos.colId) return;
      this.lastDragPos = { rowIndex: pos.rowIndex, colId: pos.colId };
      this._extendLatestRangeToCell(pos, false);
    };
    this.dragUp = () => {
      this.removeDragListeners();
      this.changed(true);
    };
    document.addEventListener('mousemove', this.dragMove);
    document.addEventListener('mouseup', this.dragUp);
  }

  private removeDragListeners(): void {
    if (this.dragMove) document.removeEventListener('mousemove', this.dragMove);
    if (this.dragUp) document.removeEventListener('mouseup', this.dragUp);
    this.dragMove = null;
    this.dragUp = null;
    this.lastDragPos = null;
  }

  /** Resolve the grid cell under viewport point (x, y), body rows only. */
  _hitTest(x: number, y: number): CellPosition | null {
    const eRoot = this.ctx.renderer?.eRoot;
    if (!eRoot) return null;
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const cellEl = closestWithAttr(el, 'data-au-col', document.documentElement);
    if (!cellEl || !eRoot.contains(cellEl)) return null;
    const colId = cellEl.getAttribute('data-au-col');
    if (!colId || colId === SELECTION_COL) return null;
    const rowEl = closestWithAttr(cellEl, 'data-au-row-index', document.documentElement);
    if (!rowEl || !eRoot.contains(rowEl)) return null;
    const rowId = rowEl.getAttribute('data-au-row-id') ?? '';
    if (rowId.startsWith('pinned-')) return null;
    const rowIndex = Number(rowEl.getAttribute('data-au-row-index'));
    if (!Number.isFinite(rowIndex) || rowIndex < 0) return null;
    return { rowIndex, colId, rowPinned: null };
  }

  /* ------------------------------------------------------ fill drag internals */

  private onFillDragMove(e: MouseEvent): void {
    const source = this._fillSource;
    const start = this.fillStart;
    if (!source || !start) return;
    const pos = this._hitTest(e.clientX, e.clientY);
    if (!pos) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const fill = this._computeFillTarget(source, pos, dx, dy);
    const last = this._lastFill;
    if (fill == null) {
      // Pointer back inside the source: restore the source extent preview.
      if (last != null) {
        this._lastFill = null;
        this.setLatestRange(
          { startRowIndex: source.minRow, endRowIndex: source.maxRow, colIds: [...source.colIds] },
          false,
        );
      }
      return;
    }
    if (last && last.direction === fill.direction && last.count === fill.count) return;
    this._lastFill = fill;
    this.setLatestRange(this._fillExtent(source, fill.direction, fill.count), false);
  }

  _onFillDragUp(): void {
    this.removeDragListeners();
    const source = this._fillSource;
    const fill = this._lastFill;
    this._fillSource = null;
    this.fillStart = null;
    this._lastFill = null;
    if (!source) return;
    const initialRange: CellRange = {
      startRowIndex: source.minRow,
      endRowIndex: source.maxRow,
      colIds: [...source.colIds],
    };
    if (!fill || fill.count === 0) {
      // Dragging into/within the source does nothing (range unchanged).
      this.setLatestRange(initialRange, true);
      return;
    }
    const finalRange = this._executeFill(source, fill.direction, fill.count);
    this.setLatestRange(finalRange, true);
    this.ctx.events.dispatch({
      type: 'fillEnd',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      initialRange,
      finalRange: {
        startRowIndex: finalRange.startRowIndex,
        endRowIndex: finalRange.endRowIndex,
        colIds: [...finalRange.colIds],
      },
    });
  }

  /**
   * Decide fill direction + cell count from the target cell and pointer travel.
   * Returns null when the target lies inside the source range on the chosen axis.
   */
  _computeFillTarget(
    source: FillSource,
    pos: { rowIndex: number; colId: string },
    dx: number,
    dy: number,
  ): { direction: FillDirection; count: number } | null {
    const vertical = Math.abs(dy) >= Math.abs(dx);
    if (vertical) {
      if (pos.rowIndex > source.maxRow) return { direction: 'down', count: pos.rowIndex - source.maxRow };
      if (pos.rowIndex < source.minRow) return { direction: 'up', count: source.minRow - pos.rowIndex };
      return null;
    }
    const displayed = this.displayedColIds();
    const target = displayed.indexOf(pos.colId);
    if (target < 0) return null;
    const firstIdx = displayed.indexOf(source.colIds[0]);
    const lastIdx = displayed.indexOf(source.colIds[source.colIds.length - 1]);
    if (firstIdx < 0 || lastIdx < 0) return null;
    if (target > lastIdx) return { direction: 'right', count: target - lastIdx };
    if (target < firstIdx) return { direction: 'left', count: firstIdx - target };
    return null;
  }

  /** The range extent the fill preview / final range covers. Clamped to grid bounds. */
  _fillExtent(source: FillSource, direction: FillDirection, count: number): CellRange {
    if (direction === 'down') {
      const maxIdx = this.ctx.rowModel.getRowCount() - 1;
      return {
        startRowIndex: source.minRow,
        endRowIndex: Math.min(source.maxRow + count, maxIdx),
        colIds: [...source.colIds],
      };
    }
    if (direction === 'up') {
      return {
        startRowIndex: source.maxRow,
        endRowIndex: Math.max(source.minRow - count, 0),
        colIds: [...source.colIds],
      };
    }
    const displayed = this.displayedColIds();
    const firstIdx = displayed.indexOf(source.colIds[0]);
    const lastIdx = displayed.indexOf(source.colIds[source.colIds.length - 1]);
    if (firstIdx < 0 || lastIdx < 0) {
      return { startRowIndex: source.minRow, endRowIndex: source.maxRow, colIds: [...source.colIds] };
    }
    if (direction === 'right') {
      const end = Math.min(lastIdx + count, displayed.length - 1);
      return {
        startRowIndex: source.minRow,
        endRowIndex: source.maxRow,
        colIds: displayed.slice(firstIdx, end + 1),
      };
    }
    const startIdx = Math.max(firstIdx - count, 0);
    return {
      startRowIndex: source.minRow,
      endRowIndex: source.maxRow,
      colIds: displayed.slice(startIdx, lastIdx + 1),
    };
  }

  /**
   * Commit fill values for `count` cells beyond the source in `direction`.
   * Returns the final range extent (clamped to grid bounds).
   */
  _executeFill(source: FillSource, direction: FillDirection, count: number): CellRange {
    if (direction === 'down' || direction === 'up') {
      for (const colId of source.colIds) {
        const initialValues = this.columnValues(source, colId, direction === 'up');
        if (initialValues.length === 0) continue;
        for (let i = 0; i < count; i++) {
          const rowIndex =
            direction === 'down' ? source.maxRow + 1 + i : source.minRow - 1 - i;
          const node = this.ctx.rowModel.getRow(rowIndex);
          if (!node) break;
          const value = this.fillValue(initialValues, i, direction, colId, node);
          this.ctx.editing.commitValue(node, colId, value, 'fill');
        }
      }
    } else {
      const displayed = this.displayedColIds();
      const firstIdx = displayed.indexOf(source.colIds[0]);
      const lastIdx = displayed.indexOf(source.colIds[source.colIds.length - 1]);
      const newCols: string[] = [];
      if (firstIdx >= 0 && lastIdx >= 0) {
        for (let i = 1; i <= count; i++) {
          const idx = direction === 'right' ? lastIdx + i : firstIdx - i;
          if (idx < 0 || idx >= displayed.length) break;
          newCols.push(displayed[idx]);
        }
      }
      for (let r = source.minRow; r <= source.maxRow; r++) {
        const node = this.ctx.rowModel.getRow(r);
        if (!node) continue;
        const initialValues = this.rowValues(node, source.colIds, direction === 'left');
        if (initialValues.length === 0) continue;
        for (let i = 0; i < newCols.length; i++) {
          const value = this.fillValue(initialValues, i, direction, newCols[i], node);
          this.ctx.editing.commitValue(node, newCols[i], value, 'fill');
        }
      }
    }
    return this._fillExtent(source, direction, count);
  }

  /** Default fill series logic + fillOperation override, per target cell. */
  private fillValue(
    initialValues: unknown[],
    fillIndex: number,
    direction: FillDirection,
    colId: string,
    node: RowNode<TData>,
  ): unknown {
    const fillOp = this.ctx.options.get('fillOperation');
    if (fillOp) {
      const column = this.ctx.columnModel.getColumn(colId);
      const currentValue = column ? this.ctx.values.getValue(node, column) : undefined;
      const result = fillOp({
        api: this.ctx.api,
        context: this.ctx.options.get('context'),
        initialValues,
        fillIndex,
        direction,
        colId,
        node,
        currentValue,
      });
      if (result !== undefined) return result;
    }
    if (
      initialValues.length >= 2 &&
      initialValues.every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      const last = initialValues[initialValues.length - 1] as number;
      const prev = initialValues[initialValues.length - 2] as number;
      const delta = last - prev;
      return last + delta * (fillIndex + 1);
    }
    return initialValues[fillIndex % initialValues.length];
  }

  /** Source values for one column, top→bottom (reversed for up-fill). */
  private columnValues(source: FillSource, colId: string, reverse: boolean): unknown[] {
    const column = this.ctx.columnModel.getColumn(colId);
    if (!column) return [];
    const values: unknown[] = [];
    for (let r = source.minRow; r <= source.maxRow; r++) {
      const node = this.ctx.rowModel.getRow(r);
      if (!node) continue;
      values.push(this.ctx.values.getValue(node, column));
    }
    if (reverse) values.reverse();
    return values;
  }

  /** Source values for one row across the source columns, left→right (reversed for left-fill). */
  private rowValues(node: RowNode<TData>, colIds: string[], reverse: boolean): unknown[] {
    const values: unknown[] = [];
    for (const colId of colIds) {
      const column = this.ctx.columnModel.getColumn(colId);
      if (!column) continue;
      values.push(this.ctx.values.getValue(node, column));
    }
    if (reverse) values.reverse();
    return values;
  }

  /* --------------------------------------------------------------- helpers */

  private setLatestRange(range: CellRange, finished: boolean): void {
    if (this.ranges.length === 0) {
      this.ranges = [range];
      this.anchors = [{ rowIndex: range.startRowIndex, colId: range.colIds[0] }];
    } else {
      this.ranges[this.ranges.length - 1] = range;
    }
    this.changed(finished);
  }

  /** Displayed column ids excluding the selection checkbox column. */
  private displayedColIds(): string[] {
    const out: string[] = [];
    for (const c of this.ctx.columnModel.getDisplayedColumns()) {
      if (c.colId !== SELECTION_COL) out.push(c.colId);
    }
    return out;
  }

  /** Contiguous displayed-column run between two col ids, in display order. */
  private computeColRun(anchorColId: string, endColId: string): string[] | null {
    const displayed = this.displayedColIds();
    const endIdx = displayed.indexOf(endColId);
    if (endIdx < 0) return null;
    let anchorIdx = displayed.indexOf(anchorColId);
    if (anchorIdx < 0) anchorIdx = endIdx;
    const lo = Math.min(anchorIdx, endIdx);
    const hi = Math.max(anchorIdx, endIdx);
    return displayed.slice(lo, hi + 1);
  }

  private copyRanges(): CellRange[] {
    return this.ranges.map((r) => ({
      startRowIndex: r.startRowIndex,
      endRowIndex: r.endRowIndex,
      colIds: [...r.colIds],
    }));
  }

  private changed(finished: boolean): void {
    this.rebuildMeta();
    this.ctx.events.dispatch({
      type: 'cellSelectionChanged',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      ranges: this.copyRanges(),
      finished,
    });
    this.ctx.scheduleRender();
  }

  private rebuildMeta(): void {
    this.fillEnabledCache = this.isFillEnabled();
    this.meta = this.ranges.map((r) => ({
      minRow: Math.min(r.startRowIndex, r.endRowIndex),
      maxRow: Math.max(r.startRowIndex, r.endRowIndex),
      colSet: new Set(r.colIds),
      firstCol: r.colIds[0],
      lastCol: r.colIds[r.colIds.length - 1],
    }));
  }

  private cellSelOptions(): CellSelectionOptions | null {
    const cs = this.ctx.options.get('cellSelection');
    if (!cs) return null;
    return cs === true ? {} : cs;
  }

  private isFillEnabled(): boolean {
    const opts = this.cellSelOptions();
    return opts != null && (opts.handle === true || opts.handle === 'fill');
  }

  private isSuppressMulti(): boolean {
    const opts = this.cellSelOptions();
    return opts?.suppressMultiRanges === true;
  }
}
