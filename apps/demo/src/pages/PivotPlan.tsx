import { useCallback, useMemo, useRef, useState } from 'react';
import { AuGrid } from '@augrid/react';
import type {
  CellEditRequestEvent,
  ColDef,
  DefaultMenuItem,
  GetContextMenuItemsParams,
  GridApi,
  MenuItemDef,
  PivotCellContext,
  PivotKeyPart,
} from '@augrid/core';
import type { PageProps } from '../App';

/**
 * The planning-platform scenario (AUG-4/AUG-7): an editable pivot over a
 * "semantic model". Rows = item/color, columns = market/store, read-only
 * measures + one WRITE measure (allocation) + a write ATTRIBUTE (reason,
 * aggFunc 'first'). Every commit to an aggregate cell arrives as a
 * cellEditRequest carrying the intersection (rowKeys × pivotKeys × field);
 * the fake server applies it to the source rows and echoes back via
 * applyTransaction — the grid itself never mutates anything.
 */

interface PlanRow {
  id: string;
  item: string;
  color: string;
  market: string;
  store: string;
  onHand: number;
  ordered: number;
  onOrder: number;
  avg6wk: number;
  alloc: number;
  reason: string;
}

const ITEMS: [string, string[]][] = [
  ['Crew Tee', ['Black', 'White', 'Sage']],
  ['Zip Hoodie', ['Black', 'Heather']],
  ['Chino Short', ['Khaki', 'Navy']],
];
const MARKETS: [string, string[]][] = [
  ['East', ['NYC-01', 'BOS-02']],
  ['West', ['LA-11', 'SEA-12']],
];

function seedRows(): PlanRow[] {
  const rows: PlanRow[] = [];
  let n = 0;
  for (const [item, colors] of ITEMS) {
    for (const color of colors) {
      for (const [market, stores] of MARKETS) {
        for (const store of stores) {
          n++;
          rows.push({
            id: `${item}|${color}|${store}`,
            item,
            color,
            market,
            store,
            onHand: (n * 7) % 60,
            ordered: (n * 5) % 40,
            onOrder: (n * 3) % 25,
            avg6wk: Math.round((((n * 11) % 90) / 6) * 10) / 10,
            alloc: 0,
            reason: '',
          });
        }
      }
    }
  }
  return rows;
}

const keysText = (parts: PivotKeyPart[]) => parts.map((p) => `${p.colId}=${p.key}`).join(', ');
const getRowId = (p: { data: PlanRow }) => p.data.id;
const DEFAULT_COL_DEF: ColDef<PlanRow> = { sortable: true, resizable: true };

