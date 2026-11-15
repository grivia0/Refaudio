import { addTrack, storageState, trackIds } from './db';
import type { ImportSource, ParseResponse, ParsedMeta, TrackMeta } from './types';
import {
  guessMime,
  isSupportedAudioFile,
  titleFromFileName,
  trackIdFor,
  unsupportedReason,
  yieldToUi,
} from './util';

export interface ImportProgress {
  phase: 'prepare' | 'parse' | 'store' | 'done';
  total: number;
  done: number;
  added: number;
  skipped: number;
  failed: number;
  current: string;
}

export interface ImportResult {
  added: number;
  skipped: number;
  failed: number;
  unsupported: Array<{ name: string; reason: string }>;
  errors: string[];
  cancelled: boolean;
}

export interface ImportOptions {
  source: ImportSource;
  onProgress?: (progress: ImportProgress) => void;
  shouldCancel?: () => boolean;
}

/**
 * Parses tags in a worker so the A13 main thread stays responsive even for a
 * batch of several hundred files.
 */
class MetadataParser {
  private worker: Worker | null = null;
  private pending = new Map<string, { resolve: (value: ParseResponse | null) => void; timer: number }>();
  private seq = 0;
  private dead = false;

  private ensure(): Worker | null {
    if (this.dead) return null;
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./metadata.worker.ts', import.meta.url), { type: 'module' });
      } catch {
        this.dead = true;
        return null;
      }
      this.worker.onmessage = (event: MessageEvent<ParseResponse>) => {
        const entry = this.pending.get(event.data.key);
        if (!entry) return;
        window.clearTimeout(entry.timer);
        this.pending.delete(event.data.key);
        entry.resolve(event.data);
      };
      this.worker.onerror = () => {
        // A broken worker must not block the import: fall back to filenames.
        for (const [, entry] of this.pending) {
          window.clearTimeout(entry.timer);
          entry.resolve(null);
        }
        this.pending.clear();
      };
    }
    return this.worker;
  }

  parse(file: File, timeoutMs = 20000): Promise<ParseResponse | null> {
    const worker = this.ensure();
    if (!worker) return Promise.resolve(null);
    const key = `p${this.seq++}`;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(key);
        resolve(null);
      }, timeoutMs);
      this.pending.set(key, { resolve, timer });
      worker.postMessage({ key, file });
    });
  }

  dispose(): void {
    for (const [, entry] of this.pending) window.clearTimeout(entry.timer);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.dead = true;
  }
}

/**
 * Some files carry no duration in their tags. We ask the media stack once at
 * import time instead of guessing, so the UI never shows a wrong length.
 */
function measureDuration(audio: Blob): Promise<number> {
  return new Promise((resolve) => {
    const element = new Audio();
    const url = URL.createObjectURL(audio);
    let settled = false;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      element.onloadedmetadata = null;
      element.onerror = null;
      element.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(0), 8000);
    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      finish(Number.isFinite(element.duration) ? element.duration : 0);
    };
    element.onerror = () => finish(0);
    element.src = url;
  });
}


export async function importFiles(files: File[], options: ImportOptions): Promise<ImportResult> {
  const supported: File[] = [];
  const unsupported: Array<{ name: string; reason: string }> = [];

  for (const file of files) {
    const reason = unsupportedReason(file.name);
    if (reason) {
      unsupported.push({ name: file.name, reason });
      continue;
    }
    if (!isSupportedAudioFile(file)) {
      unsupported.push({ name: file.name, reason: 'Not an audio file iOS can play' });
      continue;
    }
    supported.push(file);
  }

  const existing = await trackIds();
  const pending = supported.filter((file) => !existing.has(trackIdFor(file)));
  const skipped = supported.length - pending.length;

  const progress: ImportProgress = {
    phase: 'prepare',
    total: pending.length,
    done: 0,
    added: 0,
    skipped,
    failed: 0,
    current: '',
  };
  options.onProgress?.({ ...progress });

  const result: ImportResult = {
    added: 0,
    skipped,
    failed: 0,
    unsupported,
    errors: [],
    cancelled: false,
  };
  if (pending.length === 0) {
    progress.phase = 'done';
    options.onProgress?.({ ...progress });
    return result;
  }

  // Fail before writing rather than half-way through a large batch.
  const needed = pending.reduce((sum, file) => sum + file.size, 0) * 1.15;
  const storage = await storageState();
  if (storage && storage.quota > 0) {
    const free = storage.quota - storage.usage;
    if (needed > free) {
      throw new Error(
        `Not enough device storage: this import needs about ${Math.ceil(needed / 1048576)} MB ` +
          `but only ${Math.max(0, Math.floor(free / 1048576))} MB is available.`,
      );
    }
  }

  const parser = new MetadataParser();
  try {
    for (const file of pending) {
      if (options.shouldCancel?.()) {
        result.cancelled = true;
        break;
      }

      progress.phase = 'parse';
      progress.current = file.name;
      options.onProgress?.({ ...progress });

      const parsed = await parser.parse(file);
      const meta: ParsedMeta | null = parsed?.ok ? parsed.meta ?? null : null;
      const fallback = titleFromFileName(file.name);
      const mimeType = file.type || guessMime(file.name);
      const audio = new Blob([file], { type: mimeType });

      let duration = meta?.duration ?? 0;
      if (!Number.isFinite(duration) || duration <= 0) {
        duration = await measureDuration(audio);
      }

      const cover = parsed?.cover
        ? new Blob([parsed.cover.buffer], { type: parsed.cover.type })
        : null;

      const track: TrackMeta = {
        id: trackIdFor(file),
        title: meta?.title || fallback.title,
        artist: meta?.artist || fallback.artist,
        albumArtist: meta?.albumArtist || meta?.artist || fallback.artist,
        album: meta?.album || '',
        genre: meta?.genre || '',
        year: meta?.year ?? 0,
        trackNo: meta?.trackNo ?? 0,
        discNo: meta?.discNo ?? 0,
        duration,
        codec: meta?.codec ?? '',
        container: meta?.container ?? '',
        bitrate: meta?.bitrate ?? 0,
        sampleRate: meta?.sampleRate ?? 0,
        channels: meta?.channels ?? 0,
        size: file.size,
        mimeType,
        fileName: file.name,
        addedAt: Date.now(),
        playCount: 0,
        lastPlayedAt: 0,
        hasCover: cover !== null,
        source: options.source,
      };

      progress.phase = 'store';
      options.onProgress?.({ ...progress });

      try {
        await addTrack(track, audio, cover);
        result.added += 1;
        progress.added = result.added;
      } catch (error) {
        result.failed += 1;
        progress.failed = result.failed;
        const message =
          error instanceof DOMException && error.name === 'QuotaExceededError'
            ? `Storage is full — could not save “${file.name}”.`
            : `Could not save “${file.name}”: ${error instanceof Error ? error.message : String(error)}`;
        if (!result.errors.includes(message)) result.errors.push(message);
      }

      progress.done += 1;
      options.onProgress?.({ ...progress });
      await yieldToUi();
    }
  } finally {
    parser.dispose();
  }

  progress.phase = 'done';
  progress.current = '';
  options.onProgress?.({ ...progress });
  return result;
}
