import type { IRowNode } from './rowNode.js';
import type { IColumn } from './column.js';
import type { GridApi } from './api.js';

/* Filter models are plain serializable objects — the single source of truth
 * for filter state (no live filter-instance API). */

export type TextFilterOperator =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEqual'
  | 'startsWith'
  | 'endsWith'
  | 'blank'
  | 'notBlank';

export type NumberFilterOperator =
  | 'equals'
  | 'notEqual'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'inRange'
  | 'blank'
  | 'notBlank';

export type DateFilterOperator =
  | 'equals'
  | 'notEqual'
  | 'before'
  | 'after'
  | 'inRange'
  | 'blank'
  | 'notBlank';

export interface TextFilterCondition {
  type: TextFilterOperator;
  filter?: string;
}
export interface NumberFilterCondition {
  type: NumberFilterOperator;
  filter?: number;
  filterTo?: number;
}
export interface DateFilterCondition {
  type: DateFilterOperator;
  /** ISO date string yyyy-mm-dd. */
  dateFrom?: string;
  dateTo?: string;
}

export interface SimpleFilterModel<C> {
  filterType: 'text' | 'number' | 'date';
  conditions: C[];
  operator?: 'AND' | 'OR';
}

export type TextFilterModel = SimpleFilterModel<TextFilterCondition> & { filterType: 'text' };
export type NumberFilterModel = SimpleFilterModel<NumberFilterCondition> & {
  filterType: 'number';
};
export type DateFilterModel = SimpleFilterModel<DateFilterCondition> & { filterType: 'date' };

export interface SetFilterModel {
  filterType: 'set';
  /** Selected values (stringified). null entry means blank rows selected. */
  values: (string | null)[];
}

export interface CustomFilterModel {
  filterType: 'custom';
  model: unknown;
}

export type FilterModel =
  | TextFilterModel
  | NumberFilterModel
  | DateFilterModel
  | SetFilterModel
  | CustomFilterModel;

/** colId → model for all active filters. */
export type FilterModelMap = Record<string, FilterModel>;

/* ------------------------------------------------------- custom filter comp */

export interface FilterParams<TData = unknown> {
  api: GridApi<TData>;
  context: unknown;
  column: IColumn<TData>;
  colId: string;
  /** Read the (unformatted) cell value for a node. */
  getValue(node: IRowNode<TData>): unknown;
  /** Notify the grid that this filter's state changed. */
  onModelChange(model: unknown | null): void;
  colParams: unknown; // colDef.filterParams passthrough
}

/**
 * Custom filter component: pure predicate + model in/out. UI is optional
 * (getGui used in the floating filter/column menu when present).
 */
export interface FilterComp<TData = unknown> {
  init(params: FilterParams<TData>): void;
  doesFilterPass(node: IRowNode<TData>, value: unknown): boolean;
  getModel(): unknown | null;
  setModel(model: unknown | null): void;
  getGui?(): HTMLElement;
  destroy?(): void;
}