export function PivotPlan({ theme }: PageProps) {
  const [pending, setPending] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const apiRef = useRef<GridApi<PlanRow> | null>(null);
  const rowsRef = useRef<PlanRow[] | null>(null);
  if (rowsRef.current === null) rowsRef.current = seedRows();

  const appendLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLog((l) => [...l.slice(-199), `[${ts}] ${msg}`]);
  }, []);

  const applyWrite = useCallback(
    (field: 'alloc' | 'reason', newValue: unknown, pc: PivotCellContext<PlanRow>) => {
      const targets = pc.getLeafRows();
      appendLog(
        `request  ${field} = ${String(newValue)}  @ [${keysText(pc.rowKeys)}] × [${
          pc.pivotKeys.length ? keysText(pc.pivotKeys) : 'all columns'
        }] → ${targets.length} source row(s)`,
      );
      setPending((p) => p + 1);
      // Fake server: apply with app-side allocation semantics, echo in 300ms.
      setTimeout(() => {
        const updated: PlanRow[] = targets.map((row) => {
          const copy = { ...row };
          if (field === 'alloc') {
            // Deepest intersection = 1 row (direct write); higher levels
            // spread the entered total evenly — the APP owns this policy.
            copy.alloc = Math.round((Number(newValue) / targets.length) * 100) / 100;
          } else {
            copy.reason = String(newValue ?? '');
          }
          return copy;
        });
        apiRef.current?.applyTransaction({ update: updated });
        setPending((p) => p - 1);
        appendLog(
          `applied  ${updated.length} row(s)` +
            (field === 'alloc' && targets.length > 1 ? ` (spread ${String(newValue)} evenly)` : ''),
        );
      }, 300);
    },
    [appendLog],
  );

  const onCellEditRequest = useCallback(
    (e: CellEditRequestEvent<PlanRow>) => {
      const pc = e.pivot;
      if (!pc) return;
      const field = pc.valueColId;
      if (field === 'alloc' || field === 'reason') applyWrite(field, e.newValue, pc);
    },
    [applyWrite],
  );

  // Right-click: intersection-aware actions ahead of the built-in items.
  const getContextMenuItems = useCallback(
    (p: GetContextMenuItemsParams<PlanRow>): (DefaultMenuItem | MenuItemDef<PlanRow>)[] => {
      const pc = p.pivot;
      if (!pc) return p.defaultItems;
      const n = pc.getLeafRows().length;
      return [
        {
          name: `Drill through (${n} source row${n === 1 ? '' : 's'})`,
          icon: '🔎',
          action: () =>
            appendLog(
              `drill    [${keysText(pc.rowKeys)}] × [${
                pc.pivotKeys.length ? keysText(pc.pivotKeys) : 'all columns'
              }] → ${pc
                .getLeafRows()
                .map((r) => r.id)
                .join('; ')}`,
            ),
        },
        {
          name: 'Clear allocation here',
          icon: '⌫',
          disabled: pc.valueColId !== 'alloc',
          action: () => applyWrite('alloc', 0, pc),
        },
        'separator',
        ...p.defaultItems,
      ];
    },
    [appendLog, applyWrite],
  );

  const columnDefs = useMemo<ColDef<PlanRow>[]>(
    () => [
      { field: 'item', rowGroup: true },
      { field: 'color', rowGroup: true },
      { field: 'market', pivot: true },
      { field: 'store', pivot: true },
      { field: 'onHand', headerName: 'On hand', aggFunc: 'sum', width: 92 },
      { field: 'ordered', aggFunc: 'sum', width: 92 },
      { field: 'onOrder', headerName: 'On order', aggFunc: 'sum', width: 92 },
      { field: 'avg6wk', headerName: '6-wk avg', aggFunc: 'avg', width: 92 },
      {
        field: 'alloc',
        headerName: 'ALLOCATION',
        aggFunc: 'sum',
        editable: true,
        cellEditor: 'number',
        width: 110,
        cellClass: 'plan-write-cell',
      },
      {
        field: 'reason',
        headerName: 'Reason',
        aggFunc: 'first',
        editable: true,
        width: 110,
        cellClass: 'plan-write-cell',
      },
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
          Editable pivot: ALLOCATION and Reason are write fields (highlighted); other measures
          are read-only. Edits at store level write one source row; edits at market/item level
          are spread by the app. Double-click a highlighted cell, or right-click any cell for
          intersection-aware actions (drill-through, clear).
        </p>
      </div>
      <div className="demo-split">
        <div className="demo-main">
          <div className="demo-grid">
            <AuGrid<PlanRow>
              columnDefs={columnDefs}
              defaultColDef={DEFAULT_COL_DEF}
              rowData={rowsRef.current}
              getRowId={getRowId}
              pivotMode={true}
              groupDefaultExpanded={-1}
              suppressAggFuncInHeader={true}
              enableCellChangeFlash={true}
              onCellEditRequest={onCellEditRequest}
              getContextMenuItems={getContextMenuItems}
              theme={theme}
              onGridReady={(e) => {
                apiRef.current = e.api as GridApi<PlanRow>;
              }}
            />
          </div>
        </div>
        <div className="demo-log" aria-label="Write-back log">
          {log.length === 0
            ? 'Double-click an ALLOCATION or Reason cell to see intersection-keyed write-back…'
            : log.join('\n')}
        </div>
      </div>
    </div>
  );
}
