import { afterEach, describe, expect, it } from 'vitest';
import { createMockContext } from '../test/mockContext.js';
import { GridRenderer } from './renderer.js';
import type { GridOptions } from '../types/gridOptions.js';

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
  it('root is a plain grid (roving tabindex) when no grouping is active', () => {
    const { renderer } = setup({}, 5);
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    expect(renderer.eRoot.getAttribute('role')).toBe('grid');
    expect(renderer.eRoot.getAttribute('tabindex')).toBe('0');
    expect(renderer.eRoot.hasAttribute('aria-multiselectable')).toBe(false);
  });

  it('root is a treegrid while row grouping is active', () => {
    const { renderer } = setup(
      {
        columnDefs: [{ field: 'name', rowGroup: true }, { field: 'value' }],
      },
      10,
    );
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    expect(renderer.eRoot.getAttribute('role')).toBe('treegrid');
  });

  it('sets aria-rowcount / aria-colcount on the root every render', () => {
    const { renderer } = setup({}, 5);
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    // 1 header row + 5 body rows, 2 displayed columns
    expect(renderer.eRoot.getAttribute('aria-rowcount')).toBe('6');
    expect(renderer.eRoot.getAttribute('aria-colcount')).toBe('2');
  });

  it('rows and cells carry aria row/col indexes offset by the header rows', () => {
    const { renderer, host } = setup({}, 5);
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const row0 = host.querySelector('.au-center-spacer .au-row[data-au-row-index="0"]')!;
    expect(row0.getAttribute('role')).toBe('row');
    // header depth 1 → first body row is aria row 2
    expect(row0.getAttribute('aria-rowindex')).toBe('2');
    const row4 = host.querySelector('.au-center-spacer .au-row[data-au-row-index="4"]')!;
    expect(row4.getAttribute('aria-rowindex')).toBe('6');
    const cell = row0.querySelector('[data-au-col="name"]')!;
    expect(cell.getAttribute('role')).toBe('gridcell');
    expect(cell.getAttribute('aria-colindex')).toBe('1');
    expect(row0.querySelector('[data-au-col="value"]')!.getAttribute('aria-colindex')).toBe('2');
  });

  it('marks multiRow selection: aria-multiselectable, aria-selected, checkbox label', () => {
    const { renderer, host } = setup({ rowSelection: 'multiRow' }, 5);
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    expect(renderer.eRoot.getAttribute('aria-multiselectable')).toBe('true');
    const row0 = host.querySelector('.au-center-spacer .au-row[data-au-row-index="0"]')!;
    expect(row0.getAttribute('aria-selected')).toBe('false');
    const cb = host.querySelector('.au-row input[data-au-row-checkbox]')!;
    expect(cb.getAttribute('aria-label')).toBe('Select row');
    expect(cb.getAttribute('tabindex')).toBe('-1');
  });

  it('exposes aria-expanded on expandable group rows', () => {
    const { ctx, renderer, host } = setup(
      {
        columnDefs: [{ field: 'name', rowGroup: true }, { field: 'value' }],
      },
      10,
    );
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const groupRow = host.querySelector('.au-center-spacer .au-row.au-row-group')!;
    expect(groupRow.getAttribute('aria-expanded')).toBe('false');
    const node = ctx.rowModel.getRow(0)!;
    node.setExpanded(true);
    renderer.renderNow();
    expect(
      host.querySelector(`.au-center-spacer .au-row[data-au-row-id="${node.id}"]`)!.getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('pinned region row duplicates are presentational; center is the canonical row', () => {
    const { renderer, host } = setup(
      {
        columnDefs: [{ field: 'name', pinned: 'left' }, { field: 'value' }],
      },
      5,
    );
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const leftRow = host.querySelector('.au-body-left .au-row')!;
    expect(leftRow.getAttribute('role')).toBe('presentation');
    expect(leftRow.hasAttribute('aria-rowindex')).toBe(false);
    // pinned cells stay real gridcells with correct aria-colindex
    const leftCell = leftRow.querySelector('[data-au-col="name"]')!;
    expect(leftCell.getAttribute('role')).toBe('gridcell');
    expect(leftCell.getAttribute('aria-colindex')).toBe('1');
    const centerRow = host.querySelector('.au-center-spacer .au-row')!;
    expect(centerRow.getAttribute('role')).toBe('row');
    expect(centerRow.hasAttribute('aria-rowindex')).toBe(true);
  });
});

describe('GridRenderer — row recycling (C1)', () => {
  it('reuses row DOM nodes across a window jump and updates their content', () => {
    const { renderer, host } = setup();
    renderer.setViewportSizeForTesting(800, 300);
    renderer.ensureIndexVisible(100, 'top');
    renderer.renderNow();
    const before = new Set(host.querySelectorAll('.au-center-spacer .au-row'));
    const beforeCount = before.size;
    expect(beforeCount).toBeGreaterThan(0);

    renderer.ensureIndexVisible(1000, 'top');
    renderer.renderNow();
    const after = [...host.querySelectorAll('.au-center-spacer .au-row')];
    // (a) same number of row elements
    expect(after.length).toBe(beforeCount);
    // (b) at least half are the SAME DOM nodes (identity reuse, not recreation)
    const reused = after.filter((el) => before.has(el as never));
    expect(reused.length).toBeGreaterThanOrEqual(Math.ceil(beforeCount / 2));
    // (c) contents were rebound to the new window
    const row1000 = host.querySelector('.au-center-spacer .au-row[data-au-row-index="1000"]')!;
    expect(row1000.querySelector('[data-au-col="name"]')!.textContent).toBe('name1000');
    expect(host.querySelector('.au-center-spacer .au-row[data-au-row-index="0"]')).toBeNull();
  });
});

describe('GridRenderer — editing row keep-alive (C12)', () => {
  it('keeps the edited row rendered when it scrolls out of the window', () => {
    const { ctx, renderer, host } = setup();
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    (ctx.editing as { getEditingCells: () => unknown }).getEditingCells = () => [
      { rowIndex: 2, colId: 'name', rowPinned: null },
    ];
    renderer.ensureIndexVisible(1000, 'top');
    renderer.renderNow();
    const editedRow = host.querySelector('.au-center-spacer .au-row[data-au-row-id="r2"]') as HTMLElement;
    expect(editedRow).toBeTruthy();
    // positioned at its real rowTop — it scrolls out of view naturally
    expect(editedRow.style.transform).toBe(`translateY(${2 * 32}px)`);
  });
});

describe('GridRenderer — focus retention on virtualize-out (C19)', () => {
  it('refocuses the grid root when the focused cell is recycled away', () => {
    const { renderer, host } = setup();
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const cell = host.querySelector(
      '.au-center-spacer .au-row[data-au-row-index="5"] [data-au-col="name"]',
    ) as HTMLElement;
    cell.focus();
    expect(document.activeElement).toBe(cell);
    renderer.ensureIndexVisible(1000, 'top');
    renderer.renderNow();
    expect(document.activeElement).toBe(renderer.eRoot);
  });
});

describe('GridRenderer — framework renderer wrapper mounts (C5/C29)', () => {
  function fwSetup() {
    const containers: HTMLElement[] = [];
    const result = setup({
      columnDefs: [{ field: 'name', cellRenderer: { __frameworkComponent: 'Comp' } }, { field: 'value' }],
    });
    result.ctx.frameworkAdapter = {
      render: (_comp, _props, container) => {
        containers.push(container);
        const marker = document.createElement('b');
        marker.textContent = 'portal';
        container.appendChild(marker);
        return () => {};
      },
    };
    return { ...result, containers };
  }

  it('mounts framework renderers into a dedicated .au-fw-mount wrapper', () => {
    const { renderer, host, containers } = fwSetup();
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    expect(containers.length).toBeGreaterThan(0);
    expect(containers[0].classList.contains('au-fw-mount')).toBe(true);
    expect(containers[0].parentElement!.classList.contains('au-cell')).toBe(true);
    expect(host.querySelector('[data-au-col="name"] .au-fw-mount b')!.textContent).toBe('portal');
  });

  it('refreshCells remounts into a FRESH wrapper; the old one is detached intact', () => {
    const { renderer, containers } = fwSetup();
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const firstMounts = containers.length;
    const oldWrapper = containers[0];
    renderer.refreshCells();
    renderer.renderNow();
    expect(containers.length).toBeGreaterThan(firstMounts);
    const newWrapper = containers[firstMounts];
    // a new container element ⇒ the adapter/React sees a real change
    expect(newWrapper).not.toBe(oldWrapper);
    expect(newWrapper.isConnected).toBe(true);
    // the old wrapper was removed as a node, never wiped — its children survive
    expect(oldWrapper.isConnected).toBe(false);
    expect(oldWrapper.querySelector('b')).toBeTruthy();
  });

  it('edit-start detaches the wrapper without wiping its contents', () => {
    const { ctx, renderer, host, containers } = fwSetup();
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const wrapper = containers[0];
    expect(wrapper.isConnected).toBe(true);
    (ctx.editing as { isEditingCell: (r: number, c: string) => boolean }).isEditingCell = (r, c) =>
      r === 0 && c === 'name';
    renderer.refreshCells();
    renderer.renderNow();
    const cell = host.querySelector('.au-row[data-au-row-index="0"] [data-au-col="name"]')!;
    expect(cell.querySelector('.au-fw-mount')).toBeNull();
    // wrapper node intact for React's asynchronous unmount
    expect(wrapper.isConnected).toBe(false);
    expect(wrapper.querySelector('b')).toBeTruthy();
  });
});

describe('GridRenderer — flashCells (C16)', () => {
  it('applies the flash class with a single batched reflow read', () => {
    const { renderer, host } = setup({}, 20);
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    let reads = 0;
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        reads++;
        return 100;
      },
    });
    try {
      renderer.flashCells(null, null);
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', original);
      else delete (HTMLElement.prototype as { offsetWidth?: unknown }).offsetWidth;
    }
    const flashed = host.querySelectorAll('.au-cell-flash');
    expect(flashed.length).toBeGreaterThan(10); // many cells flashed…
    expect(reads).toBe(1); // …but exactly ONE layout read for the whole batch
  });
});

