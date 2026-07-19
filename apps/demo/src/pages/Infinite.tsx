import { useCallback, useMemo, useRef, useState } from 'react';
import { AuGrid } from '@augrid/react';
import type { ColDef } from '@augrid/core';
import type { PageProps } from '../App';
import { createFakeServer } from '../fakeServer';
import type { Row } from '../data';

/**
 * Infinite row model against a fake server: 10k rows, 500ms latency, blocks
 * fetched on demand. Click a header to sort — the sortModel goes to the
 * server, the cache resets, and blocks are re-fetched in server order.
 */
const DEFAULT_COL_DEF: ColDef<Row> = { sortable: true, resizable: true };
const getRowId = (p: { data: Row }) => p.data.id;

export function Infinite({ theme }: PageProps) {
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<(msg: string) => void>(() => {});
  logRef.current = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLog((l) => [...l.slice(-199), `[${ts}] ${msg}`]);
  }, []);

  // Server (and datasource identity) must be stable across re-renders.
  const server = useMemo(() => createFakeServer(10_000, 500, (m) => logRef.current(m)), []);

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { field: 'id', width: 90, sortable: false },
      { field: 'athlete', minWidth: 170 },
      { field: 'country', minWidth: 140 },
      { field: 'sport', minWidth: 120 },
      { field: 'year', width: 100 },
      { field: 'gold', width: 90 },
      { field: 'silver', width: 90 },
      { field: 'bronze', width: 90 },
      { field: 'total', width: 100 },
    ],
    [],
  );

  return (
    <div className="demo-page">
      <div className="demo-toolbar">
        <p className="demo-note">
          rowModelType=&quot;infinite&quot; — 10,000 rows on a fake server with 500ms latency,
          100-row blocks. Scroll to fetch blocks; sort a column to watch the server round-trip.
        </p>
      </div>
      <div className="demo-split">
        <div className="demo-main">
          <div className="demo-grid">
            <AuGrid<Row>
              columnDefs={columnDefs}
              defaultColDef={DEFAULT_COL_DEF}
              rowModelType="infinite"
              datasource={server.datasource}
              cacheBlockSize={100}
              maxBlocksInCache={10}
              getRowId={getRowId}
              theme={theme}
            />
          </div>
        </div>
        <div className="demo-log" aria-label="Server request log">
          {log.length === 0 ? 'Waiting for first block request…' : log.join('\n')}
        </div>
      </div>
    </div>
  );
}
