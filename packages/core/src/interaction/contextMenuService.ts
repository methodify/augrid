import type { GridContext, IContextMenuService } from '../context';
import type { CellPosition } from '../types/base';
import type {
  DefaultMenuItem,
  GetContextMenuItemsParams,
  MenuItemDef,
} from '../types/menu';
import type { Column } from '../columns/column';
import type { RowNode } from '../rows/rowNode';
import type { ClientSideRowModel } from '../rows/clientSideRowModel';
import { buildPivotCellContext } from '../values/pivotContext';
import { MenuPopup, type ResolvedMenuItem } from './menuPopup';

/* ------------------------------------------------ pure item construction */

/** Default item names for a cell, driven by grid state. */
export function buildDefaultItems<TData>(
  ctx: GridContext<TData>,
  column: Column<TData> | null,
): DefaultMenuItem[] {
  const items: DefaultMenuItem[] = ['copy', 'copyWithHeaders', 'cut', 'paste'];
  if (column && column.getColDef().lockPinned !== true) items.push('separator', 'pinSubMenu');
  const grouping =
    ctx.columnModel.getRowGroupColumns().length > 0 || ctx.options.get('treeData') === true;
  if (grouping) items.push('separator', 'expandAll', 'contractAll');
  items.push('separator', 'csvExport');
  return items;
}

/**
 * Resolve a mixed list of names and MenuItemDefs into rendered items,
 * collapsing redundant separators. Names that don't apply here (e.g.
 * pinSubMenu with no column) drop out.
 */
export function resolveMenuItems<TData>(
  ctx: GridContext<TData>,
  items: (DefaultMenuItem | MenuItemDef<TData>)[],
  column: Column<TData> | null,
): ResolvedMenuItem<TData>[] {
  const out: ResolvedMenuItem<TData>[] = [];
  for (const item of items) {
    if (typeof item !== 'string') {
      out.push(item);
      continue;
    }
    if (item === 'separator') {
      out.push('separator');
      continue;
    }
    const def = builtinItem(ctx, item, column);
    if (def) out.push(def);
  }
  const clean: ResolvedMenuItem<TData>[] = [];
  for (const it of out) {
    if (it === 'separator' && (clean.length === 0 || clean[clean.length - 1] === 'separator')) continue;
    clean.push(it);
  }
  while (clean[clean.length - 1] === 'separator') clean.pop();
  return clean;
}

function builtinItem<TData>(
  ctx: GridContext<TData>,
  name: Exclude<DefaultMenuItem, 'separator'>,
  column: Column<TData> | null,
): MenuItemDef<TData> | null {
  const api = ctx.api;
  switch (name) {
    case 'copy':
      return { name: 'Copy', shortcut: 'Ctrl+C', action: () => ctx.clipboard.copy(false) };
    case 'copyWithHeaders':
      return { name: 'Copy with headers', action: () => ctx.clipboard.copy(true) };
    case 'cut':
      return { name: 'Cut', shortcut: 'Ctrl+X', action: () => ctx.clipboard.cut() };
    case 'paste':
      return {
        name: 'Paste',
        shortcut: 'Ctrl+V',
        disabled: ctx.options.get('suppressClipboardPaste') === true,
        action: () => ctx.clipboard.paste(),
      };
    case 'pinSubMenu': {
      if (!column) return null;
      const colId = column.colId;
      const pinned = column.pinned;
      const pin = (p: 'left' | 'right' | null) => () =>
        ctx.columnModel.setColumnsPinned([colId], p, 'contextMenu');
      return {
        name: 'Pin column',
        subMenu: [
          { name: 'Pin left', checked: pinned === 'left', action: pin('left') },
          { name: 'Pin right', checked: pinned === 'right', action: pin('right') },
          { name: 'No pin', checked: pinned == null, action: pin(null) },
        ],
      };
    }
    case 'expandAll':
      return { name: 'Expand all row groups', action: () => api.expandAll() };
    case 'contractAll':
      return { name: 'Collapse all row groups', action: () => api.collapseAll() };
    case 'csvExport':
      return { name: 'Export to CSV', action: () => api.exportDataAsCsv() };
  }
}

