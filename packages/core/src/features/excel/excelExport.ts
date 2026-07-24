import type { GridContext } from '../../context.js';
import type { Column } from '../../columns/column.js';
import type { RowNode } from '../../rows/rowNode.js';
import type { ExcelExportParams } from '../../types/api.js';
import {
  SharedStrings,
  StyleTable,
  contentTypesXml,
  rootRelsXml,
  sanitizeSheetName,
  sheetXml,
  workbookRelsXml,
  workbookXml,
  type ExcelCell,
  type ExcelSheetData,
  type ExcelValue,
  type StyleSpec,
} from './ooxml.js';
import { createZip, utf8 } from './zip.js';

const DEFAULT_HEADER_STYLE = { bold: true, fill: 'FFEFF2F7', borderBottom: true } as const;

/** Number formats used when a column declares none. */
const DEFAULT_DATE_FORMAT = 'yyyy-mm-dd';

/**
 * Build one sheet's data from the grid's current view. Exported separately so
 * apps can compose multi-sheet workbooks (`exportMultipleSheetsAsExcel`).
 * Pure with respect to the DOM — only reads the row model and value service.
 */
export function buildSheetData<TData>(
  ctx: GridContext<TData>,
  params: ExcelExportParams<TData> = {},
  styles: StyleTable = new StyleTable(),
): { sheet: ExcelSheetData; styles: StyleTable } {
  const columns: Column<TData>[] = (
    params.allColumns
      ? ctx.columnModel.getPrimaryColumns().filter((c) => c.isVisible())
      : ctx.columnModel.getDisplayedColumns()
  ).filter((c) => c.colId !== 'au-selection-col');

  const headerStyle = styles.add({ ...DEFAULT_HEADER_STYLE, ...params.headerStyle });
  const rows: ExcelCell[][] = [];

  if (!params.skipHeaders) {
    rows.push(columns.map((c) => ({ value: c.getHeaderName(), styleId: headerStyle })));
  }

  // One interned style per column (they share a number format), so a 100k-row
  // export builds the style table once rather than per cell.
  const columnStyles = columns.map((col) => {
    const def = col.getColDef();
    const numberFormat =
      def.excelNumberFormat ??
      (col.cellDataType === 'date' ? DEFAULT_DATE_FORMAT : undefined);
    return numberFormat ? styles.add({ numberFormat }) : 0;
  });

  const useFormatted = params.useFormattedValues === true;
  const processCell = params.processCellForExcel;

  const emit = (node: RowNode<TData>): void => {
    if (params.onlySelected && node.isSelected() !== true) return;
    rows.push(
      columns.map((col, i) => {
        const raw = ctx.values.getValue(node, col);
        let value: ExcelValue = processCell
          ? (processCell({ value: raw, node, colId: col.colId }) as ExcelValue)
          : toExcelValue(raw, useFormatted ? ctx.values.getFormattedValue(node, col) : null);
        if (value === undefined) value = null;
        return columnStyles[i] ? { value, styleId: columnStyles[i] } : { value };
      }),
    );
  };

  const forEachSorted = ctx.rowModel.forEachNodeAfterFilterAndSort;
  if (forEachSorted) {
    forEachSorted.call(ctx.rowModel, (node: RowNode<TData>) => {
      // Synthetic group rows carry no data — matches CSV export semantics.
      if (node.group && node.data === undefined) return;
      emit(node);
    });
  } else {
    // Server-side/infinite models have no filtered-and-sorted walk: export the
    // rows currently materialized, in display order.
    const count = ctx.rowModel.getRowCount();
    for (let i = 0; i < count; i++) {
      const node = ctx.rowModel.getRow(i);
      if (!node || node.data === undefined) continue;
      emit(node);
    }
  }

  const pinnedLeft = params.allColumns
    ? 0
    : ctx.columnModel.getDisplayed().left.filter((c) => c.colId !== 'au-selection-col').length;
  const headerRows = params.skipHeaders ? 0 : 1;

  const sheet: ExcelSheetData = {
    name: sanitizeSheetName(params.sheetName ?? 'Sheet1'),
    rows,
    // px → Excel character units (~7px per character at the default font).
    columnWidths: columns.map((c) => Math.max(6, Math.round((c.actualWidth / 7) * 10) / 10)),
    freeze:
      params.suppressFreeze === true
        ? undefined
        : { rows: headerRows, cols: pinnedLeft },
    autoFilterRows: params.suppressAutoFilter === true ? 0 : headerRows,
  };
  return { sheet, styles };
}

