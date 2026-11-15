import { playCollection, player } from '../app';
import type { TrackMeta } from '../types';
import { formatTime } from '../util';
import { createArt } from './artwork';
import { el, icon } from './dom';
import { openTrackMenu } from './trackMenu';

export interface TrackRowOptions {
  track: TrackMeta;
  /** Ids of everything currently listed; tapping a row queues exactly this list. */
  queue: string[];
  /** Set when the row lives inside a playlist, so the menu can remove it. */
  playlistId?: string;
  /** Rows in the queue sheet show their position instead of the duration. */
  meta?: string;
  /** Selection mode: a tap toggles the tick instead of starting playback. */
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

/** One tappable track row with artwork, duration and a ⋯ menu. */
export function createTrackRow(options: TrackRowOptions): HTMLElement {
  const { track, queue, playlistId, selectable = false, selected = false } = options;

  const node = el('div', selectable ? 'row row--selectable' : 'row');
  node.setAttribute('role', 'button');
  node.tabIndex = 0;
  if (player.currentId === track.id) node.classList.add('is-current');

  const check = el('span', 'row__check');
  check.setAttribute('aria-hidden', 'true');
  check.append(icon('check', { size: 14 }));

  const { node: art } = createArt(track, 'row');
  const text = el('span', 'row__text');
  text.append(
    el('span', 'row__title', track.title),
    el('span', 'row__sub', track.artist || track.album || 'Unknown artist'),
  );

  const meta = el(
    'span',
    'row__meta',
    options.meta ?? (track.duration > 0 ? formatTime(track.duration) : ''),
  );

  const more = el('button', 'row__more');
  more.type = 'button';
  more.setAttribute('aria-label', `More options for ${track.title}`);
  more.append(icon('more'));
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    openTrackMenu(track, { playlistId });
  });

  const toggle = () => options.onSelect?.(track.id);
  node.append(check, art, text, meta, more);

  if (selectable) {
    node.classList.toggle('is-selected', selected);
    node.setAttribute('aria-pressed', selected ? 'true' : 'false');
    node.addEventListener('click', toggle);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
    return node;
  }

  const play = () => playCollection(queue, track.id);
  node.addEventListener('click', play);
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      play();
    }
  });

  // Long-press opens the same menu as the ⋯ button (an iOS habit).
  let holdTimer = 0;
  node.addEventListener(
    'touchstart',
    () => {
      holdTimer = window.setTimeout(() => openTrackMenu(track, { playlistId }), 500);
    },
    { passive: true },
  );
  const clearHold = () => window.clearTimeout(holdTimer);
  node.addEventListener('touchend', clearHold);
  node.addEventListener('touchmove', clearHold, { passive: true });

  return node;
}
