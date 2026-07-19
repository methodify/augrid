import { describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../test/mockContext';
import { PaginationService } from './pagination';
import type { GridOptions } from '../types/gridOptions';
import type { PaginationChangedEvent } from '../types/events';

interface Row {
  id: number;
}

function setup(options: Partial<GridOptions<Row>> = {}, rowCount = 25) {
  const rowData: Row[] = Array.from({ length: rowCount }, (_, id) => ({ id }));
  const { ctx, start } = createMockContext<Row>({
    columnDefs: [{ field: 'id' }],
    rowData,
    pagination: true,
    paginationPageSize: 10,
    ...options,
  });
  ctx.pagination = new PaginationService(ctx);
  start();
  return ctx;
}

describe('PaginationService', () => {
  it('applies the page window to the row model', () => {
    const ctx = setup();
    expect(ctx.rowModel.getRowCount()).toBe(10);
    expect(ctx.rowModel.getRow(0)!.data!.id).toBe(0);
    expect(ctx.rowModel.getRow(9)!.data!.id).toBe(9);

    ctx.pagination!.goToPage(1);
    expect(ctx.rowModel.getRowCount()).toBe(10);
    expect(ctx.rowModel.getRow(0)!.data!.id).toBe(10);

    ctx.pagination!.goToPage(2); // last, partial page
    expect(ctx.rowModel.getRowCount()).toBe(5);
    expect(ctx.rowModel.getRow(0)!.data!.id).toBe(20);
    expect(ctx.pagination!.getTotalPages()).toBe(3);
  });

  it('clamps out-of-range page requests', () => {
    const ctx = setup();
    ctx.pagination!.goToPage(99);
    expect(ctx.pagination!.getCurrentPage()).toBe(2);
    ctx.pagination!.goToPage(-5);
    expect(ctx.pagination!.getCurrentPage()).toBe(0);
    expect(ctx.rowModel.getRow(0)!.data!.id).toBe(0);
  });

  it('changes page size, recomputes pages, and re-clamps the page', () => {
    const ctx = setup();
    ctx.pagination!.goToPage(2);
    ctx.pagination!.setPageSize(20);
    expect(ctx.pagination!.getPageSize()).toBe(20);
    expect(ctx.pagination!.getTotalPages()).toBe(2);
    expect(ctx.pagination!.getCurrentPage()).toBe(1); // clamped from 2
    expect(ctx.rowModel.getRowCount()).toBe(5);
  });

  it('dispatches paginationChanged with page, pageSize, totalPages', () => {
    const ctx = setup();
    const listener = vi.fn();
    ctx.events.addEventListener('paginationChanged', listener);
    ctx.pagination!.goToPage(1);
    expect(listener).toHaveBeenCalledTimes(1);
    const e = listener.mock.calls[0][0] as PaginationChangedEvent<Row>;
    expect(e.page).toBe(1);
    expect(e.pageSize).toBe(10);
    expect(e.totalPages).toBe(3);
  });

  it('renders the panel: label, buttons, disabled state, size selector', () => {
    const ctx = setup();
    const container = document.createElement('div');
    ctx.pagination!.mountPanel(container);

    expect(container.classList.contains('au-paging')).toBe(true);
    const label = container.querySelector('.au-paging-label')!;
    expect(label.textContent).toBe('1–10 of 25');

    const first = container.querySelector<HTMLButtonElement>('.au-paging-first')!;
    const prev = container.querySelector<HTMLButtonElement>('.au-paging-prev')!;
    const next = container.querySelector<HTMLButtonElement>('.au-paging-next')!;
    const last = container.querySelector<HTMLButtonElement>('.au-paging-last')!;
    expect(first.disabled).toBe(true);
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    expect(last.disabled).toBe(false);

    // selector shown by default with default sizes + current page size
    const select = container.querySelector<HTMLSelectElement>('select.au-paging-size')!;
    expect(select).not.toBeNull();
    expect(select.value).toBe('10');

    // clicking next updates page, label, and disabled state
    next.click();
    expect(ctx.pagination!.getCurrentPage()).toBe(1);
    expect(label.textContent).toBe('11–20 of 25');
    expect(first.disabled).toBe(false);

    last.click();
    expect(ctx.pagination!.getCurrentPage()).toBe(2);
    expect(label.textContent).toBe('21–25 of 25');
    expect(next.disabled).toBe(true);
    expect(last.disabled).toBe(true);
  });

  it('hides the size selector when paginationPageSizeSelector is false', () => {
    const ctx = setup({ paginationPageSizeSelector: false });
    const container = document.createElement('div');
    ctx.pagination!.mountPanel(container);
    expect(container.querySelector('select')).toBeNull();
  });

  it('computes page size from viewport height with paginationAutoPageSize', () => {
    // mock renderer viewport is 600px tall; default rowHeight 32 → floor(600/32)=18
    const ctx = setup({ paginationAutoPageSize: true });
    expect(ctx.pagination!.getPageSize()).toBe(18);
    expect(ctx.rowModel.getRowCount()).toBe(18);
    expect(ctx.pagination!.getTotalPages()).toBe(2);
  });

  it('destroy clears the window and hides the panel', () => {
    const ctx = setup();
    const container = document.createElement('div');
    ctx.pagination!.mountPanel(container);
    ctx.pagination!.destroy();
    expect(container.style.display).toBe('none');
    expect(ctx.rowModel.getRowCount()).toBe(25); // window cleared
  });
});
