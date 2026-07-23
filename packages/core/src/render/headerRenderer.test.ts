import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../test/mockContext.js';
import { HeaderRenderer } from './headerRenderer.js';
import type { GridOptions } from '../types/gridOptions.js';
import type { Column } from '../columns/column.js';

interface Row {
  id: string;
  a: string;
  b: number;
  c: string;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.restoreAllMocks();
});

function makeEls() {
  const d = () => document.createElement('div');
  const els = {
    header: d(),
    headerLeft: d(),
    headerCenterVp: d(),
    headerCenter: d(),
    headerRight: d(),
    floating: d(),
    floatingLeft: d(),
    floatingCenterVp: d(),
    floatingCenter: d(),
    floatingRight: d(),
  };
  els.headerCenterVp.appendChild(els.headerCenter);
  els.header.append(els.headerLeft, els.headerCenterVp, els.headerRight);
  els.floatingCenterVp.appendChild(els.floatingCenter);
  els.floating.append(els.floatingLeft, els.floatingCenterVp, els.floatingRight);
  document.body.append(els.header, els.floating);
  return els;
}

function setup(options: GridOptions<Row> = {}) {
  const { ctx } = createMockContext<Row>(options);
  const els = makeEls();
  const hr = new HeaderRenderer<Row>(ctx, els);
  cleanups.push(() => {
    hr.destroy();
    els.header.remove();
    els.floating.remove();
  });
  return { ctx, els, hr };
}

describe('HeaderRenderer — ARIA structure (C21/C23)', () => {
  it('wraps each header level in a role=row element with aria-rowindex; containers are presentation', () => {
    const { els, hr } = setup({
      columnDefs: [
        { headerName: 'G', children: [{ field: 'a' }, { field: 'b' }] },
        { field: 'c' },
      ],
    });
    hr.refresh();

    for (const container of [els.header, els.headerLeft, els.headerCenterVp, els.headerCenter, els.headerRight]) {
      expect(container.getAttribute('role')).toBe('presentation');
    }

    const rows = [...els.headerCenter.children] as HTMLElement[];
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.getAttribute('role')).toBe('row');
    expect(rows[0].getAttribute('aria-rowindex')).toBe('1');
    expect(rows[1].getAttribute('aria-rowindex')).toBe('2');
    expect(rows[0].style.top).toBe('0px');
    expect(rows[1].style.top).toBe('36px');
    expect(rows[0].style.height).toBe('36px');

    // group cell lives in the level-0 row, spanning one level
    const group = rows[0].querySelector('.au-header-group-cell') as HTMLElement;
    expect(group).toBeTruthy();
    expect(group.style.height).toBe('36px');
    expect(group.style.top).toBe('0px');

    // ungrouped leaf 'c' starts at level 0 and spans both levels (in its STARTING level's row)
    const cellC = rows[0].querySelector('[data-au-header-col="c"]') as HTMLElement;
    expect(cellC).toBeTruthy();
    expect(cellC.style.top).toBe('0px');
    expect(cellC.style.height).toBe('72px');

    // grouped leaves live in the level-1 row with single-level height
    const cellA = rows[1].querySelector('[data-au-header-col="a"]') as HTMLElement;
    const cellB = rows[1].querySelector('[data-au-header-col="b"]') as HTMLElement;
    expect(cellA).toBeTruthy();
    expect(cellB).toBeTruthy();
    expect(cellA.style.height).toBe('36px');
  });

  it('sets aria-colindex on leaf header cells matching displayed order (1-based, across regions)', () => {
    const { els, hr } = setup({
      columnDefs: [{ field: 'a' }, { field: 'b', pinned: 'left' }, { field: 'c' }],
    });
    hr.refresh();
    // displayed order: pinned-left b, then center a, c
    const cellB = els.header.querySelector('[data-au-header-col="b"]')!;
    const cellA = els.header.querySelector('[data-au-header-col="a"]')!;
    const cellC = els.header.querySelector('[data-au-header-col="c"]')!;
    expect(cellB.getAttribute('aria-colindex')).toBe('1');
    expect(cellA.getAttribute('aria-colindex')).toBe('2');
    expect(cellC.getAttribute('aria-colindex')).toBe('3');
    // pinned region also got its own role=row wrapper
    const leftRow = els.headerLeft.querySelector('[role="row"]');
    expect(leftRow).toBeTruthy();
    expect(leftRow!.contains(cellB)).toBe(true);
  });
});

