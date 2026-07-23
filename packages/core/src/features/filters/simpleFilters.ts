/**
 * Pure predicate builders for the provided simple filter types (text, number,
 * date). No grid dependencies — the FilterManager compiles these against
 * column values; tests exercise them directly.
 */
import type {
  DateFilterCondition,
  DateFilterModel,
  NumberFilterCondition,
  NumberFilterModel,
  TextFilterCondition,
  TextFilterModel,
} from '../../types/filter.js';

type ValuePredicate = (value: unknown) => boolean;

const PASS: ValuePredicate = () => true;

/** Blank = null, undefined, or empty string. */
export function isBlankValue(value: unknown): boolean {
  return value == null || value === '';
}

function combine<C>(
  conditions: C[] | undefined,
  operator: 'AND' | 'OR' | undefined,
  build: (cond: C) => ValuePredicate,
): ValuePredicate {
  if (!conditions || conditions.length === 0) return PASS;
  const preds = conditions.map(build);
  if (preds.length === 1) return preds[0];
  if (operator === 'OR') {
    return (value) => {
      for (const p of preds) if (p(value)) return true;
      return false;
    };
  }
  // 'AND' default
  return (value) => {
    for (const p of preds) if (!p(value)) return false;
    return true;
  };
}

/* ------------------------------------------------------------------- text */

function textCondition(cond: TextFilterCondition): ValuePredicate {
  const type = cond.type;
  if (type === 'blank') return isBlankValue;
  if (type === 'notBlank') return (v) => !isBlankValue(v);
  const filter = (cond.filter ?? '').toLowerCase();
  return (value) => {
    // Blank values fail positive matches, pass negative matches.
    if (isBlankValue(value)) return type === 'notContains' || type === 'notEqual';
    const s = String(value).toLowerCase();
    switch (type) {
      case 'contains':
        return s.includes(filter);
      case 'notContains':
        return !s.includes(filter);
      case 'equals':
        return s === filter;
      case 'notEqual':
        return s !== filter;
      case 'startsWith':
        return s.startsWith(filter);
      case 'endsWith':
        return s.endsWith(filter);
      default:
        return true;
    }
  };
}

export function buildTextPredicate(model: TextFilterModel): ValuePredicate {
  return combine(model.conditions, model.operator, textCondition);
}

/* ----------------------------------------------------------------- number */

function numberCondition(cond: NumberFilterCondition): ValuePredicate {
  const type = cond.type;
  if (type === 'blank') return isBlankValue;
  if (type === 'notBlank') return (v) => !isBlankValue(v);
  const f = cond.filter;
  const to = cond.filterTo;
  return (value) => {
    // Blank / non-numeric values fail all non-blank number ops.
    if (isBlankValue(value)) return false;
    const n = Number(value);
    if (Number.isNaN(n)) return false;
    switch (type) {
      case 'equals':
        return n === f;
      case 'notEqual':
        return n !== f;
      case 'greaterThan':
        return f != null && n > f;
      case 'greaterThanOrEqual':
        return f != null && n >= f;
      case 'lessThan':
        return f != null && n < f;
      case 'lessThanOrEqual':
        return f != null && n <= f;
      case 'inRange':
        return f != null && to != null && n >= f && n <= to;
      default:
        return true;
    }
  };
}

export function buildNumberPredicate(model: NumberFilterModel): ValuePredicate {
  return combine(model.conditions, model.operator, numberCondition);
}

/* ------------------------------------------------------------------- date */

const MS_PER_DAY = 86_400_000;

/**
 * UTC day number for a cell value: Date instances truncate on their local
 * calendar date; strings with a leading yyyy-mm-dd use it directly, other
 * parseable strings go through Date. Null when blank or unparseable.
 */
export function dateValueToDay(value: unknown): number | null {
  if (isBlankValue(value)) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / MS_PER_DAY;
  }
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY;
  }
  if (typeof value === 'number') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY;
  }
  return null;
}

/** Model dates are 'yyyy-mm-dd'. */
function modelDay(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY;
}

function dateCondition(cond: DateFilterCondition): ValuePredicate {
  const type = cond.type;
  if (type === 'blank') return (v) => dateValueToDay(v) === null;
  if (type === 'notBlank') return (v) => dateValueToDay(v) !== null;
  const from = modelDay(cond.dateFrom);
  const to = modelDay(cond.dateTo);
  return (value) => {
    const day = dateValueToDay(value);
    if (day === null) return type === 'notEqual';
    switch (type) {
      case 'equals':
        return from !== null && day === from;
      case 'notEqual':
        return from === null || day !== from;
      case 'before':
        return from !== null && day < from;
      case 'after':
        return from !== null && day > from;
      case 'inRange':
        return from !== null && to !== null && day >= from && day <= to;
      default:
        return true;
    }
  };
}

export function buildDatePredicate(model: DateFilterModel): ValuePredicate {
  return combine(model.conditions, model.operator, dateCondition);
}
