import type { GridContext } from '../../context';
import type { Column } from '../../columns/column';
import type { FilterManager } from '../filters/filterManager';
import { mountFloatingFilter } from '../filters/floatingFilters';
import { el, clearChildren } from '../../utils/dom';

interface Entry {
  colId: string;
  dot: HTMLElement;
  clearBtn: HTMLElement;
}

/**
 * Filters tool panel: every filterable column with its filter UI mounted
 * inline (the same components as the floating filter row — one source of
 * truth in the FilterManager). Structural column changes rebuild; filter
 * model changes only repaint the active indicators.
 */
export class FiltersPanel<TData = unknown> {
  private entries: Entry[] = [];
  private cleanups: (() => void)[] = [];
  private unsubs: (() => void)[] = [];

  constructor(
    private ctx: GridContext<TData>,
    private container: HTMLElement,
  ) {
    // Panel keys (typing in filter inputs) must not reach the grid dispatcher.
    container.addEventListener('keydown', (e) => e.stopPropagation());
    container.addEventListener('click', (e) => this.onClick(e));

    const rebuild = (): void => this.renderBody();
    const repaint = (): void => this.updateIndicators();
    for (const type of ['displayedColumnsChanged', 'newColumnsLoaded'] as const) {
      this.ctx.events.addEventListener(type, rebuild);
      this.unsubs.push(() => this.ctx.events.removeEventListener(type, rebuild));
    }
    this.ctx.events.addEventListener('filterChanged', repaint);
    this.unsubs.push(() => this.ctx.events.removeEventListener('filterChanged', repaint));

    this.renderBody();
  }

  refresh(): void {
    this.renderBody();
  }

  private manager(): FilterManager<TData> {
    return this.ctx.filters as FilterManager<TData>;
  }

  private filterableColumns(): Column<TData>[] {
    const manager = this.manager();
    return this.ctx.columnModel
      .getPrimaryColumns()
      .filter(
        (c) =>
          !c.isAutoGroupCol && c.colId !== 'au-selection-col' && manager.resolveFilterKind(c) !== null,
      );
  }

  private renderBody(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.entries = [];
    clearChildren(this.container);

    for (const col of this.filterableColumns()) {
      const entry = el('div', 'au-panel-filter-entry');
      const head = el('div', 'au-panel-filter-head');
      const dot = el('span', 'au-panel-filter-active');
      const name = el('span', 'au-panel-col-label');
      name.textContent = col.getHeaderName();
      const clearBtn = el('span', 'au-panel-filter-clear', {
        'data-au-panel-filter-clear': col.colId,
        role: 'button',
        'aria-label': `Clear ${col.getHeaderName()} filter`,
        title: 'Clear filter',
      });
      clearBtn.textContent = '✕';
      head.append(dot, name, clearBtn);
      const body = el('div', 'au-panel-filter-body');
      this.cleanups.push(mountFloatingFilter(this.ctx, body, col));
      entry.append(head, body);
      this.container.appendChild(entry);
      this.entries.push({ colId: col.colId, dot, clearBtn });
    }
    this.updateIndicators();
  }

  private updateIndicators(): void {
    for (const e of this.entries) {
      const active = this.ctx.filters.isColumnActive(e.colId);
      e.dot.style.visibility = active ? '' : 'hidden';
      e.clearBtn.style.visibility = active ? '' : 'hidden';
    }
  }

  private onClick(e: Event): void {
    const colId = (e.target as HTMLElement).getAttribute?.('data-au-panel-filter-clear');
    if (colId) this.ctx.filters.setColumnModel_(colId, null, 'toolPanel');
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    for (const c of this.cleanups) c();
    this.unsubs = [];
    this.cleanups = [];
    clearChildren(this.container);
  }
}
