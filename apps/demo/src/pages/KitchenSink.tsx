import { useEffect, useMemo, useRef, useState } from 'react';
import { AuGrid, reactComponent } from '@augrid/react';
import type {
  CellRendererParams,
  ColDef,
  GridApi,
  GridState,
} from '@augrid/core';
import type { PageProps } from '../App';
import { COUNTRIES, makeRows, type Row } from '../data';

const STATE_KEY = 'augrid-demo-state';

/** Custom React cell renderer: medal emoji scaled to the total. */
function MedalTotal(params: CellRendererParams<Row>) {
  const total = Number(params.value ?? 0);
  const medal = total >= 10 ? '\u{1F947}' : total >= 5 ? '\u{1F948}' : total > 0 ? '\u{1F949}' : '';
  return (
    <span className="demo-medal-cell">
      <span>{medal}</span>
      <span>{params.valueFormatted || String(total)}</span>
    </span>
  );
}

const hot = { 'demo-hot': (p: { value: unknown }) => Number(p.value) > 2 };

/* Stable identities so the wrapper's prop diffing never sees phantom changes. */
const ROW_SELECTION = { mode: 'multiRow', checkboxes: true, headerCheckbox: true } as const;
const CELL_SELECTION = { handle: 'fill' } as const;
const getRowId = (p: { data: Row }) => p.data.id;

