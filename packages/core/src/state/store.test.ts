import { describe, expect, it, vi } from 'vitest';
import { batch, computed, effect, signal } from './store.js';

describe('signal', () => {
  it('get/set/peek', () => {
    const s = signal(1);
    expect(s()).toBe(1);
    s.set(2);
    expect(s()).toBe(2);
    expect(s.peek()).toBe(2);
  });

  it('update applies a function of the previous value', () => {
    const s = signal(10);
    s.update((v) => v + 5);
    expect(s()).toBe(15);
  });

  it('set with an identical value does not notify subscribers', () => {
    const s = signal(3);
    const spy = vi.fn(() => s());
    effect(spy);
    expect(spy).toHaveBeenCalledTimes(1);
    s.set(3);
    expect(spy).toHaveBeenCalledTimes(1);
    s.set(4);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('peek does not create a dependency', () => {
    const s = signal(0);
    const runs = vi.fn(() => {
      s.peek();
    });
    effect(runs);
    expect(runs).toHaveBeenCalledTimes(1);
    s.set(99);
    expect(runs).toHaveBeenCalledTimes(1);
  });
});

describe('computed', () => {
  it('is lazy: does not compute until read', () => {
    const s = signal(2);
    const fn = vi.fn(() => s() * 10);
    const c = computed(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(c()).toBe(20);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('caches until a dependency changes, then recomputes on next read', () => {
    const s = signal(1);
    const fn = vi.fn(() => s() + 100);
    const c = computed(fn);
    expect(c()).toBe(101);
    expect(c()).toBe(101);
    expect(fn).toHaveBeenCalledTimes(1);
    s.set(2);
    expect(fn).toHaveBeenCalledTimes(1); // still lazy
    expect(c()).toBe(102);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('peek returns the current value', () => {
    const s = signal(5);
    const c = computed(() => s() * 2);
    expect(c.peek()).toBe(10);
    s.set(6);
    expect(c.peek()).toBe(12);
  });

  it('effects depending on a computed re-run when its source changes', () => {
    const s = signal(1);
    const c = computed(() => s() * 2);
    const seen: number[] = [];
    effect(() => seen.push(c()));
    s.set(2);
    expect(seen).toEqual([2, 4]);
  });
});

describe('effect', () => {
  it('runs immediately and re-runs on dependency change', () => {
    const s = signal('a');
    const seen: string[] = [];
    effect(() => seen.push(s()));
    s.set('b');
    s.set('c');
    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('dispose stops further runs', () => {
    const s = signal(0);
    const spy = vi.fn(() => s());
    const dispose = effect(spy);
    s.set(1);
    expect(spy).toHaveBeenCalledTimes(2);
    dispose();
    s.set(2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('tracks only dependencies of the latest run', () => {
    const flag = signal(true);
    const a = signal('A');
    const b = signal('B');
    const spy = vi.fn(() => (flag() ? a() : b()));
    effect(spy);
    expect(spy).toHaveBeenCalledTimes(1);
    flag.set(false); // now depends on b, not a
    expect(spy).toHaveBeenCalledTimes(2);
    a.set('A2'); // no longer a dependency
    expect(spy).toHaveBeenCalledTimes(2);
    b.set('B2');
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

describe('batch', () => {
  it('coalesces multiple sets into one effect run', () => {
    const a = signal(1);
    const b = signal(2);
    const spy = vi.fn(() => a() + b());
    effect(spy);
    expect(spy).toHaveBeenCalledTimes(1);
    batch(() => {
      a.set(10);
      b.set(20);
      a.set(11);
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('nested batches flush only once at the outermost end', () => {
    const s = signal(0);
    const spy = vi.fn(() => s());
    effect(spy);
    batch(() => {
      s.set(1);
      batch(() => s.set(2));
      s.set(3);
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(s()).toBe(3);
  });
});

describe('re-entrancy safety', () => {
  it('an effect setting its own dependency converges (no infinite loop)', () => {
    const s = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      const v = s();
      if (v < 5) s.set(v + 1);
    });
    expect(s()).toBe(5);
    expect(runs).toBeLessThanOrEqual(10);
  });

  it('setting a signal to its current value inside an effect terminates', () => {
    const s = signal(7);
    let runs = 0;
    effect(() => {
      runs++;
      s.set(s()); // Object.is guard stops the cycle
    });
    expect(runs).toBe(1);
  });
});
