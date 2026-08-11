import type { GridContext } from '../context.js';
import type { RowNode } from '../rows/rowNode.js';

/**
 * Pure: drop slot (0..rowCount) for a y offset into the body.
 * `rowTops` has rowCount+1 entries — tops of each row plus the end (total
 * height). Slot i means "insert before row i"; slot rowCount = append.
 */
export function dropSlotAtY(rowTops: number[], totalRows: number, y: number): number {
  for (let i = 0; i < totalRows; i++) {
    const mid = (rowTops[i]! + rowTops[i + 1]!) / 2;
    if (y < mid) return i;
  }
  return totalRows;
}

/**
 * Row drag-to-reorder. The handle (`data-au-row-drag`, rendered by cells whose
 * colDef sets `rowDrag`) starts a gesture; document listeners live only while
 * dragging (mirrors ColumnDragService). `rowDragManaged` reorders the
 * client-side model on drop when no sort/group/filter is active; unmanaged
 * consumers drive their own reorder from the rowDrag* events.
 */
export class RowDragService<TData = unknown> {
  private ctx: GridContext<TData>;
  private activeCleanup: (() => void) | null = null;
  private suppressNextClick = false;

  constructor(ctx: GridContext<TData>) {
    this.ctx = ctx;
  }

  shouldSwallowClick(): boolean {
    const v = this.suppressNextClick;
    this.suppressNextClick = false;
    return v;
  }

  private armClickSuppression(): void {
    this.suppressNextClick = true;
    setTimeout(() => {
      this.suppressNextClick = false;
    }, 0);
  }

  /** Managed reorder is only truthful on the natural row order. */
  canManageReorder(): boolean {
    if (!this.ctx.options.is('rowDragManaged')) return false;
    if (this.ctx.rowModel.type !== 'clientSide') return false;
    const sorted = this.ctx.columnModel.getPrimaryColumns().some((c) => c.sort != null);
    const grouped = this.ctx.columnModel.getRowGroupColumns().length > 0;
    return !sorted && !grouped;
  }

  beginDrag(node: RowNode<TData>, startEvent: MouseEvent): void {
    if (node.group || node.detail || node.rowPinned != null) return;
    this.activeCleanup?.();
    const ctx = this.ctx;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let indicator: HTMLElement | null = null;
    let lastSlot = -1;
    const startY = startEvent.clientY;

    const dispatch = (type: string, e: MouseEvent, overIndex: number): void => {
      ctx.events.dispatch({
        type,
        api: ctx.api,
        context: ctx.options.get('context'),
        node,
        data: node.data,
        overIndex,
        overNode: overIndex >= 0 ? ctx.rowModel.getRow(overIndex) : undefined,
        y: e.clientY,
        vDirection: e.clientY > startY ? 'down' : e.clientY < startY ? 'up' : null,
        event: e,
      } as never);
    };

    const bodyY = (e: MouseEvent): number => {
      const rect = ctx.renderer.eRoot.getBoundingClientRect();
      return e.clientY - rect.top - this.bodyTop() + ctx.renderer.getScroll().top;
    };

    const slotFromEvent = (e: MouseEvent): number => {
      const count = ctx.rowModel.getRowCount();
      const tops: number[] = [];
      for (let i = 0; i < count; i++) tops.push(ctx.rowModel.getRow(i)?.rowTop ?? 0);
      const last = ctx.rowModel.getRow(count - 1);
      tops.push((last?.rowTop ?? 0) + (last?.rowHeight ?? 0));
      return dropSlotAtY(tops, count, bodyY(e));
    };

    const onMove = (e: MouseEvent): void => {
      if (!dragging) {
        if (Math.abs(e.clientY - startY) <= 4) return;
        dragging = true;
        ghost = document.createElement('div');
        ghost.className = 'au-drag-ghost';
        ghost.style.position = 'fixed';
        ghost.textContent = this.ctx.options.get('rowDragText')?.(node) ?? `1 row`;
        document.body.appendChild(ghost);
        indicator = document.createElement('div');
        indicator.className = 'au-row-drop-indicator';
        ctx.renderer.eRoot.appendChild(indicator);
        dispatch('rowDragEnter', e, node.rowIndex);
      }
      e.preventDefault();
      if (ghost) {
        ghost.style.left = `${e.clientX + 12}px`;
        ghost.style.top = `${e.clientY + 12}px`;
      }
      const slot = slotFromEvent(e);
      if (slot !== lastSlot) {
        lastSlot = slot;
        if (indicator) {
          const count = ctx.rowModel.getRowCount();
          const yTop =
            slot >= count
              ? (ctx.rowModel.getRow(count - 1)?.rowTop ?? 0) +
                (ctx.rowModel.getRow(count - 1)?.rowHeight ?? 0)
              : (ctx.rowModel.getRow(slot)?.rowTop ?? 0);
          indicator.style.top = `${this.bodyTop() + yTop - ctx.renderer.getScroll().top}px`;
        }
      }
      dispatch('rowDragMove', e, Math.min(lastSlot, ctx.rowModel.getRowCount() - 1));
    };

    const finish = (e: MouseEvent | null, cancelled: boolean): void => {
      const wasDragging = dragging;
      const slot = lastSlot;
      cleanup();
      if (!wasDragging) return;
      this.armClickSuppression();
      if (cancelled || !e) {
        dispatch('rowDragLeave', e ?? startEvent, -1);
        return;
      }
      if (this.canManageReorder() && slot >= 0) {
        (this.ctx.rowModel as { moveRowToIndex?: (n: RowNode<TData>, slot: number) => void })
          .moveRowToIndex?.(node, slot);
      }
      dispatch('rowDragEnd', e, Math.min(slot, ctx.rowModel.getRowCount() - 1));
    };

    const onUp = (e: MouseEvent): void => finish(e, false);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(null, true);
    };
    const cleanup = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey);
      ghost?.remove();
      indicator?.remove();
      ghost = null;
      indicator = null;
      dragging = false;
      this.activeCleanup = null;
    };
    this.activeCleanup = cleanup;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey);
  }

  /** Header + floating filter height — the body's y offset inside the root. */
  private bodyTop(): number {
    const root = this.ctx.renderer.eRoot;
    const body = root.querySelector('.au-body') as HTMLElement | null;
    if (!body) return 0;
    return body.getBoundingClientRect().top - root.getBoundingClientRect().top;
  }

  destroy(): void {
    this.activeCleanup?.();
  }
}
