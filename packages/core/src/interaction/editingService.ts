import type { FrameworkAdapter, GridContext, IEditingService, StartEditParams } from '../context';
import type { CellPosition } from '../types/base';
import type { CellEditorComp, CellEditorParams } from '../types/colDef';
import type { IColumn } from '../types/column';
import type { Column } from '../columns/column';
import type { RowNode } from '../rows/rowNode';
import {
  CheckboxCellEditor,
  DateCellEditor,
  NumberCellEditor,
  PROVIDED_EDITORS,
  TextCellEditor,
} from './editors';

interface EditingCellState<TData> {
  rowIndex: number;
  colId: string;
  node: RowNode<TData>;
  column: Column<TData>;
  comp: CellEditorComp<TData>;
  params: CellEditorParams<TData>;
  /** GUI attached to the DOM (afterGuiAttached already called for it). */
  attached: boolean;
  popupEl: HTMLElement | null;
}

/** Bridges a wrapper-registered framework component to the editor interface. */
class FrameworkCellEditor<TData> implements CellEditorComp<TData> {
  private container: HTMLElement;
  private cleanup: (() => void) | null = null;

  constructor(
    private component: unknown,
    private adapter: FrameworkAdapter,
  ) {
    this.container = document.createElement('div');
    this.container.className = 'au-editor-framework';
  }

  init(params: CellEditorParams<TData>): void {
    this.cleanup = this.adapter.render(
      this.component,
      params as unknown as Record<string, unknown>,
      this.container,
    );
  }

  getGui(): HTMLElement {
    return this.container;
  }

  getValue(): unknown {
    return this.adapter.getEditorValue ? this.adapter.getEditorValue(this.container) : undefined;
  }

  destroy(): void {
    this.cleanup?.();
    this.cleanup = null;
  }
}

/**
 * Edit lifecycle: start/stop editors per cell (or per row in fullRow mode),
 * mount editor GUIs during render, and funnel every value mutation (edit,
 * paste, fill, clear) through commitValue → parse → validate → setValue.
 */
export class EditingService<TData = unknown> implements IEditingService<TData> {
  private ctx: GridContext<TData>;
  private cells: EditingCellState<TData>[] = [];
  private fullRow = false;
  private focusColId: string | null = null;
  private onDocMouseDown: (e: MouseEvent) => void;

  constructor(ctx: GridContext<TData>) {
    this.ctx = ctx;
    this.onDocMouseDown = (e: MouseEvent) => {
      if (this.ctx.destroyed || !this.isEditing()) return;
      if (this.ctx.options.get('stopEditingWhenCellsLoseFocus') === false) return;
      const target = e.target;
      if (target instanceof Node && this.ctx.renderer.eRoot.contains(target)) return;
      this.stopEditing(false);
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('mousedown', this.onDocMouseDown);
    }
  }

  /* ----------------------------------------------------------------- state */

  isEditing(): boolean {
    return this.cells.length > 0;
  }

  isEditingCell(rowIndex: number, colId: string): boolean {
    for (const c of this.cells) {
      if (c.rowIndex === rowIndex && c.colId === colId) return true;
    }
    return false;
  }

  getEditingCells(): CellPosition[] {
    return this.cells.map((c) => ({ rowIndex: c.rowIndex, colId: c.colId, rowPinned: null }));
  }

  /* ----------------------------------------------------------------- start */

  startEditing({ rowIndex, colId, rowPinned, key, event }: StartEditParams): boolean {
    if (rowPinned) return false; // pinned rows are not editable
    const node = this.ctx.rowModel.getRow(rowIndex);
    const column = this.ctx.columnModel.getColumn(colId);
    if (!node || !column) return false;
    if (!this.isCellEditable(node, column)) return false;
    if (this.isEditingCell(rowIndex, colId)) return true;
    if (this.isEditing()) this.stopEditing(false);

    if (this.ctx.options.get('editType') === 'fullRow') {
      const started: EditingCellState<TData>[] = [];
      for (const col of this.ctx.columnModel.getDisplayedColumns()) {
        if (!this.isCellEditable(node, col)) continue;
        const st = this.createCellState(node, col, rowIndex, col.colId === colId ? (key ?? null) : null);
        if (st) started.push(st);
      }
      if (started.length === 0) return false;
      this.cells = started;
      this.fullRow = true;
      this.focusColId = colId;
      for (const st of started) this.dispatchCellEditingEvent('cellEditingStarted', st, event);
      this.ctx.events.dispatch({
        type: 'rowEditingStarted',
        api: this.ctx.api,
        context: this.ctx.options.get('context'),
        node,
        data: node.data,
        rowIndex,
        event,
      });
      this.ctx.scheduleRender();
      return true;
    }

    const st = this.createCellState(node, column, rowIndex, key ?? null);
    if (!st) return false;
    this.cells = [st];
    this.fullRow = false;
    this.focusColId = colId;
    this.dispatchCellEditingEvent('cellEditingStarted', st, event);
    this.ctx.scheduleRender();
    return true;
  }

