import { afterEach, describe, expect, it } from 'vitest';
import { createMockContext } from '../test/mockContext';
import { GridRenderer } from './renderer';
import type { GridOptions } from '../types/gridOptions';

interface Row {
  id: string;
  name: string;
  value: number;
}

function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `name${i}`, value: i }));
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function setup(options: GridOptions<Row> = {}, rowCount = 10000) {
  const { ctx } = createMockContext<Row>({
    columnDefs: [{ field: 'name' }, { field: 'value' }],
    rowData: makeRows(rowCount),
    getRowId: (p) => p.data.id,
    ...options,
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const renderer = new GridRenderer<Row>(ctx, host);
  ctx.renderer = renderer;
  cleanups.push(() => {
    renderer.destroy();
    host.remove();
  });
  ctx.rowModel.start();
  return { ctx, renderer, host };
}

function centerRowIndexes(host: HTMLElement): number[] {
  return [...host.querySelectorAll('.au-center-spacer .au-row')].map((r) =>
    Number(r.getAttribute('data-au-row-index')),
  );
}

describe('GridRenderer — scaffold', () => {
  it('builds the structural DOM with au- classes', () => {
    const { host, renderer } = setup({}, 10);
    expect(host.querySelector('.au-root')).toBe(renderer.eRoot);
    expect(host.querySelector('.au-header')).toBeTruthy();
    expect(host.querySelector('.au-header-center-vp .au-header-center')).toBeTruthy();
    expect(host.querySelector('.au-body')).toBeTruthy();
    expect(host.querySelector('.au-body-center-vp .au-center-spacer')).toBeTruthy();
    expect(host.querySelector('.au-body-left')).toBeTruthy();
    expect(host.querySelector('.au-body-right')).toBeTruthy();
    expect(host.querySelector('.au-pinned-top')).toBeTruthy();
    expect(host.querySelector('.au-pinned-bottom')).toBeTruthy();
    expect(host.querySelector('.au-overlay')).toBeTruthy();
    expect(host.querySelector('.au-paging')).toBeTruthy();
  });

  it('sizes the center spacer to total row height', () => {
    const { renderer, host } = setup({}, 10000);
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const spacer = host.querySelector('.au-center-spacer') as HTMLElement;
    expect(spacer.style.height).toBe(`${10000 * 32}px`);
  });
});

describe('GridRenderer — row virtualization', () => {
  it('renders only the visible window + buffer, not all 10k rows', () => {
    const { renderer, host } = setup();
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const indexes = centerRowIndexes(host);
    // viewport 300px / 32px rows ≈ 10 visible + 3 buffer below (top clamped at 0) = 13
    expect(indexes.length).toBe(13);
    expect(Math.min(...indexes)).toBe(0);
    expect(Math.max(...indexes)).toBe(12);
    expect(indexes.length).toBeLessThan(100); // decidedly not the full data set
  });

  it('moves the rendered window on ensureIndexVisible (recycling)', () => {
    const { renderer, host } = setup();
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    expect(centerRowIndexes(host)).toContain(0);

    renderer.ensureIndexVisible(5000, 'top');
    renderer.renderNow();
    const indexes = centerRowIndexes(host);
    expect(indexes).toContain(5000);
    expect(indexes).not.toContain(0);
    expect(Math.min(...indexes)).toBeGreaterThan(4900);
    expect(indexes.length).toBeLessThan(40); // pool stays bounded
    // scroll position was applied
    expect(renderer.getScroll().top).toBe(5000 * 32);
  });

  it('renders everything when suppressRowVirtualisation is on', () => {
    const { renderer, host } = setup({ suppressRowVirtualisation: true }, 50);
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    expect(centerRowIndexes(host).length).toBe(50);
  });
});

describe('GridRenderer — header and cells', () => {
  it('renders header cells with column widths and labels', () => {
    const { renderer, host } = setup({}, 10);
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const headerCells = [...host.querySelectorAll('.au-header-center .au-header-cell')] as HTMLElement[];
    expect(headerCells).toHaveLength(2);
    expect(headerCells[0].style.width).toBe('200px'); // default column width
    expect(headerCells[0].textContent).toContain('Name');
    expect(headerCells[1].textContent).toContain('Value');
    expect(headerCells[0].getAttribute('data-au-header-col')).toBe('name');
  });

  it('renders correct cell textContent for the first rows', () => {
    const { renderer, host } = setup({}, 10);
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const row0 = host.querySelector('.au-center-spacer .au-row[data-au-row-index="0"]')!;
    expect(row0.querySelector('[data-au-col="name"]')!.textContent).toBe('name0');
    expect(row0.querySelector('[data-au-col="value"]')!.textContent).toBe('0');
    const row3 = host.querySelector('.au-center-spacer .au-row[data-au-row-index="3"]')!;
    expect(row3.querySelector('[data-au-col="name"]')!.textContent).toBe('name3');
    expect(row0.getAttribute('data-au-row-id')).toBe('r0');
  });

  it('positions rows via translateY at their rowTop', () => {
    const { renderer, host } = setup({}, 10);
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const row2 = host.querySelector('.au-center-spacer .au-row[data-au-row-index="2"]') as HTMLElement;
    expect(row2.style.transform).toBe(`translateY(${2 * 32}px)`);
    expect(row2.style.height).toBe('32px');
  });
});

describe('GridRenderer — overlays', () => {
  it('shows the no-rows overlay for empty data and hides it when rows exist', () => {
    const { renderer, host } = setup({}, 0);
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const overlay = host.querySelector('.au-overlay') as HTMLElement;
    expect(overlay.hidden).toBe(false);
    expect(overlay.textContent).toContain('No rows to show');
  });

  it('keeps the overlay hidden when data is present', () => {
    const { renderer, host } = setup({}, 5);
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    expect((host.querySelector('.au-overlay') as HTMLElement).hidden).toBe(true);
  });

  it('shows the loading overlay when loading option is set', () => {
    const { renderer, host } = setup({ loading: true }, 5);
    renderer.renderNow();
    const overlay = host.querySelector('.au-overlay') as HTMLElement;
    expect(overlay.hidden).toBe(false);
    expect(overlay.textContent).toContain('Loading');
  });

  it('showOverlay("hidden") forces the no-rows overlay off', () => {
    const { renderer, host } = setup({}, 0);
    renderer.showOverlay('hidden');
    renderer.renderNow();
    expect((host.querySelector('.au-overlay') as HTMLElement).hidden).toBe(true);
  });
});

describe('GridRenderer — ARIA', () => {
  it('root is a treegrid with roving tabindex', () => {
    const { renderer } = setup({}, 5);
    expect(renderer.eRoot.getAttribute('role')).toBe('treegrid');
    expect(renderer.eRoot.getAttribute('tabindex')).toBe('0');
  });

  it('rows and cells carry aria row/col indexes', () => {
    const { renderer, host } = setup({}, 5);
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const row0 = host.querySelector('.au-center-spacer .au-row[data-au-row-index="0"]')!;
    expect(row0.getAttribute('role')).toBe('row');
    expect(row0.getAttribute('aria-rowindex')).toBe('1');
    const row4 = host.querySelector('.au-center-spacer .au-row[data-au-row-index="4"]')!;
    expect(row4.getAttribute('aria-rowindex')).toBe('5');
    const cell = row0.querySelector('[data-au-col="name"]')!;
    expect(cell.getAttribute('role')).toBe('gridcell');
    expect(cell.getAttribute('aria-colindex')).toBe('1');
    expect(row0.querySelector('[data-au-col="value"]')!.getAttribute('aria-colindex')).toBe('2');
  });
});
