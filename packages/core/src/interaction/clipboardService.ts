import type { GridContext, IClipboardService } from '../context.js';
import type { CellRange } from '../types/base.js';
import type { Column } from '../columns/column.js';
import type { RowNode } from '../rows/rowNode.js';

/**
 * Clipboard: TSV serialization of ranges / selected rows / focused cell,
 * paste routed through the editing commit funnel. Uses the async Clipboard
 * API when available, with a textarea/execCommand fallback and an internal
 * buffer (lastCopied) as the paste fallback.
 */
export class ClipboardService<TData = unknown> implements IClipboardService<TData> {
  private ctx: GridContext<TData>;
  /** Internal buffer: last copied text, used when clipboard read is unavailable. */
  private lastCopied: string | null = null;

  constructor(ctx: GridContext<TData>) {
    this.ctx = ctx;
  }

  /* ------------------------------------------------------------------ copy */

  getCopyText(includeHeaders?: boolean): string {
    const withHeaders =
      includeHeaders ?? this.ctx.options.get('copyHeadersToClipboard') === true;
    const delimiter = this.ctx.options.get('clipboardDelimiter') ?? '\t';
    const rows: string[] = [];

    const ranges = this.ctx.range ? this.ctx.range.getCellRanges() : [];
    if (this.ctx.range && ranges.length > 0) {
      const use = this.rangesToUse(ranges);
      const firstCols = this.columnsForColIds(use[0].colIds);
      if (withHeaders) rows.push(this.headerRow(firstCols, delimiter));
      for (const range of use) {
        const cols = this.columnsForColIds(range.colIds);
        const r0 = Math.min(range.startRowIndex, range.endRowIndex);
        const r1 = Math.max(range.startRowIndex, range.endRowIndex);
        for (let r = r0; r <= r1; r++) {
          const node = this.ctx.rowModel.getRow(r);
          if (!node) continue;
          rows.push(this.rowText(node, cols, delimiter));
        }
      }
      return rows.join('\n');
    }

    const selected = this.ctx.selection.getSelectedNodes();
    if (selected.length > 0) {
      const cols = this.displayedDataColumns();
      if (withHeaders) rows.push(this.headerRow(cols, delimiter));
      for (const node of this.inDisplayOrder(selected)) {
        rows.push(this.rowText(node, cols, delimiter));
      }
      return rows.join('\n');
    }

    const cell = this.ctx.focus.getFocusedCell();
    if (cell) {
      const node = this.ctx.rowModel.getRow(cell.rowIndex);
      const column = this.ctx.columnModel.getColumn(cell.colId);
      if (node && column) {
        if (withHeaders) rows.push(this.headerRow([column], delimiter));
        rows.push(this.rowText(node, [column], delimiter));
      }
      return rows.join('\n');
    }
    return '';
  }

  copy(includeHeaders?: boolean): void {
    const text = this.getCopyText(includeHeaders);
    this.lastCopied = text;
    this.writeToClipboard(text);
  }

  /* ------------------------------------------------------------------- cut */

  cut(): void {
    this.copy();
    const ranges = this.ctx.range ? this.ctx.range.getCellRanges() : [];
    if (this.ctx.range && ranges.length > 0) {
      for (const range of this.rangesToUse(ranges)) {
        const r0 = Math.min(range.startRowIndex, range.endRowIndex);
        const r1 = Math.max(range.startRowIndex, range.endRowIndex);
        for (let r = r0; r <= r1; r++) {
          const node = this.ctx.rowModel.getRow(r);
          if (!node) continue;
          for (const colId of range.colIds) {
            this.ctx.editing.commitValue(node, colId, null, 'cut');
          }
        }
      }
    } else {
      const selected = this.ctx.selection.getSelectedNodes();
      if (selected.length > 0) {
        const cols = this.displayedDataColumns().filter((c) => c.isEditable());
        for (const node of this.inDisplayOrder(selected)) {
          for (const col of cols) {
            this.ctx.editing.commitValue(node, col.colId, null, 'cut');
          }
        }
      } else {
        const cell = this.ctx.focus.getFocusedCell();
        if (cell) {
          const node = this.ctx.rowModel.getRow(cell.rowIndex);
          if (node) this.ctx.editing.commitValue(node, cell.colId, null, 'cut');
        }
      }
    }
    this.ctx.scheduleRender();
  }

