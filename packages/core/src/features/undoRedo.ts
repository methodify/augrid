import type { GridContext, IUndoRedoService } from '../context.js';
import type { CellValueChangedEvent } from '../types/events.js';

interface UndoEntry {
  rowId: string;
  colId: string;
  oldValue: unknown;
  newValue: unknown;
}

/** One undoable action: all cell changes recorded in the same microtask. */
type UndoAction = UndoEntry[];

/** Sources whose cellValueChanged events are undoable. */
const RECORDED_SOURCES: ReadonlySet<string> = new Set(['edit', 'paste', 'fill', 'cut']);

/**
 * Cell-edit undo/redo. Changes arriving in the same microtask (a paste, a
 * fill drag) collapse into one action so a single undo reverts them all.
 */
export class UndoRedoService<TData = unknown> implements IUndoRedoService<TData> {
  private ctx: GridContext<TData>;
  private undoStack: UndoAction[] = [];
  private redoStack: UndoAction[] = [];
  private pending: UndoEntry[] = [];

  private readonly onCellValueChanged = (e: CellValueChangedEvent<TData>): void => {
    if (!RECORDED_SOURCES.has(e.source)) return;
    this.pending.push({
      rowId: e.node.id,
      colId: e.colId,
      oldValue: e.oldValue,
      newValue: e.newValue,
    });
    if (this.pending.length === 1) queueMicrotask(() => this.flushPending());
  };

  constructor(ctx: GridContext<TData>) {
    this.ctx = ctx;
    ctx.events.addEventListener('cellValueChanged', this.onCellValueChanged);
  }

  private flushPending(): void {
    if (this.pending.length === 0) return;
    this.undoStack.push(this.pending);
    this.pending = [];
    this.redoStack = [];
    const limit = this.ctx.options.get('undoRedoCellEditingLimit') ?? 100;
    while (this.undoStack.length > limit) this.undoStack.shift();
  }

  undo(): void {
    const action = this.undoStack.pop();
    if (!action) return;
    for (let i = action.length - 1; i >= 0; i--) {
      const entry = action[i];
      this.ctx.rowModel.getRowNode(entry.rowId)?.setDataValue(entry.colId, entry.oldValue, 'undo');
    }
    this.redoStack.push(action);
    this.dispatchPerformed('undoPerformed', 'undo');
    this.ctx.scheduleRender();
  }

  redo(): void {
    const action = this.redoStack.pop();
    if (!action) return;
    for (const entry of action) {
      this.ctx.rowModel.getRowNode(entry.rowId)?.setDataValue(entry.colId, entry.newValue, 'redo');
    }
    this.undoStack.push(action);
    this.dispatchPerformed('redoPerformed', 'redo');
    this.ctx.scheduleRender();
  }

  undoSize(): number {
    return this.undoStack.length;
  }

  redoSize(): number {
    return this.redoStack.length;
  }

  private dispatchPerformed(type: 'undoPerformed' | 'redoPerformed', operation: 'undo' | 'redo'): void {
    this.ctx.events.dispatch({
      type,
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      operation,
    });
  }

  destroy(): void {
    this.ctx.events.removeEventListener('cellValueChanged', this.onCellValueChanged);
    this.undoStack = [];
    this.redoStack = [];
    this.pending = [];
  }
}
