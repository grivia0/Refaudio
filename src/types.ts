export type RepeatMode = 'off' | 'all' | 'one';
export type SortKey = 'added' | 'title' | 'artist' | 'album' | 'duration';
export type GroupMode = 'none' | 'album' | 'artist';
export type ImportSource = 'picker' | 'inbox' | 'backup';

/** Everything we keep in IndexedDB about a track. Audio bytes live elsewhere. */
export interface TrackMeta {
  id: string;
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  genre: string;
  year: number;
  trackNo: number;
  discNo: number;
  /** Seconds. 0 when unknown. */
  duration: number;
  codec: string;
  container: string;
  bitrate: number;
  sampleRate: number;
  channels: number;
  /** Bytes of the original file. */
  size: number;
  mimeType: string;
  fileName: string;
  addedAt: number;
  playCount: number;
  lastPlayedAt: number;
  hasCover: boolean;
  source: ImportSource;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PlaybackSnapshot {
  trackId: string | null;
  position: number;
  queue: string[];
  index: number;
}

export interface PersistedSettings {
  inboxUrl: string;
  sort: SortKey;
  group: GroupMode;
  shuffle: boolean;
  repeat: RepeatMode;
  rate: number;
  volume: number;
  favorites: string[];
  recent: string[];
  installTipDismissed: boolean;
  reduceTransparency: boolean;
  playback: PlaybackSnapshot | null;
}

/** Payload returned by the metadata worker. */
export interface ParsedMeta {
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  genre: string;
  year: number;
  trackNo: number;
  discNo: number;
  duration: number;
  codec: string;
  container: string;
  bitrate: number;
  sampleRate: number;
  channels: number;
}

export interface ParseResponse {
  key: string;
  ok: boolean;
  meta?: ParsedMeta;
  cover?: { type: string; buffer: ArrayBuffer } | null;
  error?: string;
}
