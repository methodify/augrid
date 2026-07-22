import type { GridContext, IFocusService } from '../context';
import type { CellPosition, RowPinnedPosition } from '../types/base';
import type { RowNode } from '../rows/rowNode';
import { clamp } from '../utils/general';

/** Keys that initialise focus on the first cell when nothing is focused yet. */
const FOCUS_INIT_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Enter',
]);

/**
 * FocusService — the grid's single keyboard dispatcher and focused-cell state
 * holder. The renderer routes ALL keydowns on the root element into
 * `onKeyDown`, which delegates to editing / navigation / selection /
 * clipboard / undo-redo behaviors.
 */
export class FocusService<TData = unknown> implements IFocusService<TData> {
  private focused: CellPosition | null = null;
  private destroyed = false;
  /** Key currently being processed (passed to the navigateToNextCell hook). */
  private currentKey = '';
  private domFocusPending = false;

  constructor(private ctx: GridContext<TData>) {}

  /* ------------------------------------------------------------ focus state */

  getFocusedCell(): CellPosition | null {
    return this.focused;
  }

  setFocusedCell(rowIndex: number, colId: string, rowPinned: RowPinnedPosition = null): void {
    const ctx = this.ctx;
    if (ctx.options.is('suppressCellFocus')) {
      // Cell focus disabled: never install a focused cell, drop any existing one.
      if (this.focused) this.clearFocusedCell();
      return;
    }
    if (!ctx.columnModel.getColumn(colId)) return; // unknown column: ignore
    if (rowPinned == null) {
      const count = ctx.rowModel.getRowCount();
      if (count === 0) return;
      rowIndex = clamp(rowIndex, 0, count - 1);
    }
    this.focused = { rowIndex, colId, rowPinned };
    ctx.events.dispatch({
      type: 'cellFocused',
      api: ctx.api,
      context: ctx.options.get('context'),
      rowIndex,
      colId,
      rowPinned,
    });
    if (rowPinned == null) ctx.renderer.ensureIndexVisible(rowIndex);
    ctx.renderer.ensureColumnVisible(colId);
    ctx.scheduleRender();
    this.queueDomFocus();
  }

  clearFocusedCell(): void {
    this.focused = null;
    this.ctx.events.dispatch({
      type: 'cellFocused',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      rowIndex: null,
      colId: null,
      rowPinned: null,
    });
    this.ctx.scheduleRender();
  }

  /** After the next render pass, apply real DOM focus (a11y). */
  private queueDomFocus(): void {
    if (this.domFocusPending) return;
    this.domFocusPending = true;
    const run = (): void => {
      this.domFocusPending = false;
      if (this.destroyed || this.ctx.destroyed || !this.focused) return;
      this.ctx.renderer.focusCellElement(this.focused);
    };
    // scheduleRender() was called before us, so the renderer's rAF callback
    // (registered first) runs first and the cell element exists when we focus.
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(run);
    else run();
  }

  /* ------------------------------------------------------------- navigation */

  navigateBy(dRow: number, dCol: number, extendRange = false): CellPosition | null {
    const ctx = this.ctx;
    const from = this.focused;
    if (!from) return null;
    // Minimal pinned-row handling: arrows navigate within the body only.
    if (from.rowPinned != null) return null;

    const cols = ctx.columnModel.getDisplayedColumns();
    if (cols.length === 0) return null;
    const rowCount = ctx.rowModel.getRowCount();
    if (rowCount === 0) return null;

    // Shift+arrow steps from the range's current extension end, not from the
    // focused cell — the focus stays on the anchor while the range grows.
    const origin = (extendRange && ctx.range ? ctx.range.getLatestRangeEnd() : null) ?? from;

    let colIdx = cols.findIndex((c) => c.colId === origin.colId);
    if (colIdx < 0) colIdx = 0;
    const nextColIdx = clamp(colIdx + dCol, 0, cols.length - 1);
    const nextRow = clamp(origin.rowIndex + dRow, 0, rowCount - 1);
    let next: CellPosition | null = {
      rowIndex: nextRow,
      colId: cols[nextColIdx]!.colId,
      rowPinned: null,
    };

    const hook = ctx.options.get('navigateToNextCell');
    if (hook) {
      const result = hook({
        key: this.currentKey,
        previousCellPosition: from,
        nextCellPosition: next,
      });
      if (!result) return null; // hook blocked navigation
      next = { rowIndex: result.rowIndex, colId: result.colId, rowPinned: result.rowPinned ?? null };
    }

    if (extendRange && ctx.range) {
      // No range yet (e.g. focus set via API/keyboard): anchor at the focused
      // cell first so the extension grows away from it.
      if (ctx.range.getCellRanges().length === 0) ctx.range.setRangeToCell(from);
      ctx.range.extendLatestRangeToCell(next);
      // Keep the growing edge on screen (spreadsheet behavior).
      ctx.renderer.ensureIndexVisible(next.rowIndex);
      ctx.renderer.ensureColumnVisible(next.colId);
      ctx.scheduleRender();
      return next;
    }
    this.setFocusedCell(next.rowIndex, next.colId, next.rowPinned);
    if (ctx.range) ctx.range.setRangeToCell(this.focused ?? next);
    return this.focused;
  }

