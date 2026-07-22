import type { GridOptions } from './types/gridOptions';
import type { GridApi } from './types/api';
import type { GridContext } from './context';
import { OptionsService } from './options';
import { EventService } from './events/eventService';
import { effect } from './state/store';
import { ValueService } from './values/valueService';
import { ColumnModel } from './columns/columnModel';
import { ClientSideRowModel } from './rows/clientSideRowModel';
import { InfiniteRowModel } from './rows/infiniteRowModel';
import { GridRenderer } from './render/renderer';
import { createGridApi } from './gridApi';
import { injectStyles, applyTheme } from './style/theme';
import { nextId } from './utils/general';

import { FocusService } from './interaction/focusService';
import { SelectionService } from './interaction/selectionService';
import { RangeService } from './interaction/rangeService';
import { EditingService } from './interaction/editingService';
import { ClipboardService } from './interaction/clipboardService';
import { ContextMenuService } from './interaction/contextMenuService';
import { ColumnMenuService } from './interaction/columnMenuService';
import { SideBarService } from './features/sideBar/sideBarService';
import { FindService } from './features/findService';
import { ColumnDragService } from './interaction/columnDragService';
import { ColumnResizeService } from './interaction/columnResizeService';
import { FilterManager } from './features/filters/filterManager';
import { SortController } from './features/sortController';
import { UndoRedoService } from './features/undoRedo';
import { PaginationService } from './features/pagination';
import { TooltipService } from './features/tooltips';

/**
 * Composition root. Boot order matters: options/events → value/column/row
 * models → renderer → interaction services → start.
 */
export class Grid<TData = unknown> {
  readonly api: GridApi<TData>;
  private ctx: GridContext<TData>;

  constructor(hostEl: HTMLElement, options: GridOptions<TData>) {
    const root = hostEl.getRootNode();
    injectStyles(root instanceof ShadowRoot ? root : document);

    const ctx = {
      gridId: nextId('au-grid'),
      rootEl: undefined as unknown as HTMLElement,
      destroyed: false,
    } as unknown as GridContext<TData>;
    this.ctx = ctx;

    ctx.options = new OptionsService<TData>(options);
    ctx.events = new EventService<TData>();
    ctx.api = this.api = createGridApi(ctx);
    ctx.values = new ValueService(ctx);
    ctx.columnModel = new ColumnModel(ctx);
    ctx.scheduleRender = () => ctx.renderer?.schedule();
    ctx.renderNow = () => ctx.renderer?.renderNow();

    // Interaction/features that the models call into must exist before boot.
    ctx.sort = new SortController(ctx);
    ctx.filters = new FilterManager(ctx);

    ctx.rowModel =
      ctx.options.get('rowModelType') === 'infinite'
        ? new InfiniteRowModel(ctx)
        : new ClientSideRowModel(ctx);

    ctx.columnModel.setColumnDefs(ctx.options.get('columnDefs') ?? []);

    ctx.renderer = new GridRenderer(ctx, hostEl);
    (ctx as { rootEl: HTMLElement }).rootEl = ctx.renderer.eRoot;
    applyTheme(ctx.renderer.eRoot, ctx.options.get('theme'));

    ctx.selection = new SelectionService(ctx);
    ctx.focus = new FocusService(ctx);
    ctx.editing = new EditingService(ctx);
    const cellSel = ctx.options.get('cellSelection');
    ctx.range = cellSel ? new RangeService(ctx) : null;
    ctx.clipboard = new ClipboardService(ctx);
    ctx.contextMenu = new ContextMenuService(ctx);
    ctx.columnMenu = new ColumnMenuService(ctx);
    ctx.undoRedo = ctx.options.is('undoRedoCellEditing') ? new UndoRedoService(ctx) : null;
    ctx.pagination = ctx.options.is('pagination') ? new PaginationService(ctx) : null;
    ctx.columnDrag = new ColumnDragService(ctx);
    ctx.columnResize = new ColumnResizeService(ctx);
    ctx.tooltips = new TooltipService(ctx);
    ctx.sideBar = new SideBarService(ctx, ctx.renderer.getSideBarHost());
    ctx.find = new FindService(ctx);
    ctx.frameworkAdapter = null;

    (ctx as unknown as { __destroyGrid: () => void }).__destroyGrid = () => this.destroy();

    // Bridge events to GridOptions `onXxx` callbacks (looked up per dispatch so
    // updated options keep working).
    ctx.events.addGlobalListener((type, event) => {
      const cb = (ctx.options.raw() as Record<string, unknown>)[
        'on' + type.charAt(0).toUpperCase() + type.slice(1)
      ];
      if (typeof cb === 'function') cb(event);
    });

    // enableCellChangeFlash: flash a cell when its value changes, when enabled
    // grid-wide or on the changed column's colDef (colDef `false` opts out of
    // the grid-wide setting).
    ctx.events.addEventListener('cellValueChanged', (e) => {
      const colFlash = e.colDef?.enableCellChangeFlash;
      const enabled = colFlash === true || (ctx.options.is('enableCellChangeFlash') && colFlash !== false);
      if (enabled && e.node?.id != null) {
        ctx.renderer.flashCells(new Set([e.node.id]), new Set([e.colId]));
      }
    });

    this.wireOptionChanges();

    // Apply initial state before first data.
    const initialState = ctx.options.get('initialState');
    if (initialState?.columns) ctx.columnModel.applyColumnState({ state: initialState.columns, applyOrder: true });
    if (initialState?.filter) ctx.filters.setModel(initialState.filter as never, 'initialState');

    ctx.rowModel.start();
    ctx.pagination?.mountPanel(ctx.renderer.getPagingContainer());
    ctx.renderer.markHeaderDirty();
    ctx.renderer.renderNow();

    if (initialState?.expandedGroups && ctx.rowModel instanceof ClientSideRowModel) {
      ctx.rowModel.setExpandedGroupPaths(initialState.expandedGroups);
    }

    ctx.events.dispatch({
      type: 'gridReady',
      api: ctx.api,
      context: ctx.options.get('context'),
    });
  }

