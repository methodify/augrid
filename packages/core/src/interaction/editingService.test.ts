import { describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../test/mockContext';
import { EditingService } from './editingService';
import { RowNode } from '../rows/rowNode';
import type { GridOptions } from '../types/gridOptions';
import type { CellEditorComp, CellEditorParams, ColDef } from '../types/colDef';

interface Data {
  name: string;
  age: number;
  locked: string;
}

const baseDefs: ColDef<Data>[] = [
  { field: 'name', editable: true },
  { field: 'age', editable: true },
  { field: 'locked' },
];

const baseData: Data[] = [
  { name: 'Ann', age: 30, locked: 'a' },
  { name: 'Bob', age: 40, locked: 'b' },
];

function setup(opts: Partial<GridOptions<Data>> = {}) {
  const { ctx, start } = createMockContext<Data>({
    columnDefs: baseDefs,
    rowData: baseData.map((d) => ({ ...d })),
    ...opts,
  });
  const svc = new EditingService<Data>(ctx);
  ctx.editing = svc;
  start();
  return { ctx, svc };
}

describe('EditingService — editability gates', () => {
  it('refuses non-editable columns and accepts editable ones', () => {
    const { svc } = setup();
    expect(svc.startEditing({ rowIndex: 0, colId: 'locked' })).toBe(false);
    expect(svc.isEditing()).toBe(false);
    expect(svc.startEditing({ rowIndex: 0, colId: 'name' })).toBe(true);
    expect(svc.isEditing()).toBe(true);
    expect(svc.isEditingCell(0, 'name')).toBe(true);
    expect(svc.getEditingCells()).toEqual([{ rowIndex: 0, colId: 'name', rowPinned: null }]);
    svc.destroy();
  });

  it('evaluates editable callbacks per row', () => {
    const editable = vi.fn((p: { data: Data | undefined }) => p.data?.name === 'Ann');
    const { svc } = setup({
      columnDefs: [{ field: 'name', editable: editable as ColDef<Data>['editable'] }],
    });
    expect(svc.startEditing({ rowIndex: 1, colId: 'name' })).toBe(false);
    expect(svc.startEditing({ rowIndex: 0, colId: 'name' })).toBe(true);
    expect(editable).toHaveBeenCalled();
    svc.destroy();
  });

  it('refuses secondary (pivot result) columns', () => {
    const { ctx, svc } = setup();
    const col = ctx.columnModel.getColumn('name')!;
    col.secondary = true;
    expect(svc.startEditing({ rowIndex: 0, colId: 'name' })).toBe(false);
    expect(svc.commitValue(ctx.rowModel.getRow(0)!, 'name', 'X', 'edit')).toBe(false);
    col.secondary = false;
    svc.destroy();
  });

  it('group rows without data are not editable unless the colDef uses a callback', () => {
    const { ctx, svc } = setup({ readOnlyEdit: true });
    const groupNode = new RowNode<Data>(ctx);
    groupNode.group = true; // no data

    // Plain editable: true → refused at the editability gate.
    expect(svc.commitValue(groupNode, 'name', 'X', 'edit')).toBe(false);

    // Function editable that opts in → allowed (readOnlyEdit dispatches request).
    ctx.columnModel.getColumn('age')!.colDef.editable = () => true;
    const requests: unknown[] = [];
    ctx.events.addEventListener('cellEditRequest', (e) => requests.push(e));
    expect(svc.commitValue(groupNode, 'age', 5, 'edit')).toBe(true);
    expect(requests.length).toBe(1);
    svc.destroy();
  });

  it('commitValue refuses non-editable columns and unknown columns', () => {
    const { ctx, svc } = setup();
    const node = ctx.rowModel.getRow(0)!;
    expect(svc.commitValue(node, 'locked', 'zzz', 'paste')).toBe(false);
    expect(node.data!.locked).toBe('a');
    expect(svc.commitValue(node, 'nope', 'zzz', 'paste')).toBe(false);
    svc.destroy();
  });
});

describe('EditingService — editor resolution & mounting', () => {
  it('typing eventKey replaces the cell value in the editor', () => {
    const { svc } = setup();
    svc.startEditing({ rowIndex: 0, colId: 'name', key: 'z' });
    const cellEl = document.createElement('div');
    svc.mountEditorInto(cellEl, 0, 'name');
    const input = cellEl.querySelector('input')!;
    expect(input.value).toBe('z');
    svc.stopEditing(true);
    svc.destroy();
  });

  it('defaults the editor by cellDataType (number → inputmode=decimal)', () => {
    const { svc } = setup();
    svc.startEditing({ rowIndex: 0, colId: 'age' }); // age inferred number
    const cellEl = document.createElement('div');
    svc.mountEditorInto(cellEl, 0, 'age');
    const input = cellEl.querySelector('input')!;
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.value).toBe('30');
    svc.stopEditing(true);
    svc.destroy();
  });

  it('mounts popup editors into .au-editor-popup inside the renderer root', () => {
    const { ctx, svc } = setup({
      columnDefs: [{ field: 'name', editable: true, cellEditor: 'largeText' }],
    });
    svc.startEditing({ rowIndex: 0, colId: 'name' });
    const cellEl = document.createElement('div');
    svc.mountEditorInto(cellEl, 0, 'name');
    expect(cellEl.querySelector('textarea')).toBeNull(); // cell stays empty
    const popup = ctx.renderer.eRoot.querySelector('.au-editor-popup');
    expect(popup).not.toBeNull();
    expect(popup!.querySelector('textarea')!.value).toBe('Ann');
    svc.stopEditing(true);
    expect(ctx.renderer.eRoot.querySelector('.au-editor-popup')).toBeNull();
    svc.destroy();
  });

  it('aborts when isCancelBeforeStart returns true', () => {
    class CancelEditor implements CellEditorComp<Data> {
      private e = document.createElement('input');
      init(): void {}
      getGui(): HTMLElement {
        return this.e;
      }
      getValue(): unknown {
        return this.e.value;
      }
      isCancelBeforeStart(): boolean {
        return true;
      }
    }
    const { svc } = setup({
      columnDefs: [{ field: 'name', editable: true, cellEditor: CancelEditor }],
    });
    expect(svc.startEditing({ rowIndex: 0, colId: 'name' })).toBe(false);
    expect(svc.isEditing()).toBe(false);
    svc.destroy();
  });

  it('uses the framework adapter for framework-marker editors', () => {
    const { ctx, svc } = setup();
    ctx.frameworkAdapter = {
      render: (_c, _p, container) => {
        const i = document.createElement('input');
        i.value = 'fw-value';
        container.appendChild(i);
        return () => {
          container.textContent = '';
        };
      },
      getEditorValue: (container) => container.querySelector('input')!.value,
    };
    ctx.columnModel.getColumn('name')!.colDef.cellEditor = { __frameworkComponent: 'MyEditor' };
    svc.startEditing({ rowIndex: 0, colId: 'name' });
    const cellEl = document.createElement('div');
    svc.mountEditorInto(cellEl, 0, 'name');
    expect(cellEl.querySelector('input')!.value).toBe('fw-value');
    svc.stopEditing(false);
    expect(ctx.rowModel.getRow(0)!.data!.name).toBe('fw-value');
    svc.destroy();
  });
});

