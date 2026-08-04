import type { PinnedPosition, SortDirection } from './base.js';
import type { IRowNode } from './rowNode.js';
import type { IColumn } from './column.js';
import type { GridApi } from './api.js';
import type { PivotCellContext } from './pivot.js';
import type { SparklineOptions } from './sparkline.js';

/* ------------------------------------------------------------------ params */

export interface BaseParams<TData = unknown> {
  api: GridApi<TData>;
  /** Application context object passed through GridOptions.context. */
  context: unknown;
}

export interface RowParams<TData = unknown> extends BaseParams<TData> {
  data: TData | undefined;
  node: IRowNode<TData>;
}

export interface CellParams<TData = unknown> extends RowParams<TData> {
  column: IColumn<TData>;
  colDef: ColDef<TData>;
}

export interface ValueGetterParams<TData = unknown> extends CellParams<TData> {
  /** Get another column's value on the same row (uses its valueGetter). */
  getValue(colId: string): unknown;
}

export interface ValueFormatterParams<TData = unknown> extends CellParams<TData> {
  value: unknown;
}

export interface ValueSetterParams<TData = unknown> extends CellParams<TData> {
  oldValue: unknown;
  newValue: unknown;
}

export interface ValueParserParams<TData = unknown> extends CellParams<TData> {
  oldValue: unknown;
  /** Raw value from the editor (usually a string). */
  newValue: unknown;
}

export interface EditableCallbackParams<TData = unknown> extends CellParams<TData> {
  /**
   * Intersection coordinates when deciding editability of an aggregate cell
   * (pivot result / group-row value / group header). Lets policies like
   * "editable only at the deepest level" or "only rows in the user's purview"
   * be expressed per cell.
   */
  pivot?: PivotCellContext<TData>;
}

export interface CellClassParams<TData = unknown> extends CellParams<TData> {
  value: unknown;
  rowIndex: number;
}

export interface CellRendererParams<TData = unknown> extends CellParams<TData> {
  /** Raw cell value (after valueGetter). */
  value: unknown;
  /** Value after valueFormatter (or stringified raw value). */
  valueFormatted: string;
  rowIndex: number;
  /** Refresh only available inside the grid lifecycle. */
  refreshCell(): void;
}

export interface TooltipParams<TData = unknown> extends CellParams<TData> {
  value: unknown;
}

export interface HeaderParams<TData = unknown> extends BaseParams<TData> {
  column: IColumn<TData>;
  colDef: ColDef<TData>;
  displayName: string;
  /** Trigger a sort as if the header was clicked. */
  progressSort(multi: boolean): void;
}

/* -------------------------------------------------------------- components */

/**
 * Cell renderer: return a string (rendered as text), an HTML element, or an
 * object with refresh support for high-frequency updates.
 */
export type CellRendererFn<TData = unknown> = (
  params: CellRendererParams<TData>,
) => string | HTMLElement | null;

export interface CellRendererComp<TData = unknown> {
  /** Called once; return the element to place in the cell. */
  init(params: CellRendererParams<TData>): HTMLElement;
  /** Return true if the update was handled in place; false → re-init. */
  refresh?(params: CellRendererParams<TData>): boolean;
  destroy?(): void;
}

export type CellRendererDef<TData = unknown> =
  | CellRendererFn<TData>
  | (new () => CellRendererComp<TData>)
  /** Wrapper-registered framework component (e.g. a React component). */
  | { readonly __frameworkComponent: unknown };

export interface CellEditorParams<TData = unknown> extends CellParams<TData> {
  value: unknown;
  /** Printable key that initiated the edit by typing, if any. */
  eventKey: string | null;
  /** Stop editing programmatically from inside the editor. */
  stopEditing(cancel?: boolean): void;
  colParams: unknown; // colDef.cellEditorParams passthrough
}

export interface CellEditorComp<TData = unknown> {
  init(params: CellEditorParams<TData>): void;
  getGui(): HTMLElement;
  /** Value to commit (pre-valueParser). */
  getValue(): unknown;
  afterGuiAttached?(): void;
  /** Return true to abort the edit before it starts. */
  isCancelBeforeStart?(): boolean;
  /** Return true to discard the value at commit time. */
  isCancelAfterEnd?(): boolean;
  /** True → grid renders the editor in a popup over the cell. */
  isPopup?(): boolean;
  destroy?(): void;
  focusIn?(): void;
}

export type ProvidedCellEditor =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'checkbox'
  | 'largeText';

export type CellEditorDef<TData = unknown> =
  | ProvidedCellEditor
  | (new () => CellEditorComp<TData>)
  | { readonly __frameworkComponent: unknown };

export interface HeaderComp<TData = unknown> {
  init(params: HeaderParams<TData>): HTMLElement;
  refresh?(params: HeaderParams<TData>): boolean;
  destroy?(): void;
}

export interface TooltipCompParams<TData = unknown> extends TooltipParams<TData> {
  /**
   * The resolved tooltipField/tooltipValueGetter string, or null when the
   * column configures neither. The string gates visibility when configured;
   * the component owns presentation.
   */
  tip: string | null;
  rowIndex: number;
}

/** Rich tooltip content: the grid owns delay/positioning/lifecycle, the
 * component owns the content element. */
export interface TooltipComp<TData = unknown> {
  init(params: TooltipCompParams<TData>): HTMLElement;
  destroy?(): void;
}

/* -------------------------------------------------------------- aggregation */

