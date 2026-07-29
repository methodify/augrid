import type { GridContext } from '../context.js';
import type { Column } from '../columns/column.js';
import type { RowNode } from '../rows/rowNode.js';
import { RowBand, FullWidthBand } from './rowRenderer.js';
import { HeaderRenderer } from './headerRenderer.js';
import { el, closestWithAttr } from '../utils/dom.js';
import { clamp } from '../utils/general.js';
import type { CellPosition } from '../types/base.js';
import type { ClientSideRowModel } from '../rows/clientSideRowModel.js';
import { SparklineDomains } from '../features/sparkline/sparklineDomains.js';

interface CellHit<TData> {
  node: RowNode<TData>;
  /** Null for full-width rows (data-au-col="au-fullwidth" has no real column). */
  column: Column<TData> | null;
  rowIndex: number;
  rowPinned: 'top' | 'bottom' | null;
  cellEl: HTMLElement;
}

/** Shared immutable empty list (avoids a per-frame allocation). */
const EMPTY_NODES: never[] = [];

export class GridRenderer<TData = unknown> {
  private ctx: GridContext<TData>;
  readonly eRoot: HTMLElement;
  private eHeader!: HTMLElement;
  private eHeaderLeft!: HTMLElement;
  private eHeaderCenterVp!: HTMLElement;
  private eHeaderCenter!: HTMLElement;
  private eHeaderRight!: HTMLElement;
  private eFloating!: HTMLElement;
  private eFloatingLeft!: HTMLElement;
  private eFloatingCenterVp!: HTMLElement;
  private eFloatingCenter!: HTMLElement;
  private eFloatingRight!: HTMLElement;
  private eBody!: HTMLElement;
  private eBodyLeft!: HTMLElement;
  private eBodyLeftContainer!: HTMLElement;
  private eBodyCenterVp!: HTMLElement;
  private eCenterSpacer!: HTMLElement;
  private eBodyRight!: HTMLElement;
  private eBodyRightContainer!: HTMLElement;
  private ePinnedTop!: HTMLElement;
  private ePinnedTopLeft!: HTMLElement;
  private ePinnedTopCenterVp!: HTMLElement;
  private ePinnedTopCenter!: HTMLElement;
  private ePinnedTopRight!: HTMLElement;
  private ePinnedBottom!: HTMLElement;
  private ePinnedBottomLeft!: HTMLElement;
  private ePinnedBottomCenterVp!: HTMLElement;
  private ePinnedBottomCenter!: HTMLElement;
  private ePinnedBottomRight!: HTMLElement;
  private eOverlay!: HTMLElement;
  private ePaging!: HTMLElement;
  private eMain!: HTMLElement;
  private eSideBarHost!: HTMLElement;
  /** Created on first `domain: 'shared'` request. */
  private sparklineDomains: SparklineDomains<TData> | null = null;
  private eFullWidthWrap!: HTMLElement;
  private eFullWidthContainer!: HTMLElement;

  private headerRenderer!: HeaderRenderer<TData>;
  private bodyBand!: RowBand<TData>;
  private topBand!: RowBand<TData>;
  private bottomBand!: RowBand<TData>;
  private fullWidthBand!: FullWidthBand<TData>;

  private scrollTop = 0;
  private scrollLeft = 0;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private headerDirty = true;
  private firstRenderDone = false;
  private hoveredRowId: string | null = null;
  /** Cell under the pointer, for enter/exit event pairing across recycled rows. */
  private hoveredCell: { key: string; payload: ReturnType<GridRenderer<TData>['cellEventPayload']> } | null = null;
  private scrollEndTimer: ReturnType<typeof setTimeout> | null = null;
  private lastVisible = { first: 0, last: -1 };
  private destroyed = false;
  /** Header row depth, refreshed with the header (aria-rowcount and offsets). */
  private headerDepth = 1;
  /** Per-header-cell geometry cache for the cheap (non-dirty) header path. */
  private headerGeom = new Map<string, { left: number; width: number }>();
  /** autoHeight: last measured node __version per node id. */
  private measuredVersions = new Map<string, number>();
  private lastDisplayedRef: unknown = null;
  private autoHeightCols: Column<TData>[] = [];
  private lastRootRole = '';
  private lastMultiselect: boolean | null = null;
  private lastAriaRowCount = -1;
  private lastAriaColCount = -1;

  constructor(ctx: GridContext<TData>, host: HTMLElement) {
    this.ctx = ctx;
    // Role/aria-multiselectable are kept current per render pass: 'treegrid'
    // only while grouping/tree data is active, multiselectable only for
    // multiRow selection.
    this.eRoot = el('div', 'au-root', {
      role: 'grid',
      tabindex: '0',
    });
    host.appendChild(this.eRoot);
    this.buildScaffold();
    this.headerRenderer = new HeaderRenderer(ctx, {
      header: this.eHeader,
      headerLeft: this.eHeaderLeft,
      headerCenterVp: this.eHeaderCenterVp,
      headerCenter: this.eHeaderCenter,
      headerRight: this.eHeaderRight,
      floating: this.eFloating,
      floatingLeft: this.eFloatingLeft,
      floatingCenterVp: this.eFloatingCenterVp,
      floatingCenter: this.eFloatingCenter,
      floatingRight: this.eFloatingRight,
    });
    this.bodyBand = new RowBand(ctx, { left: this.eBodyLeftContainer, center: this.eCenterSpacer, right: this.eBodyRightContainer }, null);
    this.topBand = new RowBand(ctx, { left: this.ePinnedTopLeft, center: this.ePinnedTopCenter, right: this.ePinnedTopRight }, 'top');
    this.bottomBand = new RowBand(ctx, { left: this.ePinnedBottomLeft, center: this.ePinnedBottomCenter, right: this.ePinnedBottomRight }, 'bottom');
    this.fullWidthBand = new FullWidthBand(ctx, this.eFullWidthContainer);
    this.wireEvents();
    this.observeSize();
    // Structural column changes repaint the header — services mutate columns
    // through the ColumnModel without going via the api layer. Width-only
    // changes (columnResized) stay on the cheap geometry path.
    for (const type of GridRenderer.HEADER_STRUCTURE_EVENTS) {
      ctx.events.addEventListener(type, this.onColumnStructureChanged);
    }
  }

