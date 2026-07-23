import type { GridContext } from '../context.js';
import type { CsvExportParams } from '../types/api.js';
import type { Column } from '../columns/column.js';
import type { RowNode } from '../rows/rowNode.js';

/** Serialize the grid's displayed data to CSV text. */
export function exportCsv<TData>(ctx: GridContext<TData>, params: CsvExportParams = {}): string {
  const separator = params.columnSeparator ?? ',';
  const columns: Column<TData>[] = (
    params.allColumns
      ? ctx.columnModel.getPrimaryColumns().filter((c) => c.isVisible())
      : ctx.columnModel.getDisplayedColumns()
  ).filter((c) => c.colId !== 'au-selection-col');

  const useFormatted = params.useFormattedValues !== false;
  const neutralize = params.suppressFormulaEscaping !== true;
  const lines: string[] = [];

  if (!params.skipHeaders) {
    lines.push(
      columns
        .map((c) => escapeCsvValue(neutralize ? neutralizeFormula(c.getHeaderName()) : c.getHeaderName(), separator))
        .join(separator),
    );
  }

  ctx.rowModel.forEachNodeAfterFilterAndSort?.((node: RowNode<TData>) => {
    // Skip synthetic group rows; keep tree-data nodes that carry data.
    if (node.group && node.data === undefined) return;
    if (params.onlySelected && node.isSelected() !== true) return;
    const cells = columns.map((col) => {
      const raw = ctx.values.getValue(node, col);
      let value = useFormatted ? ctx.values.getFormattedValue(node, col) : rawToString(raw);
      // Numeric cell values are exempt (a leading minus is just a negative
      // number); everything else gets formula-injection neutralization.
      if (neutralize && typeof raw !== 'number') value = neutralizeFormula(value);
      return escapeCsvValue(value, separator);
    });
    lines.push(cells.join(separator));
  });

  return lines.join('\n');
}

function rawToString(value: unknown): string {
  return value == null ? '' : String(value);
}

/**
 * Defuse spreadsheet formula injection: a leading = + - @ tab or CR makes
 * Excel/Sheets treat the cell as a formula on import. Prefix a single quote
 * so the value imports as literal text.
 */
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
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
