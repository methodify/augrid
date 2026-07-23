import type { GridContext, ISideBarService, ToolPanelId } from '../../context.js';
import type { GridOptions } from '../../types/gridOptions.js';
import { el } from '../../utils/dom.js';
import { ColumnsPanel } from './columnsPanel.js';
import { FiltersPanel } from './filtersPanel.js';

export interface ResolvedSideBar {
  panels: ToolPanelId[];
  defaultOpen: ToolPanelId | null;
  position: 'left' | 'right';
}

/** Normalize the `sideBar` option's shorthand forms. Null = no side bar. */
export function resolveSideBarDef(opt: GridOptions['sideBar']): ResolvedSideBar | null {
  if (!opt) return null;
  if (opt === true) return { panels: ['columns', 'filters'], defaultOpen: null, position: 'right' };
  if (typeof opt === 'string') return { panels: [opt], defaultOpen: null, position: 'right' };
  const panels = opt.panels ?? ['columns', 'filters'];
  if (panels.length === 0) return null;
  return {
    panels,
    defaultOpen: opt.defaultOpen ?? null,
    position: opt.position ?? 'right',
  };
}

const PANEL_TITLES: Record<ToolPanelId, string> = { columns: 'Columns', filters: 'Filters' };

interface PanelCtrl {
  refresh(): void;
  destroy(): void;
}

/**
 * Tool-panel side bar: a vertical tab strip plus one open panel (columns
 * chooser with group/value/pivot drop zones, or the filters panel). Docks
 * beside the grid's main pane in the renderer's side-bar host.
 */
export class SideBarService<TData = unknown> implements ISideBarService<TData> {
  private def: ResolvedSideBar | null;
  private ePanelArea: HTMLElement | null = null;
  private buttons = new Map<ToolPanelId, HTMLElement>();
  private panels = new Map<ToolPanelId, { container: HTMLElement; ctrl: PanelCtrl }>();
  private openId: ToolPanelId | null = null;
  private visible = false;

  constructor(
    private ctx: GridContext<TData>,
    private host: HTMLElement,
  ) {
    this.def = resolveSideBarDef(ctx.options.get('sideBar'));
    if (!this.def) return;
    this.build(this.def);
    this.setVisible(true);
    if (this.def.defaultOpen && this.def.panels.includes(this.def.defaultOpen)) {
      this.openPanel(this.def.defaultOpen);
    }
  }

  private build(def: ResolvedSideBar): void {
    this.host.classList.toggle('au-sidebar-left', def.position === 'left');
    const bar = el('div', 'au-sidebar');
    this.ePanelArea = el('div', 'au-sidebar-panel');
    this.ePanelArea.style.display = 'none';
    const strip = el('div', 'au-sidebar-buttons', { role: 'tablist', 'aria-label': 'Tool panels' });
    for (const id of def.panels) {
      const btn = el('div', 'au-sidebar-btn', {
        role: 'tab',
        tabindex: '0',
        'aria-selected': 'false',
        'data-au-panel-btn': id,
      });
      btn.textContent = PANEL_TITLES[id];
      strip.appendChild(btn);
      this.buttons.set(id, btn);
    }
    strip.addEventListener('click', (e) => this.onStripActivate(e));
    strip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        this.onStripActivate(e);
        e.preventDefault();
        e.stopPropagation();
      }
    });
    bar.append(this.ePanelArea, strip);
    this.host.appendChild(bar);
  }

  private onStripActivate(e: Event): void {
    const target = (e.target as HTMLElement).closest?.('[data-au-panel-btn]') as HTMLElement | null;
    if (!target) return;
    const id = target.getAttribute('data-au-panel-btn') as ToolPanelId;
    if (this.openId === id) this.closePanel();
    else this.openPanel(id);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.host.style.display = visible ? '' : 'none';
  }

  isVisible(): boolean {
    return this.visible;
  }

  openPanel(id: ToolPanelId): void {
    if (!this.def || !this.def.panels.includes(id) || !this.ePanelArea) return;
    if (!this.visible) this.setVisible(true);
    let entry = this.panels.get(id);
    if (!entry) {
      const container = el('div', 'au-panel-body');
      this.ePanelArea.appendChild(container);
      const ctrl: PanelCtrl =
        id === 'columns' ? new ColumnsPanel(this.ctx, container) : new FiltersPanel(this.ctx, container);
      entry = { container, ctrl };
      this.panels.set(id, entry);
    }
    this.openId = id;
    this.ePanelArea.style.display = '';
    for (const [pid, p] of this.panels) p.container.style.display = pid === id ? '' : 'none';
    for (const [pid, btn] of this.buttons) {
      btn.classList.toggle('au-selected', pid === id);
      btn.setAttribute('aria-selected', pid === id ? 'true' : 'false');
    }
    entry.ctrl.refresh();
    this.dispatchVisibleChanged();
  }

  closePanel(): void {
    if (this.openId == null) return;
    this.openId = null;
    if (this.ePanelArea) this.ePanelArea.style.display = 'none';
    for (const btn of this.buttons.values()) {
      btn.classList.remove('au-selected');
      btn.setAttribute('aria-selected', 'false');
    }
    this.dispatchVisibleChanged();
  }

  getOpenedPanel(): ToolPanelId | null {
    return this.openId;
  }

  private dispatchVisibleChanged(): void {
    this.ctx.events.dispatch({
      type: 'toolPanelVisibleChanged',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      open: this.openId,
    });
  }

  destroy(): void {
    for (const p of this.panels.values()) p.ctrl.destroy();
    this.panels.clear();
    this.buttons.clear();
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);
    this.host.style.display = 'none';
    this.host.classList.remove('au-sidebar-left');
  }
}
