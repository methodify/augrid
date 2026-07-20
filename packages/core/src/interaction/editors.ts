import type { CellEditorComp, CellEditorParams, ProvidedCellEditor } from '../types/colDef';

/**
 * Provided cell editors. All are plain DOM components with no event listeners:
 * Enter/Escape/Tab bubble up to the grid root where the focus service handles
 * commit/cancel/navigation — editors never call stopPropagation.
 */

function toEditString(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

/** True when the edit was initiated by typing a printable key. */
function startedByTyping(params: CellEditorParams<unknown>): boolean {
  return params.eventKey != null && params.eventKey.length === 1;
}

/* ------------------------------------------------------------------- text */

export class TextCellEditor<TData = unknown> implements CellEditorComp<TData> {
  protected eInput!: HTMLInputElement;
  protected startedByKey = false;

  init(params: CellEditorParams<TData>): void {
    this.eInput = document.createElement('input');
    this.eInput.type = 'text';
    this.eInput.className = 'au-editor-input';
    if (startedByTyping(params as CellEditorParams<unknown>)) {
      // Edit started by typing: the key replaces the current content.
      this.startedByKey = true;
      this.eInput.value = params.eventKey as string;
    } else {
      this.eInput.value = toEditString(params.value);
    }
  }

  getGui(): HTMLElement {
    return this.eInput;
  }

  getValue(): unknown {
    return this.eInput.value;
  }

  afterGuiAttached(): void {
    this.eInput.focus();
    if (this.startedByKey) {
      // Caret at end so further typing appends.
      const len = this.eInput.value.length;
      this.eInput.setSelectionRange(len, len);
    } else {
      this.eInput.select();
    }
  }

  focusIn(): void {
    this.eInput.focus();
  }
}

/* ----------------------------------------------------------------- number */

/**
 * Numeric editor. getValue returns the raw string — parsing to number happens
 * downstream via valueService.parseValue in the commit funnel.
 */
export class NumberCellEditor<TData = unknown> extends TextCellEditor<TData> {
  override init(params: CellEditorParams<TData>): void {
    super.init(params);
    this.eInput.setAttribute('inputmode', 'decimal');
  }
}

/* ------------------------------------------------------------------- date */

export class DateCellEditor<TData = unknown> implements CellEditorComp<TData> {
  private eInput!: HTMLInputElement;
  /** 'yyyy-mm-dd' the editor started from ('' when no valid initial value). */
  private initialValue = '';

  init(params: CellEditorParams<TData>): void {
    this.eInput = document.createElement('input');
    this.eInput.type = 'date';
    this.eInput.className = 'au-editor-input';
    const v = params.value;
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      // Format with UTC accessors: 'yyyy-mm-dd' strings are UTC-parsed on
      // commit, so local-time formatting would shift the date a day back in
      // negative-offset timezones.
      this.initialValue = v.toISOString().slice(0, 10);
    } else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      this.initialValue = v.slice(0, 10);
    }
    this.eInput.value = this.initialValue;
  }

  getGui(): HTMLElement {
    return this.eInput;
  }

  /** Returns the 'yyyy-mm-dd' string (null when cleared). */
  getValue(): unknown {
    return this.eInput.value === '' ? null : this.eInput.value;
  }

  /** No-op edit (unchanged yyyy-mm-dd) must not commit / fire cellValueChanged. */
  isCancelAfterEnd(): boolean {
    return this.eInput.value === this.initialValue;
  }

  afterGuiAttached(): void {
    this.eInput.focus();
  }

  focusIn(): void {
    this.eInput.focus();
  }
}

/* ----------------------------------------------------------------- select */

export class SelectCellEditor<TData = unknown> implements CellEditorComp<TData> {
  private eSelect!: HTMLSelectElement;

  init(params: CellEditorParams<TData>): void {
    this.eSelect = document.createElement('select');
    this.eSelect.className = 'au-editor-select';
    const values = (params.colParams as { values?: unknown[] } | undefined)?.values ?? [];
    const current = toEditString(params.value);
    for (const v of values) {
      const opt = document.createElement('option');
      const s = toEditString(v);
      opt.value = s;
      opt.textContent = s;
      if (s === current) opt.selected = true;
      this.eSelect.appendChild(opt);
    }
  }

  getGui(): HTMLElement {
    return this.eSelect;
  }

  getValue(): unknown {
    return this.eSelect.value;
  }

  afterGuiAttached(): void {
    // Enter bubbles to the grid root and commits — no listener here.
    this.eSelect.focus();
  }

  focusIn(): void {
    this.eSelect.focus();
  }
}

/* --------------------------------------------------------------- checkbox */

export class CheckboxCellEditor<TData = unknown> implements CellEditorComp<TData> {
  private eInput!: HTMLInputElement;

  init(params: CellEditorParams<TData>): void {
    this.eInput = document.createElement('input');
    this.eInput.type = 'checkbox';
    this.eInput.className = 'au-editor-checkbox';
    const v = params.value;
    this.eInput.checked = v === true || v === 'true' || v === 1;
  }

  getGui(): HTMLElement {
    return this.eInput;
  }

  getValue(): unknown {
    return this.eInput.checked;
  }

  isPopup(): boolean {
    return false;
  }

  afterGuiAttached(): void {
    this.eInput.focus();
  }

  focusIn(): void {
    this.eInput.focus();
  }
}

/* ------------------------------------------------------------- large text */

export class LargeTextCellEditor<TData = unknown> implements CellEditorComp<TData> {
  private eTextarea!: HTMLTextAreaElement;
  private startedByKey = false;

  init(params: CellEditorParams<TData>): void {
    this.eTextarea = document.createElement('textarea');
    this.eTextarea.className = 'au-editor-textarea';
    this.eTextarea.rows = 4;
    if (startedByTyping(params as CellEditorParams<unknown>)) {
      this.startedByKey = true;
      this.eTextarea.value = params.eventKey as string;
    } else {
      this.eTextarea.value = toEditString(params.value);
    }
  }

  getGui(): HTMLElement {
    return this.eTextarea;
  }

  getValue(): unknown {
    return this.eTextarea.value;
  }

  isPopup(): boolean {
    return true;
  }

  afterGuiAttached(): void {
    this.eTextarea.focus();
    if (this.startedByKey) {
      const len = this.eTextarea.value.length;
      this.eTextarea.setSelectionRange(len, len);
    } else {
      this.eTextarea.select();
    }
  }

  focusIn(): void {
    this.eTextarea.focus();
  }
}

/* ---------------------------------------------------------------- registry */

export const PROVIDED_EDITORS: Record<ProvidedCellEditor, new () => CellEditorComp<unknown>> = {
  text: TextCellEditor,
  number: NumberCellEditor,
  date: DateCellEditor,
  select: SelectCellEditor,
  checkbox: CheckboxCellEditor,
  largeText: LargeTextCellEditor,
};
