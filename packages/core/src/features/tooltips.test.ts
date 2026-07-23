import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../test/mockContext.js';
import { TooltipService } from './tooltips.js';

interface Row {
  name: string;
  info: string;
}

function setup() {
  const { ctx, start } = createMockContext<Row>({
    columnDefs: [{ field: 'name', tooltipField: 'info' }],
    rowData: [{ name: 'Alice', info: 'Alice is an admin' }],
  });
  const tooltips = new TooltipService(ctx);
  ctx.tooltips = tooltips;
  start();
  return { ctx, tooltips };
}

describe('TooltipService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.textContent = '';
  });

  it('shows the tooltip after the delay and dispatches tooltipShow', () => {
    const { ctx, tooltips } = setup();
    const shown = vi.fn();
    ctx.events.addEventListener('tooltipShow', shown);
    const cellEl = document.createElement('div');
    document.body.appendChild(cellEl);

    tooltips.onCellMouseOver(cellEl, 0, 'name');
    expect(document.body.querySelector('.au-tooltip')).toBeNull(); // not yet

    vi.advanceTimersByTime(600); // default tooltipShowDelay
    const el = document.body.querySelector('.au-tooltip');
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe('Alice is an admin');
    expect(shown).toHaveBeenCalledTimes(1);
    expect(shown.mock.calls[0][0].value).toBe('Alice is an admin');
    expect(shown.mock.calls[0][0].cell).toEqual({ rowIndex: 0, colId: 'name', rowPinned: null });

    tooltips.destroy();
  });

  it('hides on onLeaveGrid and dispatches tooltipHide', () => {
    const { ctx, tooltips } = setup();
    const hidden = vi.fn();
    ctx.events.addEventListener('tooltipHide', hidden);
    const cellEl = document.createElement('div');
    document.body.appendChild(cellEl);

    tooltips.onCellMouseOver(cellEl, 0, 'name');
    vi.advanceTimersByTime(600);
    expect(document.body.querySelector('.au-tooltip')).not.toBeNull();

    tooltips.onLeaveGrid();
    expect(document.body.querySelector('.au-tooltip')).toBeNull();
    expect(hidden).toHaveBeenCalledTimes(1);

    // leaving before the delay cancels the pending show without a hide event
    tooltips.onCellMouseOver(cellEl, 0, 'name');
    tooltips.onLeaveGrid();
    vi.advanceTimersByTime(1000);
    expect(document.body.querySelector('.au-tooltip')).toBeNull();
    expect(hidden).toHaveBeenCalledTimes(1);

    tooltips.destroy();
  });
});
