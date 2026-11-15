import {
  addToQueue,
  addTracksToPlaylist,
  createPlaylist,
  playNextInQueue,
  removeFromPlaylist,
  removeTrackFromLibrary,
} from '../app';
import { state, toggleFavorite } from '../state';
import type { Playlist, TrackMeta } from '../types';
import { formatBytes, formatTime, plural, subtitleFor } from '../util';
import {
  actionSheet,
  confirmDialog,
  detailDialog,
  listSheet,
  promptDialog,
  resetList,
  toast,
} from './overlay';
import { el } from './dom';

export interface TrackMenuOptions {
  /** When set, the track can be removed from this playlist. */
  playlistId?: string;
}

export function openTrackMenu(track: TrackMeta, options: TrackMenuOptions = {}): void {
  const liked = state.favorites.has(track.id);
  actionSheet(track.title, [
    {
      label: liked ? 'Remove from Liked' : 'Add to Liked',
      hint: liked ? '♥' : '♡',
      onSelect: () => {
        void toggleFavorite(track.id).then((nowLiked) => {
          toast(nowLiked ? 'Added to Liked.' : 'Removed from Liked.', 'success');
        });
      },
    },
    {
      label: 'Play next',
      onSelect: () => playNextInQueue(track.id),
    },
    {
      label: 'Add to queue',
      onSelect: () => addToQueue(track.id),
    },
    {
      label: 'Add to playlist…',
      onSelect: () => openPlaylistPicker(track),
    },
    {
      label: 'Track info',
      onSelect: () => openTrackInfo(track),
    },
    ...(options.playlistId
      ? [
          {
            label: 'Remove from this playlist',
            danger: true,
            onSelect: () => {
              void removeFromPlaylist(options.playlistId as string, track.id).then(() => {
                toast('Removed from playlist.', 'success');
              });
            },
          },
        ]
      : []),
    {
      label: 'Delete from library',
      danger: true,
      onSelect: () => {
        void confirmDialog({
          title: 'Delete track?',
          message: `“${track.title}” will be removed from this device. This cannot be undone.`,
          confirmLabel: 'Delete',
          danger: true,
        }).then((confirmed) => {
          if (!confirmed) return;
          void removeTrackFromLibrary(track.id).then(() => toast('Track deleted.', 'success'));
        });
      },
    },
  ]);
}

export function openPlaylistPicker(
  tracks: TrackMeta | TrackMeta[],
  options: { onAdded?: (added: number) => void } = {},
): void {
  const chosen = Array.isArray(tracks) ? tracks : [tracks];
  const ids = chosen.map((track) => track.id);
  const many = ids.length > 1;
  const sheet = listSheet({
    title: many ? `Add ${ids.length} songs` : 'Add to playlist',
    empty: 'No playlists yet.',
  });

  const report = (playlist: Playlist, added: number, created = false) => {
    sheet.close();
    if (created) {
      toast(`Created “${playlist.name}”${added > 1 ? ` with ${added} songs` : ''}.`, 'success');
      options.onAdded?.(added);
      return;
    }
    if (added === 0) {
      toast('Already in that playlist.', 'info');
      return;
    }
    if (!many) toast(`Added to “${playlist.name}”.`, 'success');
    else if (added < ids.length) {
      toast(`Added ${added} of ${ids.length} songs to “${playlist.name}”.`, 'success');
    } else {
      toast(`Added ${added} songs to “${playlist.name}”.`, 'success');
    }
    options.onAdded?.(added);
  };

  const render = () => {
    resetList(sheet.list, 'No playlists yet.', state.playlists.length === 0);
    for (const playlist of state.playlists) {
      const row = el('button', 'file-row');
      row.type = 'button';
      const text = el('span', 'file-row__name', playlist.name);
      const count = el('span', 'file-row__size', `${playlist.trackIds.length}`);
      row.append(text, count);
      row.addEventListener('click', () => {
        void addTracksToPlaylist(playlist.id, ids).then((added) => report(playlist, added));
      });
      sheet.list.append(row);
    }
  };

  const create = el('button', 'btn btn--primary', 'New playlist');
  create.type = 'button';
  create.addEventListener('click', () => {
    void promptDialog({
      title: 'New playlist',
      label: 'Name',
      placeholder: 'Late night drive',
      confirmLabel: 'Create',
    }).then((name) => {
      if (!name) return;
      void createPlaylist(name).then(async (playlist) => {
        const added = await addTracksToPlaylist(playlist.id, ids);
        report({ ...playlist, trackIds: ids }, added, true);
      });
    });
  });
  sheet.footer.append(create);

  render();
}

export function openTrackInfo(track: TrackMeta): void {
  const format = (value: number, suffix: string) => (value > 0 ? `${value} ${suffix}` : '—');
  detailDialog(track.title, [
    ['Artist', track.artist || '—'],
    ['Album artist', track.albumArtist || '—'],
    ['Album', track.album || '—'],
    ['Track', track.trackNo > 0 ? `${track.discNo > 0 ? `${track.discNo}-` : ''}${track.trackNo}` : '—'],
    ['Year', track.year > 0 ? String(track.year) : '—'],
    ['Genre', track.genre || '—'],
    ['Duration', track.duration > 0 ? formatTime(track.duration) : '—'],
    ['Format', subtitleFor([track.codec, track.container])],
    ['Bitrate', format(Math.round(track.bitrate / 1000), 'kbps')],
    ['Sample rate', format(Math.round(track.sampleRate / 1000), 'kHz')],
    ['Channels', format(track.channels, track.channels === 1 ? 'mono' : 'ch')],
    ['File size', formatBytes(track.size)],
    ['File name', track.fileName],
    ['Plays', plural(track.playCount, 'play')],
    ['Added', new Date(track.addedAt).toLocaleDateString()],
  ]);
}
