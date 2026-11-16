import { Player } from './audio/player';
import { bindActions } from './audio/mediaSession';
import { configureAudioSession } from './audio/session';
import { deletePlaylist, deleteTracks, putPlaylist, recordPlay } from './db';
import { persist, pushRecent, refreshLibrary, state, trackOf } from './state';
import type { Playlist } from './types';
import { forgetArtwork } from './ui/artwork';
import { toast } from './ui/overlay';
import { newId } from './util';

export const player = new Player({
  getTrack: (id) => trackOf(id),
  onError: (message) => toast(message, 'error'),
  onPersist: (snapshot) => {
    state.settings = { ...state.settings, playback: snapshot };
    void persist({ playback: snapshot });
  },
  onPlayed: (id) => {
    void recordPlay(id).then((track) => {
      if (!track) return;
      state.byId.set(id, track);
      const index = state.tracks.findIndex((entry) => entry.id === id);
      if (index >= 0) state.tracks[index] = track;
    });
    pushRecent(id);
  },
});

/* ------------------------------- playback ----------------------------- */

/** Re-applies stored volume/rate/shuffle/repeat and the last queue. */
export function restorePlayer(): void {
  configureAudioSession();
  player.shuffle = state.settings.shuffle;
  player.repeat = state.settings.repeat;
  player.rate = state.settings.rate;
  player.volume = state.settings.volume;
  bindActions(player);
  if (state.settings.playback && state.byId.size > 0) player.restore(state.settings.playback);
}

export function saveTransport(): void {
  void persist({ shuffle: player.shuffle, repeat: player.repeat, rate: player.rate });
}

export function playCollection(ids: string[], startId?: string): void {
  const playable = ids.filter((id) => state.byId.has(id));
  if (playable.length === 0) {
    toast('Nothing to play yet — add some music first.');
    return;
  }
  const start = startId ? Math.max(0, playable.indexOf(startId)) : 0;
  player.setQueue(playable, start, true);
  saveTransport();
}

export function playNextInQueue(trackId: string): void {
  if (player.queue.length === 0) {
    playCollection([trackId], trackId);
    return;
  }
  const added = player.addNext(trackId);
  toast(added ? 'Up next.' : 'Already in the queue.', added ? 'success' : 'info');
}

export function addToQueue(trackId: string): void {
  if (player.queue.length === 0) {
    playCollection([trackId], trackId);
    return;
  }
  const added = player.addLast(trackId);
  toast(added ? 'Added to the queue.' : 'Already in the queue.', added ? 'success' : 'info');
}

/**
 * Queues a whole selection at once. Returns what happened so the caller can
 * phrase the toast; `started` is true when an empty queue began playing.
 */
export function addManyToQueue(ids: string[]): { added: number; started: boolean } {
  const unique = [...new Set(ids)].filter((id) => state.byId.has(id));
  if (unique.length === 0) return { added: 0, started: false };
  if (player.queue.length === 0) {
    playCollection(unique, unique[0]);
    return { added: unique.length, started: true };
  }
  return { added: player.addMany(unique), started: false };
}

/* ------------------------------- playlists ---------------------------- */

export async function createPlaylist(name: string): Promise<Playlist> {
  const now = Date.now();
  const playlist: Playlist = {
    id: newId('pl'),
    name,
    trackIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await putPlaylist(playlist);
  await refreshLibrary();
  return playlist;
}

/**
 * Adds many tracks in one write. Returns how many were new, so the caller can
 * report "added 8 of 10 — some were already there".
 */
export async function addTracksToPlaylist(playlistId: string, ids: string[]): Promise<number> {
  const playlist = state.playlists.find((entry) => entry.id === playlistId);
  if (!playlist) return 0;

  const existing = new Set(playlist.trackIds);
  const fresh = ids.filter((id) => state.byId.has(id) && !existing.has(id));
  if (fresh.length === 0) return 0;

  await putPlaylist({
    ...playlist,
    trackIds: [...playlist.trackIds, ...fresh],
    updatedAt: Date.now(),
  });
  await refreshLibrary();
  return fresh.length;
}

export async function removeFromPlaylist(playlistId: string, trackId: string): Promise<void> {
  const playlist = state.playlists.find((entry) => entry.id === playlistId);
  if (!playlist) return;
  await putPlaylist({
    ...playlist,
    trackIds: playlist.trackIds.filter((id) => id !== trackId),
    updatedAt: Date.now(),
  });
  await refreshLibrary();
}

export async function renamePlaylist(playlistId: string, name: string): Promise<void> {
  const playlist = state.playlists.find((entry) => entry.id === playlistId);
  if (!playlist) return;
  await putPlaylist({ ...playlist, name, updatedAt: Date.now() });
  await refreshLibrary();
}

export async function removePlaylist(playlistId: string): Promise<void> {
  await deletePlaylist(playlistId);
  await refreshLibrary();
}

/* -------------------------------- library ----------------------------- */

/** Removes one track everywhere; the multi-selection path shares the same code. */
export async function removeTrackFromLibrary(id: string): Promise<void> {
  await removeTracksFromLibrary([id]);
}

/**
 * Deletes many tracks with one queue update, one DB transaction and one refresh.
 * Queue, playlists, favourites and recents are all cleaned up.
 */
export async function removeTracksFromLibrary(ids: string[]): Promise<number> {
  const gone = [...new Set(ids)].filter((id) => state.byId.has(id));
  if (gone.length === 0) return 0;

  player.removeMany(gone);
  for (const id of gone) forgetArtwork(id);
  await deleteTracks(gone);

  const removed = new Set(gone);
  for (const playlist of state.playlists.filter((entry) => entry.trackIds.some((id) => removed.has(id)))) {
    await putPlaylist({
      ...playlist,
      trackIds: playlist.trackIds.filter((id) => !removed.has(id)),
      updatedAt: Date.now(),
    });
  }

  const favorites = [...state.favorites].filter((id) => !removed.has(id));
  const recent = state.recent.filter((id) => !removed.has(id));
  state.favorites = new Set(favorites);
  await persist({ favorites, recent });
  await refreshLibrary();
  return gone.length;
}
