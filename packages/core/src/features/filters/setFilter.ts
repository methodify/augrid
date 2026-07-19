/**
 * Set filter: predicate over a selected set of stringified values plus the
 * distinct-value collector used by the floating-filter popup UI.
 */
import type { GridContext } from '../../context';
import type { SetFilterModel } from '../../types/filter';
import { isBlankValue } from './simpleFilters';

/** Max distinct values collected for the set filter. */
export const SET_FILTER_VALUE_CAP = 10_000;

export function buildSetPredicate(model: SetFilterModel): (value: unknown) => boolean {
  const values = model.values ?? [];
  const selected = new Set<string>();
  let includeBlank = false;
  for (const v of values) {
    if (v === null) includeBlank = true;
    else selected.add(v);
  }
  return (value) => {
    if (isBlankValue(value)) return includeBlank;
    return selected.has(String(value));
  };
}

/**
 * Distinct stringified values for a column over ALL leaf nodes (unfiltered),
 * sorted ascending with the blank entry (null) last. Capped at
 * SET_FILTER_VALUE_CAP values.
 */
export function collectSetValues<TData>(
  ctx: GridContext<TData>,
  colId: string,
): (string | null)[] {
  const column = ctx.columnModel.getColumn(colId);
  const forEachLeafNode = ctx.rowModel.forEachLeafNode;
  if (!column || !forEachLeafNode) return [];

  const seen = new Set<string>();
  let hasBlank = false;
  forEachLeafNode.call(ctx.rowModel, (node) => {
    if (seen.size >= SET_FILTER_VALUE_CAP) return;
    const v = ctx.values.getValue(node, column);
    if (isBlankValue(v)) {
      hasBlank = true;
      return;
    }
    seen.add(String(v));
  });

  const out: (string | null)[] = [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (hasBlank && out.length < SET_FILTER_VALUE_CAP) out.push(null);
  return out;
}
