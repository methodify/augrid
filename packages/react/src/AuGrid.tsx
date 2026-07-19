import * as React from 'react';
import { Grid } from '@augrid/core';
import type { GridApi, GridOptions } from '@augrid/core';
import { ReactFrameworkAdapter, PortalHost } from './frameworkAdapter';

export interface AuGridProps<TData = unknown> extends GridOptions<TData> {
  /** Merged over the default { width: '100%', height: '100%' } on the host div. */
  style?: React.CSSProperties;
  className?: string;
  /** Fired once after the grid is created (adapter already attached). */
  onGridReady?: (event: { api: GridApi<TData> }) => void;
}

/** Imperative handle exposed via ref: the grid api (null before mount / after unmount). */
export interface AuGridRef<TData = unknown> {
  api: GridApi<TData> | null;
}

/** Props that belong to the React wrapper, never forwarded as GridOptions. */
const WRAPPER_PROPS = new Set<string>(['style', 'className', 'onGridReady', 'children']);

function extractGridOptions<TData>(props: AuGridProps<TData>): GridOptions<TData> {
  const options: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (WRAPPER_PROPS.has(key)) continue;
    options[key] = (props as Record<string, unknown>)[key];
  }
  return options as GridOptions<TData>;
}

function AuGridImpl<TData>(
  props: AuGridProps<TData>,
  ref: React.ForwardedRef<AuGridRef<TData>>,
): React.ReactElement {
  const divRef = React.useRef<HTMLDivElement | null>(null);
  // One adapter per component instance, created before the grid (portal
  // bridge must exist before any core render can request a framework mount).
  const [adapter] = React.useState(() => new ReactFrameworkAdapter());
  const gridRef = React.useRef<Grid<TData> | null>(null);
  const apiRef = React.useRef<GridApi<TData> | null>(null);
  const prevPropsRef = React.useRef<AuGridProps<TData> | null>(null);
  // Mount effect runs once but must see the props of the render it fires in.
  const latestPropsRef = React.useRef(props);
  latestPropsRef.current = props;

  React.useImperativeHandle(
    ref,
    () => ({
      get api(): GridApi<TData> | null {
        return apiRef.current;
      },
    }),
    [],
  );

  React.useLayoutEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const mountProps = latestPropsRef.current;
    const grid = new Grid<TData>(el, extractGridOptions(mountProps));
    // ctx is not exposed on the api; Grid.getContext() is the supported hook
    // for wrappers to attach their FrameworkAdapter.
    const ctx = grid.getContext();
    ctx.frameworkAdapter = adapter;
    gridRef.current = grid;
    apiRef.current = grid.api;
    prevPropsRef.current = mountProps;
    // First paint happened inside the Grid constructor without the adapter;
    // re-render so framework cell/header components mount now.
    grid.api.refreshHeader();
    grid.api.refreshCells({ force: true });
    ctx.scheduleRender();
    mountProps.onGridReady?.({ api: grid.api });
    return () => {
      gridRef.current = null;
      apiRef.current = null;
      prevPropsRef.current = null;
      grid.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter]);

  // Prop diffing → api.updateGridOptions with the changed subset. Comparison is
  // by identity (===): memoize object/array/function props (rowData, columnDefs,
  // callbacks) to avoid spurious grid option updates on every parent render.
  React.useEffect(() => {
    const prev = prevPropsRef.current;
    prevPropsRef.current = props;
    const api = apiRef.current;
    if (!prev || prev === props || !api) return;
    const changed: Record<string, unknown> = {};
    let count = 0;
    const cur = props as Record<string, unknown>;
    const old = prev as Record<string, unknown>;
    for (const key of Object.keys(cur)) {
      if (WRAPPER_PROPS.has(key)) continue;
      if (cur[key] !== old[key]) {
        changed[key] = cur[key];
        count++;
      }
    }
    for (const key of Object.keys(old)) {
      if (WRAPPER_PROPS.has(key) || key in cur) continue;
      changed[key] = undefined;
      count++;
    }
    if (count > 0) api.updateGridOptions(changed as Partial<GridOptions<TData>>);
  });

  return (
    <div
      ref={divRef}
      className={props.className}
      style={{ width: '100%', height: '100%', ...props.style }}
    >
      <PortalHost adapter={adapter} />
    </div>
  );
}

/**
 * React component wrapping an AuGrid instance. All GridOptions are accepted as
 * props; changed props are forwarded to api.updateGridOptions. Wrap React
 * custom components with reactComponent(Comp) in your ColDefs.
 */
export const AuGrid = React.forwardRef(
  AuGridImpl as (props: AuGridProps<unknown>, ref: React.ForwardedRef<AuGridRef<unknown>>) => React.ReactElement,
) as <TData = unknown>(
  props: AuGridProps<TData> & React.RefAttributes<AuGridRef<TData>>,
) => React.ReactElement;