  /**
   * Tab navigation: dCol ±1 with row wrap. Returns the position moved to, or
   * null when at the grid edge (caller lets the browser tab out).
   */
  private tabNavigate(backwards: boolean, editing: boolean): CellPosition | null {
    const ctx = this.ctx;
    const from = this.focused;
    if (!from || from.rowPinned != null) return null;
    const cols = ctx.columnModel.getDisplayedColumns();
    if (cols.length === 0) return null;
    const rowCount = ctx.rowModel.getRowCount();

    let colIdx = cols.findIndex((c) => c.colId === from.colId);
    if (colIdx < 0) colIdx = 0;
    let nextColIdx = colIdx + (backwards ? -1 : 1);
    let nextRow = from.rowIndex;
    if (nextColIdx >= cols.length) {
      nextColIdx = 0;
      nextRow++;
    } else if (nextColIdx < 0) {
      nextColIdx = cols.length - 1;
      nextRow--;
    }
    let next: CellPosition | null =
      nextRow < 0 || nextRow >= rowCount
        ? null
        : { rowIndex: nextRow, colId: cols[nextColIdx]!.colId, rowPinned: null };

    const hook = ctx.options.get('tabToNextCell');
    if (hook) {
      const result = hook({
        backwards,
        editing,
        previousCellPosition: from,
        nextCellPosition: next,
      });
      next = result
        ? { rowIndex: result.rowIndex, colId: result.colId, rowPinned: result.rowPinned ?? null }
        : null;
    }
    if (!next) return null;

    this.setFocusedCell(next.rowIndex, next.colId, next.rowPinned);
    if (ctx.range) ctx.range.setRangeToCell(this.focused ?? next);
    return this.focused;
  }

  /* ------------------------------------------------------ keyboard dispatch */

