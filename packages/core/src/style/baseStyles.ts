/**
 * Structural CSS — layout-critical rules only. Visual polish lives in
 * themes.ts on top of the --au-* custom properties defined here.
 */
export const BASE_CSS = `
.au-root {
  --au-row-height: 32px;
  --au-header-height: 36px;
  --au-spacing: 8px;
  --au-font-size: 13px;
  --au-icon-size: 16px;

  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
  font-size: var(--au-font-size);
  font-family: var(--au-font-family, system-ui, -apple-system, sans-serif);
  color: var(--au-foreground-color, #181d1f);
  background: var(--au-background-color, #fff);
  border: 1px solid var(--au-border-color, #dde2eb);
  border-radius: var(--au-wrapper-border-radius, 8px);
  outline: none;
  user-select: none;
  cursor: default;
}
.au-root *, .au-root *::before, .au-root *::after { box-sizing: border-box; }

/* ---------- header ---------- */
.au-header {
  display: flex;
  flex: none;
  overflow: hidden;
  background: var(--au-header-background-color, #f8f8f8);
  border-bottom: 1px solid var(--au-border-color, #dde2eb);
}
.au-header-left, .au-header-right { flex: none; position: relative; overflow: hidden; }
.au-header-center-vp { flex: 1 1 auto; overflow: hidden; position: relative; }
.au-header-center { position: relative; height: 100%; will-change: transform; }
.au-header-cell {
  position: absolute;
  top: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 var(--au-cell-horizontal-padding, 12px);
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
}
.au-header-cell-label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 4px; min-width: 0; }
.au-header-cell-text { overflow: hidden; text-overflow: ellipsis; }
.au-header-cell.au-sortable { cursor: pointer; }
.au-header-group-cell { justify-content: center; font-weight: 600; }
.au-sort-indicator { flex: none; display: inline-flex; align-items: center; opacity: .85; }
.au-sort-order { font-size: 10px; opacity: .6; margin-left: 1px; }
.au-header-resize {
  position: absolute;
  right: -4px;
  top: 0;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
}
.au-floating {
  display: flex;
  flex: none;
  overflow: hidden;
  border-bottom: 1px solid var(--au-border-color, #dde2eb);
  background: var(--au-header-background-color, #f8f8f8);
}
.au-floating-left, .au-floating-right { flex: none; position: relative; overflow: hidden; }
.au-floating-center-vp { flex: 1 1 auto; overflow: hidden; position: relative; }
.au-floating-center { position: relative; height: 100%; will-change: transform; }
.au-floating-cell {
  position: absolute; top: 0; height: 100%;
  display: flex; align-items: center;
  padding: 0 4px;
}
.au-floating-cell input, .au-floating-cell select {
  width: 100%;
  height: calc(100% - 10px);
  font: inherit;
  padding: 0 6px;
  border: 1px solid var(--au-input-border-color, #babfc7);
  border-radius: var(--au-input-border-radius, 4px);
  background: var(--au-input-background-color, #fff);
  color: inherit;
  outline: none;
  min-width: 0;
}

/* ---------- body ---------- */
.au-body { flex: 1 1 auto; display: flex; min-height: 0; position: relative; }
.au-body-left, .au-body-right { flex: none; position: relative; overflow: hidden; z-index: 1; }
.au-body-left { box-shadow: var(--au-pinned-left-shadow, 2px 0 4px -2px rgba(0,0,0,.12)); }
.au-body-right { box-shadow: var(--au-pinned-right-shadow, -2px 0 4px -2px rgba(0,0,0,.12)); }
.au-pinned-container { position: absolute; top: 0; left: 0; right: 0; will-change: transform; }
.au-body-center-vp { flex: 1 1 auto; overflow: auto; position: relative; min-width: 0; }
.au-center-spacer { position: relative; }
.au-fullwidth-wrap {
  position: absolute; inset: 0; overflow: hidden;
  pointer-events: none; z-index: 2;
}
.au-fullwidth-container {
  position: absolute; top: 0; left: 0; right: 0;
  pointer-events: none; will-change: transform;
}
.au-fullwidth-container .au-row { pointer-events: auto; }
.au-fullwidth-cell { left: 0; width: 100%; }
/* Framework component mount wrapper (one per mount; removed as a node). */
.au-fw-mount { display: contents; }

/* ---------- rows / cells ---------- */
.au-row {
  position: absolute;
  left: 0;
  display: block;
  width: 100%;
  border-bottom: 1px solid var(--au-row-border-color, #eff1f6);
  background: var(--au-background-color, #fff);
  contain: layout paint;
}
.au-row.au-row-odd { background: var(--au-odd-row-background-color, var(--au-background-color, #fff)); }
.au-row.au-row-hover { background: var(--au-row-hover-color, #f1f4f9); }
.au-row.au-row-selected { background: var(--au-selected-row-background-color, #e7f0fe); }
.au-row.au-row-group { font-weight: 500; }
.au-row.au-row-footer { font-weight: 600; background: var(--au-footer-row-background-color, #f8f8f8); }
.au-cell {
  position: absolute;
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 var(--au-cell-horizontal-padding, 12px);
  overflow: hidden;
  white-space: nowrap;
}
.au-cell-value { overflow: hidden; text-overflow: ellipsis; flex: 1 1 auto; min-width: 0; }
.au-cell.au-cell-number, .au-header-cell.au-cell-number .au-header-cell-label { justify-content: flex-end; }
.au-cell.au-cell-wrap { white-space: normal; align-items: flex-start; padding-top: 4px; padding-bottom: 4px; }
.au-cell-focus {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--au-focus-border-color, #2563eb);
  z-index: 1;
}
.au-cell-inline-editing { padding: 0; overflow: visible; z-index: 3; }
.au-cell-inline-editing > input, .au-cell-inline-editing > select, .au-cell-inline-editing > textarea {
  width: 100%; height: 100%; font: inherit; padding: 0 var(--au-cell-horizontal-padding, 12px);
  border: 2px solid var(--au-focus-border-color, #2563eb);
  background: var(--au-input-background-color, #fff);
  color: inherit;
  outline: none;
}
.au-cell-flash { animation: au-flash var(--au-cell-flash-duration, .7s) ease-out; }
@keyframes au-flash {
  0% { background-color: var(--au-value-change-flash-color, #fde68a); }
  100% { background-color: transparent; }
}

/* ranges */
.au-range-selected { background-color: var(--au-range-selection-background-color, rgba(37,99,235,.12)); }
.au-range-top { box-shadow: inset 0 2px 0 var(--au-range-selection-border-color, #2563eb); }
.au-range-bottom { box-shadow: inset 0 -2px 0 var(--au-range-selection-border-color, #2563eb); }
.au-range-left { box-shadow: inset 2px 0 0 var(--au-range-selection-border-color, #2563eb); }
.au-range-right { box-shadow: inset -2px 0 0 var(--au-range-selection-border-color, #2563eb); }
.au-range-top.au-range-left { box-shadow: inset 0 2px 0 var(--au-range-selection-border-color, #2563eb), inset 2px 0 0 var(--au-range-selection-border-color, #2563eb); }
.au-range-top.au-range-right { box-shadow: inset 0 2px 0 var(--au-range-selection-border-color, #2563eb), inset -2px 0 0 var(--au-range-selection-border-color, #2563eb); }
.au-range-bottom.au-range-left { box-shadow: inset 0 -2px 0 var(--au-range-selection-border-color, #2563eb), inset 2px 0 0 var(--au-range-selection-border-color, #2563eb); }
.au-range-bottom.au-range-right { box-shadow: inset 0 -2px 0 var(--au-range-selection-border-color, #2563eb), inset -2px 0 0 var(--au-range-selection-border-color, #2563eb); }
.au-fill-handle {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 7px;
  height: 7px;
  background: var(--au-range-selection-border-color, #2563eb);
  border: 1px solid var(--au-background-color, #fff);
  cursor: crosshair;
  z-index: 4;
}

/* group cell */
.au-group-cell { display: flex; align-items: center; gap: 6px; overflow: hidden; min-width: 0; }
.au-group-expand {
  flex: none;
  width: var(--au-icon-size, 16px);
  height: var(--au-icon-size, 16px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform .15s ease;
  opacity: .7;
}
.au-group-expand.au-expanded { transform: rotate(90deg); }
.au-group-expand.au-hidden { visibility: hidden; cursor: default; }
.au-group-key { overflow: hidden; text-overflow: ellipsis; }
.au-group-count { opacity: .55; font-weight: 400; }

/* checkbox */
.au-checkbox {
  width: 15px; height: 15px;
  accent-color: var(--au-accent-color, #2563eb);
  cursor: pointer;
  margin: 0;
}

/* pinned rows */
.au-pinned-top, .au-pinned-bottom {
  display: flex; flex: none; overflow: hidden; position: relative;
  background: var(--au-background-color, #fff);
}
.au-pinned-top { border-bottom: 2px solid var(--au-border-color, #dde2eb); }
.au-pinned-bottom { border-top: 2px solid var(--au-border-color, #dde2eb); }
.au-pinned-row-left, .au-pinned-row-right { flex: none; position: relative; overflow: hidden; }
.au-pinned-row-center-vp { flex: 1 1 auto; overflow: hidden; position: relative; }
.au-pinned-row-center { position: relative; height: 100%; will-change: transform; }

/* overlay */
.au-overlay {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--au-overlay-background-color, rgba(255,255,255,.66));
  z-index: 10;
  pointer-events: none;
}
.au-overlay[hidden] { display: none; }
.au-overlay-panel {
  pointer-events: auto;
  padding: 8px 16px;
  border-radius: 6px;
  background: var(--au-background-color, #fff);
  border: 1px solid var(--au-border-color, #dde2eb);
  box-shadow: 0 4px 16px rgba(0,0,0,.08);
}
.au-loading-spinner {
  width: 18px; height: 18px;
  border: 2px solid var(--au-border-color, #dde2eb);
  border-top-color: var(--au-accent-color, #2563eb);
  border-radius: 50%;
  display: inline-block;
  vertical-align: -4px;
  margin-right: 8px;
  animation: au-spin .8s linear infinite;
}
@keyframes au-spin { to { transform: rotate(360deg); } }

/* paging panel */
.au-paging {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 6px 12px;
  border-top: 1px solid var(--au-border-color, #dde2eb);
  background: var(--au-header-background-color, #f8f8f8);
}
.au-paging button {
  font: inherit;
  padding: 2px 8px;
  border: 1px solid var(--au-border-color, #dde2eb);
  border-radius: 4px;
  background: var(--au-background-color, #fff);
  color: inherit;
  cursor: pointer;
}
.au-paging button:disabled { opacity: .4; cursor: default; }
.au-paging select { font: inherit; }

/* editor popup */
.au-editor-popup {
  position: absolute;
  z-index: 20;
  background: var(--au-background-color, #fff);
  border: 1px solid var(--au-border-color, #dde2eb);
  border-radius: 4px;
  box-shadow: 0 6px 24px rgba(0,0,0,.14);
}

/* context menu */
.au-menu {
  position: absolute;
  z-index: 30;
  min-width: 180px;
  padding: 4px;
  background: var(--au-background-color, #fff);
  border: 1px solid var(--au-border-color, #dde2eb);
  border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0,0,0,.14);
  font-size: var(--au-font-size, 13px);
  user-select: none;
  outline: none;
}
.au-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  outline: none;
  white-space: nowrap;
}
.au-menu-item:hover, .au-menu-item:focus { background: var(--au-row-hover-color, #f1f4f9); }
.au-menu-item[aria-disabled="true"] { opacity: .45; cursor: default; }
.au-menu-item[aria-disabled="true"]:hover { background: none; }
.au-menu-icon { flex: none; width: 16px; text-align: center; }
.au-menu-name { flex: 1 1 auto; }
.au-menu-shortcut { flex: none; opacity: .55; font-size: 11px; }
.au-menu-arrow { flex: none; opacity: .6; }
.au-menu-sep { height: 1px; margin: 4px 2px; background: var(--au-border-color, #dde2eb); }

/* column drag ghost & drop indicator */
.au-drag-ghost {
  position: fixed;
  z-index: 1000;
  pointer-events: none;
  padding: 4px 10px;
  border-radius: 4px;
  background: var(--au-background-color, #fff);
  border: 1px solid var(--au-border-color, #dde2eb);
  box-shadow: 0 4px 12px rgba(0,0,0,.18);
  font-size: var(--au-font-size, 13px);
  opacity: .9;
}
.au-drop-indicator {
  position: absolute;
  top: 0;
  width: 2px;
  background: var(--au-accent-color, #2563eb);
  z-index: 5;
  pointer-events: none;
}

/* tooltip */
.au-tooltip {
  position: fixed;
  z-index: 1001;
  max-width: 320px;
  padding: 6px 10px;
  border-radius: 4px;
  background: var(--au-tooltip-background-color, #23272e);
  color: var(--au-tooltip-foreground-color, #fff);
  font-size: 12px;
  pointer-events: none;
  white-space: pre-wrap;
}
`;
