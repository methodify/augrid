/**
 * Test harness: builds a GridContext with REAL kernel pieces (options, events,
 * values, columnModel, clientSideRowModel) and inert stubs for interaction
 * services + renderer. Tests for a service replace the relevant stub with the
 * real class (assign onto ctx before calling start()).
 */
import type { GridContext, IFilterManager, ISortController } from '../context';
import type { GridOptions } from '../types/gridOptions';
import { OptionsService } from '../options';
import { EventService } from '../events/eventService';
import { ValueService } from '../values/valueService';
import { ColumnModel } from '../columns/columnModel';
import { ClientSideRowModel } from '../rows/clientSideRowModel';
import { createGridApi } from '../gridApi';
import type { SortModelItem } from '../types/base';

export interface MockContextResult<TData> {
  ctx: GridContext<TData>;
  /** Call after replacing stubs to load data & run the pipeline. */
  start: () => void;
}

export function createMockContext<TData = unknown>(
  options: GridOptions<TData> = {},
): MockContextResult<TData> {
  const ctx = { gridId: 'test-grid', destroyed: false } as unknown as GridContext<TData>;

  ctx.options = new OptionsService<TData>(options);
  ctx.events = new EventService<TData>();
  ctx.values = new ValueService(ctx);
  ctx.columnModel = new ColumnModel(ctx);
  ctx.scheduleRender = () => {};
  ctx.renderNow = () => {};

  // ----- inert stubs (replace with real services in module tests) -----
  ctx.sort = createStubSort(ctx);
  ctx.filters = createStubFilters();
  ctx.selection = {
    isSelected: () => false,
    setSelected: () => {},
    handleRowClick: () => {},
    handleHeaderCheckbox: () => {},
    getSelectedNodes: () => [],
    selectAll: () => {},
    deselectAll: () => {},
    getHeaderState: () => false,
    refresh: () => {},
    destroy: () => {},
  };
  ctx.focus = {
    getFocusedCell: () => null,
    setFocusedCell: () => {},
    clearFocusedCell: () => {},
    onKeyDown: () => {},
    navigateBy: () => null,
    destroy: () => {},
  };
  ctx.editing = {
    isEditing: () => false,
    isEditingCell: () => false,
    getEditingCells: () => [],
    startEditing: () => false,
    stopEditing: () => false,
    mountEditorInto: () => {},
    commitValue: (node, colId, newValue, source) => ctx.values.setValue(node, colId, newValue, source),
    destroy: () => {},
  };
  ctx.range = null;
  ctx.clipboard = {
    copy: () => {},
    cut: () => {},
    paste: () => {},
    getCopyText: () => '',
    destroy: () => {},
  };
  ctx.contextMenu = null;
  ctx.undoRedo = null;
  ctx.pagination = null;
  ctx.columnDrag = null;
  ctx.columnResize = null;
  ctx.tooltips = null;
  ctx.frameworkAdapter = null;

  // renderer stub: only what kernel/services call.
  ctx.renderer = {
    schedule: () => {},
    renderNow: () => {},
    markHeaderDirty: () => {},
    ensureIndexVisible: () => {},
    ensureColumnVisible: () => {},
    getCellElement: () => null,
    focusCellElement: () => {},
    refreshCells: () => {},
    redrawAll: () => {},
    flashCells: () => {},
    showOverlay: () => {},
    measureColumnWidth: () => 100,
    getVisibleRowRange: () => ({ first: 0, last: 100 }),
    getScroll: () => ({ top: 0, left: 0 }),
    getViewportSize: () => ({ width: 1000, height: 600 }),
    getPagingContainer: () => document.createElement('div'),
    eRoot: typeof document !== 'undefined' ? document.createElement('div') : (null as never),
    destroy: () => {},
  } as unknown as GridContext<TData>['renderer'];

  ctx.rowModel = new ClientSideRowModel(ctx);
  ctx.api = createGridApi(ctx);
  ctx.columnModel.setColumnDefs(ctx.options.get('columnDefs') ?? []);

  return {
    ctx,
    start: () => ctx.rowModel.start(),
  };
}

function createStubSort<TData>(ctx: GridContext<TData>): ISortController<TData> {
  return {
    getSortModel: (): SortModelItem[] => {
      const cols = ctx.columnModel
        .getPrimaryColumns()
        .filter((c) => c.sort != null)
        .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
      return cols.map((c) => ({ colId: c.colId, sort: c.sort as 'asc' | 'desc' }));
    },
    setSortModel: (model) => {
      for (const c of ctx.columnModel.getPrimaryColumns()) {
        const item = model.find((m) => m.colId === c.colId);
        c.sort = item?.sort ?? null;
        c.sortIndex = item ? model.indexOf(item) : null;
      }
      ctx.rowModel.onSortChanged();
    },
    progressSort: () => {},
    destroy: () => {},
  };
}

function createStubFilters<TData>(): IFilterManager<TData> {
  return {
    getModel: () => ({}),
    setModel: () => {},
    getColumnModel_: () => null,
    setColumnModel_: () => {},
    isColumnActive: () => false,
    isAnyFilterActive: () => false,
    createPredicate: () => null,
    getSetValues: () => [],
    mountFloatingFilter: () => () => {},
    destroy: () => {},
  };
}
