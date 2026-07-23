import { createGrid } from './grid.js';
import type { GridApi } from './types/api.js';
import type { GridOptions } from './types/gridOptions.js';

/**
 * `<au-grid>` custom element. Set options via the `gridOptions` property
 * (attributes are not sufficient for rich options). The `api` property is
 * available after connection; the element fires a `gridready` CustomEvent.
 *
 * Defined lazily so importing @augrid/core stays safe in DOM-less
 * environments (SSR, Node tooling): extending HTMLElement at module scope
 * would throw where no DOM exists.
 */
export interface AuGridElement extends HTMLElement {
  api: GridApi | null;
  gridOptions: GridOptions | null;
}

let elementClass: (new () => AuGridElement) | null = null;

/** Build (once) and return the element class. Requires a DOM. */
export function getAuGridElementClass(): new () => AuGridElement {
  if (elementClass) return elementClass;
  if (typeof HTMLElement === 'undefined') {
    throw new Error('AuGridElement requires a DOM environment');
  }

  class AuGridElementImpl extends HTMLElement {
    api: GridApi | null = null;
    private _options: GridOptions | null = null;

    set gridOptions(options: GridOptions | null) {
      this._options = options;
      if (this.isConnected && options) this.init();
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

  elementClass = AuGridElementImpl;
  return elementClass;
}

export function defineAuGridElement(tagName = 'au-grid'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tagName)) {
    customElements.define(tagName, getAuGridElementClass());
  }
}
