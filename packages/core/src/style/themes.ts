/**
 * Default theme: "aurora". Light + dark parameter sets applied as CSS
 * variables, plus scheme-conditional CSS for `auto` mode.
 */

export const LIGHT_PARAMS: Record<string, string> = {
  backgroundColor: '#ffffff',
  foregroundColor: '#181d1f',
  borderColor: '#dde2eb',
  rowBorderColor: '#eff1f6',
  headerBackgroundColor: '#f8f9fb',
  oddRowBackgroundColor: '#fcfdfe',
  rowHoverColor: '#f1f4f9',
  selectedRowBackgroundColor: '#e7f0fe',
  footerRowBackgroundColor: '#f6f8fa',
  accentColor: '#2563eb',
  focusBorderColor: '#2563eb',
  rangeSelectionBackgroundColor: 'rgba(37, 99, 235, 0.12)',
  rangeSelectionBorderColor: '#2563eb',
  valueChangeFlashColor: '#fde68a',
  inputBorderColor: '#babfc7',
  inputBackgroundColor: '#ffffff',
  overlayBackgroundColor: 'rgba(255, 255, 255, 0.66)',
  tooltipBackgroundColor: '#23272e',
  tooltipForegroundColor: '#ffffff',
};

export const DARK_PARAMS: Record<string, string> = {
  backgroundColor: '#15181c',
  foregroundColor: '#e8eaed',
  borderColor: '#33383f',
  rowBorderColor: '#23272d',
  headerBackgroundColor: '#1c2025',
  oddRowBackgroundColor: '#171a1f',
  rowHoverColor: '#20242a',
  selectedRowBackgroundColor: '#1e3a5f',
  footerRowBackgroundColor: '#1c2025',
  accentColor: '#60a5fa',
  focusBorderColor: '#60a5fa',
  rangeSelectionBackgroundColor: 'rgba(96, 165, 250, 0.16)',
  rangeSelectionBorderColor: '#60a5fa',
  valueChangeFlashColor: '#78350f',
  inputBorderColor: '#3f454d',
  inputBackgroundColor: '#1c2025',
  overlayBackgroundColor: 'rgba(21, 24, 28, 0.66)',
  tooltipBackgroundColor: '#e8eaed',
  tooltipForegroundColor: '#15181c',
};

/** Extra CSS beyond structural rules: auto color-scheme support. */
export const THEME_CSS = `
@media (prefers-color-scheme: dark) {
  .au-root[data-au-color-scheme="auto"] {
    --au-background-color: ${DARK_PARAMS.backgroundColor};
    --au-foreground-color: ${DARK_PARAMS.foregroundColor};
    --au-border-color: ${DARK_PARAMS.borderColor};
    --au-row-border-color: ${DARK_PARAMS.rowBorderColor};
    --au-header-background-color: ${DARK_PARAMS.headerBackgroundColor};
    --au-odd-row-background-color: ${DARK_PARAMS.oddRowBackgroundColor};
    --au-row-hover-color: ${DARK_PARAMS.rowHoverColor};
    --au-selected-row-background-color: ${DARK_PARAMS.selectedRowBackgroundColor};
    --au-footer-row-background-color: ${DARK_PARAMS.footerRowBackgroundColor};
    --au-accent-color: ${DARK_PARAMS.accentColor};
    --au-focus-border-color: ${DARK_PARAMS.focusBorderColor};
    --au-range-selection-background-color: ${DARK_PARAMS.rangeSelectionBackgroundColor};
    --au-range-selection-border-color: ${DARK_PARAMS.rangeSelectionBorderColor};
    --au-value-change-flash-color: ${DARK_PARAMS.valueChangeFlashColor};
    --au-input-border-color: ${DARK_PARAMS.inputBorderColor};
    --au-input-background-color: ${DARK_PARAMS.inputBackgroundColor};
    --au-overlay-background-color: ${DARK_PARAMS.overlayBackgroundColor};
    --au-tooltip-background-color: ${DARK_PARAMS.tooltipBackgroundColor};
    --au-tooltip-foreground-color: ${DARK_PARAMS.tooltipForegroundColor};
    color-scheme: dark;
  }
}
.au-root[data-au-color-scheme="dark"] { color-scheme: dark; }
`;
