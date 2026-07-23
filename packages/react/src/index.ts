/* @augrid/react — public API surface. */

export { AuGrid } from './AuGrid.js';
export type { AuGridProps, AuGridRef } from './AuGrid.js';
export { reactComponent, ReactFrameworkAdapter, PortalHost } from './frameworkAdapter.js';
export type { PortalEntry, PortalHostProps } from './frameworkAdapter.js';

/* Convenience type re-exports from core. */
export type {
  GridApi,
  GridOptions,
  ColDef,
  ColGroupDef,
  ColDefOrGroup,
  IRowNode,
  IColumn,
  CellRendererParams,
  CellEditorParams,
  HeaderParams,
  GridState,
  ThemeSpec,
  RowSelectionOptions,
  CellSelectionOptions,
  FrameworkAdapter,
} from '@augrid/core';
