import type { GridContext } from '../../context';
import type { GridEventName } from '../../types/events';
import { el, clearChildren } from '../../utils/dom';

export type PanelZone = 'rowGroup' | 'value' | 'pivot';

/* ---------------------------------------------- pure zone mutation helpers */

export function zoneColIds<TData>(ctx: GridContext<TData>, zone: PanelZone): string[] {
  const cm = ctx.columnModel;
  const cols =
    zone === 'rowGroup' ? cm.getRowGroupColumns() : zone === 'value' ? cm.getValueColumns() : cm.getPivotColumns();
  return cols.map((c) => c.colId);
}

export function addToZone<TData>(ctx: GridContext<TData>, zone: PanelZone, colId: string, source = 'toolPanel'): void {
  const current = zoneColIds(ctx, zone);
  if (current.includes(colId)) return;
  applyZone(ctx, zone, [...current, colId], source);
}

export function removeFromZone<TData>(
  ctx: GridContext<TData>,
  zone: PanelZone,
  colId: string,
  source = 'toolPanel',
): void {
  const current = zoneColIds(ctx, zone);
  if (!current.includes(colId)) return;
  applyZone(ctx, zone, current.filter((id) => id !== colId), source);
}

function applyZone<TData>(ctx: GridContext<TData>, zone: PanelZone, colIds: string[], source: string): void {
  const cm = ctx.columnModel;
  if (zone === 'rowGroup') cm.setRowGroupColumns(colIds, source);
  else if (zone === 'pivot') cm.setPivotColumns(colIds, source);
  else {
    cm.setValueColumns(
      colIds.map((colId) => {
        const col = cm.getColumn(colId);
        return { colId, aggFunc: col?.aggFunc ?? col?.getColDef().aggFunc ?? 'sum' };
      }),
      source,
    );
  }
}

/* ---------------------------------------------------------------- the panel */

const REFRESH_EVENTS: GridEventName[] = [
  'displayedColumnsChanged',
  'newColumnsLoaded',
  'columnVisible',
  'columnRowGroupChanged',
  'columnPivotChanged',
  'columnValueChanged',
  'pivotModeChanged',
];

const ZONES: { zone: PanelZone; title: string; pivotOnly?: boolean }[] = [
  { zone: 'rowGroup', title: 'Row groups' },
  { zone: 'value', title: 'Values' },
  { zone: 'pivot', title: 'Column labels', pivotOnly: true },
];

/**
 * Columns tool panel: visibility checkboxes over the primary columns plus
 * drag-and-drop zones for row groups, values, and (in pivot mode) column
 * labels. All listeners are delegated at the panel container; drag payloads
 * ride HTML5 dataTransfer as JSON {colId, from}.
 */
export class ColumnsPanel<TData = unknown> {
  private eSearch: HTMLInputElement;
  private eBody: HTMLElement;
  private unsubs: (() => void)[] = [];
  private searchText = '';

  constructor(
    private ctx: GridContext<TData>,
    private container: HTMLElement,
  ) {
    this.eSearch = el('input', 'au-panel-search', {
      type: 'text',
      placeholder: 'Search columns…',
      'aria-label': 'Search columns',
    }) as HTMLInputElement;
    this.eSearch.addEventListener('input', () => {
      this.searchText = this.eSearch.value.toLowerCase();
      this.renderBody();
    });
    // Panel keys must not reach the grid's keyboard dispatcher.
    this.container.addEventListener('keydown', (e) => e.stopPropagation());
    this.eBody = el('div', 'au-panel-columns');
    container.append(this.eSearch, this.eBody);

    this.eBody.addEventListener('change', (e) => this.onChange(e));
    this.eBody.addEventListener('click', (e) => this.onClick(e));
    this.eBody.addEventListener('dragstart', (e) => this.onDragStart(e));
    this.eBody.addEventListener('dragover', (e) => this.onDragOver(e));
    this.eBody.addEventListener('dragleave', (e) => this.onDragLeave(e));
    this.eBody.addEventListener('drop', (e) => this.onDrop(e));

    const onEvt = (): void => this.renderBody();
    for (const type of REFRESH_EVENTS) {
      this.ctx.events.addEventListener(type, onEvt);
      this.unsubs.push(() => this.ctx.events.removeEventListener(type, onEvt));
    }
    this.renderBody();
  }

  refresh(): void {
    this.renderBody();
  }

  private panelColumns() {
    return this.ctx.columnModel
      .getPrimaryColumns()
      .filter((c) => !c.isAutoGroupCol && c.colId !== 'au-selection-col');
  }

