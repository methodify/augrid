import { useEffect, useRef, useState } from 'react';
import { createGrid } from '@augrid/core';
import type { ColDef, GridApi, GridEventListener, GridEventName } from '@augrid/core';
import type { PageProps } from '../App';
import { formatMs, frameStats } from '../bench';
import { makeRows, type Row } from '../data';

interface BenchResult {
  scenario: string;
  result: string;
  detail: string;
}

const BENCH_COLS: ColDef<Row>[] = [
  { field: 'athlete', minWidth: 160 },
  { field: 'country', minWidth: 130 },
  { field: 'sport', minWidth: 110 },
  { field: 'year', width: 100 },
  { field: 'date', width: 120, valueFormatter: (p) => (p.value instanceof Date ? p.value.toLocaleDateString() : '') },
  { field: 'gold', width: 90 },
  { field: 'silver', width: 90 },
  { field: 'bronze', width: 90 },
  { field: 'total', width: 100 },
];

const ROW_COUNT = 100_000;

/** Resolve with elapsed ms when `type` fires after running `run` (15s timeout → -1). */
function timedEvent<K extends GridEventName>(
  api: GridApi<Row>,
  type: K,
  run: () => void,
): Promise<number> {
  return new Promise((resolve) => {
    let done = false;
    const listener = () => {
      if (done) return;
      done = true;
      api.removeEventListener(type, listener as GridEventListener<K, Row>);
      resolve(performance.now() - t0);
    };
    api.addEventListener(type, listener as GridEventListener<K, Row>);
    const t0 = performance.now();
    run();
    setTimeout(() => {
      if (!done) {
        done = true;
        api.removeEventListener(type, listener as GridEventListener<K, Row>);
        resolve(-1);
      }
    }, 15_000);
  });
}