/* ------------------------------------------------------------ the service */

/**
 * Right-click / Shift+F10 context menu. Builds the cell's item list
 * (defaults merged through the `getContextMenuItems` hook, with
 * PivotCellContext on aggregate cells) and shows it in a MenuPopup.
 */
export class ContextMenuService<TData = unknown> implements IContextMenuService<TData> {
  private popup: MenuPopup<TData>;
  private lastSource: 'ui' | 'api' = 'ui';

  constructor(private ctx: GridContext<TData>) {
    this.popup = new MenuPopup(
      ctx,
      (items) => resolveMenuItems(ctx, items, null),
      (restoreFocus) => this.onPopupClosed(restoreFocus),
    );
  }

  isOpen(): boolean {
    return this.popup.isOpen();
  }

  showMenuForEvent(pos: CellPosition, e: MouseEvent): boolean {
    const ctx = this.ctx;
    if (ctx.options.is('suppressContextMenu')) return false;
    if ((e.ctrlKey || e.metaKey) && !ctx.options.is('allowContextMenuWithControlKey')) return false;
    const rootRect = ctx.rootEl.getBoundingClientRect();
    return this.show(pos, e.clientX - rootRect.left, e.clientY - rootRect.top, 'ui');
  }

  showMenuAtCell(pos: CellPosition, source: 'ui' | 'api' = 'ui'): boolean {
    const ctx = this.ctx;
    if (ctx.options.is('suppressContextMenu')) return false;
    // Anchor under the cell's bottom-left corner when the cell is rendered.
    const cellEl = ctx.renderer.getCellElement(pos);
    let x = 0;
    let y = 0;
    if (cellEl) {
      const rootRect = ctx.rootEl.getBoundingClientRect();
      const rect = cellEl.getBoundingClientRect();
      x = rect.left - rootRect.left;
      y = rect.bottom - rootRect.top;
    }
    return this.show(pos, x, y, source);
  }

  hideMenu(): void {
    this.lastSource = 'api';
    this.popup.close(false);
  }

  private show(pos: CellPosition, x: number, y: number, source: 'ui' | 'api'): boolean {
    const ctx = this.ctx;
    if (ctx.editing.isEditing()) ctx.editing.stopEditing();

    const column = ctx.columnModel.getColumn(pos.colId) ?? null;
    const node: RowNode<TData> | undefined =
      pos.rowPinned != null
        ? (ctx.rowModel as ClientSideRowModel<TData>).getPinnedRow?.(pos.rowPinned, pos.rowIndex)
        : ctx.rowModel.getRow(pos.rowIndex);

    const defaultItems = buildDefaultItems(ctx, column);
    const params: GetContextMenuItemsParams<TData> = {
      api: ctx.api,
      context: ctx.options.get('context'),
      node,
      column: column ?? undefined,
      colId: column?.colId ?? pos.colId,
      value: node && column ? ctx.values.getValue(node, column) : undefined,
      rowIndex: pos.rowIndex,
      pivot: node && column ? (buildPivotCellContext(ctx, node, column) ?? undefined) : undefined,
      defaultItems,
    };
    const hook = ctx.options.get('getContextMenuItems');
    const rawItems = hook ? hook(params) : defaultItems;
    const items = resolveMenuItems(ctx, rawItems, column);

    this.lastSource = source;
    if (!this.popup.open(items, x, y)) return false;
    ctx.events.dispatch({
      type: 'contextMenuVisibleChanged',
      api: ctx.api,
      context: ctx.options.get('context'),
      visible: true,
      source,
    });
    return true;
  }

  private onPopupClosed(restoreFocus: boolean): void {
    const ctx = this.ctx;
    ctx.events.dispatch({
      type: 'contextMenuVisibleChanged',
      api: ctx.api,
      context: ctx.options.get('context'),
      visible: false,
      source: this.lastSource,
    });
    if (restoreFocus && !ctx.destroyed) {
      const focused = ctx.focus.getFocusedCell();
      if (focused) ctx.renderer.focusCellElement(focused);
      else ctx.rootEl.focus({ preventScroll: true });
    }
  }

  destroy(): void {
    this.popup.destroy();
  }
}
