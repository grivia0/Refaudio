import { isEditable } from './dom';

/**
 * iOS lays a freshly launched home-screen app out for a stale viewport: until
 * something forces a re-layout the shell ends up a few dozen pixels short and
 * the tab bar floats above the home indicator. Navigating the list fixes it,
 * because the bounce fires a resize — this keeps that from being necessary.
 *
 * The measured height is published as `--app-vh` (see app.css). It is polled for
 * the first seconds after launch, then kept in sync by the resize-ish events.
 */
const SETTLE_FRAMES = 120;

export function watchViewportHeight(): void {
  const root = document.documentElement;
  let applied = -1;

  const apply = (): void => {
    // iOS does not resize the layout viewport for the keyboard, but Android and
    // desktop browsers do; shrinking the whole shell while a search field is
    // focused would be worse than a stale pixel.
    if (isEditable(document.activeElement)) return;
    const height = Math.round(window.innerHeight);
    if (height <= 0 || height === applied) return;
    applied = height;
    root.style.setProperty('--app-vh', `${height}px`);
  };

  apply();

  // The launch animation ends a moment later; keep re-reading until it settles.
  let frames = 0;
  const settle = (): void => {
    apply();
    frames += 1;
    if (frames < SETTLE_FRAMES) requestAnimationFrame(settle);
  };
  requestAnimationFrame(settle);

  // `on()` is typed for element events only, and these are window/document ones.
  const listen = (target: EventTarget, type: string): void => {
    target.addEventListener(type, apply);
  };
  listen(window, 'resize');
  listen(window, 'orientationchange');
  listen(window, 'pageshow');
  if (window.visualViewport) listen(window.visualViewport, 'resize');
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) apply();
  });
  // The keyboard hides after the field blurs, so that resize lands too early.
  document.addEventListener('focusout', () => window.setTimeout(apply, 150));
}
