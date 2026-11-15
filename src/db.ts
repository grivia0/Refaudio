import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PersistedSettings, Playlist, TrackMeta } from './types';

interface RefaudioDB extends DBSchema {
  tracks: { key: string; value: TrackMeta; indexes: { 'by-added': number } };
  audio: { key: string; value: Blob };
  covers: { key: string; value: Blob };
  playlists: { key: string; value: Playlist };
  settings: { key: string; value: unknown };
}

const DB_NAME = 'refaudio';
const DB_VERSION = 1;
const SETTINGS_KEY = 'app';

export const DEFAULT_SETTINGS: PersistedSettings = {
  inboxUrl: '',
  sort: 'added',
  group: 'none',
  shuffle: false,
  repeat: 'off',
  rate: 1,
  volume: 1,
  favorites: [],
  recent: [],
  installTipDismissed: false,
  reduceTransparency: false,
  playback: null,
};

let handle: Promise<IDBPDatabase<RefaudioDB>> | null = null;

export function db(): Promise<IDBPDatabase<RefaudioDB>> {
  if (!handle) {
    handle = openDB<RefaudioDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const tracks = database.createObjectStore('tracks', { keyPath: 'id' });
        tracks.createIndex('by-added', 'addedAt');
        database.createObjectStore('audio');
        database.createObjectStore('covers');
        database.createObjectStore('playlists', { keyPath: 'id' });
        database.createObjectStore('settings');
      },
      blocking() {
        void handle?.then((database) => database.close()).catch(() => undefined);
        handle = null;
      },
    });
  }
  return handle;
}

/* ------------------------------ tracks ------------------------------ */

export async function allTracks(): Promise<TrackMeta[]> {
  const database = await db();
  return database.getAll('tracks');
}

export async function trackIds(): Promise<Set<string>> {
  const database = await db();
  return new Set(await database.getAllKeys('tracks'));
}

/** Writes metadata, audio bytes and cover art in a single transaction. */
export async function addTrack(track: TrackMeta, audio: Blob, cover: Blob | null): Promise<void> {
  const database = await db();
  const tx = database.transaction(['tracks', 'audio', 'covers'], 'readwrite');
  await tx.objectStore('tracks').put(track);
  await tx.objectStore('audio').put(audio, track.id);
  if (cover) await tx.objectStore('covers').put(cover, track.id);
  await tx.done;
}

export async function getAudioBlob(id: string): Promise<Blob | undefined> {
  const database = await db();
  return database.get('audio', id);
}

export async function getCoverBlob(id: string): Promise<Blob | undefined> {
  const database = await db();
  return database.get('covers', id);
}

export async function deleteTracks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const database = await db();
  const tx = database.transaction(['tracks', 'audio', 'covers'], 'readwrite');
  const tracks = tx.objectStore('tracks');
  const audio = tx.objectStore('audio');
  const covers = tx.objectStore('covers');
  // Fire every delete in the same task so the transaction cannot auto-commit.
  const requests: Array<Promise<unknown>> = [];
  for (const id of ids) {
    requests.push(tracks.delete(id), audio.delete(id), covers.delete(id));
  }
  await Promise.all(requests);
  await tx.done;
}

/** Bumps the play counters; the caller refreshes the in-memory copy. */
export async function recordPlay(id: string): Promise<TrackMeta | undefined> {
  const database = await db();
  const tx = database.transaction('tracks', 'readwrite');
  const track = await tx.store.get(id);
  if (!track) {
    await tx.done;
    return undefined;
  }
  track.playCount += 1;
  track.lastPlayedAt = Date.now();
  await tx.store.put(track);
  await tx.done;
  return track;
}

export async function clearLibrary(): Promise<void> {
  const database = await db();
  const tx = database.transaction(['tracks', 'audio', 'covers'], 'readwrite');
  await Promise.all([
    tx.objectStore('tracks').clear(),
    tx.objectStore('audio').clear(),
    tx.objectStore('covers').clear(),
  ]);
  await tx.done;
}

/* ----------------------------- playlists ---------------------------- */

export async function allPlaylists(): Promise<Playlist[]> {
  const database = await db();
  return database.getAll('playlists');
}

export async function putPlaylist(playlist: Playlist): Promise<void> {
  const database = await db();
  await database.put('playlists', playlist);
}

export async function deletePlaylist(id: string): Promise<void> {
  const database = await db();
  await database.delete('playlists', id);
}

/* ----------------------------- settings ----------------------------- */

export async function loadSettings(): Promise<PersistedSettings> {
  const database = await db();
  const stored = (await database.get('settings', SETTINGS_KEY)) as Partial<PersistedSettings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function saveSettings(settings: PersistedSettings): Promise<void> {
  const database = await db();
  await database.put('settings', settings, SETTINGS_KEY);
}

/* ------------------------------ storage ----------------------------- */

export interface StorageState {
  usage: number;
  quota: number;
  persisted: boolean;
}

export async function storageState(): Promise<StorageState | null> {
  if (!navigator.storage) return null;
  try {
    const estimate: StorageEstimate = (await navigator.storage.estimate?.()) ?? {};
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
      persisted,
    };
  } catch {
    return null;
  }
}

/** Asks Safari to keep this origin's data out of the eviction pool. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