  private createCellState(
    node: RowNode<TData>,
    column: Column<TData>,
    rowIndex: number,
    key: string | null,
  ): EditingCellState<TData> | null {
    const colDef = column.getColDef();
    const comp = this.resolveEditor(column);
    if (!comp) return null;
    const params: CellEditorParams<TData> = {
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      data: node.data,
      node,
      // Cast: kernel-wide IColumn.getAggFunc variance mismatch (see valueService).
      column: column as unknown as IColumn<TData>,
      colDef,
      value: this.ctx.values.getValue(node, column),
      eventKey: key,
      stopEditing: (cancel?: boolean) => {
        this.stopEditing(cancel);
      },
      colParams: colDef.cellEditorParams,
    };
    comp.init(params);
    if (comp.isCancelBeforeStart?.()) {
      comp.destroy?.();
      return null;
    }
    return {
      rowIndex,
      colId: column.colId,
      node,
      column,
      comp,
      params,
      attached: false,
      popupEl: null,
    };
  }

  private resolveEditor(column: Column<TData>): CellEditorComp<TData> | null {
    const def = column.getColDef();
    const ce = def.cellEditor;
    if (typeof ce === 'string') {
      const Ctor = PROVIDED_EDITORS[ce];
      return Ctor ? (new Ctor() as CellEditorComp<TData>) : new TextCellEditor<TData>();
    }
    if (typeof ce === 'function') {
      return new (ce as new () => CellEditorComp<TData>)();
    }
    if (ce && typeof ce === 'object' && '__frameworkComponent' in ce) {
      const adapter = this.ctx.frameworkAdapter;
      if (adapter) return new FrameworkCellEditor<TData>(ce.__frameworkComponent, adapter);
      return new TextCellEditor<TData>();
    }
    switch (column.cellDataType) {
      case 'number':
        return new NumberCellEditor<TData>();
      case 'date':
        return new DateCellEditor<TData>();
      case 'boolean':
        return new CheckboxCellEditor<TData>();
      default:
        return new TextCellEditor<TData>();
    }
  }

  /* ----------------------------------------------------------------- mount */

  mountEditorInto(cellEl: HTMLElement, rowIndex: number, colId: string): void {
    const st = this.cells.find((c) => c.rowIndex === rowIndex && c.colId === colId);
    if (!st) return;
    const gui = st.comp.getGui();
    const popup = !!st.comp.isPopup?.() || !!st.column.getColDef().cellEditorPopup;

    if (popup) {
      const root = this.ctx.renderer.eRoot;
      const firstAttach = !st.popupEl;
      if (!st.popupEl) {
        st.popupEl = document.createElement('div');
        st.popupEl.className = 'au-editor-popup';
        st.popupEl.appendChild(gui);
        root.appendChild(st.popupEl);
      }
      // Position over the cell. Layout read is acceptable: editing is not a hot path.
      const cellRect = cellEl.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      st.popupEl.style.left = `${cellRect.left - rootRect.left}px`;
      st.popupEl.style.top = `${cellRect.top - rootRect.top}px`;
      st.popupEl.style.minWidth = `${cellRect.width}px`;
      if (firstAttach && !st.attached) {
        st.attached = true;
        st.comp.afterGuiAttached?.();
        this.refocusAfterMount(st);
      }
      return;
    }

    if (gui.parentElement !== cellEl) {
      // Not yet in this cell (fresh edit, or row recycling moved the cell).
      cellEl.appendChild(gui);
      st.attached = true;
      st.comp.afterGuiAttached?.();
      this.refocusAfterMount(st);
    }
  }

  /**
   * fullRow mode: every editor focuses itself in afterGuiAttached; make sure
   * the editor of the clicked column ends up focused regardless of mount order.
   */
  private refocusAfterMount(mounted: EditingCellState<TData>): void {
    if (!this.focusColId || mounted.colId === this.focusColId) return;
    const target = this.cells.find((c) => c.colId === this.focusColId);
    if (target && target.attached) this.focusEditor(target);
  }

