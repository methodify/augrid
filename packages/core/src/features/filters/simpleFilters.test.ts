import { describe, expect, it } from 'vitest';
import {
  buildDatePredicate,
  buildNumberPredicate,
  buildTextPredicate,
} from './simpleFilters';
import { buildSetPredicate } from './setFilter';
import type {
  DateFilterModel,
  NumberFilterModel,
  TextFilterModel,
} from '../../types/filter';

const text = (m: Omit<TextFilterModel, 'filterType'>): TextFilterModel => ({
  filterType: 'text',
  ...m,
});
const num = (m: Omit<NumberFilterModel, 'filterType'>): NumberFilterModel => ({
  filterType: 'number',
  ...m,
});
const date = (m: Omit<DateFilterModel, 'filterType'>): DateFilterModel => ({
  filterType: 'date',
  ...m,
});

describe('buildTextPredicate', () => {
  it('contains is case-insensitive over String(value)', () => {
    const p = buildTextPredicate(text({ conditions: [{ type: 'contains', filter: 'AN' }] }));
    expect(p('Banana')).toBe(true);
    expect(p('anchor')).toBe(true);
    expect(p('berry')).toBe(false);
    expect(p(12345)).toBe(false);
    const pNum = buildTextPredicate(text({ conditions: [{ type: 'contains', filter: '23' }] }));
    expect(pNum(12345)).toBe(true);
  });

  it('notContains', () => {
    const p = buildTextPredicate(text({ conditions: [{ type: 'notContains', filter: 'an' }] }));
    expect(p('Banana')).toBe(false);
    expect(p('berry')).toBe(true);
  });

  it('equals / notEqual', () => {
    const eq = buildTextPredicate(text({ conditions: [{ type: 'equals', filter: 'Apple' }] }));
    expect(eq('apple')).toBe(true);
    expect(eq('apples')).toBe(false);
    const ne = buildTextPredicate(text({ conditions: [{ type: 'notEqual', filter: 'apple' }] }));
    expect(ne('APPLE')).toBe(false);
    expect(ne('pear')).toBe(true);
  });

  it('startsWith / endsWith', () => {
    const sw = buildTextPredicate(text({ conditions: [{ type: 'startsWith', filter: 'ba' }] }));
    expect(sw('Banana')).toBe(true);
    expect(sw('abba')).toBe(false);
    const ew = buildTextPredicate(text({ conditions: [{ type: 'endsWith', filter: 'NA' }] }));
    expect(ew('banana')).toBe(true);
    expect(ew('nab')).toBe(false);
  });

  it('blank / notBlank treat null, undefined and empty string as blank', () => {
    const blank = buildTextPredicate(text({ conditions: [{ type: 'blank' }] }));
    expect(blank(null)).toBe(true);
    expect(blank(undefined)).toBe(true);
    expect(blank('')).toBe(true);
    expect(blank('x')).toBe(false);
    expect(blank(0)).toBe(false);
    const nb = buildTextPredicate(text({ conditions: [{ type: 'notBlank' }] }));
    expect(nb(null)).toBe(false);
    expect(nb('')).toBe(false);
    expect(nb('x')).toBe(true);
  });

  it('blank values fail positive ops and pass negative ops', () => {
    expect(buildTextPredicate(text({ conditions: [{ type: 'contains', filter: 'a' }] }))(null)).toBe(false);
    expect(buildTextPredicate(text({ conditions: [{ type: 'equals', filter: 'a' }] }))('')).toBe(false);
    expect(buildTextPredicate(text({ conditions: [{ type: 'notEqual', filter: 'a' }] }))(null)).toBe(true);
    expect(buildTextPredicate(text({ conditions: [{ type: 'notContains', filter: 'a' }] }))(undefined)).toBe(true);
  });

  it('combines conditions with AND (default) and OR', () => {
    const and = buildTextPredicate(
      text({
        conditions: [
          { type: 'startsWith', filter: 'b' },
          { type: 'endsWith', filter: 'a' },
        ],
      }),
    );
    expect(and('banana')).toBe(true);
    expect(and('berry')).toBe(false);
    const or = buildTextPredicate(
      text({
        operator: 'OR',
        conditions: [
          { type: 'equals', filter: 'apple' },
          { type: 'equals', filter: 'pear' },
        ],
      }),
    );
    expect(or('Pear')).toBe(true);
    expect(or('apple')).toBe(true);
    expect(or('plum')).toBe(false);
  });

  it('empty or missing conditions → pass-through', () => {
    const p = buildTextPredicate(text({ conditions: [] }));
    expect(p('anything')).toBe(true);
    expect(p(null)).toBe(true);
    const p2 = buildTextPredicate({ filterType: 'text' } as TextFilterModel);
    expect(p2('x')).toBe(true);
  });
});