describe('EditingService — commit / cancel flow', () => {
  it('commits through valueService with parsing (string "42" → number 42)', () => {
    const { ctx, svc } = setup();
    const changed: { newValue: unknown; source: string }[] = [];
    ctx.events.addEventListener('cellValueChanged', (e) =>
      changed.push({ newValue: e.newValue, source: e.source }),
    );
    svc.startEditing({ rowIndex: 0, colId: 'age' });
    const cellEl = document.createElement('div');
    svc.mountEditorInto(cellEl, 0, 'age');
    cellEl.querySelector('input')!.value = '42';
    const node = ctx.rowModel.getRow(0)!;
    expect(svc.stopEditing(false)).toBe(true);
    expect(node.data!.age).toBe(42);
    expect(changed).toEqual([{ newValue: 42, source: 'edit' }]);
    svc.destroy();
  });

  it('validateEdit rejection blocks the write and fires no cellValueChanged', () => {
    const { ctx, svc } = setup({
      validateEdit: ({ newValue }) => (newValue === 13 ? 'unlucky' : null),
    });
    const changed: unknown[] = [];
    ctx.events.addEventListener('cellValueChanged', (e) => changed.push(e));
    const node = ctx.rowModel.getRow(0)!;
    expect(svc.commitValue(node, 'age', '13', 'edit', true)).toBe(false);
    expect(node.data!.age).toBe(30);
    expect(changed.length).toBe(0);
    // Non-rejected value passes.
    expect(svc.commitValue(node, 'age', '14', 'edit', true)).toBe(true);
    expect(node.data!.age).toBe(14);
    svc.destroy();
  });

  it('readOnlyEdit fires cellEditRequest and never mutates data', () => {
    const { ctx, svc } = setup({ readOnlyEdit: true });
    const requests: { colId: string; newValue: unknown }[] = [];
    ctx.events.addEventListener('cellEditRequest', (e) =>
      requests.push({ colId: e.colId, newValue: e.newValue }),
    );
    svc.startEditing({ rowIndex: 0, colId: 'name' });
    const cellEl = document.createElement('div');
    svc.mountEditorInto(cellEl, 0, 'name');
    cellEl.querySelector('input')!.value = 'Changed';
    svc.stopEditing(false);
    expect(requests).toEqual([{ colId: 'name', newValue: 'Changed' }]);
    expect(ctx.rowModel.getRow(0)!.data!.name).toBe('Ann');
    svc.destroy();
  });

  it('cancel discards the pending value', () => {
    const { ctx, svc } = setup();
    svc.startEditing({ rowIndex: 0, colId: 'name' });
    const cellEl = document.createElement('div');
    svc.mountEditorInto(cellEl, 0, 'name');
    cellEl.querySelector('input')!.value = 'Nope';
    expect(svc.stopEditing(true)).toBe(true);
    expect(ctx.rowModel.getRow(0)!.data!.name).toBe('Ann');
    expect(svc.isEditing()).toBe(false);
    svc.destroy();
  });

  it('starting a different cell commits the previous edit first', () => {
    const { ctx, svc } = setup();
    svc.startEditing({ rowIndex: 0, colId: 'name' });
    const node0 = ctx.rowModel.getRow(0)!;
    const cellEl = document.createElement('div');
    svc.mountEditorInto(cellEl, 0, 'name');
    cellEl.querySelector('input')!.value = 'Zed';
    svc.startEditing({ rowIndex: 1, colId: 'name' });
    expect(node0.data!.name).toBe('Zed');
    expect(svc.isEditingCell(1, 'name')).toBe(true);
    svc.stopEditing(true);
    svc.destroy();
  });

  it('re-starting the same cell returns true without restarting', () => {
    const { ctx, svc } = setup();
    const started: unknown[] = [];
    ctx.events.addEventListener('cellEditingStarted', (e) => started.push(e));
    expect(svc.startEditing({ rowIndex: 0, colId: 'name' })).toBe(true);
    expect(svc.startEditing({ rowIndex: 0, colId: 'name' })).toBe(true);
    expect(started.length).toBe(1);
    svc.stopEditing(true);
    svc.destroy();
  });
});

