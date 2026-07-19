/**
 * Floating filter row UI: one small input per filterable column under the
 * header. Thin DOM layer — all filter state flows through the FilterManager
 * model (single source of truth), so external model changes are reflected
 * back into the inputs.
 */
import type { GridContext } from '../../context';
import type { Column } from '../../columns/column';
import type {
  DateFilterModel,
  FilterModel,
  NumberFilterModel,
  SetFilterModel,
  TextFilterModel,
} from '../../types/filter';
import type { FilterManager } from './filterManager';
import { el, clearChildren } from '../../utils/dom';
import { debounce } from '../../utils/general';

const MAX_SET_ROWS = 200;

export function mountFloatingFilter<TData>(
  ctx: GridContext<TData>,
  container: HTMLElement,
  column: Column<TData>,
): void {
  const manager = ctx.filters as FilterManager<TData>;
  const kind = manager.resolveFilterKind(column);
  if (kind === null) return;

  switch (kind) {
    case 'text':
      mountSimpleInput(ctx, container, column, 'text');
      break;
    case 'number':
      mountSimpleInput(ctx, container, column, 'number');
      break;
    case 'date':
      mountDateInput(ctx, container, column);
      break;
    case 'set':
      mountSetTrigger(ctx, container, column);
      break;
    case 'custom': {
      const inst = manager.getOrCreateCustomInstance(column);
      const gui = inst?.getGui?.();
      if (gui) container.appendChild(gui);
      break;
    }
  }
}

/* --------------------------------------------------------- text / number */

function firstConditionText(model: FilterModel | null): string {
  if (!model) return '';
  if (model.filterType === 'text' || model.filterType === 'number') {
    const c = model.conditions?.[0];
    return c?.filter != null ? String(c.filter) : '';
  }
  if (model.filterType === 'date') {
    return model.conditions?.[0]?.dateFrom ?? '';
  }
  return '';
}

function mountSimpleInput<TData>(
  ctx: GridContext<TData>,
  container: HTMLElement,
  column: Column<TData>,
  kind: 'text' | 'number',
): void {
  const colId = column.colId;
  const input = el('input', 'au-floating-input', {
    type: 'text',
    placeholder: 'Filter…',
  }) as HTMLInputElement;
  if (kind === 'number') input.setAttribute('inputmode', 'decimal');
  input.value = firstConditionText(ctx.filters.getColumnModel_(colId));
  container.appendChild(input);

  const apply = debounce(() => {
    if (ctx.destroyed) return;
    const raw = input.value.trim();
    if (raw === '') {
      ctx.filters.setColumnModel_(colId, null, 'floatingFilter');
      return;
    }
    let model: TextFilterModel | NumberFilterModel | null;
    if (kind === 'number') {
      const n = Number(raw);
      model = Number.isNaN(n)
        ? null
        : { filterType: 'number', conditions: [{ type: 'equals', filter: n }] };
    } else {
      model = { filterType: 'text', conditions: [{ type: 'contains', filter: raw }] };
    }
    ctx.filters.setColumnModel_(colId, model, 'floatingFilter');
  }, 300);

  input.addEventListener('input', () => apply());

  const onFilterChanged = (): void => {
    if (!input.isConnected) {
      ctx.events.removeEventListener('filterChanged', onFilterChanged);
      return;
    }
    if (document.activeElement === input) return;
    input.value = firstConditionText(ctx.filters.getColumnModel_(colId));
  };
  ctx.events.addEventListener('filterChanged', onFilterChanged);
}

/* ------------------------------------------------------------------ date */

function mountDateInput<TData>(
  ctx: GridContext<TData>,
  container: HTMLElement,
  column: Column<TData>,
): void {
  const colId = column.colId;
  const input = el('input', 'au-floating-input', { type: 'date' }) as HTMLInputElement;
  input.value = firstConditionText(ctx.filters.getColumnModel_(colId));
  container.appendChild(input);

  input.addEventListener('change', () => {
    if (ctx.destroyed) return;
    const raw = input.value;
    if (raw === '') {
      ctx.filters.setColumnModel_(colId, null, 'floatingFilter');
      return;
    }
    const model: DateFilterModel = {
      filterType: 'date',
      conditions: [{ type: 'equals', dateFrom: raw }],
    };
    ctx.filters.setColumnModel_(colId, model, 'floatingFilter');
  });

  const onFilterChanged = (): void => {
    if (!input.isConnected) {
      ctx.events.removeEventListener('filterChanged', onFilterChanged);
      return;
    }
    if (document.activeElement === input) return;
    input.value = firstConditionText(ctx.filters.getColumnModel_(colId));
  };
  ctx.events.addEventListener('filterChanged', onFilterChanged);
}

/* ------------------------------------------------------------------- set */

function setTriggerLabel(model: FilterModel | null): string {
  if (!model || model.filterType !== 'set') return '(All)';
  return `${model.values.length} selected`;
}

