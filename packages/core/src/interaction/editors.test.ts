import { describe, expect, it } from 'vitest';
import {
  CheckboxCellEditor,
  DateCellEditor,
  LargeTextCellEditor,
  NumberCellEditor,
  PROVIDED_EDITORS,
  SelectCellEditor,
  TextCellEditor,
} from './editors';
import type { CellEditorParams } from '../types/colDef';

function makeParams(overrides: Partial<CellEditorParams> = {}): CellEditorParams {
  return {
    api: {} as never,
    context: undefined,
    data: undefined,
    node: {} as never,
    column: {} as never,
    colDef: {},
    value: null,
    eventKey: null,
    stopEditing: () => {},
    colParams: undefined,
    ...overrides,
  };
}

describe('TextCellEditor', () => {
  it('round-trips the initial value as a string', () => {
    const ed = new TextCellEditor();
    ed.init(makeParams({ value: 'hello' }));
    const gui = ed.getGui() as HTMLInputElement;
    expect(gui.tagName).toBe('INPUT');
    expect(gui.type).toBe('text');
    expect(ed.getValue()).toBe('hello');
  });

  it('stringifies non-string values and blanks null/undefined', () => {
    const ed = new TextCellEditor();
    ed.init(makeParams({ value: 42 }));
    expect(ed.getValue()).toBe('42');
    const ed2 = new TextCellEditor();
    ed2.init(makeParams({ value: null }));
    expect(ed2.getValue()).toBe('');
  });

  it('eventKey replaces the content when edit started by typing', () => {
    const ed = new TextCellEditor();
    ed.init(makeParams({ value: 'hello', eventKey: 'x' }));
    expect(ed.getValue()).toBe('x');
  });

  it('afterGuiAttached focuses and selects the text', () => {
    const ed = new TextCellEditor();
    ed.init(makeParams({ value: 'hello' }));
    const gui = ed.getGui() as HTMLInputElement;
    document.body.appendChild(gui);
    ed.afterGuiAttached();
    expect(document.activeElement).toBe(gui);
    expect(gui.selectionStart).toBe(0);
    expect(gui.selectionEnd).toBe(5);
    gui.remove();
  });

  it('afterGuiAttached puts the caret at the end when started by typing', () => {
    const ed = new TextCellEditor();
    ed.init(makeParams({ value: 'hello', eventKey: 'x' }));
    const gui = ed.getGui() as HTMLInputElement;
    document.body.appendChild(gui);
    ed.afterGuiAttached();
    expect(gui.selectionStart).toBe(1);
    expect(gui.selectionEnd).toBe(1);
    gui.remove();
  });
});

describe('NumberCellEditor', () => {
  it('uses inputmode=decimal and returns the raw string', () => {
    const ed = new NumberCellEditor();
    ed.init(makeParams({ value: 42 }));
    const gui = ed.getGui() as HTMLInputElement;
    expect(gui.getAttribute('inputmode')).toBe('decimal');
    expect(ed.getValue()).toBe('42');
    gui.value = '13.5';
    expect(ed.getValue()).toBe('13.5'); // parsing happens later via valueService
  });
});

describe('DateCellEditor', () => {
  it('initialises from a Date and returns yyyy-mm-dd', () => {
    const ed = new DateCellEditor();
    ed.init(makeParams({ value: new Date(2024, 0, 15) }));
    const gui = ed.getGui() as HTMLInputElement;
    expect(gui.type).toBe('date');
    expect(ed.getValue()).toBe('2024-01-15');
  });

  it('initialises from an ISO string', () => {
    const ed = new DateCellEditor();
    ed.init(makeParams({ value: '2024-03-05T10:30:00' }));
    expect(ed.getValue()).toBe('2024-03-05');
  });

  it('returns null when cleared / no initial value', () => {
    const ed = new DateCellEditor();
    ed.init(makeParams({ value: null }));
    expect(ed.getValue()).toBeNull();
  });
});

describe('SelectCellEditor', () => {
  it('builds options from colParams.values and preselects the current value', () => {
    const ed = new SelectCellEditor();
    ed.init(makeParams({ value: 'b', colParams: { values: ['a', 'b', 'c'] } }));
    const gui = ed.getGui() as HTMLSelectElement;
    expect(gui.tagName).toBe('SELECT');
    expect(gui.options.length).toBe(3);
    expect(ed.getValue()).toBe('b');
    gui.value = 'c';
    expect(ed.getValue()).toBe('c');
  });

  it('tolerates missing colParams', () => {
    const ed = new SelectCellEditor();
    ed.init(makeParams({ value: 'x' }));
    expect((ed.getGui() as HTMLSelectElement).options.length).toBe(0);
  });
});

describe('CheckboxCellEditor', () => {
  it('round-trips a boolean and is not a popup', () => {
    const ed = new CheckboxCellEditor();
    ed.init(makeParams({ value: true }));
    const gui = ed.getGui() as HTMLInputElement;
    expect(gui.type).toBe('checkbox');
    expect(ed.getValue()).toBe(true);
    gui.checked = false;
    expect(ed.getValue()).toBe(false);
    expect(ed.isPopup()).toBe(false);
  });

  it('treats "true" string as checked', () => {
    const ed = new CheckboxCellEditor();
    ed.init(makeParams({ value: 'true' }));
    expect(ed.getValue()).toBe(true);
  });
});

describe('LargeTextCellEditor', () => {
  it('is a 4-row textarea popup with value round-trip', () => {
    const ed = new LargeTextCellEditor();
    ed.init(makeParams({ value: 'long text' }));
    const gui = ed.getGui() as HTMLTextAreaElement;
    expect(gui.tagName).toBe('TEXTAREA');
    expect(gui.rows).toBe(4);
    expect(ed.isPopup()).toBe(true);
    expect(ed.getValue()).toBe('long text');
    gui.value = 'edited';
    expect(ed.getValue()).toBe('edited');
  });
});

describe('PROVIDED_EDITORS', () => {
  it('registers all six provided editors', () => {
    expect(new PROVIDED_EDITORS.text()).toBeInstanceOf(TextCellEditor);
    expect(new PROVIDED_EDITORS.number()).toBeInstanceOf(NumberCellEditor);
    expect(new PROVIDED_EDITORS.date()).toBeInstanceOf(DateCellEditor);
    expect(new PROVIDED_EDITORS.select()).toBeInstanceOf(SelectCellEditor);
    expect(new PROVIDED_EDITORS.checkbox()).toBeInstanceOf(CheckboxCellEditor);
    expect(new PROVIDED_EDITORS.largeText()).toBeInstanceOf(LargeTextCellEditor);
  });
});