  private focusEditor(st: EditingCellState<TData>): void {
    if (st.comp.focusIn) {
      st.comp.focusIn();
      return;
    }
    const gui = st.comp.getGui();
    const focusable = gui.matches('input,select,textarea')
      ? gui
      : gui.querySelector<HTMLElement>('input,select,textarea');
    focusable?.focus();
  }

  /* ------------------------------------------------------------------ stop */

  stopEditing(cancel = false): boolean {
    if (this.cells.length === 0) return false;
    const cells = this.cells;
    const wasFullRow = this.fullRow;
    const focusColId = this.focusColId ?? cells[0].colId;
    const rowIndex = cells[0].rowIndex;
    const node = cells[0].node;

    let anyChanged = false;
    if (!cancel) {
      for (const st of cells) {
        const raw = st.comp.getValue();
        if (st.comp.isCancelAfterEnd?.()) continue;
        if (this.commitValue(st.node, st.colId, raw, 'edit', true)) anyChanged = true;
      }
    }

    for (const st of cells) {
      st.comp.destroy?.();
      if (st.popupEl) {
        st.popupEl.remove();
        st.popupEl = null;
      }
    }

    // Clear state BEFORE dispatching stop events so listeners see a non-editing grid.
    this.cells = [];
    this.fullRow = false;
    this.focusColId = null;

    for (const st of cells) this.dispatchCellEditingEvent('cellEditingStopped', st);
    if (wasFullRow) {
      const rowPayload = {
        api: this.ctx.api,
        context: this.ctx.options.get('context'),
        node,
        data: node.data,
        rowIndex,
      };
      this.ctx.events.dispatch({ ...rowPayload, type: 'rowEditingStopped' });
      if (anyChanged) this.ctx.events.dispatch({ ...rowPayload, type: 'rowValueChanged' });
    }

    this.ctx.scheduleRender();
    // Return DOM focus to the grid cell so keyboard flow continues.
    this.ctx.renderer.focusCellElement({ rowIndex, colId: focusColId, rowPinned: null });
    return true;
  }

  /* ---------------------------------------------------------------- commit */

  commitValue(
    node: RowNode<TData>,
    colId: string,
    newValue: unknown,
    source: string,
    parse = false,
  ): boolean {
    const column = this.ctx.columnModel.getColumn(colId);
    if (!column) return false;
    if (!this.isCellEditable(node, column)) return false;

    const value = parse ? this.ctx.values.parseValue(node, column, newValue) : newValue;

    const validate = this.ctx.options.get('validateEdit');
    if (validate) {
      const error = validate({
        node,
        colId,
        oldValue: this.ctx.values.getValue(node, column),
        newValue: value,
      });
      if (typeof error === 'string') return false;
    }

    return this.ctx.values.setValue(node, colId, value, source);
  }

  /* ------------------------------------------------------------ editability */

  private isCellEditable(node: RowNode<TData>, column: Column<TData>): boolean {
    if (column.secondary) return false; // pivot result columns are read-only
    if (!column.isEditable()) return false;
    const colDef = column.getColDef();
    const editable = colDef.editable;
    if (typeof editable === 'function') {
      return !!editable({
        api: this.ctx.api,
        context: this.ctx.options.get('context'),
        data: node.data,
        node,
        column: column as unknown as IColumn<TData>,
        colDef,
      });
    }
    // Group rows without backing data are not editable unless a callback says so.
    if (node.group && node.data == null) return false;
    return true;
  }

  /* ----------------------------------------------------------------- misc */

  private dispatchCellEditingEvent(
    type: 'cellEditingStarted' | 'cellEditingStopped',
    st: EditingCellState<TData>,
    event?: Event,
  ): void {
    this.ctx.events.dispatch({
      type,
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      node: st.node,
      data: st.node.data,
      column: st.column as unknown as IColumn<TData>,
      colDef: st.column.getColDef(),
      colId: st.colId,
      value: this.ctx.values.getValue(st.node, st.column),
      rowIndex: st.rowIndex,
      event,
    });
  }

  destroy(): void {
    if (this.isEditing()) this.stopEditing(true);
    if (typeof document !== 'undefined') {
      document.removeEventListener('mousedown', this.onDocMouseDown);
    }
  }
}
