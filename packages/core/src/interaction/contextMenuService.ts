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
import { el } from '../utils/dom';

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
): (MenuItemDef<TData> | 'separator')[] {
  const out: (MenuItemDef<TData> | 'separator')[] = [];
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
  const clean: (MenuItemDef<TData> | 'separator')[] = [];
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

/* --------------------------------------------------------- the DOM menu */

interface OpenMenu<TData> {
  menuEl: HTMLElement;
  items: (MenuItemDef<TData> | 'separator')[];
  /** Item elements by their index in `items` (separators absent). */
  itemEls: Map<number, HTMLElement>;
  level: number;
  /** Index of the parent menu's item that opened this submenu. */
  parentIdx: number | null;
}

/**
 * Right-click / Shift+F10 context menu. One menu per grid instance; submenus
 * stack. Item lists come from `resolveMenuItems` (app hook merged with
 * defaults); rendering uses textContent only and delegates events at the menu
 * container — no per-item listeners.
 */
export class ContextMenuService<TData = unknown> implements IContextMenuService<TData> {
  private stack: OpenMenu<TData>[] = [];
  private outsideMouseDown: ((e: MouseEvent) => void) | null = null;
  private windowBlur: (() => void) | null = null;
  private scrollListener: (() => void) | null = null;
  private lastSource: 'ui' | 'api' = 'ui';
  private destroyed = false;

  constructor(private ctx: GridContext<TData>) {}

  isOpen(): boolean {
    return this.stack.length > 0;
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
    this.closeAll(false, 'api');
  }

  private show(pos: CellPosition, x: number, y: number, source: 'ui' | 'api'): boolean {
    const ctx = this.ctx;
    if (this.isOpen()) this.closeAll(false, this.lastSource);
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
    if (items.length === 0) return false;

    this.lastSource = source;
    this.openMenu(items, x, y, 0);
    this.installGlobalListeners();
    ctx.events.dispatch({
      type: 'contextMenuVisibleChanged',
      api: ctx.api,
      context: ctx.options.get('context'),
      visible: true,
      source,
    });
    // Focus the first item so keyboard users land in the menu (ARIA menu pattern).
    this.focusItem(this.stack[0]!, 1);
    return true;
  }

  /* ------------------------------------------------------------- rendering */

  private openMenu(
    items: (MenuItemDef<TData> | 'separator')[],
    x: number,
    y: number,
    level: number,
    parentIdx: number | null = null,
  ): void {
    const menuEl = el('div', 'au-menu', { role: 'menu', tabindex: '-1' });
    const itemEls = new Map<number, HTMLElement>();
    items.forEach((item, idx) => {
      if (item === 'separator') {
        menuEl.appendChild(el('div', 'au-menu-sep', { role: 'separator' }));
        return;
      }
      const itemEl = el('div', 'au-menu-item' + (item.cssClass ? ` ${item.cssClass}` : ''), {
        role: 'menuitem',
        tabindex: '-1',
        'data-au-menu-idx': String(idx),
      });
      if (item.disabled) itemEl.setAttribute('aria-disabled', 'true');
      if (item.subMenu) itemEl.setAttribute('aria-haspopup', 'menu');
      const icon = el('span', 'au-menu-icon');
      icon.textContent = item.checked ? '✓' : (item.icon ?? '');
      const nameEl = el('span', 'au-menu-name');
      nameEl.textContent = item.name;
      itemEl.append(icon, nameEl);
      if (item.shortcut && !item.subMenu) {
        const sc = el('span', 'au-menu-shortcut');
        sc.textContent = item.shortcut;
        itemEl.appendChild(sc);
      }
      if (item.subMenu) {
        const arrow = el('span', 'au-menu-arrow');
        arrow.textContent = '›';
        itemEl.appendChild(arrow);
      }
      menuEl.appendChild(itemEl);
      itemEls.set(idx, itemEl);
    });

    menuEl.addEventListener('click', (e) => this.onMenuClick(e));
    menuEl.addEventListener('mouseover', (e) => this.onMenuMouseOver(e));
    menuEl.addEventListener('keydown', (e) => this.onMenuKeyDown(e));
    // Right-click inside the menu must not re-trigger the grid's handler.
    menuEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    this.ctx.rootEl.appendChild(menuEl);
    this.stack.push({ menuEl, items, itemEls, level, parentIdx });
    this.position(menuEl, x, y);
  }

  /** Place at (x,y) within the root, pulled back inside root bounds. Layout read is fine: not a hot path. */
  private position(menuEl: HTMLElement, x: number, y: number): void {
    menuEl.style.left = `${x}px`;
    menuEl.style.top = `${y}px`;
    const rootRect = this.ctx.rootEl.getBoundingClientRect();
    const rect = menuEl.getBoundingClientRect();
    let left = x;
    let top = y;
    if (rect.width > 0 && x + rect.width > rootRect.width) left = Math.max(0, rootRect.width - rect.width);
    if (rect.height > 0 && y + rect.height > rootRect.height) top = Math.max(0, rootRect.height - rect.height);
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
  }

  /* ----------------------------------------------------------- interaction */

  private hitItem(e: Event): { open: OpenMenu<TData>; idx: number; item: MenuItemDef<TData> } | null {
    const target = e.target as Element | null;
    let cur: Element | null = target;
    let itemEl: HTMLElement | null = null;
    while (cur && cur !== this.ctx.rootEl) {
      if ((cur as HTMLElement).hasAttribute?.('data-au-menu-idx')) {
        itemEl = cur as HTMLElement;
        break;
      }
      cur = cur.parentElement;
    }
    if (!itemEl) return null;
    const open = this.stack.find((m) => m.menuEl.contains(itemEl));
    if (!open) return null;
    const idx = Number(itemEl.getAttribute('data-au-menu-idx'));
    const item = open.items[idx];
    if (!item || item === 'separator') return null;
    return { open, idx, item };
  }

  private onMenuClick(e: MouseEvent): void {
    const hit = this.hitItem(e);
    if (!hit) return;
    e.stopPropagation();
    this.activate(hit.open, hit.idx, hit.item);
  }

  private onMenuMouseOver(e: MouseEvent): void {
    const hit = this.hitItem(e);
    if (!hit) return;
    // Hovering an item at level L closes any deeper submenus…
    this.closeDeeperThan(hit.open.level);
    // …and opens this item's submenu, if it has one.
    if (hit.item.subMenu && !hit.item.disabled) this.openSubMenu(hit.open, hit.idx, hit.item, false);
  }

  private activate(open: OpenMenu<TData>, idx: number, item: MenuItemDef<TData>): void {
    if (item.disabled) return;
    if (item.subMenu) {
      this.closeDeeperThan(open.level);
      this.openSubMenu(open, idx, item, true);
      return;
    }
    const action = item.action;
    this.closeAll(true, this.lastSource);
    action?.();
  }

  private openSubMenu(parent: OpenMenu<TData>, idx: number, item: MenuItemDef<TData>, focus: boolean): void {
    // Already open for this item? (mouseover fires repeatedly)
    if (this.stack.length > parent.level + 1) return;
    const itemEl = parent.itemEls.get(idx);
    if (!itemEl || !item.subMenu) return;
    const items = resolveMenuItems(this.ctx, item.subMenu, null);
    if (items.length === 0) return;
    const rootRect = this.ctx.rootEl.getBoundingClientRect();
    const menuRect = parent.menuEl.getBoundingClientRect();
    const itemRect = itemEl.getBoundingClientRect();
    this.openMenu(items, menuRect.right - rootRect.left - 2, itemRect.top - rootRect.top - 4, parent.level + 1, idx);
    if (focus) this.focusItem(this.stack[this.stack.length - 1]!, 1);
  }

  private onMenuKeyDown(e: KeyboardEvent): void {
    const open = this.stack.find((m) => m.menuEl.contains(e.target as Node));
    if (!open) return;
    e.stopPropagation();
    switch (e.key) {
      case 'ArrowDown':
        this.focusItem(open, 1);
        e.preventDefault();
        return;
      case 'ArrowUp':
        this.focusItem(open, -1);
        e.preventDefault();
        return;
      case 'Home':
      case 'End':
        this.focusItem(open, e.key === 'Home' ? 1 : -1, true);
        e.preventDefault();
        return;
      case 'Enter':
      case ' ': {
        const hit = this.hitItem(e);
        if (hit) this.activate(hit.open, hit.idx, hit.item);
        e.preventDefault();
        return;
      }
      case 'ArrowRight': {
        const hit = this.hitItem(e);
        if (hit && hit.item.subMenu) this.activate(hit.open, hit.idx, hit.item);
        e.preventDefault();
        return;
      }
      case 'ArrowLeft':
        if (open.level > 0) {
          const parentIdx = open.parentIdx;
          this.closeDeeperThan(open.level - 1);
          const parent = this.stack[this.stack.length - 1];
          if (parent && parentIdx != null) {
            parent.itemEls.get(parentIdx)?.focus({ preventScroll: true });
          } else if (parent) {
            this.focusItem(parent, 1);
          }
        }
        e.preventDefault();
        return;
      case 'Escape':
      case 'Tab':
        this.closeAll(true, this.lastSource);
        e.preventDefault();
        return;
    }
  }

  /**
   * Roving focus among menu items. dir ±1 steps (with wrap) from the
   * currently focused item; `fromEdge` jumps to first/last.
   */
  private focusItem(open: OpenMenu<TData>, dir: 1 | -1, fromEdge = false): void {
    const indices = [...open.itemEls.keys()];
    if (indices.length === 0) return;
    const active = open.menuEl.contains(document.activeElement)
      ? indices.findIndex((i) => open.itemEls.get(i) === document.activeElement)
      : -1;
    const next =
      fromEdge || active < 0
        ? dir === 1
          ? 0
          : indices.length - 1
        : (active + dir + indices.length) % indices.length;
    open.itemEls.get(indices[next]!)?.focus({ preventScroll: true });
  }

  /* -------------------------------------------------------------- teardown */

  private closeDeeperThan(level: number): void {
    while (this.stack.length > level + 1) {
      const top = this.stack.pop()!;
      top.menuEl.remove();
    }
  }

  private closeAll(restoreFocus: boolean, source: 'ui' | 'api'): void {
    if (!this.isOpen()) return;
    for (const m of this.stack) m.menuEl.remove();
    this.stack = [];
    this.removeGlobalListeners();
    const ctx = this.ctx;
    ctx.events.dispatch({
      type: 'contextMenuVisibleChanged',
      api: ctx.api,
      context: ctx.options.get('context'),
      visible: false,
      source,
    });
    if (restoreFocus && !ctx.destroyed) {
      const focused = ctx.focus.getFocusedCell();
      if (focused) ctx.renderer.focusCellElement(focused);
      else ctx.rootEl.focus({ preventScroll: true });
    }
  }

  private installGlobalListeners(): void {
    if (this.outsideMouseDown) return;
    this.outsideMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && this.stack.some((m) => m.menuEl.contains(target))) return;
      this.closeAll(false, this.lastSource);
    };
    document.addEventListener('mousedown', this.outsideMouseDown, true);
    this.windowBlur = () => this.closeAll(false, this.lastSource);
    window.addEventListener('blur', this.windowBlur);
    const onScroll = () => this.closeAll(false, this.lastSource);
    this.ctx.events.addEventListener('bodyScroll', onScroll);
    this.scrollListener = () => this.ctx.events.removeEventListener('bodyScroll', onScroll);
  }

  private removeGlobalListeners(): void {
    if (this.outsideMouseDown) {
      document.removeEventListener('mousedown', this.outsideMouseDown, true);
      this.outsideMouseDown = null;
    }
    if (this.windowBlur) {
      window.removeEventListener('blur', this.windowBlur);
      this.windowBlur = null;
    }
    this.scrollListener?.();
    this.scrollListener = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const m of this.stack) m.menuEl.remove();
    this.stack = [];
    this.removeGlobalListeners();
  }
}
