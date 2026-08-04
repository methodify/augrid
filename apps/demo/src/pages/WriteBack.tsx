import { useCallback, useMemo, useRef, useState } from 'react';
import { AuGrid, reactComponent } from '@augrid/react';
import type { CellEditRejectedEvent, CellEditRequestEvent, ColDef, GridApi } from '@augrid/core';
import type { PageProps } from '../App';
import { COUNTRIES, makeRows, type Row } from '../data';

const NUMERIC_FIELDS = new Set(['gold', 'silver', 'bronze', 'total', 'year']);

const DEFAULT_COL_DEF: ColDef<Row> = { sortable: true, resizable: true };
const getRowId = (p: { data: Row }) => p.data.id;

/** Rich grid-managed tooltip (tooltipComponent): medal breakdown card. */
function MedalCard({ data }: { data?: Row }) {
  if (!data) return null;
  return (
    <div style={{ display: 'grid', gap: 2, fontSize: 12, lineHeight: 1.4 }}>
      <strong>{data.athlete}</strong>
      <span>🥇 {data.gold} · 🥈 {data.silver} · 🥉 {data.bronze}</span>
      <span style={{ opacity: 0.7 }}>hover me — I stay open (tooltipInteraction)</span>
    </div>
  );
}

/**
 * Fabric-style write-back loop: the grid is readOnlyEdit — it never mutates
 * its own data. Every commit surfaces as a cellEditRequest; we simulate a
 * 300ms server round-trip, then apply the accepted value via
 * applyTransaction(update). Cell-change flash shows the server echo landing.
 */
export function WriteBack({ theme }: PageProps) {
  const [pending, setPending] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const apiRef = useRef<GridApi<Row> | null>(null);
  const initialRows = useRef<Row[] | null>(null);
  if (initialRows.current === null) initialRows.current = makeRows(60);

  const appendLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLog((l) => [...l.slice(-199), `[${ts}] ${msg}`]);
  }, []);

  const onCellEditRequest = useCallback(
    (e: CellEditRequestEvent<Row>) => {
      const { colId, oldValue, newValue, data } = e;
      if (!data) return;
      appendLog(`request  ${data.id}.${colId}: ${String(oldValue)} → ${String(newValue)}`);
      setPending((p) => p + 1);
      // Fake server: validate + persist, echo back after 300ms.
      setTimeout(() => {
        const updated: Row = { ...data };
        if (NUMERIC_FIELDS.has(colId)) {
          (updated as unknown as Record<string, unknown>)[colId] = Number(newValue);
        } else {
          (updated as unknown as Record<string, unknown>)[colId] = String(newValue);
        }
        if (colId === 'gold' || colId === 'silver' || colId === 'bronze') {
          updated.total = updated.gold + updated.silver + updated.bronze;
        }
        apiRef.current?.applyTransaction({ update: [updated] });
        setPending((p) => p - 1);
        appendLog(`applied  ${data.id}.${colId} = ${String(newValue)} (server ok, 300ms)`);
      }, 300);
    },
    [appendLog],
  );

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { field: 'athlete', editable: true, minWidth: 170 },
      {
        field: 'country',
        editable: true,
        cellEditor: 'select',
        cellEditorParams: { values: COUNTRIES },
        minWidth: 140,
      },
      { field: 'sport', editable: true, minWidth: 120 },
      { field: 'year', editable: true, cellEditor: 'number', width: 100 },
      { field: 'gold', editable: true, cellEditor: 'number', width: 90 },
      { field: 'silver', editable: true, cellEditor: 'number', width: 90 },
      { field: 'bronze', editable: true, cellEditor: 'number', width: 90 },
      { field: 'total', width: 100, tooltipComponent: reactComponent(MedalCard) },
    ],
    [],
  );

  return (
    <div className="demo-page">
      <div className="demo-toolbar">
        <span className={'demo-badge' + (pending === 0 ? ' idle' : '')}>
          {pending === 0 ? 'All changes saved' : `Saving… (${pending} pending)`}
        </span>
        <p className="demo-note">
          readOnlyEdit grid — edits go to a fake server (300ms) and come back via
          applyTransaction. Double-click a cell to edit; total is recomputed server-side.
          Try a negative medal count: validateEdit rejects it and cellEditRejected
          carries the message (see log). Hover a Total cell for a component tooltip.
        </p>
      </div>
      <div className="demo-split">
        <div className="demo-main">
          <div className="demo-grid">
            <AuGrid<Row>
              columnDefs={columnDefs}
              defaultColDef={DEFAULT_COL_DEF}
              rowData={initialRows.current}
              getRowId={getRowId}
              readOnlyEdit={true}
              enableCellChangeFlash={true}
              validateEdit={(p) =>
                NUMERIC_FIELDS.has(p.colId) && Number(p.newValue) < 0
                  ? 'Medal counts cannot be negative.'
                  : null
              }
              onCellEditRejected={(e: CellEditRejectedEvent<Row>) =>
                appendLog(`REJECTED ${e.data?.id}.${e.colId} = ${String(e.newValue)} — ${e.error}`)
              }
              tooltipInteraction={true}
              tooltipShowDelay={300}
              onCellEditRequest={onCellEditRequest}
              theme={theme}
              onGridReady={(e) => {
                apiRef.current = e.api as GridApi<Row>;
              }}
            />
          </div>
        </div>
        <div className="demo-log" aria-label="Event log">
          {log.length === 0 ? 'Edit a cell to see the write-back loop…' : log.join('\n')}
        </div>
      </div>
    </div>
  );
}