/**
 * Map a grid value to a typed Excel value. Numbers, booleans, and dates stay
 * native (so Excel can sum, sort, and format them); everything else becomes
 * text. Unlike CSV there is no formula-injection risk: text lands in the
 * shared-string table and is never parsed as a formula.
 */
function toExcelValue(raw: unknown, formatted: string | null): ExcelValue {
  if (formatted !== null) return formatted;
  if (raw == null) return null;
  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string') return raw;
  if (raw instanceof Date) return raw;
  return String(raw);
}

/** The grid's content as a composable payload (styles travel as specs, not ids). */
export function sheetPayload<TData>(
  ctx: GridContext<TData>,
  params: ExcelExportParams<TData> = {},
): { sheet: ExcelSheetData; styleSpecs: StyleSpec[] } {
  const styles = new StyleTable();
  const { sheet } = buildSheetData(ctx, params, styles);
  return { sheet, styleSpecs: styles.specList() };
}

/**
 * Merge independently-built sheet payloads into one workbook. Style ids are
 * re-interned per sheet, so payloads from different grids (each with their
 * own style table) compose without collisions.
 */
export async function buildMultiSheetWorkbook(
  payloads: { sheet: ExcelSheetData; styleSpecs: StyleSpec[] }[],
): Promise<Uint8Array> {
  const styles = new StyleTable();
  const sheets = payloads.map(({ sheet, styleSpecs }) => {
    const remap = styleSpecs.map((spec, i) => (i === 0 ? 0 : styles.add(spec)));
    return {
      ...sheet,
      rows: sheet.rows.map((row) =>
        row.map((cell) =>
          cell.styleId ? { ...cell, styleId: remap[cell.styleId] ?? 0 } : cell,
        ),
      ),
    };
  });
  return buildWorkbook(sheets, styles);
}

/** Assemble sheets into a complete .xlsx byte stream. */
export async function buildWorkbook(
  sheets: ExcelSheetData[],
  styles: StyleTable,
): Promise<Uint8Array> {
  const strings = new SharedStrings();
  const names = sheets.map((s, i) => sanitizeSheetName(s.name, `Sheet${i + 1}`));
  // Sheet XML must be generated before sharedStrings.xml — it fills the table.
  const sheetParts = sheets.map((s) => sheetXml(s, strings));

  return createZip([
    { name: '[Content_Types].xml', data: utf8(contentTypesXml(sheets.length)) },
    { name: '_rels/.rels', data: utf8(rootRelsXml()) },
    { name: 'xl/workbook.xml', data: utf8(workbookXml(names)) },
    { name: 'xl/_rels/workbook.xml.rels', data: utf8(workbookRelsXml(sheets.length)) },
    { name: 'xl/styles.xml', data: utf8(styles.toXml()) },
    { name: 'xl/sharedStrings.xml', data: utf8(strings.toXml()) },
    ...sheetParts.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: utf8(xml) })),
  ]);
}

/** Grid → .xlsx bytes for the current view. */
export async function exportExcel<TData>(
  ctx: GridContext<TData>,
  params: ExcelExportParams<TData> = {},
): Promise<Uint8Array> {
  const { sheet, styles } = buildSheetData(ctx, params);
  return buildWorkbook([sheet], styles);
}

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Trigger a browser download of workbook bytes. No-op outside the browser. */
export function downloadWorkbook(bytes: Uint8Array, fileName: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([bytes as BlobPart], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