  private renderBody(): void {
    const body = this.eBody;
    clearChildren(body);

    const list = el('div', 'au-panel-col-list', { role: 'group', 'aria-label': 'Columns' });
    for (const col of this.panelColumns()) {
      const name = col.getHeaderName();
      if (this.searchText && !name.toLowerCase().includes(this.searchText)) continue;
      const row = el('div', 'au-panel-col-row', { 'data-au-panel-col': col.colId, draggable: 'true' });
      const cb = el('input', 'au-checkbox', {
        type: 'checkbox',
        'data-au-panel-visibility': col.colId,
        'aria-label': `Show ${name}`,
      }) as HTMLInputElement;
      cb.checked = col.visible;
      if (col.getColDef().lockVisible) cb.disabled = true;
      const label = el('span', 'au-panel-col-label');
      label.textContent = name;
      row.append(cb, label);
      list.appendChild(row);
    }
    body.appendChild(list);

    const pivotMode = this.ctx.options.get('pivotMode') === true;
    for (const { zone, title, pivotOnly } of ZONES) {
      if (pivotOnly && !pivotMode) continue;
      const t = el('div', 'au-panel-section-title');
      t.textContent = title;
      const zoneEl = el('div', 'au-panel-drop-zone', { 'data-au-panel-zone': zone });
      const ids = zoneColIds(this.ctx, zone);
      if (ids.length === 0) {
        const empty = el('span', 'au-panel-zone-empty');
        empty.textContent = 'Drag columns here';
        zoneEl.appendChild(empty);
      }
      for (const colId of ids) {
        const col = this.ctx.columnModel.getColumn(colId);
        const chip = el('span', 'au-panel-chip', { 'data-au-panel-chip': colId, draggable: 'true' });
        const text = el('span');
        text.textContent =
          zone === 'value' && col ? `${String(col.aggFunc ?? 'sum')}(${col.getHeaderName()})` : (col?.getHeaderName() ?? colId);
        const x = el('span', 'au-panel-chip-x', {
          'data-au-panel-chip-x': colId,
          role: 'button',
          'aria-label': `Remove ${col?.getHeaderName() ?? colId}`,
        });
        x.textContent = '✕';
        chip.append(text, x);
        zoneEl.appendChild(chip);
      }
      body.append(t, zoneEl);
    }
  }

  /* ------------------------------------------------------------ interaction */

  private onChange(e: Event): void {
    const target = e.target as HTMLElement;
    const colId = target.getAttribute?.('data-au-panel-visibility');
    if (colId) this.ctx.api.setColumnsVisible([colId], (target as HTMLInputElement).checked);
  }

  private onClick(e: Event): void {
    const target = e.target as HTMLElement;
    const removeId = target.getAttribute?.('data-au-panel-chip-x');
    if (!removeId) return;
    const zoneEl = target.closest('[data-au-panel-zone]');
    const zone = zoneEl?.getAttribute('data-au-panel-zone') as PanelZone | null;
    if (zone) removeFromZone(this.ctx, zone, removeId);
  }

  private onDragStart(e: DragEvent): void {
    const target = e.target as HTMLElement;
    const rowId = target.closest?.('[data-au-panel-col]')?.getAttribute('data-au-panel-col');
    const chipEl = target.closest?.('[data-au-panel-chip]');
    const chipId = chipEl?.getAttribute('data-au-panel-chip');
    const from = chipEl?.closest('[data-au-panel-zone]')?.getAttribute('data-au-panel-zone') ?? null;
    const colId = chipId ?? rowId;
    if (!colId || !e.dataTransfer) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({ colId, from }));
    e.dataTransfer.effectAllowed = 'move';
  }

  private zoneFromEvent(e: Event): { el: HTMLElement; zone: PanelZone } | null {
    const zoneEl = (e.target as HTMLElement).closest?.('[data-au-panel-zone]') as HTMLElement | null;
    if (!zoneEl) return null;
    return { el: zoneEl, zone: zoneEl.getAttribute('data-au-panel-zone') as PanelZone };
  }

  private onDragOver(e: DragEvent): void {
    const hit = this.zoneFromEvent(e);
    if (!hit) return;
    e.preventDefault(); // allow dropping
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    hit.el.classList.add('au-drag-over');
  }

  private onDragLeave(e: DragEvent): void {
    const hit = this.zoneFromEvent(e);
    if (hit && !hit.el.contains(e.relatedTarget as Node | null)) hit.el.classList.remove('au-drag-over');
  }

  private onDrop(e: DragEvent): void {
    const hit = this.zoneFromEvent(e);
    if (!hit || !e.dataTransfer) return;
    e.preventDefault();
    hit.el.classList.remove('au-drag-over');
    let payload: { colId?: string; from?: string | null };
    try {
      payload = JSON.parse(e.dataTransfer.getData('text/plain')) as { colId?: string; from?: string | null };
    } catch {
      return;
    }
    if (!payload.colId) return;
    if (payload.from && payload.from !== hit.zone) {
      removeFromZone(this.ctx, payload.from as PanelZone, payload.colId);
    }
    addToZone(this.ctx, hit.zone, payload.colId);
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    clearChildren(this.container);
  }
}