export function Benchmark({ theme }: PageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<GridApi<Row> | null>(null);
  const [results, setResults] = useState<BenchResult[]>([]);
  const [running, setRunning] = useState<string | null>(null);

  useEffect(
    () => () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    },
    [],
  );

  // Keep an already-created benchmark grid in sync with the theme bar.
  useEffect(() => {
    apiRef.current?.setGridOption('theme', theme);
  }, [theme]);

  const addResult = (scenario: string, result: string, detail: string) =>
    setResults((r) => [...r, { scenario, result, detail }]);

  const destroyGrid = () => {
    apiRef.current?.destroy();
    apiRef.current = null;
    if (hostRef.current) hostRef.current.textContent = '';
  };

  /** Create a fresh 100k-row grid; resolves (ms since createGrid) on firstDataRendered. */
  const createBenchGrid = (): Promise<number> =>
    new Promise((resolve) => {
      destroyGrid();
      const el = hostRef.current!;
      const rows = makeRows(ROW_COUNT);
      let done = false;
      const t0 = performance.now();
      apiRef.current = createGrid<Row>(el, {
        columnDefs: BENCH_COLS,
        defaultColDef: { sortable: true, resizable: true },
        rowData: rows,
        getRowId: (p) => p.data.id,
        theme,
        onFirstDataRendered: () => {
          if (done) return;
          done = true;
          resolve(performance.now() - t0);
        },
      });
      setTimeout(() => {
        if (!done) {
          done = true;
          resolve(-1);
        }
      }, 15_000);
    });

  const ensureGrid = async (): Promise<GridApi<Row>> => {
    if (!apiRef.current) await createBenchGrid();
    return apiRef.current!;
  };

  const report = (name: string, ms: number, detail: string) =>
    addResult(name, ms < 0 ? 'timeout' : formatMs(ms), detail);

  const runInitialRender = async () => {
    const ms = await createBenchGrid();
    report(
      'Initial render (100k rows)',
      ms,
      'performance.now() around createGrid → firstDataRendered',
    );
  };

  const runScrollTest = async () => {
    const api = await ensureGrid();
    void api;
    const vp = hostRef.current!.querySelector('.au-body-center-vp') as HTMLElement | null;
    if (!vp) {
      addResult('Scroll (3s sweep)', 'n/a', 'viewport element .au-body-center-vp not found');
      return;
    }
    vp.scrollTop = 0;
    const durationMs = 3_000;
    const maxScroll = Math.max(1, vp.scrollHeight - vp.clientHeight);
    const step = maxScroll / (durationMs / 16.7); // one full sweep over the run
    const deltas: number[] = [];
    await new Promise<void>((resolve) => {
      const start = performance.now();
      let last = start;
      const tick = () => {
        const now = performance.now();
        deltas.push(now - last);
        last = now;
        vp.scrollTop = vp.scrollTop + step >= maxScroll ? 0 : vp.scrollTop + step;
        if (now - start >= durationMs) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const s = frameStats(deltas);
    addResult(
      'Scroll (3s sweep)',
      `avg ${formatMs(s.avgMs)} / p95 ${formatMs(s.p95Ms)}`,
      `${s.frames} frames, max ${formatMs(s.maxMs)} — rAF deltas while stepping scrollTop`,
    );
  };

  const runSortTest = async () => {
    const api = await ensureGrid();
    api.setSortModel([]);
    const ms = await timedEvent(api, 'sortChanged', () =>
      api.setSortModel([{ colId: 'athlete', sort: 'asc' }]),
    );
    report('Sort 100k (athlete asc)', ms, 'setSortModel → sortChanged event');
  };

  const runFilterTest = async () => {
    const api = await ensureGrid();
    api.setFilterModel(null);
    const ms = await timedEvent(api, 'filterChanged', () =>
      api.setFilterModel({
        sport: { filterType: 'text', conditions: [{ type: 'contains', filter: 'Swimming' }] },
      }),
    );
    const kept = api.getDisplayedRowCount();
    api.setFilterModel(null);
    report('Filter 100k (sport contains "Swimming")', ms, `setFilterModel → filterChanged; ${kept.toLocaleString()} rows kept`);
  };

  const runGroupTest = async () => {
    const api = await ensureGrid();
    const ms = await timedEvent(api, 'modelUpdated', () =>
      api.applyColumnState({
        state: [
          { colId: 'country', rowGroup: true },
          { colId: 'gold', aggFunc: 'sum' },
          { colId: 'total', aggFunc: 'sum' },
        ],
      }),
    );
    report('Group + aggregate 100k (by country, sum)', ms, 'applyColumnState → modelUpdated event');
    api.applyColumnState({ state: [], defaultState: { rowGroup: false, aggFunc: null } });
  };

  const scenarios: { name: string; run: () => Promise<void> }[] = [
    { name: 'Initial render', run: runInitialRender },
    { name: 'Scroll test', run: runScrollTest },
    { name: 'Sort 100k', run: runSortTest },
    { name: 'Filter 100k', run: runFilterTest },
    { name: 'Group + agg', run: runGroupTest },
  ];

  const runOne = async (s: { name: string; run: () => Promise<void> }) => {
    if (running) return;
    setRunning(s.name);
    try {
      await s.run();
    } finally {
      setRunning(null);
    }
  };

  const runAll = async () => {
    if (running) return;
    setRunning('all');
    try {
      for (const s of scenarios) await s.run();
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="demo-page">
      <div className="demo-toolbar">
        {scenarios.map((s) => (
          <button key={s.name} disabled={running !== null} onClick={() => void runOne(s)}>
            {s.name}
          </button>
        ))}
        <span className="sep" />
        <button disabled={running !== null} onClick={() => void runAll()}>
          Run all
        </button>
        <button disabled={running !== null} onClick={() => setResults([])}>
          Clear results
        </button>
        {running && <span className="demo-badge">Running: {running}…</span>}
      </div>
      {results.length > 0 && (
        <table className="demo-results">
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Result</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td>{r.scenario}</td>
                <td>{r.result}</td>
                <td>{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="demo-grid" ref={hostRef} />
    </div>
  );
}