export interface AggFuncParams<TData = unknown> {
  values: unknown[];
  colId: string;
  rowNode: IRowNode<TData>;
  api: GridApi<TData>;
  context: unknown;
}

export type AggFunc<TData = unknown> = (params: AggFuncParams<TData>) => unknown;

export type ProvidedAggFunc = 'sum' | 'min' | 'max' | 'count' | 'avg' | 'first' | 'last';

/* ------------------------------------------------------------------- coldef */

export type CellClassValue<TData = unknown> =
  | string
  | string[]
  | ((params: CellClassParams<TData>) => string | string[] | null | undefined);

export interface ColDef<TData = unknown> {
  /** Data field, supports dot paths ("address.city"). */
  field?: string;
  /** Unique id; defaults to field. Required if no field. */
  colId?: string;
  /** Header label; defaults to a humanized field name. */
  headerName?: string;
  headerTooltip?: string;
  /** Hide this column's header ⋮ menu button. */
  suppressHeaderMenuButton?: boolean;
  /**
   * Excel number-format code applied to this column on xlsx export
   * (e.g. '#,##0.00', '0.0%', 'yyyy-mm-dd'). Date columns default to
   * yyyy-mm-dd; everything else defaults to General.
   */
  excelNumberFormat?: string;
  /** Named column type(s) from GridOptions.columnTypes to merge in. */
  type?: string | string[];

  width?: number;
  minWidth?: number;
  maxWidth?: number;
  /** Flex share of free horizontal space (overrides width). */
  flex?: number;
  hide?: boolean;
  pinned?: PinnedPosition | boolean;
  lockPinned?: boolean;
  lockPosition?: boolean | 'left' | 'right';
  lockVisible?: boolean;
  suppressMovable?: boolean;
  resizable?: boolean;

  sortable?: boolean;
  /** Initial sort. */
  sort?: SortDirection;
  sortIndex?: number | null;
  sortingOrder?: SortDirection[];
  comparator?: (
    a: unknown,
    b: unknown,
    nodeA: IRowNode<TData>,
    nodeB: IRowNode<TData>,
    isDescending: boolean,
  ) => number;

  /** true → auto by inferred cell data type; or a provided filter name; or custom component. */
  filter?: boolean | 'text' | 'number' | 'date' | 'set' | (new () => unknown);
  filterParams?: unknown;
  floatingFilter?: boolean;
  /** Include this column in quick-filter matching (default true). */
  suppressQuickFilter?: boolean;

  editable?: boolean | ((params: EditableCallbackParams<TData>) => boolean);
  cellEditor?: CellEditorDef<TData>;
  cellEditorParams?: unknown;
  cellEditorPopup?: boolean;
  singleClickEdit?: boolean;

  valueGetter?: string | ((params: ValueGetterParams<TData>) => unknown);
  valueFormatter?: (params: ValueFormatterParams<TData>) => string;
  valueSetter?: (params: ValueSetterParams<TData>) => boolean;
  valueParser?: (params: ValueParserParams<TData>) => unknown;

  cellRenderer?: CellRendererDef<TData>;
  /**
   * Render this column's cells as sparklines. The cell value must be an array
   * of numbers (project one with `valueGetter`). Takes precedence over
   * `cellRenderer`.
   */
  sparkline?: SparklineOptions;
  cellRendererParams?: unknown;
  cellClass?: CellClassValue<TData>;
  cellClassRules?: Record<string, (params: CellClassParams<TData>) => boolean>;
  cellStyle?:
    | Partial<CSSStyleDeclaration>
    | ((params: CellClassParams<TData>) => Partial<CSSStyleDeclaration> | null | undefined);
  /** Flash cell on value change (also grid-wide option). */
  enableCellChangeFlash?: boolean;
  tooltipField?: string;
  tooltipValueGetter?: (params: TooltipParams<TData>) => string | null | undefined;
  /**
   * Rich tooltip content component (grid-managed lifecycle: show delay,
   * positioning, viewport clamping). With `tooltipField`/`tooltipValueGetter`
   * configured, the resolved string gates visibility (null/'' = no tooltip)
   * and reaches the component as `params.tip`; with neither configured the
   * component shows on every cell hover.
   */
  tooltipComponent?: (new () => TooltipComp<TData>) | { readonly __frameworkComponent: unknown };
  autoHeight?: boolean;
  wrapText?: boolean;

  headerComponent?: (new () => HeaderComp<TData>) | { readonly __frameworkComponent: unknown };
  headerClass?: string | string[];

  /** Group rows by this column. */
  rowGroup?: boolean;
  rowGroupIndex?: number | null;
  /** Use as pivot column in pivot mode. */
  pivot?: boolean;
  pivotIndex?: number | null;
  /** Aggregate values with this function (group/pivot modes). */
  aggFunc?: ProvidedAggFunc | AggFunc<TData> | string | null;
  /** Inferred if omitted: 'text' | 'number' | 'date' | 'boolean' | 'object'. */
  cellDataType?: 'text' | 'number' | 'date' | 'boolean' | 'object' | false;
}

export interface ColGroupDef<TData = unknown> {
  groupId?: string;
  headerName?: string;
  headerClass?: string | string[];
  children: (ColDef<TData> | ColGroupDef<TData>)[];
}

export type ColDefOrGroup<TData = unknown> = ColDef<TData> | ColGroupDef<TData>;

export function isColGroupDef<TData>(def: ColDefOrGroup<TData>): def is ColGroupDef<TData> {
  return (def as ColGroupDef<TData>).children !== undefined;
}