  getContext(): GridContext<TData> {
    return this.ctx;
  }

  private stopOptionsEffect: (() => void) | null = null;

  private wireOptionChanges(): void {
    const ctx = this.ctx;
    let lastTick = 0;
    this.stopOptionsEffect = effect(() => {
      const { keys, tick } = ctx.options.changed();
      if (tick === lastTick) return;
      lastTick = tick;
      this.onOptionsChanged(keys);
    });
  }

  private onOptionsChanged(keys: (keyof GridOptions<TData>)[]): void {
    const ctx = this.ctx;
    const has = (k: keyof GridOptions<TData>) => keys.includes(k);

    if (has('columnDefs') || has('defaultColDef') || has('columnTypes')) {
      ctx.columnModel.setColumnDefs(ctx.options.get('columnDefs') ?? []);
      ctx.rowModel.refreshModel?.('group');
      ctx.renderer.markHeaderDirty();
      // Column definition changes must invalidate already-rendered body cells
      // (formatters/renderers/classes may all have changed).
      ctx.renderer.refreshCells();
    }
    if (has('rowData')) {
      const data = ctx.options.get('rowData');
      if (data && ctx.rowModel.setRowData) ctx.rowModel.setRowData(data);
    }
    if (has('pinnedTopRowData') || has('pinnedBottomRowData')) {
      (ctx.rowModel as ClientSideRowModel<TData>).refreshPinnedRows?.();
    }
    if (has('quickFilterText')) {
      ctx.rowModel.onFilterChanged();
    }
    if (has('pivotMode')) {
      ctx.columnModel.invalidate();
      ctx.rowModel.refreshModel?.('group');
      ctx.renderer.markHeaderDirty();
      ctx.events.dispatch({ type: 'pivotModeChanged', api: ctx.api, context: ctx.options.get('context') });
    }
    if (has('groupDisplayType') || has('groupTotalRow') || has('grandTotalRow') || has('groupDefaultExpanded') || has('treeData') || has('getDataPath')) {
      ctx.columnModel.invalidate();
      ctx.rowModel.refreshModel?.('group');
      ctx.renderer.markHeaderDirty();
    }
    if (has('theme')) {
      applyTheme(ctx.renderer.eRoot, ctx.options.get('theme'));
    }
    if (has('rowHeight') || has('getRowHeight')) {
      ctx.rowModel.refreshModel?.('flatten');
    }
    if (has('pagination')) {
      if (ctx.options.is('pagination') && !ctx.pagination) {
        ctx.pagination = new PaginationService(ctx);
        ctx.pagination.mountPanel(ctx.renderer.getPagingContainer());
      } else if (!ctx.options.is('pagination') && ctx.pagination) {
        ctx.pagination.destroy();
        ctx.pagination = null;
        (ctx.rowModel as ClientSideRowModel<TData>).clearPageWindow?.();
      }
    }
    if (has('paginationPageSize')) {
      ctx.pagination?.setPageSize(ctx.options.get('paginationPageSize') ?? 100);
    }
    if (has('cellSelection')) {
      const want = !!ctx.options.get('cellSelection');
      if (want && !ctx.range) ctx.range = new RangeService(ctx);
      else if (!want && ctx.range) {
        ctx.range.destroy();
        ctx.range = null;
      }
    }
    if (has('rowSelection')) {
      ctx.columnModel.invalidate();
      ctx.renderer.markHeaderDirty();
    }
    if (has('datasource') && ctx.rowModel.type === 'infinite') {
      ctx.rowModel.purgeCache?.();
    }
    if (has('loading')) {
      ctx.renderer.showOverlay(null);
    }
    if (has('floatingFilter')) {
      ctx.renderer.markHeaderDirty();
    }
    if (has('sideBar')) {
      ctx.sideBar?.destroy();
      ctx.sideBar = new SideBarService(ctx, ctx.renderer.getSideBarHost());
    }
    if (has('suppressHeaderMenuButton')) {
      ctx.renderer.markHeaderDirty();
    }
    ctx.scheduleRender();
  }

  destroy(): void {
    const ctx = this.ctx;
    if (ctx.destroyed) return;
    ctx.destroyed = true;
    this.stopOptionsEffect?.();
    ctx.events.dispatch({
      type: 'gridPreDestroyed',
      api: ctx.api,
      context: ctx.options.get('context'),
    });
    ctx.find?.destroy();
    ctx.sideBar?.destroy();
    ctx.tooltips?.destroy();
    ctx.columnResize?.destroy();
    ctx.columnDrag?.destroy();
    ctx.pagination?.destroy();
    ctx.undoRedo?.destroy();
    ctx.columnMenu?.destroy();
    ctx.contextMenu?.destroy();
    ctx.clipboard.destroy();
    ctx.range?.destroy();
    ctx.editing.destroy();
    ctx.focus.destroy();
    ctx.selection.destroy();
    ctx.filters.destroy();
    ctx.sort.destroy();
    ctx.rowModel.destroy();
    ctx.renderer.destroy();
    ctx.events.destroy();
  }
}

/** Create a grid attached to `el`. Returns the GridApi. */
export function createGrid<TData = unknown>(
  el: HTMLElement,
  options: GridOptions<TData>,
): GridApi<TData> {
  const grid = new Grid<TData>(el, options);
  return grid.api;
}
