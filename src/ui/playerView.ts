import { player, saveTransport } from '../app';
import { persist, setState, state, toggleFavorite } from '../state';
import type { TrackMeta } from '../types';
import { formatTime, plural, subtitleFor } from '../util';
import { cachedArtwork, createArt, loadArtwork, type ArtVariant } from './artwork';
import { clear, el, icon, iconButton, on, setPressed, setText } from './dom';
import { actionSheet, listSheet, resetList, toast } from './overlay';
import { openTrackMenu } from './trackMenu';

export interface PlayerUI {
  mini: HTMLElement;
  now: HTMLElement;
  open: () => void;
  close: () => void;
  /** Rebuilds everything from the player's current state. */
  sync: () => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function setArt(host: HTMLElement, track: TrackMeta | undefined, variant: ArtVariant): void {
  clear(host);
  if (!track) return;
  host.append(createArt(track, variant).node);
}

export function createPlayerUI(): PlayerUI {
  /* -------------------------------- mini -------------------------------- */
  const mini = el('div', 'mini');
  mini.hidden = true;

  const miniOpen = el('button', 'mini__open');
  miniOpen.type = 'button';
  miniOpen.setAttribute('aria-label', 'Open player');

  const miniArt = el('div', 'mini__art-slot');
  const miniText = el('div', 'mini__text');
  const miniTitle = el('span', 'mini__title', '');
  const miniSub = el('span', 'mini__subtitle', '');
  miniText.append(miniTitle, miniSub);
  miniOpen.append(miniArt, miniText);

  const miniControls = el('div', 'mini__controls');
  const miniPlay = el('button', 'mini__btn mini__btn--play');
  miniPlay.type = 'button';
  miniPlay.setAttribute('aria-label', 'Play or pause');

  const miniNext = el('button', 'mini__btn');
  miniNext.type = 'button';
  miniNext.setAttribute('aria-label', 'Next track');
  miniNext.append(icon('next', { size: 22 }));
  miniControls.append(miniPlay, miniNext);

  const miniBar = el('span');
  const miniProgress = el('div', 'mini__progress');
  miniProgress.append(miniBar);
  mini.append(miniOpen, miniControls, miniProgress);

  /* ----------------------------- now playing ---------------------------- */
  const now = el('div', 'now');
  now.setAttribute('aria-hidden', 'true');
  now.setAttribute('role', 'dialog');
  now.setAttribute('aria-label', 'Now playing');

  const bg = el('div', 'now__bg');
  const bgImg = el('img');
  bgImg.alt = '';
  bgImg.decoding = 'async';
  bg.append(bgImg);
  now.append(bg, el('div', 'now__grabber'));

  const head = el('div', 'now__head');
  const collapse = iconButton('down', 'Close player', () => close());
  const queueBtn = iconButton('queue', 'Open queue', () => openQueue());
  head.append(collapse, el('span', 'now__heading', 'Now playing'), queueBtn);

  const scroll = el('div', 'now__scroll');
  const artHost = el('div', 'now__artwrap');
  const meta = el('div', 'now__meta');
  const title = el('h1', 'now__title', '');
  const artistBtn = el('button', 'now__artist');
  artistBtn.type = 'button';
  const albumLine = el('span', 'now__album', '');
  meta.append(title, artistBtn, albumLine);

  const seekWrap = el('div', 'now__seek');
  const seek = el('input', 'seek');
  seek.type = 'range';
  seek.min = '0';
  seek.max = '1';
  seek.step = '0.1';
  seek.value = '0';
  seek.setAttribute('aria-label', 'Playback position');
  const times = el('div', 'now__times');
  const elapsed = el('span', undefined, '0:00');
  const remaining = el('span', undefined, '0:00');
  times.append(elapsed, remaining);
  seekWrap.append(seek, times);

  const transport = el('div', 'now__transport');
  const shuffleBtn = el('button', 'now__ctrl');
  shuffleBtn.type = 'button';
  shuffleBtn.setAttribute('aria-label', 'Shuffle');
  shuffleBtn.append(icon('shuffle', { size: 21 }));

  const prevBtn = el('button', 'now__ctrl');
  prevBtn.type = 'button';
  prevBtn.setAttribute('aria-label', 'Previous track');
  prevBtn.append(icon('prev', { size: 28 }));

  const playBtn = el('button', 'now__ctrl now__ctrl--play');
  playBtn.type = 'button';
  playBtn.setAttribute('aria-label', 'Play or pause');

  const nextBtn = el('button', 'now__ctrl');
  nextBtn.type = 'button';
  nextBtn.setAttribute('aria-label', 'Next track');
  nextBtn.append(icon('next', { size: 28 }));

  const repeatBtn = el('button', 'now__ctrl');
  repeatBtn.type = 'button';
  repeatBtn.setAttribute('aria-label', 'Repeat mode');
  repeatBtn.append(icon('repeat', { size: 21 }));
  const repeatBadge = el('span', 'now__badge', '1');
  repeatBadge.hidden = true;
  repeatBtn.append(repeatBadge);

  transport.append(shuffleBtn, prevBtn, playBtn, nextBtn, repeatBtn);

  const extras = el('div', 'now__extras');
  const backBtn = el('button', 'pill', '−15');
  backBtn.type = 'button';
  backBtn.setAttribute('aria-label', 'Back 15 seconds');
  const speedBtn = el('button', 'pill', '1×');
  speedBtn.type = 'button';
  speedBtn.setAttribute('aria-label', 'Playback speed');
  const forwardBtn = el('button', 'pill', '+15');
  forwardBtn.type = 'button';
  forwardBtn.setAttribute('aria-label', 'Forward 15 seconds');
  const likeBtn = el('button', 'pill');
  likeBtn.type = 'button';
  likeBtn.setAttribute('aria-label', 'Like this track');
  extras.append(backBtn, speedBtn, forwardBtn, likeBtn);

  const upSection = el('section', 'now__section');
  const upHead = el('div', 'now__section-head');
  const upTitle = el('span', 'now__section-title', 'Up next');
  const openQueueBtn = el('button', 'now__link', 'Queue');
  openQueueBtn.type = 'button';
  upHead.append(upTitle, openQueueBtn);
  const upNext = el('div', 'now__upnext');
  upSection.append(upHead, upNext);

  scroll.append(artHost, meta, seekWrap, transport, extras, upSection);
  now.append(head, scroll);

  /* ------------------------------ queue sheet --------------------------- */
  let queueSheet: ReturnType<typeof listSheet> | null = null;
  let clearQueueBtn: HTMLButtonElement | null = null;

  function renderQueueSheet(): void {
    if (!queueSheet) return;
    const items = player.orderedQueue;
    resetList(queueSheet.list, 'The queue is empty.', items.length === 0);
    if (!clearQueueBtn) {
      clearQueueBtn = el('button', 'btn btn--ghost', 'Clear queue');
      clearQueueBtn.type = 'button';
      clearQueueBtn.addEventListener('click', () => {
        player.stop();
        queueSheet?.close();
      });
      queueSheet.footer.append(clearQueueBtn);
    }
    clearQueueBtn.hidden = items.length === 0;

    for (const { index, track } of items) {
      const row = el('div', `queue-row${player.index === index ? ' is-current' : ''}`);

      const main = el('button', 'queue-row__main');
      main.type = 'button';
      const { node: art } = createArt(track, 'row');
      const text = el('span', 'row__text');
      text.append(
        el('span', 'row__title', track.title),
        el('span', 'row__sub', subtitleFor([track.artist, track.album])),
      );
      main.append(art, text);
      main.addEventListener('click', () => {
        player.jumpTo(index, true);
      });

      const tools = el('div', 'queue-row__tools');
      const more = el('button', 'queue-tool');
      more.type = 'button';
      more.setAttribute('aria-label', `More options for ${track.title}`);
      more.append(icon('more', { size: 18 }));
      more.addEventListener('click', () => openTrackMenu(track));

      const remove = el('button', 'queue-tool');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${track.title} from the queue`);
      remove.append(icon('close', { size: 16 }));
      remove.addEventListener('click', () => player.removeFromQueue(index));

      tools.append(more, remove);
      row.append(main, tools);
      queueSheet.list.append(row);
    }
  }

  function openQueue(): void {
    if (queueSheet) return;
    queueSheet = listSheet({
      title: 'Queue',
      empty: 'The queue is empty.',
      onClose: () => {
        queueSheet = null;
        clearQueueBtn = null;
      },
    });
    renderQueueSheet();
  }

  queueBtn.addEventListener('click', openQueue);
  openQueueBtn.addEventListener('click', openQueue);

  /* ------------------------------- wiring ------------------------------- */
  miniOpen.addEventListener('click', () => open());
  miniPlay.addEventListener('click', () => player.toggle());
  miniNext.addEventListener('click', () => player.next());
  playBtn.addEventListener('click', () => player.toggle());
  nextBtn.addEventListener('click', () => player.next());
  prevBtn.addEventListener('click', () => player.prev());

  shuffleBtn.addEventListener('click', () => {
    player.toggleShuffle();
    saveTransport();
    sync();
  });

  repeatBtn.addEventListener('click', () => {
    player.cycleRepeat();
    saveTransport();
    sync();
  });

  backBtn.addEventListener('click', () => player.skip(-15));
  forwardBtn.addEventListener('click', () => player.skip(15));

  speedBtn.addEventListener('click', () => {
    actionSheet(
      'Playback speed',
      SPEEDS.map((rate) => ({
        label: rate === 1 ? 'Normal (1×)' : `${rate}×`,
        hint: player.rate === rate ? 'Current' : undefined,
        onSelect: () => {
          player.setRate(rate);
          void persist({ rate });
          sync();
        },
      })),
    );
  });

  likeBtn.addEventListener('click', () => {
    const id = player.currentId;
    if (!id) return;
    void toggleFavorite(id).then((liked) => {
      toast(liked ? 'Added to Liked.' : 'Removed from Liked.', 'success');
      sync();
    });
  });

  artistBtn.addEventListener('click', () => {
    const track = player.currentTrack;
    if (!track) return;
    close();
    setState({ query: track.artist || track.albumArtist, tab: 'library' });
  });

  let seeking = false;
  seek.addEventListener('input', () => {
    seeking = true;
    const duration = player.duration;
    const value = Number(seek.value);
    const pct = duration > 0 ? (value / duration) * 100 : 0;
    seek.style.setProperty('--fill', `${pct.toFixed(2)}%`);
    setText(elapsed, formatTime(value));
    setText(remaining, formatTime(Math.max(0, duration - value)));
  });
  seek.addEventListener('change', () => {
    player.seek(Number(seek.value));
    seeking = false;
    sync();
  });

  /* ----------------------------- presentation --------------------------- */
  function refreshTrack(): void {
    const track = player.currentTrack;
    if (!track) {
      mini.hidden = true;
      now.classList.remove('is-open');
      now.setAttribute('aria-hidden', 'true');
      bgImg.removeAttribute('src');
      clear(miniArt);
      clear(artHost);
      setText(miniTitle, '');
      setText(miniSub, '');
      setText(title, '');
      setText(artistBtn, '');
      setText(albumLine, '');
      return;
    }

    mini.hidden = false;
    setText(miniTitle, track.title);
    setText(miniSub, track.artist || track.album || 'Unknown artist');
    setArt(miniArt, track, 'mini');
    setArt(artHost, track, 'hero');

    setText(title, track.title);
    setText(artistBtn, track.artist || 'Unknown artist');
    const year = track.year > 0 ? String(track.year) : '';
    setText(albumLine, [track.album, year].filter(Boolean).join(' · '));

    const cached = cachedArtwork(track.id);
    if (cached) bgImg.src = cached;
    else bgImg.removeAttribute('src');
    if (track.hasCover) {
      void loadArtwork(track.id).then((url) => {
        if (url && player.currentId === track.id) bgImg.src = url;
      });
    }
  }

  function refreshStateUI(): void {
    const playing = player.isPlaying;
    miniPlay.replaceChildren(icon(playing ? 'pause' : 'play', { size: 24 }));
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play', { size: 30 }));
    miniPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');

    setPressed(shuffleBtn, player.shuffle);
    setPressed(repeatBtn, player.repeat !== 'off');
    repeatBadge.hidden = player.repeat !== 'one';

    const hasTrack = Boolean(player.currentId);
    for (const node of [prevBtn, nextBtn, backBtn, forwardBtn, likeBtn, speedBtn] as HTMLElement[]) {
      node.toggleAttribute('disabled', !hasTrack);
    }

    setText(speedBtn, `${player.rate}×`);

    const id = player.currentId;
    const liked = id ? state.favorites.has(id) : false;
    likeBtn.replaceChildren(icon('heart', { size: 15 }), el('span', undefined, liked ? 'Liked' : 'Like'));
    setPressed(likeBtn, liked);
  }

  function refreshTime(): void {
    const duration = player.duration;
    const position = player.currentTime;
    const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

    if (!seeking) {
      const max = duration > 0 ? duration : 1;
      seek.max = String(max);
      seek.value = String(Math.min(position, max));
      seek.style.setProperty('--fill', `${pct.toFixed(2)}%`);
      setText(elapsed, formatTime(position));
      setText(remaining, formatTime(duration > 0 ? Math.max(0, duration - position) : 0));
    }
    miniBar.style.width = `${pct.toFixed(2)}%`;
  }

  function upNextRow(track: TrackMeta, queueIndex: number): HTMLElement {
    const row = el('div', 'row');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    const { node: art } = createArt(track, 'row');
    const text = el('span', 'row__text');
    text.append(
      el('span', 'row__title', track.title),
      el('span', 'row__sub', track.artist || 'Unknown artist'),
    );
    row.append(art, text, el('span', 'row__meta', formatTime(track.duration)));
    const jump = () => player.jumpTo(queueIndex, true);
    row.addEventListener('click', jump);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        jump();
      }
    });
    return row;
  }

  function refreshUpNext(): void {
    clear(upNext);
    const items = player.upNext.slice(0, 6);
    upTitle.textContent =
      items.length > 0 ? `Up next · ${items.length} ${plural(items.length, 'song')}` : 'Up next';
    if (items.length === 0) {
      upNext.append(el('p', 'empty', 'Nothing queued after this track.'));
      return;
    }
    for (const item of items) upNext.append(upNextRow(item.track, item.index));
  }

  function sync(): void {
    refreshTrack();
    refreshStateUI();
    refreshTime();
    refreshUpNext();
    renderQueueSheet();
  }

  /* --------------------------- open / close ----------------------------- */
  function open(): void {
    if (!player.currentId) return;
    now.classList.add('is-open');
    now.setAttribute('aria-hidden', 'false');
    now.style.transform = '';
    sync();
  }

  function close(): void {
    now.classList.remove('is-open');
    now.setAttribute('aria-hidden', 'true');
    now.style.transform = '';
  }

  let startY: number | null = null;
  on(head, 'touchstart', (event) => {
    startY = event.touches[0]?.clientY ?? null;
  }, { passive: true });
  on(head, 'touchmove', (event) => {
    if (startY === null) return;
    const dy = (event.touches[0]?.clientY ?? startY) - startY;
    if (dy <= 0) return;
    now.style.transition = 'none';
    now.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  on(head, 'touchend', (event) => {
    if (startY === null) return;
    const dy = (event.changedTouches[0]?.clientY ?? startY) - startY;
    now.style.transition = '';
    now.style.transform = '';
    startY = null;
    if (dy > 90) close();
  });

  on(document, 'keydown', (event) => {
    if (event.key === 'Escape' && now.classList.contains('is-open')) close();
  });

  player.on('track', () => {
    refreshTrack();
    refreshUpNext();
    renderQueueSheet();
  });
  player.on('state', refreshStateUI);
  player.on('time', refreshTime);
  player.on('queue', () => {
    refreshUpNext();
    renderQueueSheet();
  });

  return { mini, now, open, close, sync };
}
