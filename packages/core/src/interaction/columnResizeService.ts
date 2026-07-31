import type { GridContext, IColumnResizeService } from '../context.js';

/**
 * Column resize gesture: wired onto the `.au-header-resize` grip elements the
 * header renderer creates on every refresh (grips are throwaway DOM, so
 * listeners are attached directly and never tracked). Document-level listeners
 * exist only while a drag gesture is active and are removed on mouseup /
 * Escape / destroy.
 */
export class ColumnResizeService implements IColumnResizeService {
  private ctx: GridContext<any>;
  /** Cleanup for the currently active drag gesture (document listeners). */
  private activeCleanup: (() => void) | null = null;
  /** Set when a gesture ends; the next (synthesized) click is swallowed. */
  private suppressNextClick = false;

  constructor(ctx: GridContext<any>) {
    this.ctx = ctx;
  }

  attachResizeGrip(gripEl: HTMLElement, colId: string): void {
    gripEl.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Don't let the header-drag controller see this mousedown.
      e.stopPropagation();
      e.preventDefault();
      this.beginResize(colId, e.clientX);
    });
    gripEl.addEventListener('dblclick', (e: MouseEvent) => {
      e.stopPropagation();
      const col = this.ctx.columnModel.getColumn(colId);
      if (!col) return;
      const width = this.ctx.renderer.measureColumnWidth(col, false);
      this.applyWidth(colId, width, true, 'autosize');
    });
  }

  private beginResize(colId: string, startX: number): void {
    const col = this.ctx.columnModel.getColumn(colId);
    if (!col) return;
    const startWidth = col.actualWidth;

    // Only one gesture at a time.
    this.activeCleanup?.();

    const onMouseMove = (e: MouseEvent): void => {
      this.applyWidth(colId, startWidth + (e.clientX - startX), false, 'ui');
    };
    const onMouseUp = (e: MouseEvent): void => {
      cleanup();
      this.armClickSuppression();
      this.applyWidth(colId, startWidth + (e.clientX - startX), true, 'ui');
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        cleanup();
        // The eventual mouse release still synthesizes a click.
        this.armClickSuppression();
        // Restore the width the column had when the gesture started.
        this.applyWidth(colId, startWidth, true, 'ui');
      }
    };
    const cleanup = (): void => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown);
      this.activeCleanup = null;
    };

    this.activeCleanup = cleanup;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);
  }

  shouldSwallowClick(): boolean {
    const v = this.suppressNextClick;
    this.suppressNextClick = false;
    return v;
  }

  /**
   * The click synthesized from this gesture's mousedown/mouseup pair fires
   * synchronously after mouseup; anything still set a tick later is stale
   * (e.g. the release happened outside the grid), so it self-clears rather
   * than swallowing some unrelated future click.
   */
  private armClickSuppression(): void {
    this.suppressNextClick = true;
    setTimeout(() => {
      this.suppressNextClick = false;
    }, 0);
  }

  private applyWidth(colId: string, width: number, finished: boolean, source: string): void {
    this.ctx.columnModel.setColumnWidths([{ colId, width }], finished, source);
    // During an in-flight drag (finished=false) only schedule a render: the
    // renderer's cheap header-geometry pass updates existing header cell
    // left/width styles from column state without rebuilding components.
    // A full header rebuild (markHeaderDirty) happens once, on gesture end
    // (mouseup / Escape) and on dblclick autosize — both finished=true.
    if (finished) this.ctx.renderer.markHeaderDirty();
    this.ctx.scheduleRender();
  }

  destroy(): void {
    this.activeCleanup?.();
  }
}
