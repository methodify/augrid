/**
 * React implementation of the core FrameworkAdapter contract.
 *
 * IMPORTANT: this module must NOT import '@augrid/core' at runtime — only type
 * imports — so it loads (and is testable) independently of the core barrel.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import type { FrameworkAdapter } from '@augrid/core';

/** One mounted framework component (rendered via portal into a grid-owned element). */
export interface PortalEntry {
  component: React.ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
  key: string;
  container: HTMLElement;
}

/**
 * Marker users wrap React components with when passing them as
 * cellRenderer / cellEditor / headerComponent in ColDefs:
 * `{ cellRenderer: reactComponent(MyCell) }`.
 */
export function reactComponent<P>(
  component: React.ComponentType<P>,
): { readonly __frameworkComponent: React.ComponentType<P> } {
  return { __frameworkComponent: component };
}

type Listener = () => void;

/**
 * Subscribable portal store bridging core's imperative render(component,
 * props, container) calls into a single React commit (via PortalHost).
 * All state is per-instance — multiple grids on a page stay independent.
 */
export class ReactFrameworkAdapter implements FrameworkAdapter {
  private entries = new Map<HTMLElement, PortalEntry>();
  private listeners = new Set<Listener>();
  private version = 0;
  /** Stable portal key per container so React keeps component state across upserts. */
  private keyByContainer = new WeakMap<HTMLElement, string>();
  private keyCounter = 0;
  /** Latest value reported by framework editors, per editor container. */
  private editorValues = new Map<HTMLElement, unknown>();

  /** Core contract: upsert a portal entry; returns a cleanup for this render. */
  render(
    component: unknown,
    props: Record<string, unknown>,
    container: HTMLElement,
  ): () => void {
    let key = this.keyByContainer.get(container);
    if (key === undefined) {
      key = `au-portal-${++this.keyCounter}`;
      this.keyByContainer.set(container, key);
    }

    // Editor bridging: seed with the initial value and inject onValueChange so
    // getEditorValue() can report the latest value without a component API.
    if ('value' in props) this.editorValues.set(container, props['value']);
    const userOnValueChange = props['onValueChange'];
    const entryProps: Record<string, unknown> = {
      ...props,
      onValueChange: (v: unknown) => {
        this.editorValues.set(container, v);
        if (typeof userOnValueChange === 'function') {
          (userOnValueChange as (v: unknown) => void)(v);
        }
      },
    };

    const entry: PortalEntry = {
      component: component as React.ComponentType<Record<string, unknown>>,
      props: entryProps,
      key,
      container,
    };
    this.entries.set(container, entry);
    this.bump();

    return () => {
      // Only remove if this render's entry is still the live one (a later
      // upsert on the same container must not be torn down by a stale cleanup).
      if (this.entries.get(container) === entry) {
        this.entries.delete(container);
        this.editorValues.delete(container);
        this.bump();
      }
    };
  }

  /** Core contract: latest value of the framework editor mounted in `container`. */
  getEditorValue(container: HTMLElement): unknown {
    return this.editorValues.get(container);
  }

  /* ----- store interface for useSyncExternalStore (stable identities) ----- */

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Snapshot: monotonically increasing version; the host reads entries directly. */
  getVersion = (): number => this.version;

  getEntries(): PortalEntry[] {
    return Array.from(this.entries.values());
  }

  private bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }
}

export interface PortalHostProps {
  adapter: ReactFrameworkAdapter;
}

/**
 * Rendered once inside <AuGrid>'s root div; subscribes to the adapter store
 * and mounts every registered framework component through a React portal into
 * its grid-owned container element (one React commit per store change).
 */
export function PortalHost({ adapter }: PortalHostProps): React.ReactElement {
  React.useSyncExternalStore(adapter.subscribe, adapter.getVersion, adapter.getVersion);
  return (
    <>
      {adapter.getEntries().map(({ component: C, props, key, container }) =>
        createPortal(<C {...props} />, container, key),
      )}
    </>
  );
}