  /* ------------------------------------------------------------------ paste */

  paste(): void {
    void this.pasteAsync();
  }

  /** Async worker behind paste(); exposed for tests to await. */
  async pasteAsync(): Promise<void> {
    if (this.ctx.options.is('suppressClipboardPaste')) return;
    const text = await this.readFromClipboard();
    if (text == null || text === '' || this.ctx.destroyed) return;

    this.dispatchPasteEvent('pasteStart');

    const delimiter = this.ctx.options.get('clipboardDelimiter') ?? '\t';
    const matrix = parseMatrix(text, delimiter);
    if (matrix.length === 0) {
      this.dispatchPasteEvent('pasteEnd');
      return;
    }

    // Anchor: latest range top-left, else focused cell.
    const ranges = this.ctx.range ? this.ctx.range.getCellRanges() : [];
    const latest = ranges.length > 0 ? ranges[ranges.length - 1] : null;
    let anchorRow: number;
    let anchorColId: string;
    if (latest) {
      anchorRow = Math.min(latest.startRowIndex, latest.endRowIndex);
      anchorColId = latest.colIds[0];
    } else {
      const cell = this.ctx.focus.getFocusedCell();
      if (!cell) return; // no anchor → abort
      anchorRow = cell.rowIndex;
      anchorColId = cell.colId;
    }

    const displayed = this.displayedDataColumns();
    const anchorColIdx = displayed.findIndex((c) => c.colId === anchorColId);
    if (anchorColIdx < 0) return;

    const processFrom = this.ctx.options.get('processCellFromClipboard');
    const commit = (node: RowNode<TData>, colId: string, cellText: string): void => {
      if (processFrom) {
        const value = processFrom({ value: cellText, node, colId });
        this.ctx.editing.commitValue(node, colId, value, 'paste', false);
      } else {
        this.ctx.editing.commitValue(node, colId, cellText, 'paste', true);
      }
    };

    const rowCount = this.ctx.rowModel.getRowCount();
    const singleCell = matrix.length === 1 && matrix[0].length === 1;
    const latestIsMulti =
      latest !== null &&
      (latest.startRowIndex !== latest.endRowIndex || latest.colIds.length > 1);

    if (singleCell && latest && latestIsMulti) {
      // Fill every cell of the active range with the single value.
      const value = matrix[0][0];
      const r0 = Math.min(latest.startRowIndex, latest.endRowIndex);
      const r1 = Math.max(latest.startRowIndex, latest.endRowIndex);
      for (let r = r0; r <= r1; r++) {
        const node = this.ctx.rowModel.getRow(r);
        if (!node) continue;
        for (const colId of latest.colIds) commit(node, colId, value);
      }
    } else {
      // Tile the matrix from the anchor.
      let maxCols = 0;
      for (let r = 0; r < matrix.length; r++) {
        const targetRow = anchorRow + r;
        if (targetRow >= rowCount) break;
        const node = this.ctx.rowModel.getRow(targetRow);
        if (!node) continue;
        const line = matrix[r];
        if (line.length > maxCols) maxCols = line.length;
        for (let c = 0; c < line.length; c++) {
          const col = displayed[anchorColIdx + c];
          if (!col) break; // past the last displayed column
          commit(node, col.colId, line[c]);
        }
      }
      // Set range to the pasted extent.
      if (this.ctx.range) {
        const endRow = Math.min(anchorRow + matrix.length - 1, rowCount - 1);
        const colIds = displayed
          .slice(anchorColIdx, anchorColIdx + Math.max(maxCols, 1))
          .map((c) => c.colId);
        if (endRow >= anchorRow && colIds.length > 0) {
          this.ctx.range.clearCellSelection();
          this.ctx.range.addCellRange({
            startRowIndex: anchorRow,
            endRowIndex: endRow,
            colIds,
          });
        }
      }
    }

    this.dispatchPasteEvent('pasteEnd');
    this.ctx.scheduleRender();
  }

