import type { FrameworkAdapter, GridContext, IEditingService, StartEditParams } from '../context.js';
import type { CellPosition } from '../types/base.js';
import type { CellEditorComp, CellEditorParams } from '../types/colDef.js';
import type { IColumn } from '../types/column.js';
import type { Column } from '../columns/column.js';
import type { RowNode } from '../rows/rowNode.js';
import { buildPivotCellContext, isAggregateTarget } from '../values/pivotContext.js';
import {
  CheckboxCellEditor,
  DateCellEditor,
  NumberCellEditor,
  PROVIDED_EDITORS,
  TextCellEditor,
} from './editors.js';

/**
 * Editing state is keyed by the RowNode reference (and its id) — never by a
 * snapshotted display rowIndex, which goes stale when transactions / sort /
 * filter / expand shift the model while an edit is open. Display positions
 * are always derived from `node.rowIndex` at read time.
 */
interface EditingCellState<TData> {
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
  /** Reentrancy guard: stopEditing re-entered during its commit loop is a no-op. */
  private stopping = false;
  /** Unsubscribe hook for the popup-repositioning bodyScroll listener. */
  private popupScrollListener: (() => void) | null = null;
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
    if (!this.validateEditingNode()) return false;
    for (const c of this.cells) {
      if (c.node.rowIndex === rowIndex && c.colId === colId) return true;
    }
    return false;
  }

  getEditingCells(): CellPosition[] {
    if (!this.validateEditingNode()) return [];
    return this.cells.map((c) => ({ rowIndex: c.node.rowIndex, colId: c.colId, rowPinned: null }));
  }

  /**
   * The edited node's display position may have shifted (transaction / sort /
   * filter / expand). When the node is no longer displayed at all, the edit
   * session cannot continue — commit it. Returns whether an edit is live.
   */
  private validateEditingNode(): boolean {
    if (this.cells.length === 0) return false;
    const node = this.cells[0]!.node;
    if (node.rowIndex < 0 || this.ctx.rowModel.getRow(node.rowIndex) !== node) {
      this.stopEditing(false);
      return this.cells.length > 0; // a listener may have started a new edit
    }
    return true;
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
        const st = this.createCellState(node, col, col.colId === colId ? (key ?? null) : null);
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

    const st = this.createCellState(node, column, key ?? null);
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
    const st = this.cells.find((c) => c.node.rowIndex === rowIndex && c.colId === colId);
    if (!st) return;
    const gui = st.comp.getGui();
    const popup = !!st.comp.isPopup?.() || !!st.column.getColDef().cellEditorPopup;

    if (popup) {
      const root = this.ctx.renderer.eRoot;
      if (!st.popupEl) {
        st.popupEl = document.createElement('div');
        st.popupEl.className = 'au-editor-popup';
        st.popupEl.appendChild(gui);
        root.appendChild(st.popupEl);
        // Track scrolling while the popup is open so it never drifts from its cell.
        this.subscribePopupScroll();
      }
      st.popupEl.style.visibility = '';
      this.positionPopup(st.popupEl, cellEl);
      if (!st.attached) {
        // afterGuiAttached must run exactly once per edit session.
        st.attached = true;
        st.comp.afterGuiAttached?.();
        this.refocusAfterMount(st);
      }
      return;
    }

    if (gui.parentElement !== cellEl) {
      // Not yet in this cell (fresh edit, or row recycling moved the cell).
      cellEl.appendChild(gui);
    }
    if (!st.attached) {
      // Re-attach-safe: afterGuiAttached runs exactly once per edit session,
      // even when virtualization detaches and re-mounts the editor GUI.
      st.attached = true;
      st.comp.afterGuiAttached?.();
      this.refocusAfterMount(st);
    }
  }

  /** Position a popup over its cell. Layout read is acceptable: editing is not a hot path. */
  private positionPopup(popupEl: HTMLElement, cellEl: HTMLElement): void {
    const rootRect = this.ctx.renderer.eRoot.getBoundingClientRect();
    const cellRect = cellEl.getBoundingClientRect();
    popupEl.style.left = `${cellRect.left - rootRect.left}px`;
    popupEl.style.top = `${cellRect.top - rootRect.top}px`;
    popupEl.style.minWidth = `${cellRect.width}px`;
  }

  /* --------------------------------------------------- popup scroll tracking */

  private subscribePopupScroll(): void {
    if (this.popupScrollListener) return;
    this.popupScrollListener = () => this.repositionPopups();
    this.ctx.events.addEventListener('bodyScroll', this.popupScrollListener);
  }

  private unsubscribePopupScroll(): void {
    if (!this.popupScrollListener) return;
    this.ctx.events.removeEventListener('bodyScroll', this.popupScrollListener);
    this.popupScrollListener = null;
  }

  /**
   * On bodyScroll: re-anchor open popups to the CURRENT cell element. When the
   * cell is scrolled out of the rendered window, hide the popup until the cell
   * returns (mountEditorInto shows it again) or the edit stops. Positioning
   * reads happen on scroll events, not in the per-frame render path.
   */
  private repositionPopups(): void {
    for (const st of this.cells) {
      if (!st.popupEl) continue;
      const cellEl =
        st.node.rowIndex < 0
          ? null
          : this.ctx.renderer.getCellElement({
              rowIndex: st.node.rowIndex,
              colId: st.colId,
              rowPinned: null,
            });
      if (!cellEl) {
        st.popupEl.style.visibility = 'hidden';
        continue;
      }
      st.popupEl.style.visibility = '';
      this.positionPopup(st.popupEl, cellEl);
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
    if (this.stopping) return false; // reentered from a commit listener: no-op
    if (this.cells.length === 0) return false;
    // Capture and clear state BEFORE the commit loop: synchronous
    // cellValueChanged listeners must observe a non-editing grid, and a
    // reentrant startEditing installs fresh state that this stop never
    // clobbers (the loop and cleanup below operate on the captured array).
    const cells = this.cells;
    const wasFullRow = this.fullRow;
    const focusColId = this.focusColId ?? cells[0].colId;
    const node = cells[0].node;
    this.cells = [];
    this.fullRow = false;
    this.focusColId = null;
    this.unsubscribePopupScroll();

    let anyChanged = false;
    this.stopping = true;
    try {
      if (!cancel) {
        for (const st of cells) {
          // Value comes from the retained editor comp — never from the DOM —
          // so a commit works even when the GUI was detached by scrolling.
          const raw = st.comp.getValue();
          if (st.comp.isCancelAfterEnd?.()) continue;
          if (this.commitValue(st.node, st.colId, raw, 'edit', true)) anyChanged = true;
        }
      }
    } finally {
      this.stopping = false;
    }

    for (const st of cells) {
      st.comp.destroy?.();
      if (st.popupEl) {
        st.popupEl.remove();
        st.popupEl = null;
      }
    }

    const rowIndex = node.rowIndex; // current display position of the edited node
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
    // Return DOM focus to the grid cell so keyboard flow continues — unless a
    // reentrant startEditing opened a new editor that should keep focus.
    if (this.cells.length === 0) {
      this.ctx.renderer.focusCellElement({ rowIndex, colId: focusColId, rowPinned: null });
    }
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
    if (node.footer) return false; // total rows are never editable
    if (!column.isEditable()) return false;
    const colDef = column.getColDef();
    const editable = colDef.editable;
    const aggregate = isAggregateTarget(node, column, this.ctx.rowModel.type === 'serverSide');
    if (typeof editable === 'function') {
      return !!editable({
        api: this.ctx.api,
        context: this.ctx.options.get('context'),
        data: node.data,
        node,
        column: column as unknown as IColumn<TData>,
        colDef,
        pivot: aggregate ? (buildPivotCellContext(this.ctx, node, column) ?? undefined) : undefined,
      });
    }
    // Group rows: only aggregate cells (pivot results, value columns, group
    // headers) are editable — commits to them are event-routed, never local.
    if (node.group && node.data == null && !aggregate) return false;
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
      rowIndex: st.node.rowIndex,
      event,
    });
  }

  destroy(): void {
    if (this.isEditing()) this.stopEditing(true);
    this.unsubscribePopupScroll();
    if (typeof document !== 'undefined') {
      document.removeEventListener('mousedown', this.onDocMouseDown);
    }
  }
}
