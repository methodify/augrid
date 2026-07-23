import type { GridContext, IFindService } from '../context.js';
import type { Column } from '../columns/column.js';

interface Match {
  rowIndex: number;
  colId: string;
}

/**
 * Find-in-grid: case-insensitive substring search over the FORMATTED values
 * of all displayed cells (what the user sees), with next/previous navigation
 * that scrolls and focuses the active match. Matches recompute on model or
 * column changes while a search is live; the renderer reads `getCellState`
 * per cell (one guarded map lookup — zero cost when find is inactive).
 */
export class FindService<TData = unknown> implements IFindService<TData> {
  private text = '';
  private needle = '';
  private matches: Match[] = [];
  /** rowIndex → set of matching colIds, for O(1) render-time lookup. */
  private byCell = new Map<number, Set<string>>();
  private activeIdx = -1;
  private unsubs: (() => void)[] = [];

  constructor(private ctx: GridContext<TData>) {
    const recompute = (): void => {
      if (!this.isActive()) return;
      this.computeMatches();
      // Keep the active pointer in range but don't jump the viewport on data ticks.
      if (this.activeIdx >= this.matches.length) this.activeIdx = this.matches.length - 1;
      this.dispatch();
      ctx.scheduleRender();
    };
    for (const type of ['modelUpdated', 'displayedColumnsChanged', 'newColumnsLoaded'] as const) {
      ctx.events.addEventListener(type, recompute);
      this.unsubs.push(() => ctx.events.removeEventListener(type, recompute));
    }
  }

  isActive(): boolean {
    return this.needle.length > 0;
  }

  getText(): string {
    return this.text;
  }

  getMatchCount(): number {
    return this.matches.length;
  }

  getActiveIndex(): number {
    return this.activeIdx;
  }

  setText(text: string): void {
    this.text = text;
    this.needle = text.trim().toLowerCase();
    this.activeIdx = -1;
    this.computeMatches();
    this.dispatch();
    this.ctx.scheduleRender();
  }

  clear(): void {
    if (!this.isActive() && this.text === '') return;
    this.setText('');
  }

  next(): void {
    this.step(1);
  }

  previous(): void {
    this.step(-1);
  }

  private step(dir: 1 | -1): void {
    const n = this.matches.length;
    if (n === 0) return;
    this.activeIdx = this.activeIdx < 0 ? (dir === 1 ? 0 : n - 1) : (this.activeIdx + dir + n) % n;
    const m = this.matches[this.activeIdx]!;
    this.ctx.renderer.ensureIndexVisible(m.rowIndex);
    this.ctx.renderer.ensureColumnVisible(m.colId);
    this.ctx.focus.setFocusedCell(m.rowIndex, m.colId);
    this.dispatch();
    this.ctx.scheduleRender();
  }

  getCellState(rowIndex: number, colId: string): 0 | 1 | 2 {
    if (this.matches.length === 0) return 0;
    const active = this.activeIdx >= 0 ? this.matches[this.activeIdx] : null;
    if (active && active.rowIndex === rowIndex && active.colId === colId) return 2;
    return this.byCell.get(rowIndex)?.has(colId) ? 1 : 0;
  }

  private computeMatches(): void {
    this.matches = [];
    this.byCell.clear();
    if (!this.isActive()) return;
    const ctx = this.ctx;
    const cols = ctx.columnModel.getDisplayedColumns() as Column<TData>[];
    const rowCount = ctx.rowModel.getRowCount();
    for (let i = 0; i < rowCount; i++) {
      const node = ctx.rowModel.getRow(i);
      if (!node) continue;
      let set: Set<string> | null = null;
      for (const col of cols) {
        if (col.colId === 'au-selection-col') continue;
        const formatted = ctx.values.getFormattedValue(node, col);
        if (formatted === '' || !formatted.toLowerCase().includes(this.needle)) continue;
        this.matches.push({ rowIndex: i, colId: col.colId });
        if (!set) {
          set = new Set();
          this.byCell.set(i, set);
        }
        set.add(col.colId);
      }
    }
  }

  private dispatch(): void {
    this.ctx.events.dispatch({
      type: 'findChanged',
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      text: this.text,
      totalMatches: this.matches.length,
      activeIndex: this.activeIdx,
    });
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.matches = [];
    this.byCell.clear();
  }
}
