/**
 * Fake remote server for the infinite row model demo: holds the full dataset
 * in memory, honors the sortModel server-side, and answers block requests
 * after a configurable latency.
 */
import type { Datasource } from '@augrid/core';
import { makeRows, type Row } from './data';

export interface SortModelEntry {
  colId: string;
  sort: 'asc' | 'desc';
}

/** Server-side sort: stable, multi-column, handles string/number/Date fields. */
export function sortRows(rows: Row[], sortModel: SortModelEntry[]): Row[] {
  if (sortModel.length === 0) return rows;
  const sorted = rows.slice();
  sorted.sort((a, b) => {
    for (const { colId, sort } of sortModel) {
      const av = a[colId as keyof Row];
      const bv = b[colId as keyof Row];
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else if (av instanceof Date && bv instanceof Date) cmp = av.getTime() - bv.getTime();
      else cmp = String(av).localeCompare(String(bv));
      if (cmp !== 0) return sort === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
  return sorted;
}

export interface FakeServer {
  datasource: Datasource<Row>;
  rowCount: number;
}

export function createFakeServer(
  rowCount: number,
  latencyMs: number,
  onLog?: (msg: string) => void,
): FakeServer {
  const all = makeRows(rowCount);
  const datasource: Datasource<Row> = {
    getRows(params) {
      const sortDesc =
        params.sortModel.length === 0
          ? 'none'
          : params.sortModel.map((s) => `${s.colId}:${s.sort}`).join(',');
      onLog?.(`→ getRows [${params.startRow}, ${params.endRow}) sort=${sortDesc}`);
      const slice = sortRows(all, params.sortModel).slice(params.startRow, params.endRow);
      const send = () => {
        onLog?.(`← ${slice.length} rows (total ${rowCount})`);
        params.success({ rowData: slice, lastRow: rowCount });
      };
      if (latencyMs > 0) setTimeout(send, latencyMs);
      else send();
    },
  };
  return { datasource, rowCount };
}
