import { useMemo, useRef, useState } from 'react';
import { AuGrid } from '@augrid/react';
import type { ColDef, GridApi, SparklinePointClickedEvent } from '@augrid/core';
import type { PageProps } from '../App';

/**
 * Cell visuals, phase 1: sparkline columns over a planning-shaped
 * dataset — 13 weeks of demand per SKU, weekly variance to plan, and a
 * hit/miss record. Demonstrates the scale-honesty choice: the same demand
 * series drawn with a per-cell scale (shape) and a column-shared scale
 * (magnitude), side by side.
 */

interface Row {
  sku: string;
  category: string;
  demand: number[];
  variance: number[];
  hitMiss: number[];
  onHand: number;
  plan: number;
  lastYear: number;
  forecast: { y: number; low: number; high: number }[];
}

const CATEGORIES = ['Tops', 'Bottoms', 'Outerwear', 'Footwear'];

function makeRows(n: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    // Mix of shapes so the visuals have something to say: rising, falling,
    // seasonal, flat, and one with missing weeks.
    const base = 20 + ((i * 37) % 260);
    const shape = i % 5;
    const demand: number[] = [];
    const variance: number[] = [];
    const hitMiss: number[] = [];
    for (let w = 0; w < 13; w++) {
      let v: number;
      if (shape === 0) v = base + w * 9;
      else if (shape === 1) v = base + (12 - w) * 7;
      else if (shape === 2) v = base + Math.round(Math.sin(w / 2) * base * 0.4);
      else if (shape === 3) v = base;
      else v = base + ((w * 13 + i) % 40);
      demand.push(Math.max(0, v));
      const varW = Math.round(v * (((w * 7 + i * 3) % 21) - 10) * 0.01);
      variance.push(varW);
      hitMiss.push(varW >= 0 ? 1 : -1);
    }
    // One row per category has a data outage mid-quarter.
    if (i % 17 === 3) {
      demand[5] = Number.NaN;
      demand[6] = Number.NaN;
    }
    const onHand = (i * 53) % 900;
    // Forecast cone: widening uncertainty around the demand tail.
    const forecast = demand.slice(-8).map((v, k) => ({
      y: v,
      low: Math.round(v * (1 - 0.05 * (k + 1))),
      high: Math.round(v * (1 + 0.05 * (k + 1))),
    }));
    rows.push({
      sku: `SKU-${String(1000 + i)}`,
      category: CATEGORIES[i % CATEGORIES.length]!,
      demand,
      variance,
      hitMiss,
      onHand,
      plan: Math.round(onHand * (0.7 + ((i % 7) * 0.1))),
      lastYear: Math.round(onHand * (0.5 + ((i % 11) * 0.09))),
      forecast,
    });
  }
  return rows;
}

export function Sparklines({ theme }: PageProps) {
  const [rowCount, setRowCount] = useState(500);
  const [sortBy, setSortBy] = useState<'last' | 'slope' | 'mean'>('last');
  const [drill, setDrill] = useState('hover a line for a readout; click a point to drill');
  const apiRef = useRef<GridApi<Row> | null>(null);
  const rows = useMemo(() => makeRows(rowCount), [rowCount]);

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { field: 'sku', pinned: 'left', width: 120 },
      { field: 'category', width: 110 },
      {
        colId: 'demandAuto',
        headerName: '13-wk demand (per-cell scale)',
        valueGetter: (p) => p.data?.demand,
        sparkline: {
          type: 'line',
          domain: 'auto',
          markers: { last: true, min: true, max: true },
          pointLabel: (p) => `Wk ${p.index + 1}: ${p.value.toLocaleString()} u`,
          sortBy,
        },
        width: 220,
      },
      {
        colId: 'demandShared',
        headerName: '13-wk demand (shared scale)',
        valueGetter: (p) => p.data?.demand,
        sparkline: {
          type: 'area',
          domain: 'shared',
          markers: { last: true },
          sortBy,
        },
        width: 220,
      },
      {
        colId: 'variance',
        headerName: 'Variance to plan',
        valueGetter: (p) => p.data?.variance,
        sparkline: { type: 'column', referenceValue: 0, sortBy },
        width: 190,
      },
      {
        colId: 'hitMiss',
        headerName: 'Hit / miss',
        valueGetter: (p) => p.data?.hitMiss,
        sparkline: { type: 'winLoss' },
        width: 150,
      },
      {
        colId: 'forecast',
        headerName: 'Forecast cone',
        valueGetter: (p) => p.data?.forecast,
        sparkline: { type: 'band', markers: { last: true } },
        width: 170,
      },
      {
        field: 'onHand',
        headerName: 'On hand',
        width: 150,
        sparkline: { type: 'bar', showValue: 'value' },
      },
      {
        colId: 'vsPlan',
        headerName: 'On hand vs plan',
        valueGetter: (p) => p.data?.onHand,
        sparkline: {
          type: 'bullet',
          target: (p) => (p.data as Row | undefined)?.plan,
          showValue: 'value',
        },
        width: 175,
      },
      {
        colId: 'vsLY',
        headerName: 'vs last year',
        valueGetter: (p) => p.data?.onHand,
        sparkline: {
          type: 'delta',
          baseline: (p) => (p.data as Row | undefined)?.lastYear,
          showValue: 'value',
        },
        width: 150,
      },
    ],
    [sortBy],
  );

  return (
    <div className="demo-page">
      <div className="demo-toolbar">
        <label>
          Rows{' '}
          <select value={rowCount} onChange={(e) => setRowCount(Number(e.target.value))}>
            <option value={500}>500</option>
            <option value={10_000}>10k</option>
            <option value={100_000}>100k</option>
          </select>
        </label>
        <span className="sep" />
        <label>
          Sort series by{' '}
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
            <option value="last">last value</option>
            <option value="slope">trend (slope)</option>
            <option value="mean">mean</option>
          </select>
        </label>
        <p className="demo-note">
          Click a sparkline header to sort — an array-valued column sorts by its series summary
          (try "trend" to rank by who's rising fastest). The two demand columns hold the SAME
          data: per-cell scaling shows each SKU's <em>shape</em>; the shared scale makes rows
          comparable by <em>magnitude</em>. Missing weeks break the line rather than reading as
          zero.
        </p>
      </div>
      <div className="demo-grid">
        <AuGrid<Row>
          columnDefs={columnDefs}
          rowData={rows}
          getRowId={(p) => p.data.sku}
          rowHeight={30}
          theme={theme}
          onGridReady={(e) => {
            apiRef.current = e.api as GridApi<Row>;
          }}
          onSparklinePointClicked={(e: SparklinePointClickedEvent<Row>) =>
            setDrill(
              `drill → ${e.data?.sku ?? ''} · ${e.colId} · week ${e.index + 1} = ${e.value.toLocaleString()}`,
            )
          }
        />
      </div>
      <div className="demo-status">
        <span>{drill}</span>
        <button
          onClick={() =>
            apiRef.current?.exportDataAsExcel({
              fileName: 'augrid-sparklines.xlsx',
              sheetName: 'Trends',
              nativeSparklines: true,
            })
          }
        >
          Export Excel (live sparklines)
        </button>
      </div>
    </div>
  );
}