describe('buildNumberPredicate', () => {
  it('equals / notEqual', () => {
    const eq = buildNumberPredicate(num({ conditions: [{ type: 'equals', filter: 5 }] }));
    expect(eq(5)).toBe(true);
    expect(eq('5')).toBe(true); // Number(value)
    expect(eq(6)).toBe(false);
    const ne = buildNumberPredicate(num({ conditions: [{ type: 'notEqual', filter: 5 }] }));
    expect(ne(5)).toBe(false);
    expect(ne(4)).toBe(true);
  });

  it('greaterThan / greaterThanOrEqual', () => {
    const gt = buildNumberPredicate(num({ conditions: [{ type: 'greaterThan', filter: 10 }] }));
    expect(gt(11)).toBe(true);
    expect(gt(10)).toBe(false);
    const gte = buildNumberPredicate(
      num({ conditions: [{ type: 'greaterThanOrEqual', filter: 10 }] }),
    );
    expect(gte(10)).toBe(true);
    expect(gte(9)).toBe(false);
  });

  it('lessThan / lessThanOrEqual', () => {
    const lt = buildNumberPredicate(num({ conditions: [{ type: 'lessThan', filter: 10 }] }));
    expect(lt(9)).toBe(true);
    expect(lt(10)).toBe(false);
    const lte = buildNumberPredicate(
      num({ conditions: [{ type: 'lessThanOrEqual', filter: 10 }] }),
    );
    expect(lte(10)).toBe(true);
    expect(lte(11)).toBe(false);
  });

  it('inRange is inclusive on both ends', () => {
    const p = buildNumberPredicate(
      num({ conditions: [{ type: 'inRange', filter: 5, filterTo: 10 }] }),
    );
    expect(p(5)).toBe(true);
    expect(p(10)).toBe(true);
    expect(p(7)).toBe(true);
    expect(p(4)).toBe(false);
    expect(p(11)).toBe(false);
  });

  it('non-numeric values fail all non-blank ops', () => {
    const ne = buildNumberPredicate(num({ conditions: [{ type: 'notEqual', filter: 5 }] }));
    expect(ne('abc')).toBe(false);
    expect(ne(NaN)).toBe(false);
    const gt = buildNumberPredicate(num({ conditions: [{ type: 'greaterThan', filter: 0 }] }));
    expect(gt('abc')).toBe(false);
    expect(gt(null)).toBe(false);
  });

  it('blank / notBlank number ops', () => {
    const blank = buildNumberPredicate(num({ conditions: [{ type: 'blank' }] }));
    expect(blank(null)).toBe(true);
    expect(blank('')).toBe(true);
    expect(blank(0)).toBe(false);
    const nb = buildNumberPredicate(num({ conditions: [{ type: 'notBlank' }] }));
    expect(nb(0)).toBe(true);
    expect(nb(undefined)).toBe(false);
  });

  it('AND / OR pairs of number conditions', () => {
    const and = buildNumberPredicate(
      num({
        conditions: [
          { type: 'greaterThan', filter: 5 },
          { type: 'lessThan', filter: 10 },
        ],
      }),
    );
    expect(and(7)).toBe(true);
    expect(and(12)).toBe(false);
    const or = buildNumberPredicate(
      num({
        operator: 'OR',
        conditions: [
          { type: 'lessThan', filter: 5 },
          { type: 'greaterThan', filter: 10 },
        ],
      }),
    );
    expect(or(3)).toBe(true);
    expect(or(11)).toBe(true);
    expect(or(7)).toBe(false);
  });
});