describe('EditingService — events', () => {
  it('dispatches cellEditingStarted and cellEditingStopped (state cleared before stop)', () => {
    const { ctx, svc } = setup();
    const log: string[] = [];
    ctx.events.addEventListener('cellEditingStarted', (e) => log.push(`start:${e.colId}:${e.value}`));
    ctx.events.addEventListener('cellEditingStopped', (e) => {
      log.push(`stop:${e.colId}`);
      expect(svc.isEditing()).toBe(false); // state cleared before dispatch
    });
    svc.startEditing({ rowIndex: 0, colId: 'name' });
    svc.stopEditing(true);
    expect(log).toEqual(['start:name:Ann', 'stop:name']);
    svc.destroy();
  });

  it('fullRow mode edits every editable cell of the row and fires row events', () => {
    const { ctx, svc } = setup({ editType: 'fullRow' });
    const rowEvents: string[] = [];
    ctx.events.addEventListener('rowEditingStarted', () => rowEvents.push('rowStart'));
    ctx.events.addEventListener('rowEditingStopped', () => rowEvents.push('rowStop'));
    ctx.events.addEventListener('rowValueChanged', () => rowEvents.push('rowChanged'));

    expect(svc.startEditing({ rowIndex: 0, colId: 'age' })).toBe(true);
    const cells = svc.getEditingCells();
    expect(cells.map((c) => c.colId).sort()).toEqual(['age', 'name']); // 'locked' excluded
    expect(svc.isEditingCell(0, 'locked')).toBe(false);

    const nameEl = document.createElement('div');
    const ageEl = document.createElement('div');
    svc.mountEditorInto(nameEl, 0, 'name');
    svc.mountEditorInto(ageEl, 0, 'age');
    nameEl.querySelector('input')!.value = 'Annie';
    ageEl.querySelector('input')!.value = '31';

    const node = ctx.rowModel.getRow(0)!;
    expect(svc.stopEditing(false)).toBe(true);
    expect(node.data!.name).toBe('Annie');
    expect(node.data!.age).toBe(31);
    expect(rowEvents).toEqual(['rowStart', 'rowStop', 'rowChanged']);
    svc.destroy();
  });

  it('fullRow without changes fires rowEditingStopped but no rowValueChanged', () => {
    const { ctx, svc } = setup({ editType: 'fullRow' });
    const rowEvents: string[] = [];
    ctx.events.addEventListener('rowEditingStopped', () => rowEvents.push('rowStop'));
    ctx.events.addEventListener('rowValueChanged', () => rowEvents.push('rowChanged'));
    svc.startEditing({ rowIndex: 0, colId: 'name' });
    svc.stopEditing(false); // untouched editors commit identical values → no change
    expect(rowEvents).toEqual(['rowStop']);
    svc.destroy();
  });
});

