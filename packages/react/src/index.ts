/* @augrid/react — public API surface. */

export { AuGrid } from './AuGrid';
export type { AuGridProps, AuGridRef } from './AuGrid';
export { reactComponent, ReactFrameworkAdapter, PortalHost } from './frameworkAdapter';
export type { PortalEntry, PortalHostProps } from './frameworkAdapter';

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
