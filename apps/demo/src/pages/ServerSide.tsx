import { useCallback, useMemo, useRef, useState } from 'react';
import { AuGrid } from '@augrid/react';
import type {
  CellEditRequestEvent,
  ColDef,
  GridApi,
  GroupKey,
  ServerSideDatasource,
} from '@augrid/core';
import type { PageProps } from '../App';

/**
 * Server-side row model: an enterprise-planning scenario. A fake "semantic
 * model" server owns a Region → Store → SKU hierarchy (including a BLANK
 * region member — null keys are real member values) and computes aggregates
 * at every grain. Children are fetched per-parent on expand; edits on group
 * rows arrive as cellEditRequest with the raw key path, the server
 * decomposes, and the affected store refreshes in place.
 */

interface Row {
  region?: string | null;
  store?: string | null;
  sku?: string;
  onHand: number;
  target: number;
}

/* ------------------------------ fake server ------------------------------ */

const REGION_DEFS: { key: string | null; stores: number }[] = [
  { key: 'East', stores: 6 },
  { key: 'Central', stores: 4 },
  { key: null, stores: 2 }, // unassigned region — blank member, like real MDX data
  { key: 'West', stores: 8 },
];

interface Leaf {
  region: string | null;
  store: string;
  sku: string;
  onHand: number;
  target: number;
}

function buildServerData(): Leaf[] {
  const leaves: Leaf[] = [];
  let n = 0;
  for (const r of REGION_DEFS) {
    for (let s = 0; s < r.stores; s++) {
      const store = `${r.key ? r.key.slice(0, 1) : 'U'}-${100 + s}`;
      const skus = 40 + ((s * 13) % 30);
      for (let k = 0; k < skus; k++) {
        n++;
        leaves.push({
          region: r.key,
          store,
          sku: `SKU-${store}-${String(k).padStart(3, '0')}`,
          onHand: (n * 7) % 120,
          target: (n * 11) % 90,
        });
      }
    }
  }
  return leaves;
}

/* ------------------------------ demo page ------------------------------- */

export function ServerSide({ theme }: PageProps) {
  const [log, setLog] = useState<string[]>([]);
  const apiRef = useRef<GridApi<Row> | null>(null);
  const serverRef = useRef<Leaf[] | null>(null);
  if (serverRef.current === null) serverRef.current = buildServerData();

  const appendLog = useCallback((msg: string) => {
    setLog((l) => [...l.slice(-199), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const datasource = useMemo<ServerSideDatasource<Row>>(
    () => ({
      getRows: (params) => {
        const server = serverRef.current!;
        const { groupKeys, startRow, endRow } = params;
        appendLog(
          `getRows  [${groupKeys.map((k) => JSON.stringify(k)).join(', ')}] rows ${startRow}-${endRow}`,
        );
        // Simulate one DAX query per expansion, 250ms latency.
        setTimeout(() => {
          if (groupKeys.length === 0) {
            const rows = REGION_DEFS.map((r) => {
              const mine = server.filter((l) => l.region === r.key);
              return {
                region: r.key,
                onHand: mine.reduce((s, l) => s + l.onHand, 0),
                target: mine.reduce((s, l) => s + l.target, 0),
              };
            });
            params.success({ rowData: rows, rowCount: rows.length });
          } else if (groupKeys.length === 1) {
            const mine = server.filter((l) => l.region === groupKeys[0]);
            const stores = [...new Set(mine.map((l) => l.store))];
            const rows = stores.map((store) => {
              const sl = mine.filter((l) => l.store === store);
              return {
                region: groupKeys[0] as string | null,
                store,
                onHand: sl.reduce((s, l) => s + l.onHand, 0),
                target: sl.reduce((s, l) => s + l.target, 0),
              };
            });
            params.success({ rowData: rows.slice(startRow, endRow), rowCount: rows.length });
          } else {
            const mine = server.filter(
              (l) => l.region === groupKeys[0] && l.store === groupKeys[1],
            );
            params.success({ rowData: mine.slice(startRow, endRow), rowCount: mine.length });
          }
        }, 250);
      },
    }),
    [appendLog],
  );

  const onCellEditRequest = useCallback(
    (e: CellEditRequestEvent<Row>) => {
      const pc = e.pivot;
      if (!pc || pc.valueColId !== 'target') return;
      const path = pc.rowKeys.map((p) => p.key);
      appendLog(
        `write    target = ${String(e.newValue)} @ [${path.map((k) => JSON.stringify(k)).join(', ')}] → server decomposes`,
      );
      // Fake server: spread the new target evenly over the branch's leaves.
      setTimeout(() => {
        const server = serverRef.current!;
        const [region, store] = path as (string | null)[];
        const targets = server.filter(
          (l) => l.region === region && (path.length < 2 || l.store === store),
        );
        const per = Math.round((Number(e.newValue) / Math.max(1, targets.length)) * 100) / 100;
        for (const l of targets) l.target = per;
        // Refresh exactly the stores whose grains changed — in place.
        apiRef.current?.refreshServerSideStore({ groupKeys: [] });
        if (path.length >= 1) apiRef.current?.refreshServerSideStore({ groupKeys: [region ?? null] });
        if (path.length >= 2)
          apiRef.current?.refreshServerSideStore({ groupKeys: [region ?? null, store ?? null] });
        appendLog(`applied  ${targets.length} leaves updated, stores refreshed in place`);
      }, 300);
    },
    [appendLog],
  );

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { field: 'region', rowGroup: true },
      { field: 'store', rowGroup: true },
      { field: 'sku', width: 170 },
      { field: 'onHand', headerName: 'On hand', width: 110 },
      {
        field: 'target',
        headerName: 'TARGET',
        aggFunc: 'sum',
        editable: true,
        cellEditor: 'number',
        width: 110,
        cellClass: 'plan-write-cell',
      },
    ],
    [],
  );

  const isServerSideGroup = useCallback((d: Row) => d.sku === undefined, []);
  const getServerSideGroupKey = useCallback(
    (d: Row): GroupKey => (d.store !== undefined ? (d.store as GroupKey) : (d.region as GroupKey)),
    [],
  );
  const getRowId = useCallback(
    (p: { data: Row; level: number; parentKeys?: string[] }) =>
      p.data.sku ?? `g${p.level}:${p.parentKeys?.join('') ?? ''}:${String(p.data.store ?? p.data.region)}`,
    [],
  );

  return (
    <div className="demo-page">
      <div className="demo-toolbar">
        <p className="demo-note">
          Server-side row model: children fetched per parent on expand (watch the log); the
          "(unnamed)" region is a NULL member — blank keys round-trip. TARGET is editable at any
          level; group edits are event-routed with the raw key path, the fake server decomposes
          to leaves and the affected stores refresh in place.
        </p>
      </div>
      <div className="demo-split">
        <div className="demo-main">
          <div className="demo-grid">
            <AuGrid<Row>
              columnDefs={columnDefs}
              rowModelType="serverSide"
              serverSideDatasource={datasource}
              cacheBlockSize={50}
              suppressAggFuncInHeader={true}
              isServerSideGroup={isServerSideGroup}
              getServerSideGroupKey={getServerSideGroupKey}
              getRowId={getRowId}
              onCellEditRequest={onCellEditRequest}
              theme={theme}
              onGridReady={(e) => {
                apiRef.current = e.api as GridApi<Row>;
              }}
            />
          </div>
        </div>
        <div className="demo-log" aria-label="Server log">
          {log.length === 0 ? 'Expand a region to fetch its stores…' : log.join('\n')}
        </div>
      </div>
    </div>
  );
}