describe('HeaderRenderer — floating-filter cleanups (C18)', () => {
  it('runs every stored cleanup on each refresh and on destroy', () => {
    const { ctx, hr } = setup({
      floatingFilter: true,
      columnDefs: [
        { field: 'a', filter: 'text' },
        { field: 'b', filter: 'number' },
      ],
    });
    const spies: ReturnType<typeof vi.fn>[] = [];
    ctx.filters.mountFloatingFilter = vi.fn(() => {
      const s = vi.fn();
      spies.push(s);
      return s;
    });

    hr.refresh();
    expect(ctx.filters.mountFloatingFilter).toHaveBeenCalledTimes(2);
    expect(spies).toHaveLength(2);
    expect(spies[0]).not.toHaveBeenCalled();
    expect(spies[1]).not.toHaveBeenCalled();

    // second refresh: BOTH previous cleanups run before remounting
    hr.refresh();
    expect(spies[0]).toHaveBeenCalledTimes(1);
    expect(spies[1]).toHaveBeenCalledTimes(1);
    expect(ctx.filters.mountFloatingFilter).toHaveBeenCalledTimes(4);
    expect(spies).toHaveLength(4);

    // destroy: the current mounts are cleaned up too, older ones not re-run
    hr.destroy();
    expect(spies[0]).toHaveBeenCalledTimes(1);
    expect(spies[1]).toHaveBeenCalledTimes(1);
    expect(spies[2]).toHaveBeenCalledTimes(1);
    expect(spies[3]).toHaveBeenCalledTimes(1);
  });
});

describe('HeaderRenderer — sort indicator signature skip (C38)', () => {
  it('performs no DOM writes when the sort model is unchanged, updates when it changes', () => {
    const { ctx, els, hr } = setup({ columnDefs: [{ field: 'a' }, { field: 'b' }] });
    ctx.columnModel.getColumn('a')!.sort = 'asc';
    hr.refresh();

    const cellA = els.header.querySelector('[data-au-header-col="a"]') as HTMLElement;
    expect(cellA.getAttribute('aria-sort')).toBe('ascending');
    expect(cellA.querySelector('.au-sort-indicator')!.textContent).toBe('↑');

    // second per-frame-style call with unchanged model: zero DOM writes
    const spy = vi.spyOn(Element.prototype, 'setAttribute');
    hr.updateSortIndicators();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();

    // model change invalidates the signature and re-applies
    ctx.columnModel.getColumn('a')!.sort = 'desc';
    hr.updateSortIndicators();
    expect(cellA.getAttribute('aria-sort')).toBe('descending');
    expect(cellA.querySelector('.au-sort-indicator')!.textContent).toBe('↓');
  });

  it('re-applies indicators after refresh() even with unchanged model (fresh DOM)', () => {
    const { ctx, els, hr } = setup({ columnDefs: [{ field: 'a' }] });
    ctx.columnModel.getColumn('a')!.sort = 'asc';
    hr.refresh();
    hr.refresh(); // rebuilds DOM; signature cache must be reset
    const cellA = els.header.querySelector('[data-au-header-col="a"]') as HTMLElement;
    expect(cellA.getAttribute('aria-sort')).toBe('ascending');
  });
});

describe('HeaderRenderer — header checkbox (C24 + C38)', () => {
  it('gets tabindex=-1 and an aria-label, and skips writes when state is unchanged', () => {
    const { ctx, els, hr } = setup({
      columnDefs: [{ field: 'a' }],
      rowSelection: 'multiRow',
    });
    ctx.selection.getHeaderState = vi.fn(() => true);
    hr.refresh();

    const cb = els.header.querySelector('[data-au-header-checkbox]') as HTMLInputElement;
    expect(cb).toBeTruthy();
    expect(cb.getAttribute('tabindex')).toBe('-1');
    expect(cb.getAttribute('aria-label')).toBe('Select all rows');
    expect(cb.checked).toBe(true);

    // unchanged state → no write (externally clobbered value stays clobbered)
    cb.checked = false;
    hr.updateHeaderCheckbox();
    expect(cb.checked).toBe(false);

    // changed state → write happens
    ctx.selection.getHeaderState = vi.fn(() => 'indeterminate' as const);
    hr.updateHeaderCheckbox();
    expect(cb.indeterminate).toBe(true);
    expect(cb.checked).toBe(false);
  });
});