  onKeyDown(e: KeyboardEvent): void {
    if (this.destroyed || this.ctx.destroyed) return;
    if (this.ctx.editing.isEditing()) {
      this.onKeyDownWhileEditing(e);
      return;
    }
    const ctx = this.ctx;
    const key = e.key;
    const ctrl = e.ctrlKey || e.metaKey;

    /* ---- shortcuts that do not require a focused cell ---- */
    if (ctrl) {
      switch (key.toLowerCase()) {
        case 'a':
          this.handleSelectAll();
          e.preventDefault();
          return;
        case 'c':
          ctx.clipboard.copy();
          return; // no preventDefault: let the native copy event fire
        case 'x':
          ctx.clipboard.cut();
          return; // no preventDefault: let the native cut event fire
        case 'v':
          if (ctx.options.get('suppressClipboardPaste') !== true) {
            ctx.clipboard.paste();
            e.preventDefault();
          }
          return;
        case 'z':
          if (e.shiftKey) ctx.undoRedo?.redo();
          else ctx.undoRedo?.undo();
          e.preventDefault();
          return;
        case 'y':
          ctx.undoRedo?.redo();
          e.preventDefault();
          return;
      }
    }

    if (ctx.options.is('suppressCellFocus')) return; // nav keys are inert (Ctrl+A above still works)

    const focused = this.focused;
    if (!focused) {
      // Keyboard entry (e.g. Tab into the grid): the first navigation key
      // initialises focus on the first displayed cell and is consumed.
      if (FOCUS_INIT_KEYS.has(key) && this.initFocusIfNone()) e.preventDefault();
      return;
    }
    this.currentKey = key;
    const rowCount = ctx.rowModel.getRowCount();
    const nCols = ctx.columnModel.getDisplayedColumns().length;
    const extend = e.shiftKey && !!ctx.range;

    switch (key) {
      case 'ArrowUp':
        this.navigateBy(ctrl ? -rowCount : -1, 0, extend);
        e.preventDefault();
        return;
      case 'ArrowDown':
        this.navigateBy(ctrl ? rowCount : 1, 0, extend);
        e.preventDefault();
        return;
      case 'ArrowLeft': {
        if (!ctrl && !extend && focused.rowPinned == null && this.isGroupHeaderCell(focused.colId)) {
          const node = ctx.rowModel.getRow(focused.rowIndex);
          if (node) {
            // ARIA treegrid: collapse an expanded group…
            if (this.isExpandableGroup(node) && node.expanded) {
              node.setExpanded(false);
              e.preventDefault();
              return;
            }
            // …or move focus to the parent group row of a leaf/collapsed group.
            const parent = node.parent;
            if (
              (!node.group || !node.expanded) &&
              parent &&
              parent.rowIndex >= 0 &&
              ctx.rowModel.getRow(parent.rowIndex) === parent
            ) {
              this.setFocusedCell(parent.rowIndex, focused.colId);
              e.preventDefault();
              return;
            }
          }
        }
        this.navigateBy(0, ctrl ? -nCols : -1, extend);
        e.preventDefault();
        return;
      }
      case 'ArrowRight': {
        if (!ctrl && !extend && focused.rowPinned == null && this.isGroupHeaderCell(focused.colId)) {
          const node = ctx.rowModel.getRow(focused.rowIndex);
          if (node && this.isExpandableGroup(node) && !node.expanded) {
            node.setExpanded(true); // ARIA treegrid: expand a collapsed group
            e.preventDefault();
            return;
          }
        }
        this.navigateBy(0, ctrl ? nCols : 1, extend);
        e.preventDefault();
        return;
      }
      case 'Tab': {
        const moved = this.tabNavigate(e.shiftKey, false);
        if (moved) e.preventDefault(); // else: let the browser tab out of the grid
        return;
      }
      case 'Home':
        this.navigateBy(ctrl ? -rowCount : 0, -nCols, extend);
        e.preventDefault();
        return;
      case 'End':
        this.navigateBy(ctrl ? rowCount : 0, nCols, extend);
        e.preventDefault();
        return;
      case 'PageUp':
      case 'PageDown': {
        const vpHeight = ctx.renderer.getViewportSize().height;
        const rowHeight = ctx.options.get('rowHeight') ?? 32;
        const page = Math.max(1, Math.floor(vpHeight / Math.max(1, rowHeight)));
        this.navigateBy(key === 'PageUp' ? -page : page, 0, extend);
        e.preventDefault();
        return;
      }
      case 'F2':
        ctx.editing.startEditing({
          rowIndex: focused.rowIndex,
          colId: focused.colId,
          rowPinned: focused.rowPinned,
          event: e,
        });
        e.preventDefault();
        return;
      case 'Enter': {
        const started = ctx.editing.startEditing({
          rowIndex: focused.rowIndex,
          colId: focused.colId,
          rowPinned: focused.rowPinned,
          event: e,
        });
        if (!started) {
          // Not editable: toggle expandable group rows (ARIA treegrid), else
          // Enter navigates vertically when enterNavigatesVertically is on.
          const node =
            focused.rowPinned == null && this.isGroupHeaderCell(focused.colId)
              ? ctx.rowModel.getRow(focused.rowIndex)
              : undefined;
          if (node && this.isExpandableGroup(node)) {
            node.setExpanded(!node.expanded);
          } else if (ctx.options.get('enterNavigatesVertically') === true) {
            this.navigateBy(e.shiftKey ? -1 : 1, 0);
          }
        }
        e.preventDefault();
        return;
      }
      case 'Delete':
      case 'Backspace':
        this.handleClear();
        e.preventDefault();
        return;
      case ' ': {
        if (ctx.options.get('rowSelection') != null && focused.rowPinned == null) {
          const node = ctx.rowModel.getRow(focused.rowIndex);
          if (node) {
            const value = e.shiftKey ? true : !node.isSelected();
            ctx.selection.setSelected([node], value, 'keyboard');
          }
        }
        e.preventDefault();
        return;
      }
    }

    // Printable single character → start editing with that key.
    if (key.length === 1 && !ctrl && !e.altKey) {
      const started = ctx.editing.startEditing({
        rowIndex: focused.rowIndex,
        colId: focused.colId,
        rowPinned: focused.rowPinned,
        key,
        event: e,
      });
      if (started) e.preventDefault();
    }
  }

