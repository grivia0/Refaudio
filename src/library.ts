import type { GroupMode, SortKey, TrackMeta } from './types';

export interface TrackRow {
  kind: 'track';
  track: TrackMeta;
}

export interface HeaderRow {
  kind: 'header';
  key: string;
  title: string;
  subtitle: string;
}

export type LibraryRow = TrackRow | HeaderRow;

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function albumKeyOf(track: TrackMeta): string {
  return `${track.albumArtist || track.artist || 'Unknown artist'}\u0000${track.album || 'Unknown album'}`;
}

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

/** Every term must appear somewhere in the searchable fields. */
export function matchesQuery(track: TrackMeta, query: string): boolean {
  const words = terms(query);
  if (words.length === 0) return true;
  const haystack = [
    track.title,
    track.artist,
    track.albumArtist,
    track.album,
    track.genre,
    track.fileName,
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function sortTracks(tracks: TrackMeta[], sort: SortKey): TrackMeta[] {
  const sorted = [...tracks];
  switch (sort) {
    case 'title':
      sorted.sort(
        (a, b) => collator.compare(a.title, b.title) || collator.compare(a.artist, b.artist),
      );
      break;
    case 'artist':
      sorted.sort(
        (a, b) =>
          collator.compare(a.albumArtist || a.artist, b.albumArtist || b.artist) ||
          collator.compare(a.album, b.album) ||
          a.discNo - b.discNo ||
          a.trackNo - b.trackNo ||
          collator.compare(a.title, b.title),
      );
      break;
    case 'album':
      sorted.sort(
        (a, b) =>
          collator.compare(a.album, b.album) ||
          a.discNo - b.discNo ||
          a.trackNo - b.trackNo ||
          collator.compare(a.title, b.title),
      );
      break;
    case 'duration':
      sorted.sort((a, b) => b.duration - a.duration);
      break;
    case 'added':
    default:
      sorted.sort((a, b) => b.addedAt - a.addedAt);
      break;
  }
  return sorted;
}

function headerFor(group: GroupMode, track: TrackMeta): HeaderRow {
  if (group === 'artist') {
    const artist = track.albumArtist || track.artist || 'Unknown artist';
    return { kind: 'header', key: `artist:${artist.toLowerCase()}`, title: artist, subtitle: '' };
  }
  const artist = track.albumArtist || track.artist || 'Unknown artist';
  const album = track.album || 'Unknown album';
  return {
    kind: 'header',
    key: `album:${albumKeyOf(track).toLowerCase()}`,
    title: album,
    subtitle: artist,
  };
}

/**
 * Flattens the library into rows for the virtual list. With grouping enabled the
 * list gains header rows that also show how many tracks sit under them.
 */
export function libraryRows(
  tracks: TrackMeta[],
  options: { query: string; sort: SortKey; group: GroupMode },
): LibraryRow[] {
  const filtered = tracks.filter((track) => matchesQuery(track, options.query));
  const sorted = sortTracks(filtered, options.sort);

  if (options.group === 'none') {
    return sorted.map((track) => ({ kind: 'track', track }) as TrackRow);
  }

  const rows: LibraryRow[] = [];
  let currentKey: string | null = null;
  let header: HeaderRow | null = null;
  let count = 0;

  const flush = () => {
    if (header) header.subtitle = header.subtitle ? `${header.subtitle} · ${count}` : `${count}`;
  };

  for (const track of sorted) {
    const next = headerFor(options.group, track);
    if (next.key !== currentKey) {
      flush();
      rows.push(next);
      header = next;
      currentKey = next.key;
      count = 0;
    }
    rows.push({ kind: 'track', track });
    count += 1;
  }
  flush();
  return rows;
}

/** Queue ids in library order, used by "play all" / shuffle. */
export function queueIds(rows: LibraryRow[]): string[] {
  return rows.filter((row): row is TrackRow => row.kind === 'track').map((row) => row.track.id);
}
