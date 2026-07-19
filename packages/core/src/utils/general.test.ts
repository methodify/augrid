import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  binarySearchLE,
  clamp,
  debounce,
  defaultCompare,
  getPath,
  humanize,
  insertArray,
  setPath,
  toDisplayString,
} from './general';

describe('getPath / setPath', () => {
  it('reads plain keys', () => {
    expect(getPath({ a: 1 }, 'a')).toBe(1);
    expect(getPath({ a: 1 }, 'missing')).toBeUndefined();
  });

  it('reads dotted paths', () => {
    const obj = { user: { address: { city: 'Oslo' } } };
    expect(getPath(obj, 'user.address.city')).toBe('Oslo');
  });

  it('returns undefined for missing intermediates and null objects', () => {
    expect(getPath({ user: null }, 'user.address.city')).toBeUndefined();
    expect(getPath(null, 'a.b')).toBeUndefined();
    expect(getPath(undefined, 'a')).toBeUndefined();
  });

  it('writes plain keys', () => {
    const obj: Record<string, unknown> = {};
    setPath(obj, 'x', 42);
    expect(obj.x).toBe(42);
  });

  it('writes dotted paths creating intermediates', () => {
    const obj: Record<string, unknown> = {};
    setPath(obj, 'a.b.c', 'deep');
    expect(getPath(obj, 'a.b.c')).toBe('deep');
  });

  it('overwrites non-object intermediates', () => {
    const obj: Record<string, unknown> = { a: 5 };
    setPath(obj, 'a.b', 1);
    expect(getPath(obj, 'a.b')).toBe(1);
  });
});

describe('humanize', () => {
  it('splits camelCase and capitalizes', () => {
    expect(humanize('firstName')).toBe('First Name');
    expect(humanize('age')).toBe('Age');
  });

  it('uses the last segment of a dotted field', () => {
    expect(humanize('user.lastName')).toBe('Last Name');
  });

  it('handles snake_case and kebab-case', () => {
    expect(humanize('some_field')).toBe('Some field');
    expect(humanize('other-field')).toBe('Other field');
  });
});

describe('binarySearchLE', () => {
  const arr = [0, 10, 20, 30];

  it('finds exact matches', () => {
    expect(binarySearchLE(arr, 0)).toBe(0);
    expect(binarySearchLE(arr, 10)).toBe(1);
    expect(binarySearchLE(arr, 30)).toBe(3);
  });

  it('finds greatest index <= value between entries', () => {
    expect(binarySearchLE(arr, 15)).toBe(1);
    expect(binarySearchLE(arr, 29)).toBe(2);
  });

  it('clamps at the edges', () => {
    expect(binarySearchLE(arr, -5)).toBe(0);
    expect(binarySearchLE(arr, 1000)).toBe(3);
    expect(binarySearchLE([], 5)).toBe(0);
    expect(binarySearchLE([7], 7)).toBe(0);
  });
});

describe('defaultCompare', () => {
  it('orders numbers numerically', () => {
    expect(defaultCompare(2, 10)).toBeLessThan(0);
    expect(defaultCompare(10, 2)).toBeGreaterThan(0);
    expect(defaultCompare(5, 5)).toBe(0);
  });

  it('orders strings lexically', () => {
    expect(defaultCompare('apple', 'banana')).toBeLessThan(0);
    expect(defaultCompare('b', 'a')).toBeGreaterThan(0);
    expect(defaultCompare('x', 'x')).toBe(0);
  });

  it('orders dates by time', () => {
    const d1 = new Date(2020, 0, 1);
    const d2 = new Date(2021, 0, 1);
    expect(defaultCompare(d1, d2)).toBeLessThan(0);
    expect(defaultCompare(d2, d1)).toBeGreaterThan(0);
  });

  it('sorts null/undefined first', () => {
    expect(defaultCompare(null, 1)).toBe(-1);
    expect(defaultCompare(1, null)).toBe(1);
    expect(defaultCompare(null, undefined)).toBe(0);
  });

  it('orders booleans false before true', () => {
    expect(defaultCompare(false, true)).toBe(-1);
    expect(defaultCompare(true, false)).toBe(1);
    expect(defaultCompare(true, true)).toBe(0);
  });
});

describe('debounce', () => {
  afterEach(() => vi.useRealTimers());

  it('only invokes with the last args after the delay', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(1);
    d(2);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    d(3);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it('cancel prevents the pending call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 50);
    d('x');
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('insertArray', () => {
  it('inserts at an index', () => {
    const arr = [1, 2, 5];
    insertArray(arr, [3, 4], 2);
    expect(arr).toEqual([1, 2, 3, 4, 5]);
  });

  it('appends when index is undefined or out of range', () => {
    const a = [1, 2];
    insertArray(a, [3], undefined);
    expect(a).toEqual([1, 2, 3]);
    const b = [1, 2];
    insertArray(b, [9], 100);
    expect(b).toEqual([1, 2, 9]);
    const c = [1, 2];
    insertArray(c, [0], 0);
    expect(c).toEqual([0, 1, 2]);
  });
});

describe('clamp', () => {
  it('clamps to bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
  });
});

describe('toDisplayString', () => {
  it('formats null/undefined as empty and dates via toLocaleDateString', () => {
    expect(toDisplayString(null)).toBe('');
    expect(toDisplayString(undefined)).toBe('');
    const d = new Date(2024, 5, 15);
    expect(toDisplayString(d)).toBe(d.toLocaleDateString());
    expect(toDisplayString(42)).toBe('42');
  });
});
