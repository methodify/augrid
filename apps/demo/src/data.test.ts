import { describe, expect, it } from 'vitest';
import { COUNTRIES, SPORTS, makeRows, mulberry32 } from './data';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('yields values in [0, 1)', () => {
    const rnd = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rnd();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('makeRows', () => {
  it('returns the requested count', () => {
    expect(makeRows(0)).toHaveLength(0);
    expect(makeRows(1000)).toHaveLength(1000);
  });

  it('is deterministic — two calls produce identical rows', () => {
    const a = makeRows(500);
    const b = makeRows(500);
    expect(a).toEqual(b);
  });

  it('a longer run starts with the same rows as a shorter run', () => {
    const short = makeRows(100);
    const long = makeRows(200);
    expect(long.slice(0, 100)).toEqual(short);
  });

  it('produces well-formed rows', () => {
    const rows = makeRows(2000);
    const ids = new Set<string>();
    for (const r of rows) {
      ids.add(r.id);
      expect(COUNTRIES).toContain(r.country);
      expect(SPORTS).toContain(r.sport);
      expect(r.year).toBeGreaterThanOrEqual(2000);
      expect(r.year).toBeLessThanOrEqual(2024);
      expect(r.year % 2).toBe(0);
      expect(r.date).toBeInstanceOf(Date);
      expect(r.date.getFullYear()).toBe(r.year);
      expect(r.gold).toBeGreaterThanOrEqual(0);
      expect(r.gold).toBeLessThanOrEqual(8);
      expect(r.total).toBe(r.gold + r.silver + r.bronze);
    }
    expect(ids.size).toBe(rows.length);
  });

  it('honors an explicit seed', () => {
    const a = makeRows(50, 1);
    const b = makeRows(50, 2);
    expect(a).not.toEqual(b);
  });
});
