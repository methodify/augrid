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

describe('TooltipService — component tooltips (AUG-34)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.textContent = '';
  });

  interface FRow {
    name: string;
    finding: string | null;
  }

  class Card {
    static destroyed = 0;
    private el = document.createElement('div');
    init(p: { tip: string | null; value: unknown }): HTMLElement {
      this.el.className = 'finding-card';
      this.el.textContent = `⚠ ${p.tip ?? String(p.value)}`;
      return this.el;
    }
    destroy(): void {
      Card.destroyed++;
    }
  }

  function compSetup(colDef: object, options: object = {}, row: object = { name: 'A', finding: 'Qty below plan' }) {
    const { ctx, start } = createMockContext<FRow>({
      columnDefs: [{ field: 'name', ...colDef }],
      rowData: [row as FRow],
      ...options,
    });
    const tooltips = new TooltipService(ctx);
    ctx.tooltips = tooltips;
    start();
    const cellEl = document.createElement('div');
    document.body.appendChild(cellEl);
    return { ctx, tooltips, cellEl };
  }

  it('renders the component with the resolved tip; null tip suppresses', () => {
    const { tooltips, cellEl } = compSetup({
      tooltipComponent: Card,
      tooltipValueGetter: (p: { data?: FRow }) => p.data?.finding ?? null,
    });
    tooltips.onCellMouseOver(cellEl, 0, 'name');
    vi.advanceTimersByTime(600);
    const card = document.body.querySelector('.au-tooltip .finding-card');
    expect(card).not.toBeNull();
    expect(card!.textContent).toBe('⚠ Qty below plan');
    tooltips.destroy();
  });

  it('a null-gating getter means no tooltip at all', () => {
    const { tooltips, cellEl } = compSetup(
      { tooltipComponent: Card, tooltipValueGetter: () => null },
    );
    tooltips.onCellMouseOver(cellEl, 0, 'name');
    vi.advanceTimersByTime(600);
    expect(document.body.querySelector('.au-tooltip')).toBeNull();
    tooltips.destroy();
  });

  it('without a string source the component shows on every hover with the cell value', () => {
    const { tooltips, cellEl } = compSetup({ tooltipComponent: Card });
    tooltips.onCellMouseOver(cellEl, 0, 'name');
    vi.advanceTimersByTime(600);
    expect(document.body.querySelector('.finding-card')!.textContent).toBe('⚠ A');
    tooltips.destroy();
  });

  it('component destroy runs on hide', () => {
    Card.destroyed = 0;
    const { tooltips, cellEl } = compSetup({ tooltipComponent: Card });
    tooltips.onCellMouseOver(cellEl, 0, 'name');
    vi.advanceTimersByTime(600);
    tooltips.onLeaveGrid();
    expect(Card.destroyed).toBe(1);
    expect(document.body.querySelector('.au-tooltip')).toBeNull();
    tooltips.destroy();
  });

  it('framework components render through the adapter with cleanup', () => {
    const cleanup = vi.fn();
    const { ctx, tooltips, cellEl } = compSetup({
      tooltipComponent: { __frameworkComponent: 'MyCard' },
      tooltipValueGetter: (p: { data?: FRow }) => p.data?.finding ?? null,
    });
    ctx.frameworkAdapter = {
      render: (comp, params, el) => {
        el.textContent = `fw:${String(comp)}:${(params as { tip: string }).tip}`;
        return cleanup;
      },
    };
    tooltips.onCellMouseOver(cellEl, 0, 'name');
    vi.advanceTimersByTime(600);
    expect(document.body.querySelector('.au-tooltip')!.textContent).toBe('fw:MyCard:Qty below plan');
    tooltips.onLeaveGrid();
    expect(cleanup).toHaveBeenCalledTimes(1);
    tooltips.destroy();
  });

  it('tooltipInteraction keeps the tooltip open while hovered, hides on its mouseleave', () => {
    const { tooltips, cellEl } = compSetup(
      { tooltipField: 'finding' },
      { tooltipInteraction: true },
    );
    tooltips.onCellMouseOver(cellEl, 0, 'name');
    vi.advanceTimersByTime(600);
    const tip = document.body.querySelector('.au-tooltip') as HTMLElement;
    expect(tip).not.toBeNull();

    // Pointer leaves the grid toward the tooltip: hide is deferred…
    tooltips.onLeaveGrid();
    expect(document.body.querySelector('.au-tooltip')).not.toBeNull();
    // …and entering the tooltip within the grace period cancels it.
    tip.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(1000);
    expect(document.body.querySelector('.au-tooltip')).not.toBeNull();
    // Leaving the tooltip hides immediately.
    tip.dispatchEvent(new MouseEvent('mouseleave'));
    expect(document.body.querySelector('.au-tooltip')).toBeNull();
    tooltips.destroy();
  });

  it('without tooltipInteraction the grace period does not apply', () => {
    const { tooltips, cellEl } = compSetup({ tooltipField: 'finding' });
    tooltips.onCellMouseOver(cellEl, 0, 'name');
    vi.advanceTimersByTime(600);
    tooltips.onLeaveGrid();
    expect(document.body.querySelector('.au-tooltip')).toBeNull();
    tooltips.destroy();
  });

  it('series sparkline columns own their hover: tooltip defers unless suppressInteraction', () => {
    const { tooltips, cellEl } = compSetup({
      tooltipField: 'finding',
      sparkline: { type: 'line' },
    });
    tooltips.onCellMouseOver(cellEl, 0, 'name');
    vi.advanceTimersByTime(600);
    expect(document.body.querySelector('.au-tooltip')).toBeNull();
    tooltips.destroy();

    const second = compSetup({
      tooltipField: 'finding',
      sparkline: { type: 'line', suppressInteraction: true },
    });
    second.tooltips.onCellMouseOver(second.cellEl, 0, 'name');
    vi.advanceTimersByTime(600);
    expect(document.body.querySelector('.au-tooltip')).not.toBeNull();
    second.tooltips.destroy();
  });

  it('scalar sparkline marks (bar/bullet/delta) do not block tooltips', () => {
    const { tooltips, cellEl } = compSetup({
      tooltipField: 'finding',
      sparkline: { type: 'bar' },
    });
    tooltips.onCellMouseOver(cellEl, 0, 'name');
    vi.advanceTimersByTime(600);
    expect(document.body.querySelector('.au-tooltip')).not.toBeNull();
    tooltips.destroy();
  });
});
