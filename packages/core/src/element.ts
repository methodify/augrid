import { createGrid } from './grid';
import type { GridApi } from './types/api';
import type { GridOptions } from './types/gridOptions';

/**
 * `<au-grid>` custom element. Set options via the `gridOptions` property
 * (attributes are not sufficient for rich options). The `api` property is
 * available after connection; the element fires a `gridready` CustomEvent.
 */
export class AuGridElement extends HTMLElement {
  api: GridApi | null = null;
  private _options: GridOptions | null = null;

  set gridOptions(options: GridOptions) {
    this._options = options;
    if (this.isConnected) this.init();
  }
  get gridOptions(): GridOptions | null {
    return this._options;
  }

  connectedCallback(): void {
    this.style.display = 'block';
    if (this._options) this.init();
  }

  disconnectedCallback(): void {
    this.api?.destroy();
    this.api = null;
  }

  private init(): void {
    this.api?.destroy();
    this.textContent = '';
    this.api = createGrid(this, this._options ?? {});
    this.dispatchEvent(new CustomEvent('gridready', { detail: { api: this.api } }));
  }
}

export function defineAuGridElement(tagName = 'au-grid'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tagName)) {
    customElements.define(tagName, AuGridElement);
  }
}
