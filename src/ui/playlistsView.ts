import { createPlaylist, playCollection, removePlaylist, renamePlaylist } from '../app';
import { state } from '../state';
import type { Playlist, TrackMeta } from '../types';
import { formatTime, plural, shuffled } from '../util';
import { applyCoverTo } from './artwork';
import { clear, el, icon, iconButton } from './dom';
import { actionSheet, confirmDialog, promptDialog, toast } from './overlay';
import { createTrackRow } from './trackRow';
import { VirtualList } from './virtual';

export interface PlaylistsView {
  node: HTMLElement;
  update: () => void;
}

function playlistTracks(playlist: Playlist): TrackMeta[] {
  return playlist.trackIds
    .map((id) => state.byId.get(id))
    .filter((track): track is TrackMeta => track !== undefined);
}

export function createPlaylistsView(): PlaylistsView {
  const view = el('section', 'view');
  view.id = 'view-playlists';

  /* ------------------------------- list pane ---------------------------- */
  const listPane = el('div', 'pane');
  const head = el('div', 'view-head');
  const headText = el('div');
  headText.append(el('h1', 'view-title', 'Playlists'));

  const addBtn = el('button', 'chip chip--accent');
  addBtn.type = 'button';
  addBtn.append(icon('plus', { size: 14 }), el('span', undefined, 'New playlist'));
  addBtn.addEventListener('click', () => {
    void promptDialog({
      title: 'New playlist',
      label: 'Name',
      placeholder: 'Late night drive',
      confirmLabel: 'Create',
    }).then((name) => {
      if (!name) return;
      void createPlaylist(name).then((playlist) => {
        toast(`Created “${playlist.name}”.`, 'success');
        openPlaylist(playlist.id);
      });
    });
  });

  head.append(headText, addBtn);
  const listScroller = el('div', 'scroller');
  const listEmpty = el('p', 'empty', 'Playlists you create will appear here. Tap “New playlist” to start one.');
  listPane.append(head, listEmpty, listScroller);

  /* ------------------------------ detail pane --------------------------- */
  const detailPane = el('div', 'pane');
  const detailHead = el('div', 'detail-head');
  const backBtn = iconButton('right', 'Back to playlists', () => backToPlaylists());
  backBtn.style.transform = 'rotate(180deg)';

  const detailText = el('div', 'detail-head__text');
  const detailTitle = el('h2', 'detail-head__title', '');
  const detailSub = el('p', 'detail-head__sub', '');
  detailText.append(detailTitle, detailSub);

  const playBtn = el('button', 'icon-btn icon-btn--accent');
  playBtn.type = 'button';
  playBtn.setAttribute('aria-label', 'Play playlist');
  playBtn.append(icon('play', { size: 20 }));

  const menuBtn = iconButton('more', 'Playlist options', () => openPlaylistMenu());
  detailHead.append(backBtn, detailText, playBtn, menuBtn);

  const detailScroller = el('div', 'scroller');
  const detailEmpty = el(
    'p',
    'empty',
    'This playlist is empty. Open the Library, tap “Select”, tick some songs and choose “Playlist”.',
  );

  detailPane.append(detailHead, detailEmpty, detailScroller);

  view.append(listPane, detailPane);

  let openId: string | null = null;
  let queue: string[] = [];

  const detailList = new VirtualList<TrackMeta>({
    scroller: detailScroller,
    heightFor: () => 64,
    render: (track) =>
      createTrackRow({
        track,
        queue,
        playlistId: openId ?? undefined,
      }),
  });

  /* ------------------------------ rendering ----------------------------- */
  function fillCover(container: HTMLElement, tracks: TrackMeta[]): void {
    for (let index = 0; index < 4; index += 1) {
      const track = tracks[index];
      const cell = el('div', `pl-cover__cell${track ? '' : ' pl-cover__cell--empty'}`);
      if (track) applyCoverTo(cell, track);
      container.append(cell);
    }
  }

  function renderList(): void {
    listPane.hidden = false;
    detailPane.hidden = true;

    const hasPlaylists = state.playlists.length > 0;
    listEmpty.hidden = hasPlaylists;
    listScroller.hidden = !hasPlaylists;
    clear(listScroller);
    if (!hasPlaylists) return;

    for (const playlist of state.playlists) {
      const tracks = playlistTracks(playlist);
      const card = el('button', 'pl-card');
      card.type = 'button';

      const cover = el('div', 'pl-cover');
      fillCover(cover, tracks);

      const text = el('div', 'pl-card__text');
      const total = tracks.reduce((sum, track) => sum + track.duration, 0);
      text.append(
        el('div', 'pl-card__name', playlist.name),
        el(
          'div',
          'pl-card__meta',
          tracks.length > 0
            ? `${tracks.length} ${plural(tracks.length, 'song')} · ${formatTime(total)}`
            : 'Empty playlist',
        ),
      );

      const chevron = el('span');
      chevron.style.color = 'var(--text-faint)';
      chevron.append(icon('right', { size: 18 }));

      card.append(cover, text, chevron);
      card.addEventListener('click', () => openPlaylist(playlist.id));
      listScroller.append(card);
    }
  }

  function renderDetail(playlist: Playlist): void {
    listPane.hidden = true;
    detailPane.hidden = false;

    const tracks = playlistTracks(playlist);
    queue = tracks.map((track) => track.id);
    detailTitle.textContent = playlist.name;
    const total = tracks.reduce((sum, track) => sum + track.duration, 0);
    detailSub.textContent =
      tracks.length > 0
        ? `${tracks.length} ${plural(tracks.length, 'song')} · ${formatTime(total)}`
        : 'Empty playlist';

    detailEmpty.hidden = tracks.length > 0;
    detailScroller.hidden = tracks.length === 0;
    detailList.setItems(tracks);
    playBtn.disabled = tracks.length === 0;
    playBtn.style.opacity = tracks.length === 0 ? '0.4' : '1';
  }

  function openPlaylist(id: string): void {
    openId = id;
    const playlist = state.playlists.find((entry) => entry.id === id);
    if (!playlist) {
      openId = null;
      renderList();
      return;
    }
    renderDetail(playlist);
    detailScroller.scrollTop = 0;
  }

  function backToPlaylists(): void {
    openId = null;
    renderList();
  }

  function playAll(): void {
    if (queue.length === 0) {
      toast('This playlist is empty.');
      return;
    }
    playCollection(queue, queue[0]);
  }

  function shufflePlay(): void {
    if (queue.length === 0) {
      toast('This playlist is empty.');
      return;
    }
    const ids = shuffled(queue);
    playCollection(ids, ids[0]);
  }

  function openPlaylistMenu(): void {
    const playlist = openId ? state.playlists.find((entry) => entry.id === openId) : undefined;
    if (!playlist) return;

    actionSheet(playlist.name, [
      { label: 'Play', onSelect: () => playAll() },
      { label: 'Shuffle', onSelect: () => shufflePlay() },
      {
        label: 'Rename',
        onSelect: () => {
          void promptDialog({
            title: 'Rename playlist',
            label: 'Name',
            value: playlist.name,
            confirmLabel: 'Save',
          }).then((name) => {
            if (!name) return;
            void renamePlaylist(playlist.id, name).then(() => toast('Playlist renamed.', 'success'));
          });
        },
      },
      {
        label: 'Delete playlist',
        danger: true,
        onSelect: () => {
          void confirmDialog({
            title: 'Delete playlist?',
            message: `“${playlist.name}” will be deleted. The songs stay in your library.`,
            confirmLabel: 'Delete',
            danger: true,
          }).then((confirmed) => {
            if (!confirmed) return;
            void removePlaylist(playlist.id).then(() => {
              backToPlaylists();
              toast('Playlist deleted.', 'success');
            });
          });
        },
      },
    ]);
  }

  playBtn.addEventListener('click', () => playAll());

  const update = (): void => {
    const playlist = openId ? state.playlists.find((entry) => entry.id === openId) : undefined;
    if (openId && !playlist) openId = null;
    if (openId && playlist) renderDetail(playlist);
    else renderList();
  };

  return { node: view, update };
}
