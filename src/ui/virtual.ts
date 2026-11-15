import { clear, el, on } from './dom';

export interface VirtualListOptions<T> {
  scroller: HTMLElement;
  render: (item: T, index: number) => HTMLElement;
  heightFor?: (item: T, index: number) => number;
  overscan?: number;
}

/**
 * Fixed-height virtualization with per-item heights (album headers are shorter
 * than track rows). Only the visible window exists in the DOM.
 *
 * Rows that stay inside the window are *kept*, never rebuilt: replacing a row
 * means a new <img> for its cover, and while that image decodes the gradient
 * placeholder shows through — which read as flickering artwork on a phone.
 */
export class VirtualList<T> {
  private scroller: HTMLElement;
  private spacer: HTMLElement;
  private renderRow: (item: T, index: number) => HTMLElement;
  private heightFor: (item: T, index: number) => number;
  private overscan: number;
  private items: T[] = [];
  private offsets: number[] = [];
  private heights: number[] = [];
  /** Index → mounted row, so a scroll only creates rows entering the window. */
  private mounted = new Map<number, HTMLElement>();
  private totalHeight = 0;
  private frame = 0;
  private destroyed = false;

  private handleScroll = () => this.schedule();

  constructor(options: VirtualListOptions<T>) {
    this.scroller = options.scroller;
    this.renderRow = options.render;
    this.heightFor = options.heightFor ?? (() => 64);
    this.overscan = options.overscan ?? 200;

    this.spacer = el('div', 'vlist');
    this.scroller.append(this.spacer);
    on(this.scroller, 'scroll', this.handleScroll, { passive: true });
    on(window, 'resize', this.handleScroll);
  }

  setItems(items: T[]): void {
    this.items = items;
    this.measure();
    this.spacer.style.height = `${this.totalHeight}px`;
    if (this.scroller.scrollTop > this.totalHeight) this.scroller.scrollTop = 0;
    // New rows may hold different tracks (or a different selection state), so
    // the old nodes cannot be reused.
    this.reset();
    this.render();
  }

  refresh(): void {
    this.measure();
    this.spacer.style.height = `${this.totalHeight}px`;
    this.reset();
    this.render();
  }

  scrollToTop(): void {
    this.scroller.scrollTop = 0;
    this.schedule();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.scroller.removeEventListener('scroll', this.handleScroll);
    window.removeEventListener('resize', this.handleScroll);
    this.mounted.clear();
    this.spacer.remove();
  }

  private reset(): void {
    this.mounted.clear();
    clear(this.spacer);
  }

  private measure(): void {
    this.heights = new Array<number>(this.items.length);
    this.offsets = new Array<number>(this.items.length);
    let offset = 0;
    for (let index = 0; index < this.items.length; index += 1) {
      const height = this.heightFor(this.items[index], index);
      this.heights[index] = height;
      this.offsets[index] = offset;
      offset += height;
    }
    this.totalHeight = offset;
  }

  private schedule(): void {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  /** Index of the last row whose top edge is at or above `y`. */
  private indexAt(y: number): number {
    let low = 0;
    let high = this.offsets.length - 1;
    let found = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (this.offsets[middle] <= y) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  }

  private render(): void {
    if (this.destroyed) return;
    if (this.items.length === 0) {
      this.reset();
      return;
    }

    const top = this.scroller.scrollTop;
    const viewport = this.scroller.clientHeight || 640;
    const start = Math.max(0, this.indexAt(Math.max(0, top - this.overscan)) - 1);
    const rawEnd = this.indexAt(top + viewport + this.overscan) + 1;
    const end = Math.min(this.items.length - 1, rawEnd);

    // Drop only the rows that left the window; the rest keep their nodes (and
    // their decoded cover images) while the user scrolls.
    for (const [index, row] of this.mounted) {
      if (index < start || index > end) {
        row.remove();
        this.mounted.delete(index);
      }
    }

    const fragment = document.createDocumentFragment();
    for (let index = start; index <= end; index += 1) {
      if (this.mounted.has(index)) continue;
      const row = this.renderRow(this.items[index], index);
      row.style.position = 'absolute';
      row.style.top = `${this.offsets[index]}px`;
      row.style.left = '0';
      row.style.right = '0';
      row.style.height = `${this.heights[index]}px`;
      row.dataset.index = String(index);
      this.mounted.set(index, row);
      fragment.append(row);
    }
    this.spacer.append(fragment);
  }
}