  private static readonly HEADER_STRUCTURE_EVENTS = [
    'columnVisible',
    'columnPinned',
    'columnMoved',
    'columnRowGroupChanged',
    'columnPivotChanged',
    'columnValueChanged',
    'newColumnsLoaded',
    'pivotModeChanged',
  ] as const;

  private onColumnStructureChanged = (): void => {
    this.markHeaderDirty();
  };

  private buildScaffold(): void {
    const r = this.eRoot;
    this.eHeader = el('div', 'au-header');
    this.eHeaderLeft = el('div', 'au-header-left');
    this.eHeaderCenterVp = el('div', 'au-header-center-vp');
    this.eHeaderCenter = el('div', 'au-header-center');
    this.eHeaderCenterVp.appendChild(this.eHeaderCenter);
    this.eHeaderRight = el('div', 'au-header-right');
    this.eHeader.append(this.eHeaderLeft, this.eHeaderCenterVp, this.eHeaderRight);

    this.eFloating = el('div', 'au-floating');
    this.eFloatingLeft = el('div', 'au-floating-left');
    this.eFloatingCenterVp = el('div', 'au-floating-center-vp');
    this.eFloatingCenter = el('div', 'au-floating-center');
    this.eFloatingCenterVp.appendChild(this.eFloatingCenter);
    this.eFloatingRight = el('div', 'au-floating-right');
    this.eFloating.append(this.eFloatingLeft, this.eFloatingCenterVp, this.eFloatingRight);
    this.eFloating.style.display = 'none';

    this.ePinnedTop = el('div', 'au-pinned-top');
    this.ePinnedTopLeft = el('div', 'au-pinned-row-left');
    this.ePinnedTopCenterVp = el('div', 'au-pinned-row-center-vp');
    this.ePinnedTopCenter = el('div', 'au-pinned-row-center');
    this.ePinnedTopCenterVp.appendChild(this.ePinnedTopCenter);
    this.ePinnedTopRight = el('div', 'au-pinned-row-right');
    this.ePinnedTop.append(this.ePinnedTopLeft, this.ePinnedTopCenterVp, this.ePinnedTopRight);
    this.ePinnedTop.style.display = 'none';

    this.eBody = el('div', 'au-body', { role: 'rowgroup' });
    this.eBodyLeft = el('div', 'au-body-left');
    this.eBodyLeftContainer = el('div', 'au-pinned-container');
    this.eBodyLeft.appendChild(this.eBodyLeftContainer);
    this.eBodyCenterVp = el('div', 'au-body-center-vp');
    this.eCenterSpacer = el('div', 'au-center-spacer');
    this.eBodyCenterVp.appendChild(this.eCenterSpacer);
    this.eBodyRight = el('div', 'au-body-right');
    this.eBodyRightContainer = el('div', 'au-pinned-container');
    this.eBodyRight.appendChild(this.eBodyRightContainer);
    // Full-width rows overlay: wrapper clips to the body, inner container is
    // y-synced (translateY) with body scroll and x-pinned to the viewport.
    this.eFullWidthWrap = el('div', 'au-fullwidth-wrap');
    this.eFullWidthContainer = el('div', 'au-fullwidth-container');
    this.eFullWidthWrap.appendChild(this.eFullWidthContainer);
    this.eBody.append(this.eBodyLeft, this.eBodyCenterVp, this.eBodyRight, this.eFullWidthWrap);

    this.ePinnedBottom = el('div', 'au-pinned-bottom');
    this.ePinnedBottomLeft = el('div', 'au-pinned-row-left');
    this.ePinnedBottomCenterVp = el('div', 'au-pinned-row-center-vp');
    this.ePinnedBottomCenter = el('div', 'au-pinned-row-center');
    this.ePinnedBottomCenterVp.appendChild(this.ePinnedBottomCenter);
    this.ePinnedBottomRight = el('div', 'au-pinned-row-right');
    this.ePinnedBottom.append(this.ePinnedBottomLeft, this.ePinnedBottomCenterVp, this.ePinnedBottomRight);
    this.ePinnedBottom.style.display = 'none';

    this.eOverlay = el('div', 'au-overlay');
    this.eOverlay.hidden = true;
    this.ePaging = el('div', 'au-paging');
    this.ePaging.style.display = 'none';

    // Main pane (vertical stack) beside the tool-panel side bar host.
    this.eMain = el('div', 'au-main');
    this.eMain.append(this.eHeader, this.eFloating, this.ePinnedTop, this.eBody, this.ePinnedBottom, this.eOverlay, this.ePaging);
    this.eSideBarHost = el('div', 'au-sidebar-host');
    this.eSideBarHost.style.display = 'none';
    r.append(this.eMain, this.eSideBarHost);
  }

  /** Host element the SideBarService fills (display managed by the service). */
  getSideBarHost(): HTMLElement {
    return this.eSideBarHost;
  }

  /**
   * Column-wide sparkline extent for `domain: 'shared'` (or per row group
   * when a node is passed for `domain: 'group'`). Built lazily on first use
   * so columns that don't ask never pay the row pass.
   */
  getSparklineDomain(colId: string, node?: RowNode<TData>): { min: number; max: number } | null {
    this.sparklineDomains ??= new SparklineDomains(this.ctx);
    return node ? this.sparklineDomains.getForGroup(colId, node) : this.sparklineDomains.get(colId);
  }