describe('EditingService — stopEditingWhenCellsLoseFocus', () => {
  it('a mousedown outside the grid root commits the edit', () => {
    const { ctx, svc } = setup();
    svc.startEditing({ rowIndex: 0, colId: 'name' });
    const cellEl = document.createElement('div');
    svc.mountEditorInto(cellEl, 0, 'name');
    cellEl.querySelector('input')!.value = 'Committed';
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(svc.isEditing()).toBe(false);
    expect(ctx.rowModel.getRow(0)!.data!.name).toBe('Committed');
    svc.destroy();
  });

  it('a mousedown inside the grid root does not stop the edit', () => {
    const { ctx, svc } = setup();
    document.body.appendChild(ctx.renderer.eRoot);
    const inner = document.createElement('div');
    ctx.renderer.eRoot.appendChild(inner);
    svc.startEditing({ rowIndex: 0, colId: 'name' });
    inner.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(svc.isEditing()).toBe(true);
    svc.stopEditing(true);
    svc.destroy();
    ctx.renderer.eRoot.remove();
  });

  it('is disabled when stopEditingWhenCellsLoseFocus is false', () => {
    const { svc } = setup({ stopEditingWhenCellsLoseFocus: false });
    svc.startEditing({ rowIndex: 0, colId: 'name' });
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(svc.isEditing()).toBe(true);
    svc.stopEditing(true);
    svc.destroy();
  });

  it('destroy removes the document listener and cancels open edits', () => {
    const { ctx, svc } = setup();
    svc.startEditing({ rowIndex: 0, colId: 'name' });
    svc.destroy();
    expect(svc.isEditing()).toBe(false);
    expect(ctx.rowModel.getRow(0)!.data!.name).toBe('Ann'); // destroy cancels, no commit
  });
});
