import { useMemo, useState } from 'react';
import { AuGrid } from '@augrid/react';
import type { ColDef, RowDragEvent } from '@augrid/core';
import type { PageProps } from '../App';

interface Order {
  id: string;
  customer: string;
  placed: string;
  status: 'open' | 'packed' | 'shipped';
  total: number;
  lines: { sku: string; qty: number; price: number }[];
}

function makeOrders(n: number): Order[] {
  const customers = ['Aster & Co', 'Birchmont', 'Corvid Labs', 'Deluxe North', 'Eastlight'];
  const skus = ['TEE-CREW', 'TEE-VNECK', 'HOOD-ZIP', 'CAP-SNAP', 'SOCK-3PK', 'BAG-TOTE'];
  return Array.from({ length: n }, (_, i) => {
    const lines = Array.from({ length: 2 + (i % 4) }, (_, k) => ({
      sku: skus[(i + k) % skus.length]!,
      qty: 1 + ((i * 7 + k * 3) % 12),
      price: 8 + ((i * 13 + k * 5) % 40),
    }));
    return {
      id: `SO-${String(1000 + i)}`,
      customer: customers[i % customers.length]!,
      placed: `2026-07-${String(1 + (i % 28)).padStart(2, '0')}`,
      status: (['open', 'packed', 'shipped'] as const)[i % 3],
      total: lines.reduce((s, l) => s + l.qty * l.price, 0),
      lines,
    };
  });
}

/** Detail panel: plain DOM table of the order's line items. */
function detailRenderer(p: { data?: Order }) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:10px 16px 10px 40px;font-size:12.5px;';
  const o = p.data;
  if (!o) return wrap;
  const rows = o.lines
    .map(
      (l) =>
        `<tr><td>${l.sku}</td><td style="text-align:right">${l.qty}</td>` +
        `<td style="text-align:right">$${l.price.toFixed(2)}</td>` +
        `<td style="text-align:right">$${(l.qty * l.price).toFixed(2)}</td></tr>`,
    )
    .join('');
  wrap.innerHTML =
    `<strong>${o.id} — ${o.lines.length} lines</strong>` +
    `<table style="margin-top:6px;border-collapse:collapse;min-width:360px">` +
    `<thead><tr><th style="text-align:left">SKU</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`;
  return wrap;
}

export function MasterDetail({ theme }: PageProps) {
  const [orders] = useState(() => makeOrders(40));
  const [dragLog, setDragLog] = useState('drag a row by its ⠿ handle to reorder');

  const columnDefs = useMemo<ColDef<Order>[]>(
    () => [
      { field: 'id', headerName: 'Order', rowDrag: true, width: 140 },
      { field: 'customer', width: 160 },
      { field: 'placed', width: 120 },
      { field: 'status', width: 110 },
      { field: 'total', cellDataType: 'number', width: 110, valueFormatter: (p) => `$${Number(p.value).toFixed(2)}` },
    ],
    [],
  );

  interface Span {
    section: string;
    item: string;
    q1: number;
    q2: number;
  }
  const spanRows = useMemo<Span[]>(
    () => [
      { section: 'Apparel — spans all columns', item: '', q1: 0, q2: 0 },
      { section: '', item: 'Tees', q1: 120, q2: 140 },
      { section: '', item: 'Hoodies', q1: 80, q2: 95 },
      { section: 'Accessories — spans all columns', item: '', q1: 0, q2: 0 },
      { section: '', item: 'Caps', q1: 60, q2: 66 },
      { section: '', item: 'Totes', q1: 30, q2: 41 },
    ],
    [],
  );
  const spanDefs = useMemo<ColDef<Span>[]>(
    () => [
      {
        field: 'section',
        headerName: 'Section / Item',
        colSpan: (p) => ((p.data?.section ?? '') !== '' ? 3 : 1),
        valueGetter: (p) => (p.data?.section !== '' ? p.data?.section : p.data?.item),
      },
      { field: 'q1', headerName: 'Q1', cellDataType: 'number', width: 100 },
      { field: 'q2', headerName: 'Q2', cellDataType: 'number', width: 100 },
    ],
    [],
  );

  return (
    <div className="demo-page">
      <h3 className="demo-h">Master / detail — orders expand to their line items (+ row drag)</h3>
      <p className="demo-note">{dragLog}</p>
      <div className="demo-grid" style={{ height: 420 }}>
        <AuGrid<Order>
          columnDefs={columnDefs}
          rowData={orders}
          getRowId={(p) => p.data.id}
          masterDetail={true}
          detailCellRenderer={detailRenderer}
          detailRowHeight={(p) => 70 + (p.data?.lines.length ?? 0) * 24}
          rowDragManaged={true}
          onRowDragEnd={(e: RowDragEvent<Order>) =>
            setDragLog(`moved ${e.data?.id} → display index ${e.overIndex}`)
          }
          theme={theme}
        />
      </div>
      <h3 className="demo-h" style={{ marginTop: 18 }}>
        Cell spanning — section rows span the full width (colSpan)
      </h3>
      <div className="demo-grid" style={{ height: 260 }}>
        <AuGrid<Span> columnDefs={spanDefs} rowData={spanRows} theme={theme} />
      </div>
    </div>
  );
}
