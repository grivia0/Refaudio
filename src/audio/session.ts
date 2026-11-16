/*
 * iOS 17.2+ Audio Session API (https://webkit.org/b/261512). It is the only way
 * a web app can ask not to be silenced by the ring/silent switch, and the only
 * knob a page has when iOS drops the session across a lock-screen interruption:
 * a page left on the default `auto` category comes back "playing" with no
 * sound at all (WebKit bug 323022). Older iOS and every other engine has no
 * equivalent, which is what `audioSessionLabel()` reports in Settings.
 */
export type AudioSessionKind = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';

interface AudioSessionLike {
  type: AudioSessionKind;
}

function api(): AudioSessionLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;
}

/** Label for the Settings → About row, so a bug report can say which world it is in. */
export function audioSessionLabel(): string {
  const session = api();
  if (!session) return 'System default';
  try {
    // `Auto` here means iOS reset the category after an interruption.
    return session.type === 'playback' ? 'Playback' : 'Auto';
  } catch {
    return 'System default';
  }
}

/**
 * Re-asserted rather than set once at launch: iOS resets the category when the
 * page is interrupted (lock screen, call, route change), so the same page can
 * slide back to `auto` and start playing silently. Cheap enough to call on
 * every start, every unlock and every re-attach of the source.
 */
export function configureAudioSession(kind: AudioSessionKind = 'playback'): void {
  const session = api();
  if (!session) return;
  try {
    if (session.type !== kind) session.type = kind;
  } catch {
    // Setting the type throws while the page is not audible yet; the next
    // play() or unlock simply tries again.
  }
}
