/**
 * In-cell visuals. A column becomes a visual column by declaring
 * `colDef.sparkline`; the cell's value is the series (project one with a
 * `valueGetter`).
 */

export type SparklineType = 'line' | 'area' | 'column' | 'winLoss';

/**
 * One entry of a series. A bare number (or null for a gap) is the common
 * case; `{x, y}` carries an explicit horizontal position so irregular axes
 * — real dates with missing buckets — plot at their true spacing rather
 * than evenly by index.
 */
export type SparklineDatum = number | null | { x?: number; y: number | null };

export interface SparklinePoint {
  x: number;
  y: number;
  /** The underlying data value at this point. */
  value: number;
  /** Index within the series. */
  index: number;
}

export interface SparklineMarkers {
  first?: boolean;
  last?: boolean;
  min?: boolean;
  max?: boolean;
  /** Marker radius in px (default 2). */
  size?: number;
}

/**
 * What a summary reduces a series to — used for sorting (and, later, for
 * `showValue`). `slope` is the least-squares trend: "who is rising fastest",
 * which is usually the question behind sorting a trend column.
 */
export type SparklineSummary = 'first' | 'last' | 'min' | 'max' | 'mean' | 'sum' | 'slope';

export interface SparklineOptions {
  /** Default 'line'. */
  type?: SparklineType;
  /**
   * Y-axis scale:
   *  - 'auto' (default): each cell scales to its own series — shows SHAPE.
   *    Note that cells in a column are then NOT comparable to each other.
   *  - 'shared': one scale across every row in the column — shows MAGNITUDE,
   *    making rows comparable. Costs one pass over row data per model update.
   *  - [min, max]: a fixed scale you control.
   */
  domain?: 'auto' | 'shared' | [number, number];
  /**
   * Value used when this column is sorted (default 'last'). Without it an
   * array-valued column has no meaningful order.
   */
  sortBy?: SparklineSummary;
  /** Line/border color (any CSS color). Defaults to the theme accent. */
  color?: string;
  /** Fill for area / positive columns. Defaults to a translucent accent. */
  fill?: string;
  /** Fill for negative columns and losses. Defaults to a translucent red. */
  negativeFill?: string;
  /** Stroke width in px (default 1.25). */
  lineWidth?: number;
  /** Endpoint/extreme dots. */
  markers?: SparklineMarkers;
  /** Horizontal rule at this value (e.g. a target or a zero line). */
  referenceValue?: number;
  referenceColor?: string;
  /** Gap between columns as a fraction of the slot, 0–0.9 (default 0.25). */
  columnGap?: number;
  /** Inset in px so strokes/markers are not clipped (default 2). */
  padding?: number;
  /**
   * Accessible label for the cell. Receives the series; defaults to a concise
   * "n points, up from a to b, min/max" summary so screen readers get the gist.
   */
  ariaLabel?: (values: (number | null)[]) => string;
}
