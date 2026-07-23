import type { GridOptions } from './types/gridOptions.js';
import { signal, type Signal } from './state/store.js';

const DEFAULTS = {
  rowHeight: 32,
  headerHeight: 36,
  floatingFiltersHeight: 36,
  rowBuffer: 3,
  multiSortKey: 'shift',
  groupDefaultExpanded: 0,
  groupDisplayType: 'singleColumn',
  paginationPageSize: 100,
  cacheBlockSize: 100,
  maxBlocksInCache: 10,
  undoRedoCellEditingLimit: 100,
  cellFlashDuration: 700,
  tooltipShowDelay: 600,
  clipboardDelimiter: '\t',
  quickFilterMatchesFormatted: true,
  enterNavigatesVertically: true,
  enterNavigatesVerticallyAfterEdit: true,
  stopEditingWhenCellsLoseFocus: true,
  rowModelType: 'clientSide',
} satisfies Partial<GridOptions>;

type DefaultedKey = keyof typeof DEFAULTS;

/**
 * Holds live grid options. `get` reads current value (no reactivity);
 * `changed` signal ticks with the list of changed keys for subscribers.
 */
export class OptionsService<TData = unknown> {
  private opts: GridOptions<TData>;
  /** Bumps on every option update with the changed keys. */
  readonly changed: Signal<{ keys: (keyof GridOptions<TData>)[]; tick: number }>;
  private tick = 0;

  constructor(initial: GridOptions<TData>) {
    this.opts = { ...initial };
    this.changed = signal({ keys: [] as (keyof GridOptions<TData>)[], tick: 0 });
  }

  get<K extends keyof GridOptions<TData>>(key: K): GridOptions<TData>[K] {
    const v = this.opts[key];
    if (v === undefined && key in DEFAULTS) {
      return DEFAULTS[key as DefaultedKey] as GridOptions<TData>[K];
    }
    return v;
  }

  /** Raw options object (no defaults applied). */
  raw(): GridOptions<TData> {
    return this.opts;
  }

  update(patch: Partial<GridOptions<TData>>): void {
    const keys: (keyof GridOptions<TData>)[] = [];
    for (const k in patch) {
      const key = k as keyof GridOptions<TData>;
      if (this.opts[key] !== patch[key]) {
        (this.opts as Record<string, unknown>)[k] = patch[key];
        keys.push(key);
      }
    }
    if (keys.length > 0) this.changed.set({ keys, tick: ++this.tick });
  }

  is(key: keyof GridOptions<TData>): boolean {
    return this.get(key) === true;
  }
}
