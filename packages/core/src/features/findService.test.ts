import { describe, expect, it } from 'vitest';
import { createMockContext } from '../test/mockContext';
import { FindService } from './findService';
import { Grid } from '../grid';
import type { ColDef } from '../types/colDef';
import type { FindChangedEvent } from '../types/events';

interface Row {
  id: number;
  name: string;
  qty: number;
}

const ROWS: Row[] = [
  { id: 0, name: 'Alpha', qty: 10 },
  { id: 1, name: 'Beta', qty: 20 },
  { id: 2, name: 'alphabet', qty: 30 },
  { id: 3, name: 'Gamma', qty: 105 },
];

function setup(columnDefs?: ColDef<Row>[]) {
  const { ctx, start } = createMockContext<Row>({
    columnDefs: columnDefs ?? [{ field: 'name' }, { field: 'qty' }],
    rowData: ROWS,
    getRowId: (p) => String(p.data.id),
  });
  const find = new FindService(ctx);
  ctx.find = find;
  start();
  return { ctx, find };
}

describe('FindService', () => {
  it('matches case-insensitively across all displayed cells', () => {
    const { find } = setup();
    find.setText('alpha');
    expect(find.getMatchCount()).toBe(2); // Alpha + alphabet
    expect(find.getActiveIndex()).toBe(-1);
    // '10' appears in qty 10 and 105
    find.setText('10');
    expect(find.getMatchCount()).toBe(2);
  });

  it('searches formatted values, not raw', () => {
    const { find } = setup([
      { field: 'name' },
      { field: 'qty', valueFormatter: (p) => `$${String(p.value)}.00` },
    ]);
    find.setText('$20');
    expect(find.getMatchCount()).toBe(1);
  });

  it('next/previous wrap and report cell states', () => {
    const { find } = setup();
    find.setText('a'); // Alpha, Beta, alphabet, Gamma names all contain 'a'
    const total = find.getMatchCount();
    expect(total).toBe(4);
    find.next();
    expect(find.getActiveIndex()).toBe(0);
    expect(find.getCellState(0, 'name')).toBe(2); // active
    expect(find.getCellState(1, 'name')).toBe(1); // plain match
    expect(find.getCellState(0, 'qty')).toBe(0);
    find.previous(); // wraps to last
    expect(find.getActiveIndex()).toBe(total - 1);
    find.next(); // wraps to first
    expect(find.getActiveIndex()).toBe(0);
  });

  it('recomputes on model updates and clamps the active match', () => {
    const { ctx, find } = setup();
    find.setText('alpha');
    find.next();
    expect(find.getMatchCount()).toBe(2);
    ctx.rowModel.applyTransaction?.({ remove: [ROWS[2]!] });
    expect(find.getMatchCount()).toBe(1);
    expect(find.getActiveIndex()).toBeLessThan(1);
  });

  it('clear resets everything and fires findChanged', () => {
    const { ctx, find } = setup();
    const events: FindChangedEvent<Row>[] = [];
    ctx.events.addEventListener('findChanged', (e) => events.push(e));
    find.setText('beta');
    expect(events[events.length - 1]!.totalMatches).toBe(1);
    find.clear();
    expect(find.isActive()).toBe(false);
    expect(find.getMatchCount()).toBe(0);
    expect(events[events.length - 1]!.text).toBe('');
  });
});

describe('find-in-grid (DOM)', () => {
  it('highlights matches and the active match; api drives it', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new Grid<Row>(host, {
      columnDefs: [{ field: 'name' }, { field: 'qty' }],
      rowData: ROWS,
      getRowId: (p) => String(p.data.id),
    });
    grid.getContext().renderer.setViewportSizeForTesting(800, 300);
    grid.getContext().renderer.renderNow();

    grid.api.setFindText('alpha');
    grid.getContext().renderer.renderNow();
    expect(host.querySelectorAll('.au-find-match').length).toBe(2);
    expect(host.querySelectorAll('.au-find-active').length).toBe(0);

    grid.api.findNext();
    grid.getContext().renderer.renderNow();
    expect(host.querySelectorAll('.au-find-active').length).toBe(1);
    expect(grid.api.getFindState()).toEqual({ text: 'alpha', totalMatches: 2, activeIndex: 0 });

    grid.api.clearFind();
    grid.getContext().renderer.renderNow();
    expect(host.querySelectorAll('.au-find-match').length).toBe(0);
    grid.destroy();
  });
});
