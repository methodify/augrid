/**
 * Tests for the React wrapper. The adapter-store tests import ONLY
 * ./frameworkAdapter (no core runtime import) so they pass even while sibling
 * core modules are incomplete. The full-mount smoke test is guarded: it skips
 * when the @augrid/core barrel does not compile yet.
 *
 * NOTE: collected via AuGridSuite.test.ts (root vitest include only matches
 * *.test.ts, not .tsx).
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFrameworkAdapter, PortalHost, reactComponent } from './frameworkAdapter';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------ adapter store (no core) */

describe('reactComponent', () => {
  test('wraps a component in the framework marker object', () => {
    const Comp = () => null;
    expect(reactComponent(Comp)).toEqual({ __frameworkComponent: Comp });
  });
});

describe('ReactFrameworkAdapter store contract', () => {
  const Comp = () => null;

  test('render() upserts an entry, bumps version and notifies subscribers', () => {
    const adapter = new ReactFrameworkAdapter();
    const listener = vi.fn();
    adapter.subscribe(listener);
    const v0 = adapter.getVersion();
    const container = document.createElement('div');

    adapter.render(Comp, { value: 1 }, container);

    expect(adapter.getVersion()).toBe(v0 + 1);
    expect(listener).toHaveBeenCalledTimes(1);
    const entries = adapter.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].container).toBe(container);
    expect(entries[0].props.value).toBe(1);
  });

  test('re-render on the same container keeps a stable key and a single entry', () => {
    const adapter = new ReactFrameworkAdapter();
    const container = document.createElement('div');
    adapter.render(Comp, { value: 1 }, container);
    const key1 = adapter.getEntries()[0].key;
    adapter.render(Comp, { value: 2 }, container);
    const entries = adapter.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe(key1);
    expect(entries[0].props.value).toBe(2);
  });

  test('distinct containers get distinct keys', () => {
    const adapter = new ReactFrameworkAdapter();
    adapter.render(Comp, {}, document.createElement('div'));
    adapter.render(Comp, {}, document.createElement('div'));
    const [a, b] = adapter.getEntries();
    expect(a.key).not.toBe(b.key);
  });

  test('cleanup removes the entry and notifies; version bumps', () => {
    const adapter = new ReactFrameworkAdapter();
    const listener = vi.fn();
    adapter.subscribe(listener);
    const container = document.createElement('div');
    const cleanup = adapter.render(Comp, {}, container);
    const vAfterRender = adapter.getVersion();

    cleanup();

    expect(adapter.getEntries()).toHaveLength(0);
    expect(adapter.getVersion()).toBe(vAfterRender + 1);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('stale cleanup does not tear down a newer entry on the same container', () => {
    const adapter = new ReactFrameworkAdapter();
    const container = document.createElement('div');
    const cleanup1 = adapter.render(Comp, { value: 1 }, container);
    adapter.render(Comp, { value: 2 }, container);

    cleanup1(); // stale — must be a no-op

    const entries = adapter.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].props.value).toBe(2);
  });

  test('unsubscribe stops notifications', () => {
    const adapter = new ReactFrameworkAdapter();
    const listener = vi.fn();
    const unsub = adapter.subscribe(listener);
    unsub();
    adapter.render(Comp, {}, document.createElement('div'));
    expect(listener).not.toHaveBeenCalled();
  });

  test('getEditorValue: seeded from props.value, updated via injected onValueChange', () => {
    const adapter = new ReactFrameworkAdapter();
    const container = document.createElement('div');
    adapter.render(Comp, { value: 'initial' }, container);
    expect(adapter.getEditorValue(container)).toBe('initial');

    const entry = adapter.getEntries()[0];
    const onValueChange = entry.props.onValueChange as (v: unknown) => void;
    expect(typeof onValueChange).toBe('function');
    onValueChange('edited');
    expect(adapter.getEditorValue(container)).toBe('edited');

    // user-provided onValueChange is chained, not clobbered
    const userCb = vi.fn();
    adapter.render(Comp, { value: 0, onValueChange: userCb }, container);
    (adapter.getEntries()[0].props.onValueChange as (v: unknown) => void)(7);
    expect(adapter.getEditorValue(container)).toBe(7);
    expect(userCb).toHaveBeenCalledWith(7);
  });

  test('cleanup clears the stored editor value', () => {
    const adapter = new ReactFrameworkAdapter();
    const container = document.createElement('div');
    const cleanup = adapter.render(Comp, { value: 5 }, container);
    cleanup();
    expect(adapter.getEditorValue(container)).toBeUndefined();
  });
});

