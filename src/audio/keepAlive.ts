/*
 * A page may only choose its audio-session category while it is audible: after
 * a pause from the lock screen the app is hidden and silent, so
 * `navigator.audioSession.type = 'playback'` throws, and the `play()` the lock
 * screen sends next runs on `auto` — the track reports *playing* and nothing
 * comes out until the app is opened again (WebKit bug 323022). A page cannot
 * argue with the category while it is inaudible, so it has to avoid becoming
 * inaudible: a looping silent element keeps the session active and `playback`
 * across the pause, which makes the resume an ordinary `play()` on a live
 * session. It costs a little battery, so Settings can switch it off.
 */

/** One second of 8 kHz mono 8-bit PCM. Tiny, and silence is silence. */
const RATE = 8000;
const SECONDS = 1;

let url: string | null = null;
let stream: HTMLAudioElement | null = null;

/** Unsigned 8-bit PCM puts silence in the middle of the range: 0x80. */
function silenceUrl(): string {
  if (url) return url;
  const samples = RATE * SECONDS;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE, true); // byte rate: one byte per sample
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(0x80, 44);
  url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  return url;
}

/** True while the silent stream is holding the session open. */
export function sessionHeld(): boolean {
  return stream !== null && !stream.paused;
}

/**
 * Starts the silent stream. Idempotent, and the element is attached to the
 * document because iOS routes and suspends media elements by their presence in
 * the tree, the same reason the player's own element is in there.
 */
export function holdAudioSession(): void {
  if (stream) return;
  const audio = new Audio(silenceUrl());
  audio.loop = true;
  audio.setAttribute('playsinline', '');
  audio.setAttribute('data-refaudio-keepalive', '');
  audio.setAttribute('aria-hidden', 'true');
  audio.tabIndex = -1;
  audio.style.cssText =
    'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  (document.body ?? document.documentElement).append(audio);
  stream = audio;
  // A refusal here is not an error to report: the resume simply falls back to
  // the old behaviour of staying quiet until the app is in front again.
  void audio.play().catch(() => undefined);
}

/** Lets the session go. The blob URL is cached for the next hold. */
export function releaseAudioSession(): void {
  if (!stream) return;
  const audio = stream;
  stream = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.remove();
}
