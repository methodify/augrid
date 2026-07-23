import type { GridApi } from './api.js';
import type { IColumn } from './column.js';
import type { IRowNode } from './rowNode.js';
import type { PivotCellContext } from './pivot.js';

/** Built-in context-menu item names, usable in `getContextMenuItems` results. */
export type DefaultMenuItem =
  | 'copy'
  | 'copyWithHeaders'
  | 'cut'
  | 'paste'
  | 'pinSubMenu'
  | 'expandAll'
  | 'contractAll'
  | 'csvExport'
  | 'separator';

export interface MenuItemDef<TData = unknown> {
  /** Display text. Rendered via textContent — plain text only. */
  name: string;
  /** Invoked on activation; the menu closes first. Ignored when `subMenu` is set. */
  action?: () => void;
  disabled?: boolean;
  /** Short text/emoji glyph rendered in the leading icon slot. */
  icon?: string;
  /** Display-only shortcut hint, right-aligned (the menu wires no keys). */
  shortcut?: string;
  /** Renders a check glyph in the icon slot (e.g. current pin state). */
  checked?: boolean;
  /** Extra class(es) on the item element. */
  cssClass?: string;
  /** Nested items; the item opens a submenu instead of running an action. */
  subMenu?: (DefaultMenuItem | MenuItemDef<TData>)[];
}

export interface GetContextMenuItemsParams<TData = unknown> {
  api: GridApi<TData>;
  context: unknown;
  /** Row the menu was opened on. */
  node?: IRowNode<TData>;
  column?: IColumn<TData>;
  colId?: string;
  value?: unknown;
  rowIndex?: number;
  /**
   * Intersection coordinates when the cell has group/pivot context (see
   * PivotCellContext) — drill-through and allocation actions key off this.
   */
  pivot?: PivotCellContext<TData>;
  /** The item names the grid would show by default at this cell. */
  defaultItems: DefaultMenuItem[];
}

export type GetContextMenuItems<TData = unknown> = (
  params: GetContextMenuItemsParams<TData>,
) => (DefaultMenuItem | MenuItemDef<TData>)[];
