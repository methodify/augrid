import type { GridContext } from '../context';
import type { DefaultMenuItem, MenuItemDef } from '../types/menu';
import { el } from '../utils/dom';

export type ResolvedMenuItem<TData> = MenuItemDef<TData> | 'separator';

interface OpenMenu<TData> {
  menuEl: HTMLElement;
  items: ResolvedMenuItem<TData>[];
  /** Item elements by their index in `items` (separators absent). */
  itemEls: Map<number, HTMLElement>;
  level: number;
  /** Index of the parent menu's item that opened this submenu. */
  parentIdx: number | null;
}

/**
 * Generic anchored menu surface shared by the context menu and the column
 * header menu. Owns the DOM (stacked submenus), keyboard interaction (roving
 * focus, Arrow/Home/End/Enter/Escape), hover-opened submenus, and
 * outside-click/scroll/blur dismissal. Rendering is textContent-only and all
 * listeners are delegated at menu containers.
 *
 * The owner supplies resolved items and a submenu resolver, and gets one
 * `onClosed(restoreFocus)` callback per full dismissal (events + focus
 * restoration stay the owner's job).
 */
export class MenuPopup<TData = unknown> {
  private stack: OpenMenu<TData>[] = [];
  private outsideMouseDown: ((e: MouseEvent) => void) | null = null;
  private windowBlur: (() => void) | null = null;
  private scrollListener: (() => void) | null = null;

  constructor(
    private ctx: GridContext<TData>,
    private resolveSub: (items: (DefaultMenuItem | MenuItemDef<TData>)[]) => ResolvedMenuItem<TData>[],
    private onClosed: (restoreFocus: boolean) => void,
  ) {}

  isOpen(): boolean {
    return this.stack.length > 0;
  }

  /** Open the root menu at root-relative (x,y). Returns false for an empty list. */
  open(items: ResolvedMenuItem<TData>[], x: number, y: number): boolean {
    if (items.length === 0) return false;
    if (this.isOpen()) this.close(false);
    this.openMenu(items, x, y, 0);
    this.installGlobalListeners();
    this.focusItem(this.stack[0]!, 1);
    return true;
  }

  close(restoreFocus: boolean): void {
    if (!this.isOpen()) return;
    for (const m of this.stack) m.menuEl.remove();
    this.stack = [];
    this.removeGlobalListeners();
    this.onClosed(restoreFocus);
  }

  destroy(): void {
    for (const m of this.stack) m.menuEl.remove();
    this.stack = [];
    this.removeGlobalListeners();
  }

  /* ------------------------------------------------------------- rendering */

  private openMenu(
    items: ResolvedMenuItem<TData>[],
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
    this.close(true);
    action?.();
  }

  private openSubMenu(parent: OpenMenu<TData>, idx: number, item: MenuItemDef<TData>, focus: boolean): void {
    // Already open for this item? (mouseover fires repeatedly)
    if (this.stack.length > parent.level + 1) return;
    const itemEl = parent.itemEls.get(idx);
    if (!itemEl || !item.subMenu) return;
    const items = this.resolveSub(item.subMenu);
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
        this.close(true);
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

  private installGlobalListeners(): void {
    if (this.outsideMouseDown) return;
    this.outsideMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && this.stack.some((m) => m.menuEl.contains(target))) return;
      this.close(false);
    };
    document.addEventListener('mousedown', this.outsideMouseDown, true);
    this.windowBlur = () => this.close(false);
    window.addEventListener('blur', this.windowBlur);
    const onScroll = () => this.close(false);
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
}