export function KitchenSink({ theme }: PageProps) {
  const [rowCount, setRowCount] = useState(100_000);
  const [quick, setQuick] = useState('');
  const [pagination, setPagination] = useState(false);
  const [pivotOn, setPivotOn] = useState(false);
  const [selInfo, setSelInfo] = useState('0 rows selected');
  const [rangeInfo, setRangeInfo] = useState('no cell range');
  const [editInfo, setEditInfo] = useState('no edits yet');
  const [scrollTo, setScrollTo] = useState('');
  const [findText, setFindText] = useState('');
  const [findInfo, setFindInfo] = useState('');
  const apiRef = useRef<GridApi<Row> | null>(null);
  const addedRef = useRef(0);

  const rows = useMemo(() => makeRows(rowCount), [rowCount]);

  // Pinned summary row: totals over the whole (unfiltered) dataset.
  const pinnedTop = useMemo<Row[]>(() => {
    let gold = 0;
    let silver = 0;
    let bronze = 0;
    for (const r of rows) {
      gold += r.gold;
      silver += r.silver;
      bronze += r.bronze;
    }
    return [
      {
        id: '__summary',
        athlete: `TOTALS (${rows.length.toLocaleString()} rows)`,
        country: '',
        sport: '',
        year: 0,
        date: new Date(2000, 0, 1),
        gold,
        silver,
        bronze,
        total: gold + silver + bronze,
      },
    ];
  }, [rows]);

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { field: 'athlete', pinned: 'left', filter: 'text', editable: true, minWidth: 170 },
      {
        field: 'country',
        filter: 'set',
        editable: true,
        cellEditor: 'select',
        cellEditorParams: { values: COUNTRIES },
        minWidth: 140,
      },
      { field: 'sport', filter: 'text', minWidth: 120 },
      { field: 'year', filter: 'number', width: 100 },
      {
        field: 'date',
        filter: 'date',
        editable: true,
        cellEditor: 'date',
        valueFormatter: (p) => (p.value instanceof Date ? p.value.toLocaleDateString() : ''),
        width: 130,
      },
      {
        field: 'gold',
        filter: 'number',
        aggFunc: 'sum',
        editable: true,
        cellEditor: 'number',
        cellClassRules: hot,
        width: 90,
      },
      {
        field: 'silver',
        filter: 'number',
        aggFunc: 'sum',
        editable: true,
        cellEditor: 'number',
        cellClassRules: hot,
        width: 90,
      },
      {
        field: 'bronze',
        filter: 'number',
        aggFunc: 'sum',
        editable: true,
        cellEditor: 'number',
        cellClassRules: hot,
        width: 90,
      },
      {
        field: 'total',
        filter: 'number',
        aggFunc: 'sum',
        editable: true,
        cellEditor: 'number',
        cellClassRules: hot,
        cellRenderer: reactComponent(MedalTotal),
        width: 110,
      },
    ],
    [],
  );

  const defaultColDef = useMemo<ColDef<Row>>(
    () => ({ sortable: true, resizable: true, floatingFilter: true }),
    [],
  );

  // Live status line driven by grid events.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const onSel = () => setSelInfo(`${api.getSelectedNodes().length} rows selected`);
    const onRange = () => {
      const ranges = api.getCellRanges();
      if (ranges.length === 0) {
        setRangeInfo('no cell range');
        return;
      }
      const r = ranges[ranges.length - 1];
      const nRows = Math.abs(r.endRowIndex - r.startRowIndex) + 1;
      setRangeInfo(
        `${ranges.length} range(s), last: ${nRows}×${r.colIds.length} [${r.colIds.join(', ')}]`,
      );
    };
    const onEdit = (e: { colId: string; oldValue: unknown; newValue: unknown; source: string }) =>
      setEditInfo(`edited ${e.colId}: ${String(e.oldValue)} → ${String(e.newValue)} (${e.source})`);
    api.addEventListener('selectionChanged', onSel);
    api.addEventListener('cellSelectionChanged', onRange);
    api.addEventListener('cellValueChanged', onEdit);
    return () => {
      api.removeEventListener('selectionChanged', onSel);
      api.removeEventListener('cellSelectionChanged', onRange);
      api.removeEventListener('cellValueChanged', onEdit);
    };
  }, [rowCount]);

  const api = () => apiRef.current;

  const groupByCountryYear = () =>
    api()?.applyColumnState({
      state: [
        { colId: 'country', rowGroup: true, rowGroupIndex: 0 },
        { colId: 'year', rowGroup: true, rowGroupIndex: 1 },
      ],
    });

  const clearGrouping = () =>
    api()?.applyColumnState({ state: [], defaultState: { rowGroup: false } });

  const togglePivot = () => {
    const a = api();
    if (!a) return;
    if (!pivotOn) {
      a.applyColumnState({
        state: [
          { colId: 'country', rowGroup: true, rowGroupIndex: 0 },
          { colId: 'sport', pivot: true, pivotIndex: 0 },
          { colId: 'gold', aggFunc: 'sum' },
          { colId: 'silver', aggFunc: 'sum' },
          { colId: 'bronze', aggFunc: 'sum' },
        ],
      });
      a.setGridOption('pivotMode', true);
      setPivotOn(true);
    } else {
      a.setGridOption('pivotMode', false);
      a.applyColumnState({ state: [], defaultState: { pivot: false, rowGroup: false } });
      setPivotOn(false);
    }
  };

  const addTenRows = () => {
    const a = api();
    if (!a) return;
    const base = addedRef.current;
    addedRef.current += 10;
    const add: Row[] = [];
    for (let i = 0; i < 10; i++) {
      const n = base + i;
      add.push({
        id: `new-${n}`,
        athlete: `New Athlete ${n}`,
        country: COUNTRIES[n % COUNTRIES.length],
        sport: 'Swimming',
        year: 2024,
        date: new Date(2024, 6, 26),
        gold: 1,
        silver: 0,
        bronze: 0,
        total: 1,
      });
    }
    a.applyTransaction({ add, addIndex: 0 });
  };

  const removeSelected = () => {
    const a = api();
    if (!a) return;
    const remove = a.getSelectedRows();
    if (remove.length > 0) a.applyTransaction({ remove });
  };

  const saveState = () => {
    const a = api();
    if (!a) return;
    localStorage.setItem(STATE_KEY, JSON.stringify(a.getState()));
    setEditInfo('state saved to localStorage');
  };

  const restoreState = () => {
    const a = api();
    const raw = localStorage.getItem(STATE_KEY);
    if (!a || !raw) return;
    a.applyState(JSON.parse(raw) as GridState);
    setEditInfo('state restored from localStorage');
  };

  const doScrollTo = () => {
    const idx = parseInt(scrollTo, 10);
    if (Number.isFinite(idx)) api()?.ensureIndexVisible(idx, 'middle');
  };

  return (
    <div className="demo-page">
      <div className="demo-toolbar">
        <label>
          Rows{' '}
          <select value={rowCount} onChange={(e) => setRowCount(Number(e.target.value))}>
            <option value={1_000}>1k</option>
            <option value={100_000}>100k</option>
            <option value={1_000_000}>1M</option>
          </select>
        </label>
        <input
          placeholder="Quick filter…"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
        />
        <span className="sep" />
        <button onClick={groupByCountryYear}>Group country+year</button>
        <button onClick={clearGrouping}>Clear grouping</button>
        <button onClick={togglePivot}>{pivotOn ? 'Pivot off' : 'Pivot by sport'}</button>
        <span className="sep" />
        <button onClick={() => api()?.exportDataAsCsv({ fileName: 'augrid-demo.csv' })}>
          Export CSV
        </button>
        <button onClick={() => api()?.undoCellEditing()}>Undo</button>
        <button onClick={() => api()?.redoCellEditing()}>Redo</button>
        <span className="sep" />
        <button onClick={() => api()?.selectAll()}>Select all</button>
        <button onClick={() => api()?.deselectAll()}>Clear selection</button>
        <button onClick={() => api()?.autoSizeAllColumns()}>Autosize all</button>
        <span className="sep" />
        <button onClick={saveState}>Save state</button>
        <button onClick={restoreState}>Restore state</button>
        <span className="sep" />
        <button onClick={addTenRows}>Add 10 rows</button>
        <button onClick={removeSelected}>Remove selected</button>
        <span className="sep" />
        <label>
          <input
            type="checkbox"
            checked={pagination}
            onChange={(e) => setPagination(e.target.checked)}
          />{' '}
          Pagination
        </label>
        <span className="sep" />
        <input
          style={{ width: 90 }}
          placeholder="Row index"
          value={scrollTo}
          onChange={(e) => setScrollTo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doScrollTo()}
        />
        <button onClick={doScrollTo}>Scroll to row</button>
        <span className="sep" />
        <input
          style={{ width: 110 }}
          placeholder="Find in grid…"
          value={findText}
          onChange={(e) => {
            setFindText(e.target.value);
            api()?.setFindText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.shiftKey ? api()?.findPrevious() : api()?.findNext());
          }}
        />
        <button onClick={() => api()?.findPrevious()}>◀</button>
        <button onClick={() => api()?.findNext()}>▶</button>
        {findInfo && <span>{findInfo}</span>}
      </div>
      <div className="demo-grid">
        <AuGrid<Row>
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowData={rows}
          getRowId={getRowId}
          rowSelection={ROW_SELECTION}
          cellSelection={CELL_SELECTION}
          undoRedoCellEditing={true}
          enableCellChangeFlash={true}
          pagination={pagination}
          paginationPageSize={100}
          pinnedTopRowData={pinnedTop}
          quickFilterText={quick}
          groupDefaultExpanded={0}
          sideBar={true}
          onFindChanged={(e) =>
            setFindInfo(
              e.text === ''
                ? ''
                : `${e.activeIndex < 0 ? '–' : e.activeIndex + 1}/${e.totalMatches}`,
            )
          }
          theme={theme}
          onGridReady={(e) => {
            apiRef.current = e.api as GridApi<Row>;
          }}
        />
      </div>
      <div className="demo-status">
        <span>{selInfo}</span>
        <span>{rangeInfo}</span>
        <span>{editInfo}</span>
      </div>
    </div>
  );
}