function mountSetTrigger<TData>(
  ctx: GridContext<TData>,
  container: HTMLElement,
  column: Column<TData>,
): void {
  const colId = column.colId;
  const trigger = el('input', 'au-floating-input au-set-filter-trigger', {
    type: 'text',
    readonly: 'readonly',
  }) as HTMLInputElement;
  trigger.style.cursor = 'pointer';
  trigger.value = setTriggerLabel(ctx.filters.getColumnModel_(colId));
  container.appendChild(trigger);

  trigger.addEventListener('click', () => {
    if (ctx.destroyed) return;
    openSetPopup(ctx, trigger, column);
  });

  const onFilterChanged = (): void => {
    if (!trigger.isConnected) {
      ctx.events.removeEventListener('filterChanged', onFilterChanged);
      return;
    }
    trigger.value = setTriggerLabel(ctx.filters.getColumnModel_(colId));
  };
  ctx.events.addEventListener('filterChanged', onFilterChanged);
}

function openSetPopup<TData>(
  ctx: GridContext<TData>,
  trigger: HTMLElement,
  column: Column<TData>,
): void {
  const colId = column.colId;
  const root = ctx.renderer.eRoot;
  const values = ctx.filters.getSetValues(colId);

  // Current selection: from the active model, else everything selected.
  const current = ctx.filters.getColumnModel_(colId);
  const selected = new Set<string | null>(
    current && current.filterType === 'set' ? current.values : values,
  );

  const popup = el('div', 'au-editor-popup au-set-filter-popup');
  popup.style.minWidth = '180px';
  popup.style.maxHeight = '320px';
  popup.style.display = 'flex';
  popup.style.flexDirection = 'column';
  popup.style.padding = '6px';

  // Position under the trigger, relative to the grid root.
  const rootRect = root.getBoundingClientRect();
  const rect = trigger.getBoundingClientRect();
  popup.style.left = `${rect.left - rootRect.left}px`;
  popup.style.top = `${rect.bottom - rootRect.top + 2}px`;

  const search = el('input', 'au-set-filter-search', {
    type: 'text',
    placeholder: 'Search…',
  }) as HTMLInputElement;
  search.style.marginBottom = '4px';

  const selectAllLabel = el('label', 'au-set-filter-row');
  selectAllLabel.style.display = 'block';
  const selectAll = el('input', '', { type: 'checkbox' }) as HTMLInputElement;
  selectAllLabel.appendChild(selectAll);
  selectAllLabel.appendChild(document.createTextNode(' (Select All)'));

  const list = el('div', 'au-set-filter-list');
  list.style.overflowY = 'auto';
  list.style.flex = '1 1 auto';

  popup.appendChild(search);
  popup.appendChild(selectAllLabel);
  popup.appendChild(list);
  root.appendChild(popup);

  let rendered: (string | null)[] = [];

  const syncSelectAll = (): void => {
    selectAll.checked = selected.size === values.length && values.length > 0;
    selectAll.indeterminate = selected.size > 0 && selected.size < values.length;
  };

  const commit = (): void => {
    const model: SetFilterModel | null =
      selected.size === values.length
        ? null
        : { filterType: 'set', values: values.filter((v) => selected.has(v)) };
    ctx.filters.setColumnModel_(colId, model, 'floatingFilter');
  };

  const renderList = (): void => {
    clearChildren(list);
    const q = search.value.trim().toLowerCase();
    rendered = values.filter((v) => {
      if (q === '') return true;
      return (v === null ? '(blanks)' : v.toLowerCase()).includes(q);
    });
    if (rendered.length > MAX_SET_ROWS) rendered = rendered.slice(0, MAX_SET_ROWS);
    let i = 0;
    for (const v of rendered) {
      const row = el('label', 'au-set-filter-row');
      row.style.display = 'block';
      const cb = el('input', '', { type: 'checkbox', 'data-au-set-idx': String(i) }) as HTMLInputElement;
      cb.checked = selected.has(v);
      row.appendChild(cb);
      row.appendChild(document.createTextNode(' ' + (v === null ? '(Blanks)' : v)));
      list.appendChild(row);
      i++;
    }
  };

  // Delegated change handling for the checkbox list.
  list.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;
    const idxAttr = target.getAttribute('data-au-set-idx');
    if (idxAttr === null) return;
    const v = rendered[Number(idxAttr)];
    if (v === undefined) return;
    if ((target as HTMLInputElement).checked) selected.add(v);
    else selected.delete(v);
    syncSelectAll();
    commit();
  });

  selectAll.addEventListener('change', () => {
    selected.clear();
    if (selectAll.checked) for (const v of values) selected.add(v);
    renderList();
    syncSelectAll();
    commit();
  });

  search.addEventListener('input', () => renderList());

  const close = (): void => {
    document.removeEventListener('mousedown', onDocMouseDown, true);
    ctx.events.removeEventListener('gridPreDestroyed', close);
    popup.remove();
  };

  const onDocMouseDown = (e: MouseEvent): void => {
    const t = e.target as Node;
    if (popup.contains(t) || trigger.contains(t)) return;
    close();
  };
  document.addEventListener('mousedown', onDocMouseDown, true);
  ctx.events.addEventListener('gridPreDestroyed', close);

  renderList();
  syncSelectAll();
  search.focus();
}
