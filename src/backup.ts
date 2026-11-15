import { Zip, ZipPassThrough, strFromU8, strToU8, unzip, type Unzipped } from 'fflate';
import {
  addTrack,
  allPlaylists,
  allTracks,
  getAudioBlob,
  getCoverBlob,
  putPlaylist,
  trackIds,
} from './db';
import type { Playlist, TrackMeta } from './types';
import { extensionForMime, guessMime, yieldToUi } from './util';

const BACKUP_VERSION = 1;

export interface BackupManifest {
  app: 'refaudio';
  version: number;
  createdAt: number;
  tracks: TrackMeta[];
  playlists: Playlist[];
  favorites: string[];
  recent: string[];
}

export interface BackupProgress {
  phase: 'reading' | 'zipping' | 'writing' | 'done';
  done: number;
  total: number;
  bytes: number;
  current: string;
}

export interface BackupResult {
  added: number;
  skipped: number;
  missing: number;
  playlists: number;
  favorites: string[];
  recent: string[];
}

export interface ExportOptions {
  favorites: string[];
  recent: string[];
  onProgress?: (progress: BackupProgress) => void;
}

export interface ImportOptions {
  onProgress?: (done: number, total: number) => void;
}

function audioPath(track: TrackMeta, type: string): string {
  return `audio/${track.id}.${extensionForMime(type || track.mimeType)}`;
}

/**
 * Writes a single ZIP: a JSON manifest plus the original audio bytes (stored,
 * not re-compressed — MP3 data does not shrink and re-encoding would be lossy).
 * Audio is read one track at a time so only one file's bytes are resident, while
 * the finished archive is assembled from chunks in memory (Safari spills large
 * Blobs to disk, so a big library does not have to fit in RAM).
 */
export async function exportBackup(options: ExportOptions): Promise<Blob> {
  const [tracks, playlists] = await Promise.all([allTracks(), allPlaylists()]);
  const manifest: BackupManifest = {
    app: 'refaudio',
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    tracks,
    playlists,
    favorites: options.favorites,
    recent: options.recent,
  };

  return new Promise<Blob>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let settled = false;

    const zip = new Zip((error, chunk, final) => {
      if (settled) return;
      if (error) {
        settled = true;
        reject(error);
        return;
      }
      if (chunk && chunk.length) {
        chunks.push(chunk);
        bytes += chunk.length;
      }
      if (final) {
        settled = true;
        resolve(new Blob(chunks as BlobPart[], { type: 'application/zip' }));
      }
    });

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      zip.terminate();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    void (async () => {
      try {
        const manifestEntry = new ZipPassThrough('manifest.json');
        zip.add(manifestEntry);
        manifestEntry.push(strToU8(JSON.stringify(manifest)), true);

        for (let index = 0; index < tracks.length; index += 1) {
          const track = tracks[index];
          options.onProgress?.({
            phase: 'reading',
            done: index,
            total: tracks.length,
            bytes,
            current: track.title,
          });

          const audio = await getAudioBlob(track.id);
          if (audio) {
            const entry = new ZipPassThrough(audioPath(track, audio.type));
            zip.add(entry);
            entry.push(new Uint8Array(await audio.arrayBuffer()), true);
          }

          if (track.hasCover) {
            const cover = await getCoverBlob(track.id);
            if (cover) {
              const extension = extensionForMime(cover.type);
              const entry = new ZipPassThrough(`covers/${track.id}.${extension}`);
              zip.add(entry);
              entry.push(new Uint8Array(await cover.arrayBuffer()), true);
            }
          }

          options.onProgress?.({
            phase: 'zipping',
            done: index + 1,
            total: tracks.length,
            bytes,
            current: track.title,
          });
          await yieldToUi();
        }

        options.onProgress?.({
          phase: 'writing',
          done: tracks.length,
          total: tracks.length,
          bytes,
          current: '',
        });
        zip.end();
      } catch (error) {
        fail(error);
      }
    })();
  });
}

/** Parses a backup ZIP and merges it into the current library. */
export async function importBackup(file: File, options: ImportOptions = {}): Promise<BackupResult> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise<Unzipped>((resolve, reject) => {
    unzip(buffer, (error, data) => {
      if (error) reject(new Error(`Could not read the ZIP: ${error.message}`));
      else resolve(data);
    });
  });

  const manifestBytes = entries['manifest.json'];
  if (!manifestBytes) {
    throw new Error('This ZIP is not a Refaudio backup (manifest.json is missing).');
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as BackupManifest;
  } catch {
    throw new Error('The backup manifest is damaged and cannot be read.');
  }

  if (manifest.app !== 'refaudio') throw new Error('This ZIP is not a Refaudio backup.');
  if (manifest.version > BACKUP_VERSION) {
    throw new Error('This backup was created by a newer version of Refaudio.');
  }
  if (!Array.isArray(manifest.tracks)) throw new Error('The backup has no track list.');

  const audioIndex = new Map<string, string>();
  const coverIndex = new Map<string, string>();
  for (const path of Object.keys(entries)) {
    const audio = /^audio\/([^.]+)\./.exec(path);
    if (audio) audioIndex.set(audio[1], path);
    const cover = /^covers\/([^.]+)\./.exec(path);
    if (cover) coverIndex.set(cover[1], path);
  }

  const existingTracks = await trackIds();
  const existingPlaylists = new Set((await allPlaylists()).map((playlist) => playlist.id));

  const result: BackupResult = {
    added: 0,
    skipped: 0,
    missing: 0,
    playlists: 0,
    favorites: Array.isArray(manifest.favorites) ? manifest.favorites : [],
    recent: Array.isArray(manifest.recent) ? manifest.recent : [],
  };

  const total = manifest.tracks.length;
  for (let index = 0; index < manifest.tracks.length; index += 1) {
    const track = manifest.tracks[index];
    if (!track || typeof track.id !== 'string') continue;
    if (existingTracks.has(track.id)) {
      result.skipped += 1;
      continue;
    }

    const audioPath = audioIndex.get(track.id);
    const audioBytes = audioPath ? entries[audioPath] : undefined;
    if (!audioPath || !audioBytes) {
      result.missing += 1;
      continue;
    }

    const coverPath = coverIndex.get(track.id);
    const coverBytes = coverPath ? entries[coverPath] : undefined;
    const audio = new Blob([audioBytes], { type: track.mimeType || guessMime(track.fileName) });
    const cover = coverBytes
      ? new Blob([coverBytes], { type: /\.png$/i.test(coverPath ?? '') ? 'image/png' : 'image/jpeg' })
      : null;

    await addTrack({ ...track, hasCover: cover !== null, source: 'backup' }, audio, cover);
    result.added += 1;
    options.onProgress?.(index + 1, total);
    await yieldToUi();
  }

  for (const playlist of Array.isArray(manifest.playlists) ? manifest.playlists : []) {
    if (!playlist || typeof playlist.id !== 'string' || existingPlaylists.has(playlist.id)) continue;
    await putPlaylist(playlist);
    existingPlaylists.add(playlist.id);
    result.playlists += 1;
  }

  options.onProgress?.(total, total);
  return result;
}
