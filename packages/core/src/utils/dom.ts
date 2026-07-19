export function el(
  tag: string,
  className?: string,
  attrs?: Record<string, string>,
): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

export function clearChildren(e: HTMLElement): void {
  while (e.firstChild) e.removeChild(e.firstChild);
}

export function setTransformY(e: HTMLElement, y: number): void {
  e.style.transform = `translateY(${y}px)`;
}

export function setTransformXY(e: HTMLElement, x: number, y: number): void {
  e.style.transform = `translate(${x}px,${y}px)`;
}

export function toggleClass(e: HTMLElement, cls: string, on: boolean): void {
  e.classList.toggle(cls, on);
}

/** Find closest ancestor (or self) with the attribute, bounded by `stop`. */
export function closestWithAttr(
  start: Element | null,
  attr: string,
  stop: Element,
): HTMLElement | null {
  let cur: Element | null = start;
  while (cur && cur !== stop) {
    if ((cur as HTMLElement).hasAttribute?.(attr)) return cur as HTMLElement;
    cur = cur.parentElement;
  }
  return null;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
