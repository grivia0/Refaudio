/** Small DOM helpers: no innerHTML for user data, so titles can never inject markup. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function svgNode(paths: string[], options?: { size?: number; filled?: boolean; className?: string }): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const node = document.createElementNS(namespace, 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('width', String(options?.size ?? 22));
  node.setAttribute('height', String(options?.size ?? 22));
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  node.setAttribute('fill', options?.filled ? 'currentColor' : 'none');
  if (!options?.filled) {
    node.setAttribute('stroke', 'currentColor');
    node.setAttribute('stroke-width', '1.8');
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
  }
  if (options?.className) node.setAttribute('class', options.className);
  for (const definition of paths) {
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', definition);
    node.append(path);
  }
  return node;
}

const ICONS = {
  play: ['M8 5.4v13.2L19.2 12z'],
  pause: ['M8.5 5h2.6v14H8.5zM12.9 5h2.6v14h-2.6z'],
  prev: ['M7 5h2v14H7zM19 5.6v12.8L9.6 12z'],
  next: ['M17 5h2v14h-2zM5 5.6v12.8L14.4 12z'],
  shuffle: ['M16 3h5v5', 'M4 20 21 3', 'M21 16v5h-5', 'M15 15l6 6', 'M4 4l5 5'],
  repeat: [
    'M17 2l4 4-4 4',
    'M3 11V9a4 4 0 0 1 4-4h14',
    'M7 22l-4-4 4-4',
    'M21 13v2a4 4 0 0 1-4 4H3',
  ],
  heart: ['M12 20.3s-7.4-4.6-7.4-9.8A4.6 4.6 0 0 1 12 7.2a4.6 4.6 0 0 1 7.4 3.3c0 5.2-7.4 9.8-7.4 9.8z'],
  search: ['M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z', 'M20 20l-4.4-4.4'],
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  down: ['M6 9l6 6 6-6'],
  right: ['M9 6l6 6-6 6'],
  more: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
  queue: ['M4 6h12', 'M4 12h12', 'M4 18h8', 'M18 3v12', 'M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  trash: ['M4 7h16', 'M9 7V4.8h6V7', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
  up: ['M12 19V5', 'M6 11l6-6 6 6'],
  library: ['M9 18V4.6L20 3v13.4', 'M9 18a3 3 0 1 1-3-3', 'M20 16.4a3 3 0 1 1-3-3'],
  playlist: ['M4 6h16', 'M4 12h16', 'M4 18h9', 'M20 14v7', 'M20 21a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z'],
  settings: ['M4 7h9', 'M17 7h3', 'M4 17h4', 'M12 17h8', 'M15 4v6', 'M8 14v6'],
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 17v3h16v-3'],
  download: ['M12 4v12', 'M7 11l5 5 5-5', 'M4 17v3h16v-3'],
  check: ['M5 13l4 4L19 7'],
  wifi: [
    'M2.5 8.5a16 16 0 0 1 19 0',
    'M5.5 12a11 11 0 0 1 13 0',
    'M8.6 15.6a6 6 0 0 1 6.8 0',
    'M12 19h.01',
  ],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7.5V12l3 2'],
  spinner: ['M12 3a9 9 0 0 1 9 9'],
  alert: ['M12 8v5', 'M12 17h.01', 'M10.3 3.9 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, options?: { size?: number; className?: string }): SVGSVGElement {
  const paths = ICONS[name];
  const filled = name === 'play' || name === 'pause' || name === 'prev' || name === 'next';
  return svgNode([...paths], { size: options?.size, filled, className: options?.className });
}

export function button(className: string, label: string, handler: () => void): HTMLButtonElement {
  const node = el('button', className);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.addEventListener('click', (event) => {
    event.preventDefault();
    handler();
  });
  return node;
}

export function iconButton(
  name: IconName,
  label: string,
  handler: () => void,
  className = 'icon-btn',
): HTMLButtonElement {
  const node = button(className, label, handler);
  node.append(icon(name));
  return node;
}

export function on<K extends keyof HTMLElementEventMap>(
  target: EventTarget,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void {
  target.addEventListener(type, handler as EventListener, options);
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function setPressed(node: HTMLElement, pressed: boolean): void {
  node.classList.toggle('is-active', pressed);
  node.setAttribute('aria-pressed', pressed ? 'true' : 'false');
}

export function setText(node: Element | null, text: string): void {
  if (node) node.textContent = text;
}

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