  private onKeyDownWhileEditing(e: KeyboardEvent): void {
    const ctx = this.ctx;
    switch (e.key) {
      case 'Escape':
        ctx.editing.stopEditing(true);
        if (this.focused) ctx.renderer.focusCellElement(this.focused);
        e.preventDefault();
        return;
      case 'Enter':
        ctx.editing.stopEditing(false);
        this.currentKey = e.key;
        if (ctx.options.get('enterNavigatesVerticallyAfterEdit') === true) {
          this.navigateBy(e.shiftKey ? -1 : 1, 0);
        } else if (this.focused) {
          ctx.renderer.focusCellElement(this.focused);
        }
        e.preventDefault();
        return;
      case 'Tab':
        ctx.editing.stopEditing(false);
        this.currentKey = e.key;
        this.tabNavigate(e.shiftKey, true);
        e.preventDefault();
        return;
      default:
        return; // editor handles its own keys
    }
  }

  /**
   * Keyboard entry with no focused cell: focus the first displayed cell
   * (first row, first displayed column). Returns true when focus was set —
   * the triggering key is consumed (no movement on that first press).
   */
  private initFocusIfNone(): boolean {
    const ctx = this.ctx;
    if (this.focused) return false;
    if (ctx.options.is('suppressCellFocus')) return false;
    if (ctx.rowModel.getRowCount() === 0) return false;
    const cols = ctx.columnModel.getDisplayedColumns();
    if (cols.length === 0) return false;
    this.setFocusedCell(0, cols[0]!.colId);
    return this.focused != null;
  }

  /** Group row that can be expanded/collapsed (mirrors the renderer's chevron rule). */
  private isExpandableGroup(node: RowNode<TData>): boolean {
    return node.group && !node.footer && (node.childrenAfterFilter?.length ?? 0) > 0;
  }

  /**
   * Treegrid expand/collapse key semantics apply ONLY on the group-header
   * cell (the auto group column carrying the chevron, or the full-width row
   * in 'groupRows' display). On every other cell of a group row, arrows and
   * Enter behave like normal spreadsheet navigation/editing.
   */
  private isGroupHeaderCell(colId: string): boolean {
    if (colId === 'au-fullwidth') return true;
    return this.ctx.columnModel.getColumn(colId)?.isAutoGroupCol === true;
  }

  /* -------------------------------------------------------------- behaviors */

  /** Delete/Backspace: clear cells in ranges (or the focused cell) to null. */
  private handleClear(): void {
    const ctx = this.ctx;
    const ranges = ctx.range?.getCellRanges() ?? [];
    if (ctx.range && ranges.length > 0) {
      for (const range of ranges) {
        const lo = Math.min(range.startRowIndex, range.endRowIndex);
        const hi = Math.max(range.startRowIndex, range.endRowIndex);
        for (let i = lo; i <= hi; i++) {
          const node = ctx.rowModel.getRow(i);
          if (!node) continue;
          for (const colId of range.colIds) {
            ctx.editing.commitValue(node, colId, null, 'edit');
          }
        }
      }
    } else if (this.focused && this.focused.rowPinned == null) {
      const node = ctx.rowModel.getRow(this.focused.rowIndex);
      if (node) ctx.editing.commitValue(node, this.focused.colId, null, 'edit');
    }
    ctx.scheduleRender();
  }

  /** Ctrl/Meta+A: range select-all when cell selection is on, else row select-all. */
  private handleSelectAll(): void {
    const ctx = this.ctx;
    if (ctx.range) {
      const rowCount = ctx.rowModel.getRowCount();
      const colIds = ctx.columnModel.getDisplayedColumns().map((c) => c.colId);
      if (rowCount > 0 && colIds.length > 0) {
        // Replace, not append: repeated Ctrl+A must not stack duplicate
        // all-cell ranges (duplicated rows in copy output).
        ctx.range.clearCellSelection();
        ctx.range.addCellRange({ startRowIndex: 0, endRowIndex: rowCount - 1, colIds });
        ctx.scheduleRender();
      }
    } else {
      ctx.selection.selectAll();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.focused = null;
  }
}
