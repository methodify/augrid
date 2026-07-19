import type { GridContext, IColumnDragService } from '../context';
import { el } from '../utils/dom';
import { clamp } from '../utils/general';

/* ------------------------------------------------- pure geometry helpers */

export type DropRegion = 'left' | 'center' | 'right';

/** Region-relative column box, in display order. */
export interface ColBox {
  colId: string;
  left: number;
  width: number;
}

/** Snapshot of the displayed column geometry used for drop computation. */
export interface RegionGeom {
  /** Grid root width in px (bounding rect width). */
  rootWidth: number;
  left: ColBox[];
  center: ColBox[];
  right: ColBox[];
}

export interface DropTarget {
  region: DropRegion;
  /** Insertion index among the target region's displayed columns. */
  indexInRegion: number;
}

function sumWidth(cols: ColBox[]): number {
  let s = 0;
  for (const c of cols) s += c.width;
  return s;
}

/**
 * Given the region geometry, a pointer x relative to the grid root, and the
 * center scroll offset, compute which region the pointer is over and the
 * insertion index within that region (by column midpoints).
 */
export function computeDropTarget(
  regions: RegionGeom,
  pointerX: number,
  scrollLeft: number,
): DropTarget {
  const leftW = sumWidth(regions.left);
  const rightW = sumWidth(regions.right);
  const rightStart = regions.rootWidth - rightW;

  let region: DropRegion;
  let regionX: number;
  if (regions.left.length > 0 && pointerX < leftW) {
    region = 'left';
    regionX = pointerX;
  } else if (regions.right.length > 0 && pointerX >= rightStart) {
    region = 'right';
    regionX = pointerX - rightStart;
  } else {
    region = 'center';
    regionX = pointerX - leftW + scrollLeft;
  }

  const cols = regions[region];
  let index = cols.length;
  for (let i = 0; i < cols.length; i++) {
    if (regionX < cols[i].left + cols[i].width / 2) {
      index = i;
      break;
    }
  }
  return { region, indexInRegion: index };
}

/**
 * X position (relative to the grid root) of the insertion edge for a computed
 * drop target, clamped to the root width.
 */
export function computeIndicatorX(
  regions: RegionGeom,
  target: DropTarget,
  scrollLeft: number,
): number {
  const cols = regions[target.region];
  const last = cols.length > 0 ? cols[cols.length - 1] : null;
  const edge =
    target.indexInRegion < cols.length
      ? cols[target.indexInRegion].left
      : last
        ? last.left + last.width
        : 0;
  let x: number;
  if (target.region === 'left') x = edge;
  else if (target.region === 'right') x = regions.rootWidth - sumWidth(regions.right) + edge;
  else x = sumWidth(regions.left) + edge - scrollLeft;
  return clamp(x, 0, regions.rootWidth);
}

/* --------------------------------------------------------------- service */

/**
 * Drag-to-reorder (and re-pin) columns via their header cells. Headers are
 * recreated on every header refresh, so listeners attach directly to the
 * passed element with no registry. Document listeners exist only during an
 * active gesture and are removed on mouseup / Escape / destroy.
 */
export class ColumnDragService implements IColumnDragService {
  private ctx: GridContext<any>;
  /** Cleanup for the currently active drag gesture. */
  private activeCleanup: (() => void) | null = null;

  constructor(ctx: GridContext<any>) {
    this.ctx = ctx;
  }

  attachHeaderDrag(headerEl: HTMLElement, colId: string): void {
    headerEl.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      // The resize grip stops propagation itself; defensive check anyway.
      const target = e.target as HTMLElement | null;
      if (target?.hasAttribute?.('data-au-resize')) return;
      this.beginGesture(colId, e.clientX, e.clientY);
    });
  }

  private beginGesture(colId: string, startX: number, startY: number): void {
    const ctx = this.ctx;
    const col = ctx.columnModel.getColumn(colId);
    if (!col) return;

    this.activeCleanup?.();

    let dragging = false;
    let ghost: HTMLElement | null = null;
    let indicator: HTMLElement | null = null;
    let lastTarget: DropTarget | null = null;
    let lastRegions: RegionGeom | null = null;

    const beginDrag = (): void => {
      dragging = true;
      ghost = el('div', 'au-drag-ghost');
      ghost.style.position = 'fixed';
      ghost.textContent = col.getHeaderName();
      document.body.appendChild(ghost);
      indicator = el('div', 'au-drop-indicator');
      ctx.renderer.eRoot.appendChild(indicator);
    };

    const snapshotRegions = (rootWidth: number): RegionGeom => {
      const d = ctx.columnModel.getDisplayed();
      const box = (cols: { colId: string; left: number; actualWidth: number }[]): ColBox[] =>
        cols.map((c) => ({ colId: c.colId, left: c.left, width: c.actualWidth }));
      return { rootWidth, left: box(d.left), center: box(d.center), right: box(d.right) };
    };

    const onMouseMove = (e: MouseEvent): void => {
      if (!dragging) {
        const dist = Math.max(Math.abs(e.clientX - startX), Math.abs(e.clientY - startY));
        if (dist <= 4) return;
        beginDrag();
      }
      e.preventDefault();
      if (ghost) {
        ghost.style.left = `${e.clientX + 12}px`;
        ghost.style.top = `${e.clientY + 12}px`;
      }
      const rootRect = ctx.renderer.eRoot.getBoundingClientRect();
      const pointerX = e.clientX - rootRect.left;
      const scrollLeft = ctx.renderer.getScroll().left;
      lastRegions = snapshotRegions(rootRect.width);
      lastTarget = computeDropTarget(lastRegions, pointerX, scrollLeft);
      if (indicator) {
        indicator.style.left = `${computeIndicatorX(lastRegions, lastTarget, scrollLeft)}px`;
        indicator.style.height = `${rootRect.height}px`;
      }
    };

    const onMouseUp = (): void => {
      const wasDragging = dragging;
      const target = lastTarget;
      const regions = lastRegions;
      cleanup();
      if (!wasDragging || !target || !regions) return;
      this.completeDrop(colId, target, regions);
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cleanup();
    };

    const cleanup = (): void => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown);
      ghost?.remove();
      indicator?.remove();
      ghost = null;
      indicator = null;
      dragging = false;
      this.activeCleanup = null;
    };

    this.activeCleanup = cleanup;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);
  }

  private completeDrop(colId: string, target: DropTarget, regions: RegionGeom): void {
    const ctx = this.ctx;
    const col = ctx.columnModel.getColumn(colId);
    if (!col) return;

    const newPinned = target.region === 'left' ? 'left' : target.region === 'right' ? 'right' : null;
    if (col.pinned !== newPinned) {
      ctx.columnModel.setColumnsPinned([colId], newPinned, 'ui');
    }

    // Map the insertion position among the target region's displayed columns
    // (as snapshotted during the drag) to an index in the primary set.
    const regionCols = regions[target.region];
    const insertBeforeId =
      target.indexInRegion < regionCols.length ? regionCols[target.indexInRegion].colId : null;
    const primary = ctx.columnModel.getPrimaryColumns();
    let toIndex = primary.length;
    if (insertBeforeId != null) {
      const idx = primary.findIndex((c) => c.colId === insertBeforeId);
      if (idx >= 0) toIndex = idx;
    }
    ctx.columnModel.moveColumns([colId], toIndex, 'ui');

    ctx.renderer.markHeaderDirty();
    ctx.scheduleRender();
  }

  destroy(): void {
    this.activeCleanup?.();
  }
}
