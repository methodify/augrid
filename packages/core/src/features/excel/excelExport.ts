import type { GridContext } from '../../context.js';
import type { Column } from '../../columns/column.js';
import type { RowNode } from '../../rows/rowNode.js';
import type { ExcelExportParams } from '../../types/api.js';
import { toSeries } from '../sparkline/sparkline.js';
import {
  SharedStrings,
  StyleTable,
  columnName,
  contentTypesXml,
  rootRelsXml,
  sanitizeSheetName,
  sheetXml,
  uniqueSheetNames,
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

  // Native sparklines: which columns become live Excel sparklines, and the
  // per-row series captured for their hidden data blocks.
  const NATIVE_TYPES: Record<string, 'line' | 'column' | 'stacked'> = {
    line: 'line',
    area: 'line', // Excel sparklines have no area type
    band: 'line',
    column: 'column',
    winLoss: 'stacked', // Excel's name for win/loss
  };
  const nativeCols = params.nativeSparklines
    ? columns
        .map((col, i) => ({ col, i, type: NATIVE_TYPES[col.getColDef().sparkline?.type ?? 'line'] }))
        .filter((e): e is { col: Column<TData>; i: number; type: 'line' | 'column' | 'stacked' } =>
          Boolean(e.col.getColDef().sparkline && e.type),
        )
    : [];
  const nativeColIdx = new Set(nativeCols.map((e) => e.i));
  const capturedSeries = new Map<number, (number | null)[][]>(); // colIdx → per-row series
  for (const e of nativeCols) capturedSeries.set(e.i, []);

  const emit = (node: RowNode<TData>): void => {
    if (params.onlySelected && node.isSelected() !== true) return;
    rows.push(
      columns.map((col, i) => {
        const raw = ctx.values.getValue(node, col);
        if (nativeColIdx.has(i)) {
          // The visible cell stays blank — the sparkline draws in it; the
          // series lands in the hidden block instead.
          capturedSeries.get(i)!.push(toSeries(raw).values);
          return { value: null };
        }
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

  // px → Excel character units (~7px per character at the default font).
  const columnWidths: (number | undefined)[] = columns.map((c) =>
    Math.max(6, Math.round((c.actualWidth / 7) * 10) / 10),
  );

  // Native sparklines: append each captured series block as hidden columns
  // after the data, and anchor one live sparkline per row to the (blank)
  // visible cell.
  const hiddenColumns: number[] = [];
  const sparklineGroups: NonNullable<ExcelSheetData['sparklineGroups']> = [];
  let nextCol = columns.length;
  for (const e of nativeCols) {
    const seriesPerRow = capturedSeries.get(e.i)!;
    const maxLen = seriesPerRow.reduce((m, s) => Math.max(m, s.length), 0);
    if (maxLen === 0) continue;
    const blockStart = nextCol;
    nextCol += maxLen;
    for (let c = blockStart; c < blockStart + maxLen; c++) hiddenColumns.push(c);

    // Note: referenceValue has no Excel-sparkline equivalent (Excel only
    // offers a zero axis); it is dropped on native export.
    const group: (typeof sparklineGroups)[number] = {
      type: e.type,
      sparklines: [],
    };
    seriesPerRow.forEach((series, r) => {
      const rowIdx = headerRows + r; // 0-based sheet row of this data row
      const row = rows[rowIdx]!;
      // Grow the row into the hidden block.
      while (row.length < blockStart) row.push({ value: null });
      for (let k = 0; k < maxLen; k++) row.push({ value: series[k] ?? null });
      if (series.some((v) => v != null)) {
        group.sparklines.push({
          range: `${columnName(blockStart)}${rowIdx + 1}:${columnName(blockStart + maxLen - 1)}${rowIdx + 1}`,
          anchor: `${columnName(e.i)}${rowIdx + 1}`,
        });
      }
    });
    if (group.sparklines.length > 0) sparklineGroups.push(group);
  }

  const sheet: ExcelSheetData = {
    name: sanitizeSheetName(params.sheetName ?? 'Sheet1'),
    rows,
    columnWidths,
    hiddenColumns: hiddenColumns.length ? hiddenColumns : undefined,
    freeze:
      params.suppressFreeze === true
        ? undefined
        : { rows: headerRows, cols: pinnedLeft },
    autoFilterRows: params.suppressAutoFilter === true ? 0 : headerRows,
    sparklineGroups: sparklineGroups.length ? sparklineGroups : undefined,
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
  // Sparkline series (without nativeSparklines): the numbers, space-joined —
  // consistent with CSV/clipboard, never '[object Object]'.
  if (Array.isArray(raw)) {
    return raw
      .map((v) =>
        v == null
          ? ''
          : typeof v === 'object' && 'y' in (v as Record<string, unknown>)
            ? String((v as { y: unknown }).y ?? '')
            : String(v),
      )
      .join(' ');
  }
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
  const names = uniqueSheetNames(sheets.map((s) => s.name));
  // Renaming must happen BEFORE part generation: native-sparkline formulas
  // reference the sheet by its FINAL name. Then sheet XML before
  // sharedStrings.xml — it fills the table.
  const sheetParts = sheets.map((s, i) => sheetXml({ ...s, name: names[i]! }, strings));

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