  /* ------------------------------------------------------------- observers */

  private observeSize(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.readViewportSize();
        this.ctx.events.dispatch({
          type: 'gridSizeChanged',
          api: this.ctx.api,
          context: this.ctx.options.get('context'),
          clientWidth: this.viewportWidth,
          clientHeight: this.viewportHeight,
        });
        this.schedule();
      });
      this.resizeObserver.observe(this.eBodyCenterVp);
    }
    this.readViewportSize();
  }

  private readViewportSize(): void {
    this.viewportWidth = this.eBodyCenterVp.clientWidth;
    this.viewportHeight = this.eBodyCenterVp.clientHeight;
    this.ctx.columnModel.setViewportWidth(this.viewportWidth);
  }

  /** Test hook (jsdom has no layout). */
  setViewportSizeForTesting(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.ctx.columnModel.setViewportWidth(width);
  }

  /* ---------------------------------------------------------------- events */

  private wireEvents(): void {
    this.eBodyCenterVp.addEventListener(
      'scroll',
      () => {
        this.scrollTop = this.eBodyCenterVp.scrollTop;
        const prevLeft = this.scrollLeft;
        this.scrollLeft = this.eBodyCenterVp.scrollLeft;
        this.schedule();
        this.ctx.events.dispatch({
          type: 'bodyScroll',
          api: this.ctx.api,
          context: this.ctx.options.get('context'),
          left: this.scrollLeft,
          top: this.scrollTop,
          direction: prevLeft !== this.scrollLeft ? 'horizontal' : 'vertical',
        });
        if (this.scrollEndTimer) clearTimeout(this.scrollEndTimer);
        this.scrollEndTimer = setTimeout(() => {
          this.ctx.events.dispatch({
            type: 'bodyScrollEnd',
            api: this.ctx.api,
            context: this.ctx.options.get('context'),
            left: this.scrollLeft,
            top: this.scrollTop,
            direction: 'vertical',
          });
        }, 150);
      },
      { passive: true },
    );

    this.eRoot.addEventListener('keydown', (e) => {
      this.ctx.focus?.onKeyDown(e);
    });

    // Delegated mouse events
    this.eRoot.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.eRoot.addEventListener('click', (e) => this.onClick(e));
    this.eRoot.addEventListener('dblclick', (e) => this.onDblClick(e));
    this.eRoot.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    this.eRoot.addEventListener('mouseover', (e) => this.onMouseOver(e));
    this.eRoot.addEventListener('mouseleave', (e) => {
      this.setHoveredRow(null);
      this.setHoveredCell(null, e);
      this.ctx.tooltips?.onLeaveGrid();
    });
  }

  private cellFromEvent(e: Event): CellHit<TData> | null {
    const target = e.target as Element | null;
    if (!target) return null;
    const cellEl = closestWithAttr(target, 'data-au-col', this.eRoot);
    if (!cellEl) return null;
    const rowEl = closestWithAttr(cellEl, 'data-au-row-id', this.eRoot);
    if (!rowEl) return null;
    const colId = cellEl.getAttribute('data-au-col')!;
    const rowId = rowEl.getAttribute('data-au-row-id')!;
    const rowIndex = Number(rowEl.getAttribute('data-au-row-index'));
    const column = this.ctx.columnModel.getColumn(colId) ?? null;
    // Full-width rows have no real column; row-level events and expand
    // clicks must still work, so keep the hit with column = null.
    if (!column && colId !== 'au-fullwidth') return null;
    let node: RowNode<TData> | undefined;
    let rowPinned: 'top' | 'bottom' | null = null;
    if (rowId.startsWith('pinned-top-')) {
      rowPinned = 'top';
      node = (this.ctx.rowModel as ClientSideRowModel<TData>).getPinnedRow?.('top', rowIndex);
    } else if (rowId.startsWith('pinned-bottom-')) {
      rowPinned = 'bottom';
      node = (this.ctx.rowModel as ClientSideRowModel<TData>).getPinnedRow?.('bottom', rowIndex);
    } else {
      node = this.ctx.rowModel.getRow(rowIndex);
      if (node && node.id !== rowId) node = this.ctx.rowModel.getRowNode(rowId) ?? node;
    }
    if (!node) return null;
    return { node, column, rowIndex, rowPinned, cellEl };
  }

  /** Only called for hits with a real column (never full-width cells). */
  private cellEventPayload(hit: CellHit<TData>, e: Event) {
    const column = hit.column!;
    return {
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      node: hit.node,
      data: hit.node.data,
      column,
      colDef: column.getColDef(),
      colId: column.colId,
      value: this.ctx.values.getValue(hit.node, column),
      rowIndex: hit.rowIndex,
      event: e,
    };
  }

  private onMouseDown(e: MouseEvent): void {
    const target = e.target as Element;
    if ((target as HTMLElement).getAttribute?.('data-au-fill-handle')) {
      this.ctx.range?.onFillHandleMouseDown(e);
      e.preventDefault();
      return;
    }
    const hit = this.cellFromEvent(e);
    if (!hit || !hit.column) return;
    if (e.button !== 0) return;
    // Focus the cell (unless clicking checkbox/expand controls)
    const isControl =
      (target as HTMLElement).hasAttribute?.('data-au-row-checkbox') ||
      (target as HTMLElement).hasAttribute?.('data-au-expand');
    if (!isControl && hit.rowPinned == null) {
      const editingHere = this.ctx.editing?.isEditingCell(hit.rowIndex, hit.column.colId);
      if (!editingHere) {
        if (this.ctx.editing?.isEditing()) this.ctx.editing.stopEditing();
        this.ctx.focus?.setFocusedCell(hit.rowIndex, hit.column.colId, hit.rowPinned);
        this.ctx.range?.onCellMouseDown(
          { rowIndex: hit.rowIndex, colId: hit.column.colId, rowPinned: hit.rowPinned },
          e,
        );
      }
    }
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    // header interactions — the menu button sits inside sortable cells, so it
    // must win over the sort handler.
    const menuBtn = closestWithAttr(target, 'data-au-col-menu', this.eRoot);
    if (menuBtn) {
      this.ctx.columnMenu?.showForColumn(menuBtn.getAttribute('data-au-col-menu')!, menuBtn);
      return;
    }
    const headerSort = closestWithAttr(target, 'data-au-sort-col', this.eRoot);
    if (headerSort) {
      const colId = headerSort.getAttribute('data-au-sort-col')!;
      const col = this.ctx.columnModel.getColumn(colId);
      if (col) {
        const multiKey = this.ctx.options.get('multiSortKey') === 'ctrl' ? e.ctrlKey || e.metaKey : e.shiftKey;
        this.ctx.sort.progressSort(col, multiKey, 'header');
      }
      return;
    }
    if (target.hasAttribute('data-au-header-checkbox')) {
      this.ctx.selection?.handleHeaderCheckbox((target as HTMLInputElement).checked);
      return;
    }
    const hit = this.cellFromEvent(e);
    if (!hit) return;
    if (target.hasAttribute('data-au-expand')) {
      hit.node.setExpanded(!hit.node.expanded);
      return;
    }
    if (target.hasAttribute('data-au-row-checkbox')) {
      const checked = (target as HTMLInputElement).checked;
      this.ctx.selection?.setSelected([hit.node], checked, 'checkbox');
      return;
    }
    if (hit.column) this.ctx.events.dispatch({ ...this.cellEventPayload(hit, e), type: 'cellClicked' });
    this.ctx.events.dispatch({
      type: 'rowClicked',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      node: hit.node,
      data: hit.node.data,
      rowIndex: hit.rowIndex,
      event: e,
    });
    if (hit.rowPinned == null) this.ctx.selection?.handleRowClick(hit.node, e);
    // single-click editing
    const single =
      hit.column != null &&
      (this.ctx.options.is('singleClickEdit') || hit.column.getColDef().singleClickEdit === true);
    if (single && hit.rowPinned == null && hit.column) {
      this.ctx.editing?.startEditing({ rowIndex: hit.rowIndex, colId: hit.column.colId, event: e });
    }
  }

  private onDblClick(e: MouseEvent): void {
    const hit = this.cellFromEvent(e);
    if (!hit) return;
    if (hit.column) this.ctx.events.dispatch({ ...this.cellEventPayload(hit, e), type: 'cellDoubleClicked' });
    this.ctx.events.dispatch({
      type: 'rowDoubleClicked',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      node: hit.node,
      data: hit.node.data,
      rowIndex: hit.rowIndex,
      event: e,
    });
    if (hit.rowPinned == null && hit.column) {
      this.ctx.editing?.startEditing({ rowIndex: hit.rowIndex, colId: hit.column.colId, event: e });
    }
  }

  private onContextMenu(e: MouseEvent): void {
    const hit = this.cellFromEvent(e);
    if (!hit || !hit.column) return;
    this.ctx.events.dispatch({ ...this.cellEventPayload(hit, e), type: 'cellContextMenu' });
    const shown = this.ctx.contextMenu?.showMenuForEvent(
      { rowIndex: hit.rowIndex, colId: hit.column.colId, rowPinned: hit.rowPinned },
      e,
    );
    if (shown) e.preventDefault(); // suppressed/empty menus fall through to the browser menu
  }

  private onMouseOver(e: MouseEvent): void {
    const target = e.target as Element;
    const rowEl = closestWithAttr(target, 'data-au-row-id', this.eRoot);
    this.setHoveredRow(rowEl ? rowEl.getAttribute('data-au-row-id') : null);
    const hit = this.cellFromEvent(e);
    this.setHoveredCell(hit && hit.column ? hit : null, e);
    if (this.ctx.tooltips) {
      const cellEl = closestWithAttr(target, 'data-au-col', this.eRoot);
      const rowIdx = rowEl ? Number(rowEl.getAttribute('data-au-row-index')) : -1;
      if (cellEl && rowIdx >= 0) {
        this.ctx.tooltips.onCellMouseOver(cellEl, rowIdx, cellEl.getAttribute('data-au-col')!);
      }
    }
  }

  /**
   * Enter/exit pairing for cellMouseOver/cellMouseOut. Keyed by node id + colId
   * so mouseover chatter inside one cell (spans, sparkline SVGs) stays silent,
   * and the exit event carries the entered cell's payload even after the row
   * element has been recycled.
   */
  private setHoveredCell(hit: CellHit<TData> | null, e: MouseEvent): void {
    const key = hit && hit.column ? `${hit.node.id}:${hit.column.colId}` : null;
    if (key === (this.hoveredCell?.key ?? null)) return;
    if (this.hoveredCell) {
      this.ctx.events.dispatch({ ...this.hoveredCell.payload, type: 'cellMouseOut', event: e });
    }
    this.hoveredCell = key ? { key, payload: this.cellEventPayload(hit!, e) } : null;
    if (this.hoveredCell) {
      this.ctx.events.dispatch({ ...this.hoveredCell.payload, type: 'cellMouseOver' });
    }
  }

  private setHoveredRow(rowId: string | null): void {
    if (rowId === this.hoveredRowId) return;
    if (this.hoveredRowId) {
      for (const e of this.bodyBand.getRowElements(this.hoveredRowId)) e.classList.remove('au-row-hover');
    }
    this.hoveredRowId = rowId;
    if (rowId) {
      for (const e of this.bodyBand.getRowElements(rowId)) e.classList.add('au-row-hover');
    }
  }

  /* -------------------------------------------------------------- rendering */

  schedule(): void {
    if (this.rafId != null || this.destroyed) return;
    if (typeof requestAnimationFrame === 'undefined') {
      this.renderNow();
      return;
    }
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.renderNow();
    });
  }

  markHeaderDirty(): void {
    this.headerDirty = true;
  }

  renderNow(): void {
    if (this.destroyed) return;
    const ctx = this.ctx;
    const model = ctx.rowModel;
    const displayed = ctx.columnModel.getDisplayed();
    const widths = ctx.columnModel.getRegionWidths();

    if (displayed !== this.lastDisplayedRef) {
      this.lastDisplayedRef = displayed;
      this.autoHeightCols = displayed.all.filter((c) => c.getColDef().autoHeight === true);
    }

    if (this.headerDirty) {
      this.headerRenderer.refresh();
      this.headerDirty = false;
      this.headerDepth = ctx.columnModel.getHeaderLayout().depth;
      this.headerGeom.clear();
      for (const c of displayed.all) this.headerGeom.set(c.colId, { left: c.left, width: c.actualWidth });
    } else {
      this.headerRenderer.updateSortIndicators();
      this.headerRenderer.updateHeaderCheckbox();
      // Cheap header-geometry path: live column resize/reflow updates existing
      // header cells' left/width without a full header rebuild.
      this.updateHeaderGeometry(displayed, widths);
    }

    // region sizing
    this.eBodyLeft.style.width = `${widths.left}px`;
    this.eBodyRight.style.width = `${widths.right}px`;
    this.eBodyLeft.style.display = widths.left > 0 ? '' : 'none';
    this.eBodyRight.style.display = widths.right > 0 ? '' : 'none';
    const totalHeight = model.getTotalHeight();
    this.eCenterSpacer.style.width = `${widths.center}px`;
    this.eCenterSpacer.style.height = `${Math.max(totalHeight, 1)}px`;
    this.eBodyLeftContainer.style.height = `${Math.max(totalHeight, 1)}px`;
    this.eBodyRightContainer.style.height = `${Math.max(totalHeight, 1)}px`;

    // sync horizontal: header + floating + pinned rows follow center scroll
    const tx = `translateX(${-this.scrollLeft}px)`;
    this.eHeaderCenter.style.transform = tx;
    this.eFloatingCenter.style.transform = tx;
    this.ePinnedTopCenter.style.transform = tx;
    this.ePinnedBottomCenter.style.transform = tx;
    // sync vertical: pinned side + full-width containers follow center scroll
    const ty = `translateY(${-this.scrollTop}px)`;
    this.eBodyLeftContainer.style.transform = ty;
    this.eBodyRightContainer.style.transform = ty;
    this.eFullWidthContainer.style.transform = ty;

    // visible rows
    const rowCount = model.getRowCount();
    const buffer = ctx.options.get('rowBuffer') ?? 3;
    let first = 0;
    let last = rowCount - 1;
    if (!ctx.options.is('suppressRowVirtualisation') && this.viewportHeight > 0) {
      first = Math.max(0, model.getRowIndexAtPixel(this.scrollTop) - buffer);
      last = Math.min(rowCount - 1, model.getRowIndexAtPixel(this.scrollTop + this.viewportHeight) + buffer);
    } else if (rowCount > 100 && !ctx.options.is('suppressRowVirtualisation')) {
      last = 100; // safety cap when no viewport measured (self-heals on first measured pass)
    }
    const visibleNodes: RowNode<TData>[] = [];
    for (let i = first; i <= last; i++) {
      const n = model.getRow(i);
      if (n) visibleNodes.push(n);
    }

    // Keep the row being edited alive even outside the window: its DOM (and
    // the editor state living in it) survives; it is positioned at its real
    // rowTop and simply scrolls out of view.
    const editingCells = ctx.editing?.getEditingCells() ?? [];
    for (const pos of editingCells) {
      if (pos.rowPinned != null) continue;
      if (pos.rowIndex >= first && pos.rowIndex <= last) continue;
      const n = model.getRow(pos.rowIndex);
      if (n && !visibleNodes.includes(n)) visibleNodes.push(n);
    }

    // visible center columns
    const centerCols = this.visibleCenterColumns(displayed.center);

    // Shared displayed-column index map: built ONCE per render pass and passed
    // to every band (aria-colindex source).
    const allColIndex = new Map<string, number>();
    displayed.all.forEach((c, i) => allColIndex.set(c.colId, i));

    // ARIA offsets: header rows precede pinned-top rows precede body rows.
    const modelWithPinned = model as ClientSideRowModel<TData>;
    const pinnedTopCount = modelWithPinned.getPinnedRows ? modelWithPinned.getPinnedRows('top').length : 0;
    const pinnedBottomCount = modelWithPinned.getPinnedRows ? modelWithPinned.getPinnedRows('bottom').length : 0;
    const bodyAriaOffset = this.headerDepth + pinnedTopCount;

    this.updateRootAria(displayed.all.length, rowCount, pinnedTopCount, pinnedBottomCount);

    // Full-width rows: groupDisplayType 'groupRows' group nodes and
    // isFullWidthRow leaf rows render as a single viewport-wide row; region
    // bands skip them.
    const groupRowsMode = ctx.options.get('groupDisplayType') === 'groupRows';
    const isFullWidthFn = ctx.options.get('isFullWidthRow');
    let regionNodes = visibleNodes;
    let fwNodes: RowNode<TData>[] | null = null;
    if (groupRowsMode || isFullWidthFn) {
      regionNodes = [];
      fwNodes = [];
      for (const n of visibleNodes) {
        if ((groupRowsMode && n.group && !n.footer) || (isFullWidthFn && isFullWidthFn({ rowNode: n }) === true)) {
          fwNodes.push(n);
        } else {
          regionNodes.push(n);
        }
      }
    }

    this.bodyBand.render(regionNodes, displayed.left, centerCols, displayed.right, widths, bodyAriaOffset, allColIndex);
    const fwWidth = this.viewportWidth > 0 ? this.viewportWidth : widths.left + widths.center + widths.right;
    this.fullWidthBand.render(fwNodes ?? EMPTY_NODES, fwWidth, bodyAriaOffset, groupRowsMode);

    // pinned rows
    this.renderPinned(displayed, widths, centerCols, allColIndex, rowCount, pinnedTopCount);

    // overlays
    this.updateOverlay(rowCount);

    // autoHeight: one intentional batched READ phase at the end of the frame,
    // after all writes. Only rows whose content version changed since their
    // last measurement are read; height changes route through the row model,
    // which schedules a fresh (write-only) pass.
    if (this.autoHeightCols.length > 0) this.measureAutoHeights(regionNodes);

    if (first !== this.lastVisible.first || last !== this.lastVisible.last) {
      this.lastVisible = { first, last };
      ctx.events.dispatch({
        type: 'viewportChanged',
        api: ctx.api,
        context: ctx.options.get('context'),
      });
    }

    if (!this.firstRenderDone && model.isDataLoaded() && rowCount >= 0) {
      this.firstRenderDone = true;
      ctx.events.dispatch({
        type: 'firstDataRendered',
        api: ctx.api,
        context: ctx.options.get('context'),
      });
    }
  }

  private visibleCenterColumns(center: Column<TData>[]): Column<TData>[] {
    if (this.ctx.options.is('suppressColumnVirtualisation')) return center;
    if (this.viewportWidth <= 0) {
      // Unmeasured viewport (hidden or not-yet-laid-out host): render a
      // bounded prefix instead of every column — at Plank-scale widths
      // (400+ columns) an unbounded fallback builds hundreds of thousands
      // of throwaway cells before the first ResizeObserver tick. The first
      // measured pass replaces this window.
      const out: Column<TData>[] = [];
      let w = 0;
      for (const c of center) {
        out.push(c);
        w += c.actualWidth;
        if (w > 2400) break;
      }
      return out;
    }
    const from = this.scrollLeft;
    const to = this.scrollLeft + this.viewportWidth;
    const out: Column<TData>[] = [];
    for (const c of center) {
      if (c.left + c.actualWidth < from || c.left > to) continue;
      out.push(c);
    }
    return out;
  }

  private renderPinned(
    displayed: { left: Column<TData>[]; center: Column<TData>[]; right: Column<TData>[] },
    widths: { left: number; center: number; right: number },
    centerCols: Column<TData>[],
    allColIndex: Map<string, number>,
    displayedRowCount: number,
    pinnedTopCount: number,
  ): void {
    const model = this.ctx.rowModel as ClientSideRowModel<TData>;
    const top = model.getPinnedRows ? model.getPinnedRows('top') : [];
    const bottom = model.getPinnedRows ? model.getPinnedRows('bottom') : [];
    const rowH = this.ctx.options.get('rowHeight') ?? 32;
    const sizeBand = (
      bandEl: HTMLElement,
      leftEl: HTMLElement,
      rightEl: HTMLElement,
      rows: RowNode<TData>[],
    ) => {
      if (rows.length === 0) {
        bandEl.style.display = 'none';
        return;
      }
      bandEl.style.display = '';
      const h = rows.reduce((s, r) => s + (r.rowHeight || rowH), 0);
      bandEl.style.height = `${h}px`;
      leftEl.style.width = `${widths.left}px`;
      rightEl.style.width = `${widths.right}px`;
      let y = 0;
      for (let i = 0; i < rows.length; i++) {
        rows[i].rowIndex = i;
        rows[i].rowTop = y;
        if (!rows[i].rowHeight) rows[i].rowHeight = rowH;
        y += rows[i].rowHeight;
      }
    };
    sizeBand(this.ePinnedTop, this.ePinnedTopLeft, this.ePinnedTopRight, top);
    sizeBand(this.ePinnedBottom, this.ePinnedBottomLeft, this.ePinnedBottomRight, bottom);
    // ARIA offsets: top band follows the header rows; bottom band follows
    // header + pinned-top + all displayed body rows.
    const topOffset = this.headerDepth;
    const bottomOffset = this.headerDepth + pinnedTopCount + displayedRowCount;
    if (top.length > 0)
      this.topBand.render(top, displayed.left, centerCols, displayed.right, widths, topOffset, allColIndex);
    else this.topBand.clear();
    if (bottom.length > 0)
      this.bottomBand.render(bottom, displayed.left, centerCols, displayed.right, widths, bottomOffset, allColIndex);
    else this.bottomBand.clear();
  }

  /* -------------------------------------------------- root ARIA attributes */

  private updateRootAria(
    colCount: number,
    displayedRowCount: number,
    pinnedTopCount: number,
    pinnedBottomCount: number,
  ): void {
    const ctx = this.ctx;
    // treegrid only while grouping / tree data is active; plain grid otherwise.
    const grouping = ctx.columnModel.getRowGroupColumns().length > 0 || ctx.options.get('treeData') === true;
    const role = grouping ? 'treegrid' : 'grid';
    if (role !== this.lastRootRole) {
      this.eRoot.setAttribute('role', role);
      this.lastRootRole = role;
    }
    const sel = ctx.options.get('rowSelection');
    const multi = (typeof sel === 'string' ? sel : sel?.mode) === 'multiRow';
    if (multi !== this.lastMultiselect) {
      if (multi) this.eRoot.setAttribute('aria-multiselectable', 'true');
      else this.eRoot.removeAttribute('aria-multiselectable');
      this.lastMultiselect = multi;
    }
    const rowTotal = this.headerDepth + pinnedTopCount + displayedRowCount + pinnedBottomCount;
    if (rowTotal !== this.lastAriaRowCount) {
      this.eRoot.setAttribute('aria-rowcount', String(rowTotal));
      this.lastAriaRowCount = rowTotal;
    }
    if (colCount !== this.lastAriaColCount) {
      this.eRoot.setAttribute('aria-colcount', String(colCount));
      this.lastAriaColCount = colCount;
    }
  }

  /* -------------------------------------------- cheap header geometry pass */

  /**
   * When the header is not dirty (e.g. live column resize drag), update the
   * existing header cells' left/width and the region container widths from
   * current column state. Change detection runs against a cached geometry map
   * first, so untouched frames cost one numeric loop and zero DOM work.
   */
  private updateHeaderGeometry(
    displayed: { left: Column<TData>[]; center: Column<TData>[]; right: Column<TData>[]; all: Column<TData>[] },
    widths: { left: number; center: number; right: number },
  ): void {
    let dirty = false;
    for (const c of displayed.all) {
      const g = this.headerGeom.get(c.colId);
      if (!g || g.left !== c.left || g.width !== c.actualWidth) {
        dirty = true;
        break;
      }
    }
    if (!dirty) return;
    // Prefer the HeaderRenderer's cell map when available; fall back to a
    // DOM query (this branch only runs on actual geometry changes).
    const map =
      (this.headerRenderer as unknown as { getHeaderCellMap?: () => Map<string, HTMLElement> }).getHeaderCellMap?.() ??
      null;
    let queried: Map<string, HTMLElement> | null = null;
    if (!map) {
      queried = new Map();
      for (const cell of this.eHeader.querySelectorAll<HTMLElement>('[data-au-header-col]')) {
        queried.set(cell.getAttribute('data-au-header-col')!, cell);
      }
    }
    const lookup = map ?? queried!;
    for (const c of displayed.all) {
      const g = this.headerGeom.get(c.colId);
      if (g && g.left === c.left && g.width === c.actualWidth) continue;
      const cell = lookup.get(c.colId);
      if (cell) {
        cell.style.left = `${c.left}px`;
        cell.style.width = `${c.actualWidth}px`;
      }
      this.headerGeom.set(c.colId, { left: c.left, width: c.actualWidth });
    }
    this.eHeaderLeft.style.width = `${widths.left}px`;
    this.eHeaderRight.style.width = `${widths.right}px`;
    this.eHeaderCenter.style.width = `${widths.center}px`;
    this.eFloatingLeft.style.width = `${widths.left}px`;
    this.eFloatingRight.style.width = `${widths.right}px`;
    this.eFloatingCenter.style.width = `${widths.center}px`;
  }

  /* --------------------------------------------------- autoHeight measuring */

  /**
   * Single batched READ phase (the only intentional layout read in the render
   * path): measure scrollHeight of autoHeight cells for rows whose content
   * version changed since their last measurement, then hand differing heights
   * (>1px) to the row model, which recomputes tops and schedules a new pass.
   */
  private measureAutoHeights(nodes: RowNode<TData>[]): void {
    const model = this.ctx.rowModel as ClientSideRowModel<TData>;
    if (typeof model.setRowHeight !== 'function') return;
    for (const node of nodes) {
      if (this.measuredVersions.get(node.id) === node.__version) continue;
      let h = 0;
      for (const col of this.autoHeightCols) {
        const cell = this.bodyBand.getCellElement(node.id, col.colId);
        if (cell) h = Math.max(h, cell.scrollHeight);
      }
      this.measuredVersions.set(node.id, node.__version);
      if (h > 0 && Math.abs(h - node.rowHeight) > 1) {
        model.setRowHeight(node, h);
      }
    }
  }

  private updateOverlay(rowCount: number): void {
    const loading = this.ctx.options.is('loading') || this.overlayForced === 'loading';
    const noRows =
      this.overlayForced === 'noRows' ||
      (this.ctx.rowModel.isDataLoaded() && rowCount === 0 && this.overlayForced !== 'hidden');
    if (loading) {
      this.eOverlay.hidden = false;
      this.eOverlay.innerHTML = '';
      const panel = el('div', 'au-overlay-panel');
      panel.appendChild(el('span', 'au-loading-spinner'));
      panel.appendChild(document.createTextNode('Loading…'));
      this.eOverlay.appendChild(panel);
    } else if (noRows) {
      this.eOverlay.hidden = false;
      this.eOverlay.innerHTML = '';
      const panel = el('div', 'au-overlay-panel');
      panel.textContent = this.ctx.options.get('overlayNoRowsTemplate') ?? 'No rows to show';
      this.eOverlay.appendChild(panel);
    } else {
      this.eOverlay.hidden = true;
    }
  }

  private overlayForced: 'loading' | 'noRows' | 'hidden' | null = null;
  showOverlay(kind: 'loading' | 'noRows' | 'hidden' | null): void {
    this.overlayForced = kind;
    this.schedule();
  }

  /* ------------------------------------------------------------ public API */

  getPagingContainer(): HTMLElement {
    return this.ePaging;
  }

  getScroll(): { top: number; left: number } {
    return { top: this.scrollTop, left: this.scrollLeft };
  }

  getViewportSize(): { width: number; height: number } {
    return { width: this.viewportWidth, height: this.viewportHeight };
  }

  getVisibleRowRange(): { first: number; last: number } {
    return { ...this.lastVisible };
  }

  ensureIndexVisible(index: number, position: 'top' | 'middle' | 'bottom' | null = null): void {
    const model = this.ctx.rowModel;
    const count = model.getRowCount();
    if (count === 0) return;
    const i = clamp(index, 0, count - 1);
    const top = model.getRowTop(i);
    const height = model.getRowHeightAt(i);
    let newTop = this.scrollTop;
    if (position === 'top') newTop = top;
    else if (position === 'middle') newTop = top - this.viewportHeight / 2 + height / 2;
    else if (position === 'bottom') newTop = top - this.viewportHeight + height;
    else {
      if (top < this.scrollTop) newTop = top;
      else if (top + height > this.scrollTop + this.viewportHeight)
        newTop = top + height - this.viewportHeight;
    }
    newTop = clamp(newTop, 0, Math.max(0, model.getTotalHeight() - this.viewportHeight));
    if (newTop !== this.scrollTop) {
      this.scrollTop = newTop;
      this.eBodyCenterVp.scrollTop = newTop;
      this.schedule();
    }
  }

  ensureColumnVisible(colId: string): void {
    const col = this.ctx.columnModel.getColumn(colId);
    if (!col || col.pinned) return;
    const left = col.left;
    const right = col.left + col.actualWidth;
    let newLeft = this.scrollLeft;
    if (left < this.scrollLeft) newLeft = left;
    else if (right > this.scrollLeft + this.viewportWidth) newLeft = right - this.viewportWidth;
    if (newLeft !== this.scrollLeft) {
      this.scrollLeft = newLeft;
      this.eBodyCenterVp.scrollLeft = newLeft;
      this.schedule();
    }
  }

  getCellElement(pos: CellPosition): HTMLElement | null {
    const band = pos.rowPinned === 'top' ? this.topBand : pos.rowPinned === 'bottom' ? this.bottomBand : this.bodyBand;
    let rowId: string | null = null;
    if (pos.rowPinned) {
      rowId = `pinned-${pos.rowPinned}-${pos.rowIndex}`;
    } else {
      rowId = this.ctx.rowModel.getRow(pos.rowIndex)?.id ?? null;
    }
    if (!rowId) return null;
    return band.getCellElement(rowId, pos.colId);
  }

  /** DOM focus for a11y — focuses the cell element if rendered. */
  focusCellElement(pos: CellPosition): void {
    const cell = this.getCellElement(pos);
    if (cell) cell.focus({ preventScroll: true });
    else this.eRoot.focus({ preventScroll: true });
  }

  refreshCells(params?: { rowIds?: Set<string>; colIds?: Set<string> }): void {
    if (params?.rowIds) {
      this.bodyBand.invalidateRows(params.rowIds, params.colIds);
      this.topBand.invalidateRows(params.rowIds, params.colIds);
      this.bottomBand.invalidateRows(params.rowIds, params.colIds);
    } else {
      this.bodyBand.invalidateAll(params?.colIds);
      this.topBand.invalidateAll(params?.colIds);
      this.bottomBand.invalidateAll(params?.colIds);
    }
    this.fullWidthBand.invalidateAll();
    this.schedule();
  }

  redrawAll(): void {
    this.bodyBand.clear();
    this.topBand.clear();
    this.bottomBand.clear();
    this.fullWidthBand.clear();
    this.measuredVersions.clear();
    this.headerDirty = true;
    this.schedule();
  }

  flashCells(rowIds: Set<string> | null, colIds: Set<string> | null): void {
    const duration = this.ctx.options.get('cellFlashDuration') ?? 700;
    // Two-pass write→read→write: collect all targets, strip the class from
    // every one, do a SINGLE reflow read (restarts the CSS animation), then
    // add the class to all — instead of a write-read-write per cell.
    const targets: HTMLElement[] = [];
    const cols = colIds ?? new Set(this.ctx.columnModel.getDisplayedColumns().map((c) => c.colId));
    const collect = (rowId: string) => {
      for (const colId of cols) {
        const cell = this.bodyBand.getCellElement(rowId, colId);
        if (cell) targets.push(cell);
      }
    };
    if (rowIds) for (const id of rowIds) collect(id);
    else {
      const { first, last } = this.lastVisible;
      for (let i = first; i <= last; i++) {
        const n = this.ctx.rowModel.getRow(i);
        if (n) collect(n.id);
      }
    }
    if (targets.length === 0) return;
    for (const cell of targets) cell.classList.remove('au-cell-flash');
    void targets[0].offsetWidth; // one reflow for the whole batch
    for (const cell of targets) cell.classList.add('au-cell-flash');
    setTimeout(() => {
      for (const cell of targets) cell.classList.remove('au-cell-flash');
    }, duration + 50);
  }

  /** Measure content width for autosize. Uses a hidden measuring element. */
  measureColumnWidth(col: Column<TData>, skipHeader: boolean): number {
    const measurer = el('div');
    measurer.style.cssText =
      'position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;top:0;font-size:inherit;font-family:inherit;';
    this.eRoot.appendChild(measurer);
    let max = 20;
    if (!skipHeader) {
      measurer.textContent = col.getHeaderName();
      max = Math.max(max, measurer.offsetWidth + 40);
    }
    const { first, last } = this.lastVisible;
    const from = Math.max(0, first);
    const to = Math.min(this.ctx.rowModel.getRowCount() - 1, Math.max(last, first + 50));
    for (let i = from; i <= to; i++) {
      const node = this.ctx.rowModel.getRow(i);
      if (!node) continue;
      measurer.textContent = this.ctx.values.getFormattedValue(node, col);
      max = Math.max(max, measurer.offsetWidth + 28);
    }
    measurer.remove();
    return Math.min(max, col.maxWidth);
  }

  destroy(): void {
    this.destroyed = true;
    this.sparklineDomains?.destroy();
    this.sparklineDomains = null;
    for (const type of GridRenderer.HEADER_STRUCTURE_EVENTS) {
      this.ctx.events.removeEventListener(type, this.onColumnStructureChanged);
    }
    if (this.rafId != null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.rafId);
    if (this.scrollEndTimer) clearTimeout(this.scrollEndTimer);
    this.resizeObserver?.disconnect();
    this.headerRenderer.destroy();
    this.bodyBand.destroy();
    this.topBand.destroy();
    this.bottomBand.destroy();
    this.fullWidthBand.destroy();
    this.eRoot.remove();
  }
}
