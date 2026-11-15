import {
  DEFAULT_SETTINGS,
  allPlaylists,
  allTracks,
  loadSettings,
  requestPersistence,
  saveSettings,
} from './db';
import type { GroupMode, PersistedSettings, Playlist, SortKey, TrackMeta } from './types';

export type TabKey = 'library' | 'playlists' | 'settings';

export interface AppState {
  ready: boolean;
  tracks: TrackMeta[];
  byId: Map<string, TrackMeta>;
  playlists: Playlist[];
  favorites: Set<string>;
  recent: string[];
  settings: PersistedSettings;
  tab: TabKey;
  query: string;
  sort: SortKey;
  group: GroupMode;
}

export const state: AppState = {
  ready: false,
  tracks: [],
  byId: new Map(),
  playlists: [],
  favorites: new Set(),
  recent: [],
  settings: { ...DEFAULT_SETTINGS },
  tab: 'library',
  query: '',
  sort: DEFAULT_SETTINGS.sort,
  group: DEFAULT_SETTINGS.group,
};

type Listener = (state: AppState) => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify(): void {
  for (const listener of listeners) listener(state);
}

export function setState(patch: Partial<AppState>): void {
  Object.assign(state, patch);
  notify();
}

/** Persists settings and mirrors them into the live state. */
export async function persist(patch: Partial<PersistedSettings>): Promise<void> {
  state.settings = { ...state.settings, ...patch };
  if (patch.favorites) state.favorites = new Set(patch.favorites);
  if (patch.recent) state.recent = patch.recent;
  await saveSettings(state.settings);
}

export async function bootstrapState(): Promise<void> {
  const [tracks, playlists, settings] = await Promise.all([
    allTracks(),
    allPlaylists(),
    loadSettings(),
  ]);

  state.tracks = tracks.sort((a, b) => b.addedAt - a.addedAt);
  state.byId = new Map(tracks.map((track) => [track.id, track]));
  state.playlists = playlists.sort((a, b) => a.name.localeCompare(b.name));
  state.settings = settings;
  state.favorites = new Set(settings.favorites);
  state.recent = settings.recent;
  state.sort = settings.sort;
  state.group = settings.group;
  state.ready = true;

  void requestPersistence();
  notify();
}

/** Re-reads the library after imports/deletes/backup restores. */
export async function refreshLibrary(): Promise<void> {
  const [tracks, playlists] = await Promise.all([allTracks(), allPlaylists()]);
  state.tracks = tracks.sort((a, b) => b.addedAt - a.addedAt);
  state.byId = new Map(tracks.map((track) => [track.id, track]));
  state.playlists = playlists.sort((a, b) => a.name.localeCompare(b.name));
  notify();
}

export function trackOf(id: string | null | undefined): TrackMeta | undefined {
  return id ? state.byId.get(id) : undefined;
}

export function pushRecent(id: string): void {
  const recent = [id, ...state.recent.filter((value) => value !== id)].slice(0, 100);
  void persist({ recent });
}

export async function toggleFavorite(id: string): Promise<boolean> {
  const favorites = new Set(state.favorites);
  const nowFavorite = !favorites.has(id);
  if (nowFavorite) favorites.add(id);
  else favorites.delete(id);
  await persist({ favorites: [...favorites] });
  notify();
  return nowFavorite;
}
