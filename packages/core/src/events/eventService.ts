import type { GridEventMap, GridEventName } from '../types/events';

type AnyListener = (event: unknown) => void;

export class EventService<TData = unknown> {
  private listeners = new Map<string, Set<AnyListener>>();
  private globalListeners = new Set<(type: string, event: unknown) => void>();

  addEventListener<K extends GridEventName>(
    type: K,
    listener: (event: GridEventMap<TData>[K]) => void,
  ): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as AnyListener);
  }

  removeEventListener<K extends GridEventName>(
    type: K,
    listener: (event: GridEventMap<TData>[K]) => void,
  ): void {
    this.listeners.get(type)?.delete(listener as AnyListener);
  }

  /** For wrappers: observe every event with its name. */
  addGlobalListener(listener: (type: string, event: unknown) => void): void {
    this.globalListeners.add(listener);
  }

  removeGlobalListener(listener: (type: string, event: unknown) => void): void {
    this.globalListeners.delete(listener);
  }

  dispatch<K extends GridEventName>(event: GridEventMap<TData>[K] & { type: K }): void {
    const set = this.listeners.get(event.type);
    if (set) for (const l of [...set]) l(event);
    for (const g of [...this.globalListeners]) g(event.type, event);
  }

  destroy(): void {
    this.listeners.clear();
    this.globalListeners.clear();
  }
}
