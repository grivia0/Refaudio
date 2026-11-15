/** Toggles the no-blur palette used by Settings → Appearance. */
export function applyReduceTransparency(value: boolean): void {
  document.documentElement.classList.toggle('reduce-transparency', value);
}
