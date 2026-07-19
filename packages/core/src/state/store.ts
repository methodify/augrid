/**
 * Minimal fine-grained reactivity: signal / computed / effect / batch.
 * Synchronous, glitch-free enough for grid internals (effects run after batch).
 */

type Subscriber = () => void;

interface Signal<T> {
  (): T;
  set(value: T): void;
  update(fn: (prev: T) => T): void;
  peek(): T;
}

interface ReadonlySignal<T> {
  (): T;
  peek(): T;
}

let activeEffect: EffectNode | null = null;
let batchDepth = 0;
const pendingEffects = new Set<EffectNode>();

interface EffectNode {
  run: Subscriber;
  deps: Set<Set<EffectNode>>;
  disposed: boolean;
}

function track(subs: Set<EffectNode>): void {
  if (activeEffect && !activeEffect.disposed) {
    subs.add(activeEffect);
    activeEffect.deps.add(subs);
  }
}

function notify(subs: Set<EffectNode>): void {
  for (const e of subs) pendingEffects.add(e);
  if (batchDepth === 0) flushEffects();
}

function flushEffects(): void {
  while (pendingEffects.size > 0) {
    const toRun = [...pendingEffects];
    pendingEffects.clear();
    for (const e of toRun) if (!e.disposed) runEffect(e);
  }
}

function runEffect(e: EffectNode): void {
  for (const dep of e.deps) dep.delete(e);
  e.deps.clear();
  const prev = activeEffect;
  activeEffect = e;
  try {
    e.run();
  } finally {
    activeEffect = prev;
  }
}

export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const subs = new Set<EffectNode>();
  const read = (() => {
    track(subs);
    return value;
  }) as Signal<T>;
  read.set = (v: T) => {
    if (Object.is(v, value)) return;
    value = v;
    notify(subs);
  };
  read.update = (fn) => read.set(fn(value));
  read.peek = () => value;
  return read;
}

export function computed<T>(fn: () => T): ReadonlySignal<T> {
  let value: T;
  let stale = true;
  const subs = new Set<EffectNode>();
  const node: EffectNode = {
    deps: new Set(),
    disposed: false,
    run: () => {
      stale = true;
      notify(subs);
    },
  };
  const read = (() => {
    track(subs);
    if (stale) {
      const prev = activeEffect;
      activeEffect = node;
      try {
        value = fn();
      } finally {
        activeEffect = prev;
      }
      stale = false;
    }
    return value;
  }) as ReadonlySignal<T>;
  read.peek = () => {
    if (stale) return read.call(null as never);
    return value;
  };
  return read;
}

export function effect(fn: () => void): () => void {
  const node: EffectNode = { run: fn, deps: new Set(), disposed: false };
  runEffect(node);
  return () => {
    node.disposed = true;
    for (const dep of node.deps) dep.delete(node);
    node.deps.clear();
  };
}

export function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flushEffects();
  }
}

export type { Signal, ReadonlySignal };
