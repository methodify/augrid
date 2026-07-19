import { describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../test/mockContext';
import { UndoRedoService } from './undoRedo';
import type { GridOptions } from '../types/gridOptions';

interface Row {
  id: number;
  name: string;
  age: number;
}

function setup(options: Partial<GridOptions<Row>> = {}) {
  const { ctx, start } = createMockContext<Row>({
    columnDefs: [{ field: 'name' }, { field: 'age' }],
    rowData: [
      { id: 1, name: 'Alice', age: 30 },
      { id: 2, name: 'Bob', age: 40 },
    ],
    getRowId: (p) => String(p.data.id),
    ...options,
  });
  ctx.undoRedo = new UndoRedoService(ctx);
  start();
  return ctx;
}

const flush = () => Promise.resolve();

describe('UndoRedoService', () => {
  it('round-trips a single edit through undo and redo', async () => {
    const ctx = setup();
    const node = ctx.rowModel.getRowNode('1')!;

    node.setDataValue('name', 'Ann', 'edit');
    await flush();
    expect(ctx.undoRedo!.undoSize()).toBe(1);
    expect(ctx.undoRedo!.redoSize()).toBe(0);

    ctx.undoRedo!.undo();
    expect(node.data!.name).toBe('Alice');
    expect(ctx.undoRedo!.undoSize()).toBe(0);
    expect(ctx.undoRedo!.redoSize()).toBe(1);

    ctx.undoRedo!.redo();
    expect(node.data!.name).toBe('Ann');
    expect(ctx.undoRedo!.undoSize()).toBe(1);
    expect(ctx.undoRedo!.redoSize()).toBe(0);
  });

  it('batches same-microtask changes into one undoable action', async () => {
    const ctx = setup();
    const a = ctx.rowModel.getRowNode('1')!;
    const b = ctx.rowModel.getRowNode('2')!;

    a.setDataValue('name', 'X', 'paste');
    b.setDataValue('name', 'Y', 'paste');
    b.setDataValue('age', 99, 'paste');
    await flush();

    expect(ctx.undoRedo!.undoSize()).toBe(1);
    ctx.undoRedo!.undo();
    expect(a.data!.name).toBe('Alice');
    expect(b.data!.name).toBe('Bob');
    expect(b.data!.age).toBe(40);

    ctx.undoRedo!.redo();
    expect(a.data!.name).toBe('X');
    expect(b.data!.name).toBe('Y');
    expect(b.data!.age).toBe(99);
  });

  it('caps the undo stack at undoRedoCellEditingLimit, dropping oldest', async () => {
    const ctx = setup({ undoRedoCellEditingLimit: 2 });
    const node = ctx.rowModel.getRowNode('1')!;

    node.setDataValue('name', 'B', 'edit');
    await flush();
    node.setDataValue('name', 'C', 'edit');
    await flush();
    node.setDataValue('name', 'D', 'edit');
    await flush();

    expect(ctx.undoRedo!.undoSize()).toBe(2);
    ctx.undoRedo!.undo();
    ctx.undoRedo!.undo();
    expect(node.data!.name).toBe('B'); // oldest action (Alice→B) was dropped
    expect(ctx.undoRedo!.undoSize()).toBe(0);
  });

  it('only records edit/paste/fill/cut sources', async () => {
    const ctx = setup();
    const node = ctx.rowModel.getRowNode('1')!;

    node.setDataValue('name', 'ViaApi', 'api');
    node.setDataValue('age', 31); // default source 'api'
    await flush();
    expect(ctx.undoRedo!.undoSize()).toBe(0);

    node.setDataValue('name', 'ViaFill', 'fill');
    await flush();
    node.setDataValue('name', 'ViaCut', 'cut');
    await flush();
    expect(ctx.undoRedo!.undoSize()).toBe(2);
  });

  it('undo/redo do not re-record themselves and dispatch events', async () => {
    const ctx = setup();
    const undoListener = vi.fn();
    const redoListener = vi.fn();
    ctx.events.addEventListener('undoPerformed', undoListener);
    ctx.events.addEventListener('redoPerformed', redoListener);
    const node = ctx.rowModel.getRowNode('1')!;

    node.setDataValue('name', 'Ann', 'edit');
    await flush();

    ctx.undoRedo!.undo();
    await flush(); // the 'undo'-sourced cellValueChanged must not create a new action
    expect(ctx.undoRedo!.undoSize()).toBe(0);
    expect(undoListener).toHaveBeenCalledTimes(1);
    expect(undoListener.mock.calls[0][0].operation).toBe('undo');

    ctx.undoRedo!.redo();
    await flush();
    expect(ctx.undoRedo!.undoSize()).toBe(1);
    expect(ctx.undoRedo!.redoSize()).toBe(0);
    expect(redoListener).toHaveBeenCalledTimes(1);
    expect(redoListener.mock.calls[0][0].operation).toBe('redo');
  });

  it('a new edit clears the redo stack', async () => {
    const ctx = setup();
    const node = ctx.rowModel.getRowNode('1')!;

    node.setDataValue('name', 'Ann', 'edit');
    await flush();
    ctx.undoRedo!.undo();
    expect(ctx.undoRedo!.redoSize()).toBe(1);

    node.setDataValue('name', 'Zed', 'edit');
    await flush();
    expect(ctx.undoRedo!.redoSize()).toBe(0);
    expect(ctx.undoRedo!.undoSize()).toBe(1);
  });
});
