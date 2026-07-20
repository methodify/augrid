export function humanize(field: string): string {
  const last = field.includes('.') ? field.slice(field.lastIndexOf('.') + 1) : field;
  const words = last
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Path segments that would walk (or write through) the prototype chain.
 * Both getPath and setPath treat a path containing any of these as invalid
 * (no-op / undefined) to prevent prototype pollution via colDef.field.
 */
function isUnsafePathSegment(segment: string): boolean {
  return segment === '__proto__' || segment === 'constructor' || segment === 'prototype';
}

/** Read a possibly-dotted path from an object. Fast path for non-dotted. */
export function getPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  if (!path.includes('.')) {
    if (isUnsafePathSegment(path)) return undefined;
    return (obj as Record<string, unknown>)[path];
  }
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (isUnsafePathSegment(part)) return undefined;
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function setPath(obj: unknown, path: string, value: unknown): void {
  if (obj == null) return;
  if (!path.includes('.')) {
    if (isUnsafePathSegment(path)) return;
    (obj as Record<string, unknown>)[path] = value;
    return;
  }
  const parts = path.split('.');
  for (const part of parts) if (isUnsafePathSegment(part)) return;
  let cur = obj as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    let next = cur[parts[i]];
    if (next == null || typeof next !== 'object') {
      next = {};
      cur[parts[i]] = next;
    }
    cur = next as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

let idCounter = 0;
export function nextId(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

export function last<T>(arr: readonly T[]): T | undefined {
  return arr[arr.length - 1];
}

export function insertArray<T>(arr: T[], items: T[], index: number | undefined): void {
  if (index == null || index < 0 || index >= arr.length) arr.push(...items);
  else arr.splice(index, 0, ...items);
}

/** Binary search: greatest index i such that arr[i] <= value. arr ascending. */
export function binarySearchLE(arr: ArrayLike<number>, value: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= value) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function defaultCompare(a: unknown, b: unknown, accented?: boolean): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  const as = String(a);
  const bs = String(b);
  if (accented) return as.localeCompare(bs);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

export function toDisplayString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toLocaleDateString();
  return String(value);
}

export function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}