describe('GridRenderer — getRowStyle (C27)', () => {
  it('applies getRowStyle results and clears them when a row element is recycled', () => {
    const { renderer, host } = setup({
      getRowStyle: ({ rowIndex }) => (rowIndex === 0 ? { backgroundColor: 'red' } : undefined),
    });
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const row0 = host.querySelector('.au-center-spacer .au-row[data-au-row-index="0"]') as HTMLElement;
    expect(row0.style.backgroundColor).toBe('red');
    renderer.ensureIndexVisible(1000, 'top');
    renderer.renderNow();
    // the recycled element now hosts a different row: no leaked custom style
    expect(row0.isConnected).toBe(true);
    expect(row0.style.backgroundColor).toBe('');
    expect(row0.style.transform).not.toBe('translateY(0px)');
  });
});

describe('GridRenderer — full-width rows (C4/C28)', () => {
  interface GRow {
    id: string;
    country: string;
    name: string;
    value: number;
  }
  const gRows: GRow[] = [
    { id: 'g0', country: 'USA', name: 'a', value: 1 },
    { id: 'g1', country: 'USA', name: 'b', value: 2 },
    { id: 'g2', country: 'FRA', name: 'c', value: 3 },
    { id: 'g3', country: 'FRA', name: 'd', value: 4 },
  ];

  function setupGrouped(options: GridOptions<GRow> = {}) {
    const { ctx } = createMockContext<GRow>({
      columnDefs: [{ field: 'country', rowGroup: true }, { field: 'name' }, { field: 'value' }],
      rowData: gRows,
      getRowId: (p) => p.data.id,
      ...options,
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const renderer = new GridRenderer<GRow>(ctx, host);
    ctx.renderer = renderer;
    cleanups.push(() => {
      renderer.destroy();
      host.remove();
    });
    ctx.rowModel.start();
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    return { ctx, renderer, host };
  }

  it("groupDisplayType 'groupRows' renders group nodes as full-width rows", () => {
    const { host } = setupGrouped({ groupDisplayType: 'groupRows' });
    const fwRows = host.querySelectorAll('.au-fullwidth-container .au-row.au-fullwidth-row');
    expect(fwRows.length).toBe(2); // USA + FRA, collapsed
    const first = fwRows[0] as HTMLElement;
    expect(first.classList.contains('au-row-group')).toBe(true);
    expect(first.querySelector('.au-group-key')!.textContent).toBe('USA');
    expect(first.querySelector('.au-group-count')!.textContent).toBe('(2)');
    expect(first.querySelector('[data-au-expand]')).toBeTruthy();
    // full-width cell is delegation-mappable
    expect(first.querySelector('[data-au-col="au-fullwidth"]')).toBeTruthy();
    // group rows are NOT duplicated in the region bands
    expect(host.querySelector('.au-center-spacer .au-row.au-row-group')).toBeNull();
  });

  it('expand chevron clicks on full-width group rows work through delegation', () => {
    const { renderer, host } = setupGrouped({ groupDisplayType: 'groupRows' });
    const chevron = host.querySelector('.au-fullwidth-container [data-au-expand]') as HTMLElement;
    chevron.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    renderer.renderNow();
    // leaves of the expanded group now render as regular region rows
    const leafRow = host.querySelector('.au-center-spacer .au-row[data-au-row-id="g0"]');
    expect(leafRow).toBeTruthy();
    expect(leafRow!.querySelector('[data-au-col="name"]')!.textContent).toBe('a');
    const fwFirst = host.querySelector('.au-fullwidth-container .au-fullwidth-row') as HTMLElement;
    expect(fwFirst.getAttribute('aria-expanded')).toBe('true');
  });

  it('isFullWidthRow + fullWidthCellRenderer renders designated leaf rows full width', () => {
    const { renderer, host } = setup({
      isFullWidthRow: ({ rowNode }) => (rowNode.data as Row | undefined)?.id === 'r1',
      fullWidthCellRenderer: (p) => `FW-${p.node.id}`,
    });
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const fwRow = host.querySelector('.au-fullwidth-container .au-row[data-au-row-id="r1"]') as HTMLElement;
    expect(fwRow).toBeTruthy();
    expect(fwRow.textContent).toBe('FW-r1');
    expect(fwRow.style.transform).toBe(`translateY(${1 * 32}px)`);
    // skipped by the region bands
    expect(host.querySelector('.au-center-spacer .au-row[data-au-row-id="r1"]')).toBeNull();
    // neighbours still render normally
    expect(host.querySelector('.au-center-spacer .au-row[data-au-row-id="r0"]')).toBeTruthy();
  });

  it("groupDisplayType 'multipleColumns' shows each group key only at its own level", () => {
    const { ctx, renderer, host } = (() => {
      const { ctx } = createMockContext<GRow>({
        columnDefs: [
          { field: 'country', rowGroup: true },
          { field: 'name', rowGroup: true },
          { field: 'value' },
        ],
        rowData: gRows,
        getRowId: (p) => p.data.id,
        groupDisplayType: 'multipleColumns',
        groupDefaultExpanded: 1,
      });
      const host = document.createElement('div');
      document.body.appendChild(host);
      const renderer = new GridRenderer<GRow>(ctx, host);
      ctx.renderer = renderer;
      cleanups.push(() => {
        renderer.destroy();
        host.remove();
      });
      ctx.rowModel.start();
      renderer.setViewportSizeForTesting(1200, 400);
      renderer.renderNow();
      return { ctx, renderer, host };
    })();
    void renderer;
    const autoCols = ctx.columnModel.getAutoGroupColumns();
    expect(autoCols.length).toBe(2);
    const [lvl0Col, lvl1Col] = autoCols;
    // level-0 group row (country): key in the level-0 column, level-1 blank
    const countryRow = host.querySelector('.au-center-spacer .au-row[data-au-row-index="0"]')!;
    const c0 = countryRow.querySelector(`[data-au-col="${lvl0Col.colId}"]`)!;
    const c1 = countryRow.querySelector(`[data-au-col="${lvl1Col.colId}"]`)!;
    expect(c0.querySelector('.au-group-key')!.textContent).toBe('USA');
    expect(c0.querySelector('[data-au-expand]')).toBeTruthy();
    expect(c1.querySelector('.au-group-cell')).toBeNull();
    // level-1 group row (name): key in the level-1 column, level-0 blank
    const nameRow = host.querySelector('.au-center-spacer .au-row[data-au-row-index="1"]')!;
    const n0 = nameRow.querySelector(`[data-au-col="${lvl0Col.colId}"]`)!;
    const n1 = nameRow.querySelector(`[data-au-col="${lvl1Col.colId}"]`)!;
    expect(n0.querySelector('.au-group-cell')).toBeNull();
    expect(n1.querySelector('.au-group-key')!.textContent).toBe('a');
    expect(n1.querySelector('[data-au-expand]')).toBeTruthy();
  });
});

describe('GridRenderer — autoHeight (C25)', () => {
  it('measures autoHeight cells in a batched read phase and applies row heights', () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList?.contains('au-cell') ? 55 : 0;
      },
    });
    try {
      const { ctx, renderer, host } = setup(
        {
          columnDefs: [{ field: 'name', autoHeight: true, wrapText: true }, { field: 'value' }],
        },
        10,
      );
      renderer.setViewportSizeForTesting(800, 300);
      renderer.renderNow();
      expect(ctx.rowModel.getRow(0)!.rowHeight).toBe(55);
      renderer.renderNow(); // write pass after the model recomputed tops
      const row0 = host.querySelector('.au-center-spacer .au-row[data-au-row-index="0"]') as HTMLElement;
      expect(row0.style.height).toBe('55px');
      const row1 = host.querySelector('.au-center-spacer .au-row[data-au-row-index="1"]') as HTMLElement;
      expect(row1.style.transform).toBe('translateY(55px)');
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', original);
      else delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight;
    }
  });
});

describe('GridRenderer — cheap header geometry (C17)', () => {
  it('updates header cell left/width during live resize without a header rebuild', () => {
    const { ctx, renderer, host } = setup({}, 10);
    renderer.setViewportSizeForTesting(800, 300);
    renderer.renderNow();
    const nameHeader = host.querySelector('[data-au-header-col="name"]') as HTMLElement;
    const valueHeader = host.querySelector('[data-au-header-col="value"]') as HTMLElement;
    expect(nameHeader.style.width).toBe('200px');
    // live drag: width change WITHOUT markHeaderDirty
    ctx.columnModel.setColumnWidths([{ colId: 'name', width: 333 }], false);
    renderer.renderNow();
    // same header cell elements (no rebuild), updated geometry
    expect(host.querySelector('[data-au-header-col="name"]')).toBe(nameHeader);
    expect(nameHeader.style.width).toBe('333px');
    expect(valueHeader.style.left).toBe('333px');
  });
});