describe('buildDatePredicate', () => {
  it('equals compares date-only (time of day ignored)', () => {
    const p = buildDatePredicate(
      date({ conditions: [{ type: 'equals', dateFrom: '2024-03-15' }] }),
    );
    expect(p(new Date(2024, 2, 15, 13, 45))).toBe(true);
    expect(p('2024-03-15')).toBe(true);
    expect(p('2024-03-15T23:59:00')).toBe(true);
    expect(p(new Date(2024, 2, 16))).toBe(false);
  });

  it('notEqual', () => {
    const p = buildDatePredicate(
      date({ conditions: [{ type: 'notEqual', dateFrom: '2024-03-15' }] }),
    );
    expect(p('2024-03-15')).toBe(false);
    expect(p('2024-03-16')).toBe(true);
    expect(p(null)).toBe(true);
  });

  it('before / after are strict', () => {
    const before = buildDatePredicate(
      date({ conditions: [{ type: 'before', dateFrom: '2024-03-15' }] }),
    );
    expect(before('2024-03-14')).toBe(true);
    expect(before('2024-03-15')).toBe(false);
    const after = buildDatePredicate(
      date({ conditions: [{ type: 'after', dateFrom: '2024-03-15' }] }),
    );
    expect(after('2024-03-16')).toBe(true);
    expect(after('2024-03-15')).toBe(false);
  });

  it('inRange inclusive over date strings and Dates', () => {
    const p = buildDatePredicate(
      date({ conditions: [{ type: 'inRange', dateFrom: '2024-01-01', dateTo: '2024-01-31' }] }),
    );
    expect(p('2024-01-01')).toBe(true);
    expect(p('2024-01-31')).toBe(true);
    expect(p(new Date(2024, 0, 15, 8, 0))).toBe(true);
    expect(p('2023-12-31')).toBe(false);
    expect(p('2024-02-01')).toBe(false);
  });

  it('blank / notBlank; unparseable values count as blank', () => {
    const blank = buildDatePredicate(date({ conditions: [{ type: 'blank' }] }));
    expect(blank(null)).toBe(true);
    expect(blank('')).toBe(true);
    expect(blank('not-a-date')).toBe(true);
    expect(blank('2024-05-05')).toBe(false);
    const nb = buildDatePredicate(date({ conditions: [{ type: 'notBlank' }] }));
    expect(nb(new Date(2024, 4, 5))).toBe(true);
    expect(nb(undefined)).toBe(false);
  });

  it('AND / OR date pairs', () => {
    const and = buildDatePredicate(
      date({
        conditions: [
          { type: 'after', dateFrom: '2024-01-01' },
          { type: 'before', dateFrom: '2024-02-01' },
        ],
      }),
    );
    expect(and('2024-01-15')).toBe(true);
    expect(and('2024-02-15')).toBe(false);
    const or = buildDatePredicate(
      date({
        operator: 'OR',
        conditions: [
          { type: 'equals', dateFrom: '2024-01-01' },
          { type: 'equals', dateFrom: '2024-02-01' },
        ],
      }),
    );
    expect(or('2024-02-01')).toBe(true);
    expect(or('2024-01-02')).toBe(false);
  });
});

describe('buildSetPredicate', () => {
  it('matches stringified values in the selected set', () => {
    const p = buildSetPredicate({ filterType: 'set', values: ['a', '2'] });
    expect(p('a')).toBe(true);
    expect(p(2)).toBe(true);
    expect(p('b')).toBe(false);
  });

  it('null entry matches blank values', () => {
    const p = buildSetPredicate({ filterType: 'set', values: ['a', null] });
    expect(p(null)).toBe(true);
    expect(p(undefined)).toBe(true);
    expect(p('')).toBe(true);
    const noBlank = buildSetPredicate({ filterType: 'set', values: ['a'] });
    expect(noBlank(null)).toBe(false);
    expect(noBlank('')).toBe(false);
  });
});
