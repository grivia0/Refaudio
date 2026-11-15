import { getCoverBlob } from '../db';
import type { TrackMeta } from '../types';
import { gradientFor } from '../util';
import { el } from './dom';

/**
 * Cover art is decoded once and shared between the list, mini player and the
 * full player. Object URLs are capped: a library of 1000 covers would otherwise
 * pin hundreds of megabytes of decoded images on a 4 GB phone.
 */
const MAX_CACHED = 48;
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

function evict(): void {
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    const url = cache.get(oldest.value);
    cache.delete(oldest.value);
    if (url) URL.revokeObjectURL(url);
  }
}

export function cachedArtwork(id: string): string | null {
  const url = cache.get(id);
  if (!url) return null;
  // Refresh recency (Map keeps insertion order).
  cache.delete(id);
  cache.set(id, url);
  return url;
}

export function forgetArtwork(id: string): void {
  const url = cache.get(id);
  if (url) {
    cache.delete(id);
    URL.revokeObjectURL(url);
  }
}

export function loadArtwork(id: string): Promise<string | null> {
  const cached = cachedArtwork(id);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(id);
  if (pending) return pending;

  const promise = getCoverBlob(id)
    .then((blob) => {
      inFlight.delete(id);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      cache.set(id, url);
      evict();
      return url;
    })
    .catch(() => {
      inFlight.delete(id);
      return null;
    });

  inFlight.set(id, promise);
  return promise;
}

/** Fills an arbitrary element with a cover or the deterministic gradient. */
export function applyCoverTo(element: HTMLElement, track: TrackMeta): void {
  element.style.backgroundImage = gradientFor(track.id);
  element.style.backgroundSize = 'cover';
  element.style.backgroundPosition = 'center';
  if (!track.hasCover) return;
  const cached = cachedArtwork(track.id);
  if (cached) element.style.backgroundImage = `url(${cached})`;
  void loadArtwork(track.id).then((url) => {
    if (url && element.isConnected) element.style.backgroundImage = `url(${url})`;
  });
}

export type ArtVariant = 'row' | 'mini' | 'hero' | 'card';

export interface ArtNode {
  node: HTMLElement;
  img: HTMLImageElement | null;
}

/** Gradient first (instant, deterministic), embedded cover swapped in when ready. */
export function createArt(track: TrackMeta, variant: ArtVariant): ArtNode {
  const node = el('div', `art art--${variant}`);
  node.style.backgroundImage = gradientFor(track.id);
  node.setAttribute('aria-hidden', 'true');

  if (!track.hasCover) return { node, img: null };

  const img = el('img', 'art__img');
  img.alt = '';
  img.decoding = 'async';
  // A row only exists once it is (nearly) on screen, so lazy loading would just
  // delay the cover and leave the gradient showing.
  img.loading = 'eager';

  // Reveal the cover only after it decoded. Painting the empty <img> earlier is
  // what puts the gradient underneath on screen for a frame or two.
  const reveal = (): void => img.classList.add('is-ready');
  img.addEventListener('load', reveal, { once: true });
  img.addEventListener('error', reveal, { once: true });

  const source = (url: string): void => {
    if (img.getAttribute('src') === url) return;
    img.src = url;
    // Blob URLs from the cache are decoded before the load event can fire.
    if (img.complete && img.naturalWidth > 0) reveal();
  };

  const cached = cachedArtwork(track.id);
  if (cached) source(cached);
  node.append(img);
  void loadArtwork(track.id).then((url) => {
    if (url && img.isConnected) source(url);
  });
  return { node, img };
}
