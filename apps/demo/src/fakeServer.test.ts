import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeServer, sortRows } from './fakeServer';
import { makeRows, type Row } from './data';
import type { GetRowsParams } from '@augrid/core';

function makeParams(
  startRow: number,
  endRow: number,
  sortModel: { colId: string; sort: 'asc' | 'desc' }[],
  success: GetRowsParams<Row>['success'],
): GetRowsParams<Row> {
  return { startRow, endRow, sortModel, filterModel: {}, success, fail: () => {} };
}

describe('sortRows', () => {
  const rows = makeRows(200);

  it('returns input untouched when sort model is empty', () => {
    expect(sortRows(rows, [])).toBe(rows);
  });

  it('does not mutate the input', () => {
    const copy = rows.slice();
    sortRows(rows, [{ colId: 'gold', sort: 'desc' }]);
    expect(rows).toEqual(copy);
  });

  it('sorts numbers ascending and descending', () => {
    const asc = sortRows(rows, [{ colId: 'gold', sort: 'asc' }]);
    const desc = sortRows(rows, [{ colId: 'gold', sort: 'desc' }]);
    for (let i = 1; i < asc.length; i++) expect(asc[i].gold).toBeGreaterThanOrEqual(asc[i - 1].gold);
    for (let i = 1; i < desc.length; i++) expect(desc[i].gold).toBeLessThanOrEqual(desc[i - 1].gold);
  });

  it('sorts strings', () => {
    const asc = sortRows(rows, [{ colId: 'athlete', sort: 'asc' }]);
    for (let i = 1; i < asc.length; i++) {
      expect(asc[i].athlete.localeCompare(asc[i - 1].athlete)).toBeGreaterThanOrEqual(0);
    }
  });

  it('sorts dates', () => {
    const asc = sortRows(rows, [{ colId: 'date', sort: 'asc' }]);
    for (let i = 1; i < asc.length; i++) {
      expect(asc[i].date.getTime()).toBeGreaterThanOrEqual(asc[i - 1].date.getTime());
    }
  });

  it('applies secondary sort keys', () => {
    const s = sortRows(rows, [
      { colId: 'country', sort: 'asc' },
      { colId: 'gold', sort: 'desc' },
    ]);
    for (let i = 1; i < s.length; i++) {
      if (s[i].country === s[i - 1].country) {
        expect(s[i].gold).toBeLessThanOrEqual(s[i - 1].gold);
      }
    }
  });
});

describe('createFakeServer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('answers a block after the latency with lastRow set', () => {
    const server = createFakeServer(1000, 500);
    let result: { rowData: Row[]; lastRow?: number } | null = null;
    server.datasource.getRows(makeParams(100, 200, [], (r) => (result = r)));
    expect(result).toBeNull();
    vi.advanceTimersByTime(499);
    expect(result).toBeNull();
    vi.advanceTimersByTime(1);
    expect(result).not.toBeNull();
    expect(result!.rowData).toHaveLength(100);
    expect(result!.lastRow).toBe(1000);
    // Block content matches the canonical dataset slice.
    expect(result!.rowData).toEqual(makeRows(1000).slice(100, 200));
  });

  it('honors the sort model server-side', () => {
    const server = createFakeServer(500, 10);
    let result: { rowData: Row[] } | null = null;
    server.datasource.getRows(
      makeParams(0, 50, [{ colId: 'total', sort: 'desc' }], (r) => (result = r)),
    );
    vi.advanceTimersByTime(10);
    const got = result!.rowData;
    for (let i = 1; i < got.length; i++) {
      expect(got[i].total).toBeLessThanOrEqual(got[i - 1].total);
    }
  });

  it('clamps the final partial block', () => {
    const server = createFakeServer(120, 0);
    let result: { rowData: Row[] } | null = null;
    server.datasource.getRows(makeParams(100, 200, [], (r) => (result = r)));
    expect(result!.rowData).toHaveLength(20);
  });

  it('logs requests and responses', () => {
    const log: string[] = [];
    const server = createFakeServer(100, 0, (m) => log.push(m));
    server.datasource.getRows(makeParams(0, 100, [{ colId: 'year', sort: 'asc' }], () => {}));
    expect(log[0]).toContain('getRows [0, 100)');
    expect(log[0]).toContain('year:asc');
    expect(log[1]).toContain('100 rows');
  });
});