  destroy(): void {
    this.lastCopied = null;
  }

  /* ---------------------------------------------------------------- helpers */

  /** Multiple ranges stack vertically only when column counts match; else latest wins. */
  private rangesToUse(ranges: CellRange[]): CellRange[] {
    if (ranges.length <= 1) return ranges;
    const width = ranges[0].colIds.length;
    const same = ranges.every((r) => r.colIds.length === width);
    return same ? ranges : [ranges[ranges.length - 1]];
  }

  private columnsForColIds(colIds: string[]): Column<TData>[] {
    const out: Column<TData>[] = [];
    for (const id of colIds) {
      const c = this.ctx.columnModel.getColumn(id);
      if (c) out.push(c);
    }
    return out;
  }

  /** Displayed columns excluding the synthetic selection checkbox column. */
  private displayedDataColumns(): Column<TData>[] {
    return this.ctx.columnModel
      .getDisplayedColumns()
      .filter((c) => c.colId !== 'au-selection-col');
  }

  /** Sort by rowIndex; nodes without a display index keep their set order. */
  private inDisplayOrder(nodes: RowNode<TData>[]): RowNode<TData>[] {
    return [...nodes].sort((a, b) =>
      a.rowIndex >= 0 && b.rowIndex >= 0 ? a.rowIndex - b.rowIndex : 0,
    );
  }

  private headerRow(cols: Column<TData>[], delimiter: string): string {
    return cols.map((c) => sanitize(c.getHeaderName())).join(delimiter);
  }

  private rowText(node: RowNode<TData>, cols: Column<TData>[], delimiter: string): string {
    const parts: string[] = [];
    for (const col of cols) parts.push(this.cellText(node, col));
    return parts.join(delimiter);
  }

  private cellText(node: RowNode<TData>, col: Column<TData>): string {
    const raw = this.ctx.values.getValue(node, col);
    const processFor = this.ctx.options.get('processCellForClipboard');
    const value = processFor ? processFor({ value: raw, node, colId: col.colId }) : raw;
    return sanitize(stringify(value));
  }

  private dispatchPasteEvent(type: 'pasteStart' | 'pasteEnd'): void {
    this.ctx.events.dispatch({
      type,
      api: this.ctx.api,
      context: this.ctx.options.get('context'),
      source: 'clipboard',
    });
  }

  private writeToClipboard(text: string): void {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.clipboard?.writeText) {
      nav.clipboard.writeText(text).catch(() => this.execCommandCopy(text));
    } else {
      this.execCommandCopy(text);
    }
  }

  private execCommandCopy(text: string): void {
    if (typeof document === 'undefined') return;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    (this.ctx.rootEl ?? document.body).appendChild(ta);
    try {
      ta.select();
      document.execCommand('copy');
    } catch {
      // swallow: internal buffer already holds the text
    } finally {
      ta.remove();
    }
  }

  private async readFromClipboard(): Promise<string | null> {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.clipboard?.readText) {
      try {
        return await nav.clipboard.readText();
      } catch {
        return this.lastCopied;
      }
    }
    return this.lastCopied;
  }
}

/* ------------------------------------------------------------ pure helpers */

/** Raw value → clipboard text: '' for null, ISO yyyy-mm-dd for dates. */
function stringify(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** v1: no quoting — tabs/newlines inside values become spaces. */
function sanitize(text: string): string {
  return text.replace(/[\t\n\r]/g, ' ');
}

/** Split clipboard text into a matrix; a trailing empty line is trimmed. */
function parseMatrix(text: string, delimiter: string): string[][] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => line.replace(/\r$/, '').split(delimiter));
}
