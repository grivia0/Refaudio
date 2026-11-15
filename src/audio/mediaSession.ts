import type { Player } from './player';
import type { TrackMeta } from '../types';

export function supportsMediaSession(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

/** Lock screen / Control Center / Bluetooth metadata. */
export function setMetadata(track: TrackMeta, artworkUrl: string | null): void {
  if (!supportsMediaSession() || typeof MediaMetadata === 'undefined') return;
  const artwork: MediaImage[] = artworkUrl
    ? [{ src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }]
    : [];
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist || 'Unknown artist',
      album: track.album || 'Unknown album',
      artwork,
    });
  } catch {
    // Metadata is a progressive enhancement; playback must not depend on it.
  }
}

export function clearMetadata(): void {
  if (!supportsMediaSession()) return;
  try {
    navigator.mediaSession.metadata = null;
  } catch {
    /* ignore */
  }
}

export function setPlaybackState(state: 'none' | 'paused' | 'playing'): void {
  if (!supportsMediaSession()) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    /* ignore */
  }
}

export function setPosition(duration: number, position: number, rate: number): void {
  if (!supportsMediaSession() || typeof navigator.mediaSession.setPositionState !== 'function') return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: Math.max(duration, position),
      position: Math.min(Math.max(position, 0), duration),
      playbackRate: rate,
    });
  } catch {
    /* Safari throws on invalid states; ignore rather than break playback */
  }
}

export function bindActions(player: Player): void {
  if (!supportsMediaSession() || typeof navigator.mediaSession.setActionHandler !== 'function') return;

  const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    ['play', () => void player.play()],
    ['pause', () => player.pause()],
    ['previoustrack', () => player.prev()],
    ['nexttrack', () => player.next(false)],
    ['stop', () => player.stop()],
    [
      'seekbackward',
      (details) => player.skip(-(details.seekOffset ?? 15)),
    ],
    ['seekforward', (details) => player.skip(details.seekOffset ?? 15)],
    [
      'seekto',
      (details) => {
        if (typeof details.seekTime === 'number') player.seek(details.seekTime);
      },
    ],
  ];

  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Not every action is supported by every iOS version.
    }
  }
}
