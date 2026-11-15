const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'm4b',
  'aac',
  'flac',
  'wav',
  'wave',
  'aif',
  'aiff',
  'aifc',
  'caf',
  'alac',
]);

/** Formats iOS/WebKit cannot decode, so we say so instead of failing silently. */
const UNSUPPORTED_REASONS: Record<string, string> = {
  ogg: 'Ogg Vorbis is not supported by iOS',
  oga: 'Ogg Vorbis is not supported by iOS',
  opus: 'Opus files are not supported by iOS',
  wma: 'WMA is not supported by iOS',
  wv: 'WavPack is not supported by iOS',
  ape: "Monkey's Audio is not supported by iOS",
  dsf: 'DSD is not supported by iOS',
  dff: 'DSD is not supported by iOS',
  m4p: 'Protected iTunes audio (DRM) cannot be played',
};

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Stable id: re-importing the same file must not create a duplicate. */
export function trackIdFor(file: File): string {
  return fnv1a(`${file.name}|${file.size}|${file.lastModified}|${file.type}`);
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function unsupportedReason(name: string): string | null {
  return UNSUPPORTED_REASONS[extensionOf(name)] ?? null;
}

export function isSupportedAudioFile(file: File): boolean {
  if (AUDIO_EXTENSIONS.has(extensionOf(file.name))) return true;
  return file.type.startsWith('audio/') && !unsupportedReason(file.name);
}

export function guessMime(name: string): string {
  switch (extensionOf(name)) {
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
    case 'm4b':
    case 'aac':
      return 'audio/mp4';
    case 'flac':
      return 'audio/flac';
    case 'wav':
    case 'wave':
      return 'audio/wav';
    case 'aif':
    case 'aiff':
    case 'aifc':
      return 'audio/aiff';
    case 'caf':
      return 'audio/x-caf';
    default:
      return 'application/octet-stream';
  }
}

export function extensionForMime(type: string): string {
  if (type.includes('mpeg')) return 'mp3';
  if (type.includes('mp4')) return 'm4a';
  if (type.includes('flac')) return 'flac';
  if (type.includes('wav')) return 'wav';
  if (type.includes('aiff')) return 'aiff';
  if (type.includes('caf')) return 'caf';
  if (type.includes('png')) return 'png';
  if (type.includes('jpeg')) return 'jpg';
  return 'bin';
}

/** "03 - Artist - Title.mp3" -> { artist: 'Artist', title: 'Title' } */
export function titleFromFileName(name: string): { title: string; artist: string } {
  let base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  base = base.replace(/^\s*\d{1,3}\s*[-–.)]\s*/, '').trim();
  const separator = base.indexOf(' - ');
  if (separator > 0) {
    const left = base.slice(0, separator).trim();
    const right = base.slice(separator + 3).trim();
    if (left && right) return { artist: left, title: right };
  }
  return { artist: '', title: base || name };
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  const digits = i <= 1 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[i]}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hashInt(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic artwork placeholder: the same track always gets the same
 * gradient, so the library never shows a random or broken thumbnail.
 */
export function gradientFor(seed: string): string {
  const hash = hashInt(seed);
  const hueA = hash % 360;
  const hueB = (hueA + 40 + ((hash >>> 9) % 90)) % 360;
  const lightA = 42 + ((hash >>> 17) % 14);
  const lightB = 28 + ((hash >>> 21) % 14);
  return `linear-gradient(140deg, hsl(${hueA} 62% ${lightA}%), hsl(${hueB} 58% ${lightB}%))`;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: number | undefined;
  return (...args: A) => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Lets the browser paint between heavy import steps. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}

/** Stable-enough unique id; `crypto.randomUUID` needs a secure context. */
export function newId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${uuid}`;
}

/** Fisher–Yates shuffle that never mutates the input. */
export function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** "Artist — Album" style subtitle that never renders empty separators. */

export function subtitleFor(parts: Array<string | undefined | null>): string {
  const cleaned = parts.map((part) => (part ?? '').trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join(' · ') : 'Unknown artist';
}

