import type { GridContext } from '../../context.js';
import type { RowNode } from '../../rows/rowNode.js';
import { mergeExtents, seriesExtent, toSeries, type Extent } from './sparkline.js';

/**
 * Column-wide Y extents for `domain: 'shared'` — the scale that makes rows
 * comparable to each other.
 *
 * Computed lazily on first request and cached until the model changes, so a
 * column that never asks for it costs nothing. This is why 'shared' is opt-in:
 * it is one pass over every row's series per data update, which we will not
 * impose on columns that only want shape.
 */
export class SparklineDomains<TData = unknown> {
  private cache = new Map<string, Extent | null>();
  private unsubscribe: (() => void) | null = null;

  constructor(private ctx: GridContext<TData>) {
    const invalidate = (): void => this.cache.clear();
    ctx.events.addEventListener('modelUpdated', invalidate);
    this.unsubscribe = () => ctx.events.removeEventListener('modelUpdated', invalidate);
  }

  get(colId: string): Extent | null {
    const cached = this.cache.get(colId);
    if (cached !== undefined) return cached;
    const extent = this.compute(colId);
    this.cache.set(colId, extent);
    return extent;
  }

  private compute(colId: string): Extent | null {
    const column = this.ctx.columnModel.getColumn(colId);
    if (!column) return null;
    const spark = column.getColDef().sparkline;
    const type = spark?.type ?? 'line';
    const extents: Extent[] = [];

    const visit = (node: RowNode<TData>): void => {
      const raw = this.ctx.values.getValue(node, column);

      // Scalar marks hold a single number, not a series. Their whole point is
      // cross-row comparison, so the column extent is what gives them meaning.
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        if (type === 'delta') {
          // Delta compares CHANGES, so the scale must span changes, not raw
          // values — otherwise every bar reads against the wrong magnitude.
          const baseline =
            typeof spark?.baseline === 'function'
              ? spark.baseline({ value: raw, data: node.data, colId })
              : spark?.baseline;
          const change =
            typeof baseline === 'number' && Number.isFinite(baseline) ? raw - baseline : raw;
          const mag = Math.abs(change);
          extents.push({ min: -mag, max: mag });
        } else {
          // Include zero so bars share a common origin across the column.
          extents.push({ min: Math.min(0, raw), max: Math.max(0, raw) });
        }
        return;
      }

      const series = toSeries(raw);
      const extent = seriesExtent(
        series.lows || series.highs
          ? [...series.values, ...(series.lows ?? []), ...(series.highs ?? [])]
          : series.values,
      );
      if (extent) extents.push(extent);
    };
    // Prefer the filtered view: the scale should describe what is on screen,
    // not rows the user has filtered away.
    const walk = this.ctx.rowModel.forEachNodeAfterFilter ?? this.ctx.rowModel.forEachNode;
    walk.call(this.ctx.rowModel, visit);
    return mergeExtents(extents);
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.cache.clear();
  }
}
