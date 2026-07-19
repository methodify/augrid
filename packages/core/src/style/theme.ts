import { BASE_CSS } from './baseStyles';
import type { ThemeSpec } from '../types/gridOptions';
import { THEME_CSS, DARK_PARAMS, LIGHT_PARAMS } from './themes';

const injectedDocs = new WeakSet<Document | ShadowRoot>();

/** Inject grid styles once per document/shadow-root (constructable when possible). */
export function injectStyles(root: Document | ShadowRoot = document): void {
  if (injectedDocs.has(root)) return;
  injectedDocs.add(root);
  const css = BASE_CSS + '\n' + THEME_CSS;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    const target = root as unknown as { adoptedStyleSheets: CSSStyleSheet[] };
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
  } catch {
    const style = document.createElement('style');
    style.setAttribute('data-augrid', '');
    style.textContent = css;
    (root instanceof Document ? root.head : root).appendChild(style);
  }
}

const DENSITY_SCALE = { compact: 0.8, normal: 1, comfortable: 1.25 } as const;

/** Apply a theme spec as inline CSS variables on this grid's root element. */
export function applyTheme(rootEl: HTMLElement, spec: ThemeSpec | undefined): void {
  // Clear previous inline theme vars.
  for (const name of [...rootEl.style]) {
    if (name.startsWith('--au-')) rootEl.style.removeProperty(name);
  }
  rootEl.removeAttribute('data-au-color-scheme');

  const scheme = spec?.colorScheme ?? 'light';
  if (scheme === 'dark') rootEl.setAttribute('data-au-color-scheme', 'dark');
  else if (scheme === 'auto') rootEl.setAttribute('data-au-color-scheme', 'auto');

  const base = scheme === 'dark' ? DARK_PARAMS : LIGHT_PARAMS;
  const density = spec?.density ?? 'normal';
  const scale = DENSITY_SCALE[density];
  const merged: Record<string, string | number> = { ...base, ...(spec?.params ?? {}) };
  if (density !== 'normal') {
    if (merged.rowHeight === undefined) merged.rowHeight = `${Math.round(32 * scale)}px`;
    if (merged.headerHeight === undefined) merged.headerHeight = `${Math.round(36 * scale)}px`;
    if (merged.cellHorizontalPadding === undefined)
      merged.cellHorizontalPadding = `${Math.round(12 * scale)}px`;
    if (merged.fontSize === undefined) merged.fontSize = `${Math.round(13 * Math.min(scale, 1.08))}px`;
  }
  for (const [key, value] of Object.entries(merged)) {
    rootEl.style.setProperty(toCssVar(key), String(value));
  }
}

/** camelCase param name → --au-kebab-case custom property. */
export function toCssVar(param: string): string {
  return '--au-' + param.replace(/([a-z\d])([A-Z])/g, '$1-$2').toLowerCase();
}