/* -------------------------------------------------- PortalHost (React DOM) */

describe('PortalHost', () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  test('renders registered components into their containers via portals', async () => {
    const adapter = new ReactFrameworkAdapter();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<PortalHost adapter={adapter} />));

    const cellA = document.createElement('div');
    const cellB = document.createElement('div');
    const Cell = (p: { value?: unknown }) => <span>{String(p.value)}</span>;

    let cleanupA!: () => void;
    await act(async () => {
      cleanupA = adapter.render(Cell, { value: 42 }, cellA);
      adapter.render(Cell, { value: 'hi' }, cellB);
    });
    expect(cellA.textContent).toBe('42');
    expect(cellB.textContent).toBe('hi');

    // upsert re-renders in place
    await act(async () => {
      adapter.render(Cell, { value: 43 }, cellA);
    });
    expect(cellA.textContent).toBe('43');

    // removal unmounts the portal (use the latest cleanup for cellA)
    let cleanupA2!: () => void;
    await act(async () => {
      cleanupA2 = adapter.render(Cell, { value: 44 }, cellA);
    });
    await act(async () => cleanupA2());
    expect(cellA.textContent).toBe('');
    expect(cellB.textContent).toBe('hi');
    void cleanupA;
  });
});

/* ------------------------------------------- full mount (guarded on core) */

let coreAvailable = true;
try {
  await import('@augrid/core');
} catch {
  coreAvailable = false;
}

describe('AuGrid full mount (skipped while core barrel is incomplete)', () => {
  interface Row {
    make: string;
    price: number;
  }

  test.skipIf(!coreAvailable)('mounts, exposes api, renders data, diffs props', async () => {
    const { AuGrid } = await import('./AuGrid');
    type AuGridRefT = import('./AuGrid').AuGridRef<Row>;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    const onGridReady = vi.fn();
    const ref = React.createRef<AuGridRefT>();
    const columnDefs = [{ field: 'make' }, { field: 'price' }];
    const rowData: Row[] = [
      { make: 'Toyota', price: 1 },
      { make: 'Ford', price: 2 },
    ];

    await act(async () => {
      root.render(
        <AuGrid<Row>
          ref={ref}
          rowData={rowData}
          columnDefs={columnDefs}
          onGridReady={onGridReady}
        />,
      );
    });

    expect(onGridReady).toHaveBeenCalledTimes(1);
    const api = onGridReady.mock.calls[0][0].api;
    expect(ref.current?.api).toBe(api);
    expect(api.getDisplayedRowCount()).toBe(2);
    expect(host.querySelector('.au-root')).toBeTruthy();

    // prop identity change → diffed into api.updateGridOptions
    const rowData2: Row[] = [...rowData, { make: 'BMW', price: 3 }];
    await act(async () => {
      root.render(
        <AuGrid<Row>
          ref={ref}
          rowData={rowData2}
          columnDefs={columnDefs}
          onGridReady={onGridReady}
        />,
      );
    });
    expect(api.getDisplayedRowCount()).toBe(3);
    expect(onGridReady).toHaveBeenCalledTimes(1); // no re-create

    await act(async () => root.unmount());
    expect(api.isDestroyed()).toBe(true);
    host.remove();
  });
});
