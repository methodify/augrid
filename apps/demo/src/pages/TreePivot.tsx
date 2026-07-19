import { useMemo } from 'react';
import { AuGrid } from '@augrid/react';
import type { ColDef } from '@augrid/core';
import type { PageProps } from '../App';
import { makeRows, type Row } from '../data';

interface OrgRow {
  id: string;
  path: string[];
  title: string;
  headcount: number;
}

/** Deterministic little org chart: CEO → departments → teams → people. */
function makeOrg(): OrgRow[] {
  const rows: OrgRow[] = [];
  let id = 0;
  const push = (path: string[], title: string, headcount: number) =>
    rows.push({ id: `e${id++}`, path, title, headcount });

  push(['Erica Rogers'], 'CEO', 1);
  const departments: [string, string, string[][]][] = [
    [
      'Malcolm Barrett',
      'VP Engineering',
      [
        ['Esther Baker', 'Director Platform'],
        ['Brock Jason', 'Director Product Eng'],
      ],
    ],
    [
      'Sofia Kingsley',
      'VP Sales',
      [
        ['Dana Ortiz', 'Director EMEA'],
        ['Liam Chen', 'Director Americas'],
      ],
    ],
    ['Priya Nair', 'VP Operations', [['Tomas Weber', 'Director Logistics']]],
  ];
  const people: [string, number][] = [
    ['Mary Hansen', 1],
    ['John Rowe', 1],
    ['Fatima Aziz', 1],
    ['Pavel Novak', 1],
    ['Grace Obi', 1],
  ];
  for (const [vp, vpTitle, dirs] of departments) {
    push(['Erica Rogers', vp], vpTitle, 1);
    for (const [dir, dirTitle] of dirs) {
      push(['Erica Rogers', vp, dir], dirTitle, 1);
      for (const [person] of people) {
        const name = `${person} (${dir.split(' ')[0]})`;
        push(['Erica Rogers', vp, dir, name], 'IC', 1);
      }
    }
  }
  return rows;
}

const ORG_DEFAULT_COL: ColDef<OrgRow> = { sortable: true, resizable: true };
const MEDAL_DEFAULT_COL: ColDef<Row> = { sortable: true, resizable: true };
const AUTO_GROUP_COL: ColDef<OrgRow> = { headerName: 'Organisation', minWidth: 280 };
const getOrgRowId = (p: { data: OrgRow }) => p.data.id;
const getMedalRowId = (p: { data: Row }) => p.data.id;
const getDataPath = (d: OrgRow) => d.path;

export function TreePivot({ theme }: PageProps) {
  const orgRows = useMemo(makeOrg, []);
  const medalRows = useMemo(() => makeRows(2_000), []);

  const orgCols = useMemo<ColDef<OrgRow>[]>(
    () => [
      { field: 'title', headerName: 'Title', minWidth: 160 },
      { field: 'headcount', headerName: 'Headcount', aggFunc: 'sum', width: 120 },
    ],
    [],
  );

  const pivotCols = useMemo<ColDef<Row>[]>(
    () => [
      { field: 'country', rowGroup: true },
      { field: 'year', pivot: true },
      { field: 'gold', aggFunc: 'sum' },
    ],
    [],
  );

  return (
    <div className="demo-page">
      <h2 className="demo-h2">Tree data — org chart (getDataPath) with aggregated headcount</h2>
      <div className="demo-grid-half">
        <AuGrid<OrgRow>
          columnDefs={orgCols}
          defaultColDef={ORG_DEFAULT_COL}
          rowData={orgRows}
          getRowId={getOrgRowId}
          treeData={true}
          getDataPath={getDataPath}
          autoGroupColumnDef={AUTO_GROUP_COL}
          groupDefaultExpanded={-1}
          theme={theme}
        />
      </div>
      <h2 className="demo-h2">
        Full pivot mode — rowGroup: country, pivot: year, value: sum(gold)
      </h2>
      <div className="demo-grid-half">
        <AuGrid<Row>
          columnDefs={pivotCols}
          defaultColDef={MEDAL_DEFAULT_COL}
          rowData={medalRows}
          getRowId={getMedalRowId}
          pivotMode={true}
          theme={theme}
        />
      </div>
    </div>
  );
}