describe('HeaderRenderer — delegated keyboard support (C20)', () => {
  function keydown(target: HTMLElement, key: string, shiftKey = false): boolean {
    return target.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
    );
  }

  it('makes sortable header cells focusable (tabindex=0) and others tabindex=-1', () => {
    const { els, hr } = setup({
      columnDefs: [{ field: 'a' }, { field: 'b', sortable: false }],
    });
    hr.refresh();
    const cellA = els.header.querySelector('[data-au-header-col="a"]') as HTMLElement;
    const cellB = els.header.querySelector('[data-au-header-col="b"]') as HTMLElement;
    expect(cellA.getAttribute('tabindex')).toBe('0');
    expect(cellB.getAttribute('tabindex')).toBe('-1');
  });

  it('Enter and Space on a sortable header cell trigger progressSort and preventDefault', () => {
    const { ctx, els, hr } = setup({ columnDefs: [{ field: 'a' }, { field: 'b' }] });
    const progressSort = vi.fn();
    ctx.sort.progressSort = progressSort;
    hr.refresh();

    const cellA = els.header.querySelector('[data-au-header-col="a"]') as HTMLElement;
    const colA = ctx.columnModel.getColumn('a') as Column<Row>;

    const notCancelled = keydown(cellA, 'Enter');
    expect(notCancelled).toBe(false); // preventDefault was called
    expect(progressSort).toHaveBeenCalledTimes(1);
    expect(progressSort).toHaveBeenLastCalledWith(colA, false, 'header');

    keydown(cellA, ' ', true);
    expect(progressSort).toHaveBeenCalledTimes(2);
    expect(progressSort).toHaveBeenLastCalledWith(colA, true, 'header');
  });

  it('does not sort on Enter over a non-sortable cell', () => {
    const { ctx, els, hr } = setup({
      columnDefs: [{ field: 'a', sortable: false }],
    });
    const progressSort = vi.fn();
    ctx.sort.progressSort = progressSort;
    hr.refresh();
    const cellA = els.header.querySelector('[data-au-header-col="a"]') as HTMLElement;
    const notCancelled = keydown(cellA, 'Enter');
    expect(notCancelled).toBe(true); // no preventDefault
    expect(progressSort).not.toHaveBeenCalled();
  });

  it('ArrowLeft/ArrowRight move focus between header cells', () => {
    const { els, hr } = setup({ columnDefs: [{ field: 'a' }, { field: 'b' }, { field: 'c' }] });
    hr.refresh();
    const cellA = els.header.querySelector('[data-au-header-col="a"]') as HTMLElement;
    const cellB = els.header.querySelector('[data-au-header-col="b"]') as HTMLElement;

    cellA.focus();
    expect(document.activeElement).toBe(cellA);
    keydown(cellA, 'ArrowRight');
    expect(document.activeElement).toBe(cellB);
    keydown(cellB, 'ArrowLeft');
    expect(document.activeElement).toBe(cellA);
    // at the first cell, ArrowLeft is a no-op and not swallowed
    const notCancelled = keydown(cellA, 'ArrowLeft');
    expect(document.activeElement).toBe(cellA);
    expect(notCancelled).toBe(true);
  });

  it('stops handling after destroy (listener removed)', () => {
    const { ctx, els, hr } = setup({ columnDefs: [{ field: 'a' }] });
    const progressSort = vi.fn();
    ctx.sort.progressSort = progressSort;
    hr.refresh();
    const cellA = els.header.querySelector('[data-au-header-col="a"]') as HTMLElement;
    hr.destroy();
    keydown(cellA, 'Enter');
    expect(progressSort).not.toHaveBeenCalled();
  });
});

describe('HeaderRenderer — getHeaderCellMap (C17)', () => {
  it('maps colId → leaf header cell in displayed order and rebuilds on refresh', () => {
    const { els, hr } = setup({
      columnDefs: [{ field: 'a' }, { field: 'b', pinned: 'left' }, { field: 'c' }],
    });
    hr.refresh();
    const map = hr.getHeaderCellMap();
    expect([...map.keys()]).toEqual(['b', 'a', 'c']); // pinned-left first, then center
    for (const [colId, cell] of map) {
      expect(cell.getAttribute('data-au-header-col')).toBe(colId);
      expect(els.header.contains(cell)).toBe(true);
    }

    const oldCellA = map.get('a')!;
    hr.refresh();
    const map2 = hr.getHeaderCellMap();
    expect([...map2.keys()]).toEqual(['b', 'a', 'c']);
    expect(map2.get('a')).not.toBe(oldCellA); // fresh elements after rebuild
    expect(els.header.contains(map2.get('a')!)).toBe(true);
  });
});
