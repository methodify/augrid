import type { GridContext } from '../context';
import type { CsvExportParams } from '../types/api';
import type { Column } from '../columns/column';
import type { RowNode } from '../rows/rowNode';

/** Serialize the grid's displayed data to CSV text. */
export function exportCsv<TData>(ctx: GridContext<TData>, params: CsvExportParams = {}): string {
  const separator = params.columnSeparator ?? ',';
  const columns: Column<TData>[] = (
    params.allColumns
      ? ctx.columnModel.getPrimaryColumns().filter((c) => c.isVisible())
      : ctx.columnModel.getDisplayedColumns()
  ).filter((c) => c.colId !== 'au-selection-col');

  const useFormatted = params.useFormattedValues !== false;
  const lines: string[] = [];

  if (!params.skipHeaders) {
    lines.push(columns.map((c) => escapeCsvValue(c.getHeaderName(), separator)).join(separator));
  }

  ctx.rowModel.forEachNodeAfterFilterAndSort?.((node: RowNode<TData>) => {
    // Skip synthetic group rows; keep tree-data nodes that carry data.
    if (node.group && node.data === undefined) return;
    if (params.onlySelected && node.isSelected() !== true) return;
    const cells = columns.map((col) => {
      const value = useFormatted
        ? ctx.values.getFormattedValue(node, col)
        : rawToString(ctx.values.getValue(node, col));
      return escapeCsvValue(value, separator);
    });
    lines.push(cells.join(separator));
  });

  return lines.join('\n');
}

function rawToString(value: unknown): string {
  return value == null ? '' : String(value);
}

function escapeCsvValue(value: string, separator: string): string {
  if (
    value.includes(separator) ||
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Trigger a browser download of the CSV text. No-op outside the browser. */
export function downloadCsv(text: string, fileName: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
