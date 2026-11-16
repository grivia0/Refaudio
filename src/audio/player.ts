import type { RepeatMode, TrackMeta } from '../types';
import { getAudioBlob, getCoverBlob } from '../db';
import { clearMetadata, setMetadata, setPlaybackState, setPosition } from './mediaSession';
import { configureAudioSession } from './session';

export type PlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended';
export type PlayerEvent = 'track' | 'state' | 'time' | 'queue';

export interface PlayerDeps {
  getTrack: (id: string) => TrackMeta | undefined;
  onError: (message: string) => void;
  onPersist: (snapshot: { trackId: string | null; position: number; queue: string[]; index: number }) => void;
  onPlayed: (id: string, position: number) => void;
}

const SEEK_STEP = 15;

export class Player {

  readonly audio: HTMLAudioElement;
  queue: string[] = [];
  shuffle = false;
  repeat: RepeatMode = 'off';
  rate = 1;
  volume = 1;

  private deps: PlayerDeps;
  private order: number[] = [];
  private pos = -1;
  private stateValue: PlayState = 'idle';
  private audioUrl: string | null = null;
  private coverUrl: string | null = null;
  private listeners = new Map<PlayerEvent, Set<() => void>>();
  private persistTimer: number | undefined;
  private lastPersist = 0;
  private pendingSeek: number | null = null;
  private loadToken = 0;
  private countedFor: string | null = null;
  /** What the user asked for, as opposed to what the element is doing. */
  private wantsPlay = false;
  /** True while the audio session is known to be broken by an interruption. */
  private interrupted = false;
  private watchdog: number | undefined;
  private lastMoveAt = 0;
  private lastMovePos = 0;
  private recoveries = 0;
  /** When the source was last re-attached, to ignore the resulting pause. */
  private refreshAt = 0;

  constructor(deps: PlayerDeps) {
    this.deps = deps;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.crossOrigin = null;
    audio.setAttribute('playsinline', '');
    // Attached to the document on purpose: iOS routes audio more reliably for
    // media elements that are in the tree, and it gives the suite a handle.
    audio.setAttribute('data-refaudio-audio', '');
    audio.setAttribute('aria-hidden', 'true');
    audio.tabIndex = -1;
    audio.style.cssText =
      'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    if (document.body) document.body.append(audio);
    else document.addEventListener('DOMContentLoaded', () => document.body.append(audio), { once: true });

    audio.addEventListener('play', () => {
      this.setState('playing');
      setPlaybackState('playing');
    });
    audio.addEventListener('pause', () => {
      if (this.stateValue === 'ended') return;
      // Re-attaching the source can make WebKit fire a pause late; that one is
      // part of the rebuild, not an interruption.
      if (this.wantsPlay && Date.now() - this.refreshAt < 500) return;
      // Only pause() stops on purpose. Anything else — the lock-screen button of
      // a suspended page, a phone call, headphones pulled — leaves the audio
      // session broken behind the element, so arm the recovery for the resume.
      // A track that reached its end also fires pause first: that is not an
      // interruption, and rebuilding there would re-seek to the end and stop.
      if (this.wantsPlay && !this.atEnd()) this.interrupted = true;
      this.wantsPlay = false;
      this.stopWatchdog();
      this.setState('paused');
      setPlaybackState('paused');
      this.persistNow();
    });
    audio.addEventListener('ended', () => this.handleEnded());
    audio.addEventListener('error', () => {
      if (!audio.src) return;
      this.deps.onError('This file could not be decoded by iOS.');
      this.setState('paused');
    });
    audio.addEventListener('timeupdate', () => {
      this.emit('time');
      setPosition(this.duration, this.currentTime, this.rate);
      if (Date.now() - this.lastPersist > 4000) this.persistNow();
    });
    audio.addEventListener('loadedmetadata', () => {
      if (this.pendingSeek !== null) {
        const target = this.pendingSeek;
        this.pendingSeek = null;
        try {
          audio.currentTime = Math.min(target, audio.duration || target);
        } catch {
          // Ignore: metadata may be unseekable for exotic files.
        }
      }
      this.emit('time');
    });
    // Unlocking the phone: the element can come back paused with no event, and
    // iOS resets the session category even though we set it at launch.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      configureAudioSession();
      if (!this.wantsPlay) return;
      if (this.audio.paused) void this.play();
      else this.startWatchdog();
    });
    window.addEventListener('pageshow', () => configureAudioSession());

    this.audio = audio;
  }

  /* ------------------------------ events ------------------------------ */

  on(event: PlayerEvent, listener: () => void): () => void {
    const set = this.listeners.get(event) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(event, set);
    return () => set.delete(listener);
  }

  private emit(event: PlayerEvent): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) listener();
  }

  private setState(state: PlayState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    this.emit('state');
  }

  /* ----------------------------- accessors ---------------------------- */

  get state(): PlayState {
    return this.stateValue;
  }

  get currentId(): string | null {
    return this.queue[this.index] ?? null;
  }

  get index(): number {
    return this.pos >= 0 ? this.order[this.pos] ?? -1 : -1;
  }

  get currentTrack(): TrackMeta | undefined {
    const id = this.currentId;
    return id ? this.deps.getTrack(id) : undefined;
  }

  get currentTime(): number {
    return this.audio.currentTime || 0;
  }

  get duration(): number {
    const media = this.audio.duration;
    if (Number.isFinite(media) && media > 0) return media;
    return this.currentTrack?.duration ?? 0;
  }

  get artworkUrl(): string | null {
    return this.coverUrl;
  }

  get isPlaying(): boolean {
    return this.stateValue === 'playing';
  }

  /** True when playback reached the end of the media, not just paused late. */
  private atEnd(): boolean {
    const audio = this.audio;
    if (audio.ended) return true;
    const duration = audio.duration;
    return Number.isFinite(duration) && duration > 0 && audio.currentTime >= duration - 0.1;
  }

  get upNext(): Array<{ index: number; track: TrackMeta }> {
    const items: Array<{ index: number; track: TrackMeta }> = [];
    for (let i = 0; i < this.order.length; i += 1) {
      if (i <= this.pos) continue;
      const track = this.deps.getTrack(this.queue[this.order[i]]);
      if (track) items.push({ index: this.order[i], track });
    }
    return items;
  }

  /* ---------------------------- queue setup --------------------------- */

  /**
   * Shuffle uses a permutation ("shuffle bag"): every track plays exactly once
   * per cycle and the current track always sits at the front of the order.
   */
  private rebuildOrder(currentQueueIndex: number): void {
    const indices = this.queue.map((_, index) => index);
    if (!this.shuffle) {
      this.order = indices;
      this.pos = indices.indexOf(currentQueueIndex);
      return;
    }
    const rest = indices.filter((index) => index !== currentQueueIndex);
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this.order = currentQueueIndex >= 0 ? [currentQueueIndex, ...rest] : rest;
    this.pos = this.order.indexOf(currentQueueIndex);
  }

  setQueue(ids: string[], startIndex = 0, autoplay = true): void {
    this.queue = ids.filter((id) => this.deps.getTrack(id) !== undefined);
    if (this.queue.length === 0) {
      this.stop();
      return;
    }
    const start = Math.min(Math.max(startIndex, 0), this.queue.length - 1);
    this.rebuildOrder(start);
    this.emit('queue');
    void this.load(this.queue[start], autoplay);
  }

  /** Tapping a row while the queue is already the visible list keeps the order. */
  jumpTo(queueIndex: number, autoplay = true): void {
    if (!this.queue[queueIndex]) return;
    const orderPos = this.shuffle ? this.order.indexOf(queueIndex) : queueIndex;
    this.pos = orderPos >= 0 ? orderPos : 0;
    void this.load(this.queue[queueIndex], autoplay);
  }

  restore(snapshot: {
    trackId: string | null;
    position: number;
    queue: string[];
    index: number;
  }): void {
    const queue = snapshot.queue.filter((id) => this.deps.getTrack(id) !== undefined);
    if (queue.length === 0) return;
    this.queue = queue;
    this.order = queue.map((_, index) => index);
    const target = snapshot.trackId ? queue.indexOf(snapshot.trackId) : -1;
    const index =
      target >= 0 ? target : Math.min(Math.max(snapshot.index, 0), queue.length - 1);
    this.pos = index;
    this.pendingSeek = snapshot.position > 0 ? snapshot.position : null;
    void this.load(queue[index], false);
    this.emit('queue');
  }

  /* ----------------------------- transport ---------------------------- */

  async play(): Promise<void> {
    if (!this.audio.src) return;

    // Re-assert the session on every start: iOS resets it across an
    // interruption, and `auto` is the category that plays silently.
    configureAudioSession();
    // Coming back from the lock screen or a call: the element left behind by
    // that interruption has to be rebuilt or it stays mute.
    if (this.interrupted) this.refreshAudioElement();

    this.wantsPlay = true;
    try {
      await this.audio.play();
      this.startWatchdog();
      if (this.currentId && this.countedFor !== this.currentId) {
        this.countedFor = this.currentId;
        this.deps.onPlayed(this.currentId, this.currentTime);
      }
    } catch (error) {
      this.wantsPlay = false;
      this.stopWatchdog();
      this.setState('paused');
      const name = error instanceof DOMException ? error.name : '';
      this.deps.onError(
        name === 'NotAllowedError'
          ? 'iOS needs a tap on the play button before audio can start.'
          : `Playback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  pause(): void {
    const wasPlaying = !this.audio.paused;
    this.wantsPlay = false;
    this.stopWatchdog();
    // A pause asked for while the app is hidden came from the lock screen or
    // Control Center. iOS tears the session down around it, so arm the
    // recovery for the play that follows.
    if (wasPlaying && document.visibilityState === 'hidden') this.interrupted = true;
    this.audio.pause();
    this.persistNow();
  }

  toggle(): void {
    if (this.stateValue === 'playing') this.pause();
    else void this.play();
  }

  stop(): void {
    this.wantsPlay = false;
    this.interrupted = false;
    this.stopWatchdog();
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.revokeUrls();
    this.loadToken += 1;
    this.stateValue = 'idle';
    this.queue = [];
    this.order = [];
    this.pos = -1;
    this.pendingSeek = null;
    setPlaybackState('none');
    clearMetadata();
    this.emit('track');
    this.emit('state');
    this.emit('queue');
    this.persistNow();
  }

  /**
   * `fromEnd` marks an automatic advance. Repeat-one restarts the track only in
   * that case, and the queue stops at the end unless repeat is "all".
   */
  next(fromEnd = false): void {
    if (fromEnd && this.repeat === 'one') {
      this.audio.currentTime = 0;
      void this.play();
      return;
    }

    if (this.pos < this.order.length - 1) {
      this.pos += 1;
      void this.load(this.queue[this.order[this.pos]], true);
      return;
    }

    if (this.repeat === 'all' || !fromEnd) {
      if (this.shuffle) this.rebuildOrder(this.index);
      else this.pos = 0;
      void this.load(this.queue[this.order[this.pos]], true);
      return;
    }

    this.audio.pause();
    this.wantsPlay = false;
    this.stopWatchdog();
    this.stateValue = 'ended';
    setPlaybackState('paused');
    this.emit('state');
    this.persistNow();
  }

  prev(): void {
    if (this.currentTime > 3) {
      this.seek(0);
      return;
    }
    this.pos = this.pos > 0 ? this.pos - 1 : this.order.length - 1;
    const target = this.queue[this.order[this.pos]];
    if (target) void this.load(target, true);
  }

  seek(seconds: number): void {
    const duration = this.duration;
    const target = duration > 0 ? Math.min(Math.max(seconds, 0), duration) : Math.max(seconds, 0);
    if (!Number.isFinite(target)) return;
    try {
      this.audio.currentTime = target;
    } catch {
      // Seeking before metadata is available throws on some Safari builds.
    }
    this.emit('time');
    this.persistSoon(0);
  }

  /** Jump by `delta` seconds; the UI and lock screen both use the 15 s step. */
  skip(delta: number = SEEK_STEP): void {
    this.seek(this.currentTime + delta);
  }

  setRate(rate: number): void {
    this.rate = rate;
    this.audio.playbackRate = rate;
    this.emit('state');
    this.persistSoon(0);
  }

  setVolume(volume: number): void {
    const level = Math.min(Math.max(volume, 0), 1);
    this.volume = level;
    this.audio.volume = level;
    this.emit('state');
    this.persistSoon(400);
  }

  toggleShuffle(): void {
    this.shuffle = !this.shuffle;
    this.rebuildOrder(this.index);
    this.emit('queue');
    this.emit('state');
    this.persistSoon(0);
  }

  cycleRepeat(): void {
    this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
    this.emit('state');
    this.persistSoon(0);
  }

  /** Whole queue in playback order, for the queue sheet. */
  get orderedQueue(): Array<{ index: number; track: TrackMeta }> {
    const items: Array<{ index: number; track: TrackMeta }> = [];
    for (const queueIndex of this.order) {
      const track = this.deps.getTrack(this.queue[queueIndex]);
      if (track) items.push({ index: queueIndex, track });
    }
    return items;
  }

  /** Inserts `id` right after the current track. Returns false if already queued. */

  addNext(id: string): boolean {
    if (!this.deps.getTrack(id)) return false;
    if (this.queue.includes(id)) return false;

    this.queue.push(id);
    const queueIndex = this.queue.length - 1;
    if (this.order.length === 0) {
      this.order.push(queueIndex);
      this.pos = 0;
    } else if (this.pos < 0) {
      this.order.unshift(queueIndex);
      this.pos = 0;
    } else {
      this.order.splice(this.pos + 1, 0, queueIndex);
    }
    this.emit('queue');
    this.persistSoon(400);
    return true;
  }

  /** Appends `id` to the end of the queue. Returns false if already queued. */
  addLast(id: string): boolean {
    return this.addMany([id]) > 0;
  }

  /**
   * Appends every id that is not queued yet, in order, with a single queue
   * event — selecting 50 songs must not redraw the queue 50 times.
   */
  addMany(ids: string[]): number {
    let added = 0;
    for (const id of ids) {
      if (!this.deps.getTrack(id) || this.queue.includes(id)) continue;
      this.queue.push(id);
      this.order.push(this.queue.length - 1);
      added += 1;
    }
    if (added > 0) {
      this.emit('queue');
      this.persistSoon(400);
    }
    return added;
  }

  removeFromQueue(queueIndex: number): void {
    if (queueIndex < 0 || queueIndex >= this.queue.length) return;
    const currentIndex = this.index;
    const wasCurrent = queueIndex === currentIndex;

    this.queue.splice(queueIndex, 1);
    this.order = this.order
      .filter((index) => index !== queueIndex)
      .map((index) => (index > queueIndex ? index - 1 : index));

    if (this.queue.length === 0) {
      this.stop();
      return;
    }

    if (wasCurrent) {
      this.pos = Math.min(Math.max(this.pos, 0), this.order.length - 1);
      if (this.isPlaying) void this.load(this.queue[this.order[this.pos]], true);
      else this.pendingSeek = 0;
    } else {
      const remapped = currentIndex > queueIndex ? currentIndex - 1 : currentIndex;
      this.pos = Math.max(this.order.indexOf(remapped), 0);
    }

    this.emit('queue');
    this.emit('track');
    this.persistSoon(0);
  }

  /**
   * Drops several tracks at once (deleting a multi-selection). The shuffle
   * order and the current position survive: the playing track keeps playing and
   * a removed current track hands over to its next neighbour.
   */
  removeMany(ids: string[]): number {
    if (ids.length === 0) return 0;
    const removed = new Set(ids);
    const oldQueue = this.queue;
    const keep = oldQueue.map((_, index) => index).filter((index) => !removed.has(oldQueue[index]));
    const dropped = oldQueue.length - keep.length;
    if (dropped === 0) return 0;

    const remap = new Map<number, number>();
    keep.forEach((oldIndex, newIndex) => remap.set(oldIndex, newIndex));

    const currentIndex = this.index;
    const lostCurrent = currentIndex >= 0 && !remap.has(currentIndex);

    this.queue = keep.map((oldIndex) => oldQueue[oldIndex]);
    this.order = this.order
      .filter((oldIndex) => remap.has(oldIndex))
      .map((oldIndex) => remap.get(oldIndex) as number);

    if (this.queue.length === 0) {
      this.stop();
      return dropped;
    }

    if (!lostCurrent) {
      this.pos = Math.max(this.order.indexOf(remap.get(currentIndex) ?? 0), 0);
    } else {
      this.pos = Math.min(Math.max(this.pos, 0), this.order.length - 1);
      if (this.isPlaying) void this.load(this.queue[this.order[this.pos]], true);
      else this.pendingSeek = 0;
    }

    this.emit('queue');
    this.emit('track');
    this.persistSoon(0);
    return dropped;
  }

  moveInQueue(from: number, to: number): void {
    if (from === to || from < 0 || to < 0) return;
    if (from >= this.queue.length || to >= this.queue.length) return;
    const currentIndex = this.index;
    const ids = [...this.queue];
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);

    const remap = (index: number): number => {
      if (index === from) return to;
      if (from < to) return index > from && index <= to ? index - 1 : index;
      return index >= to && index < from ? index + 1 : index;
    };

    this.queue = ids;
    this.order = this.order.map(remap);
    this.pos = Math.max(this.order.indexOf(remap(currentIndex)), 0);
    this.emit('queue');
    this.emit('track');
    this.persistSoon(0);
  }

  /* --------------------------- loading audio -------------------------- */

  private async load(id: string, autoplay: boolean): Promise<void> {
    const track = this.deps.getTrack(id);
    if (!track) {
      this.deps.onError('That track is no longer in the library.');
      return;
    }

    const token = (this.loadToken += 1);
    this.setState('loading');

    let blob: Blob | undefined;
    try {
      blob = await getAudioBlob(id);
    } catch (error) {
      this.deps.onError(`Could not read this track: ${error instanceof Error ? error.message : String(error)}`);
      this.setState('paused');
      return;
    }

    // A faster tap superseded this load; drop the stale result.
    if (token !== this.loadToken) return;
    if (!blob) {
      this.deps.onError('Audio data for this track is missing from the library.');
      this.setState('paused');
      return;
    }

    // Loading a new track pauses on purpose and rebuilds the source anyway, so
    // it must not look like an interruption to the recovery hooks.
    this.wantsPlay = false;
    this.interrupted = false;
    this.recoveries = 0;
    this.audio.pause();
    this.revokeUrls();
    this.audioUrl = URL.createObjectURL(blob);
    this.audio.src = this.audioUrl;
    this.audio.playbackRate = this.rate;
    this.audio.volume = this.volume;
    this.audio.load();
    configureAudioSession();

    this.emit('track');
    setMetadata(track, null);
    this.countedFor = null;

    if (track.hasCover) {
      void getCoverBlob(id)
        .then((cover) => {
          if (!cover || token !== this.loadToken) return;
          this.coverUrl = URL.createObjectURL(cover);
          setMetadata(track, this.coverUrl);
          this.emit('track');
        })
        .catch(() => undefined);
    }

    if (autoplay) {
      await this.play();
    } else {
      this.setState('paused');
      setPlaybackState('paused');
    }
    this.persistSoon(0);
  }

  private handleEnded(): void {
    if (this.repeat === 'one') {
      this.audio.currentTime = 0;
      void this.play();
      return;
    }
    this.next(true);
  }

  /* --------------------------- recovery paths -------------------------- */

  /**
   * Rebuilds the media pipeline without changing tracks. After an interruption
   * iOS hands the element back in a state where it claims to play while the
   * audio session routes nothing (WebKit bug 323022), and simply calling
   * `play()` on it stays mute. Re-attaching the source gives WebKit a fresh
   * renderer, and the session is put back to `playback` while we are here; the
   * position comes back through `pendingSeek` once metadata is available.
   */
  private refreshAudioElement(): void {
    const audio = this.audio;
    this.interrupted = false;
    this.wantsPlay = false;
    this.refreshAt = Date.now();
    this.lastMoveAt = Date.now();
    this.lastMovePos = audio.currentTime;
    // Seeking to the end would finish the track immediately; an ended element
    // restarts from zero on its own.
    if (audio.currentTime > 0.25 && !this.atEnd()) this.pendingSeek = audio.currentTime;
    configureAudioSession();
    audio.volume = this.volume;
    audio.playbackRate = this.rate;
    try {
      audio.load();
    } catch {
      // Ignore: the existing source still plays, and the next tap retries.
    }
    this.emit('time');
  }

  /**
   * Watches for the other half of bug 323022: the element reports
   * `paused === false` while `currentTime` never advances, and fires nothing at
   * all, so polling the clock is the only way to notice. Local blobs never
   * stall on the network, so a frozen clock means a dead session.
   */
  private startWatchdog(): void {
    this.lastMoveAt = Date.now();
    this.lastMovePos = this.currentTime;
    if (this.watchdog !== undefined) return;
    this.watchdog = window.setInterval(() => this.checkProgress(), 2000);
  }

  private stopWatchdog(): void {
    if (this.watchdog === undefined) return;
    window.clearInterval(this.watchdog);
    this.watchdog = undefined;
  }

  private checkProgress(): void {
    const audio = this.audio;
    if (!this.wantsPlay || audio.paused) {
      this.lastMoveAt = Date.now();
      this.lastMovePos = audio.currentTime;
      return;
    }
    const pos = audio.currentTime;
    if (Math.abs(pos - this.lastMovePos) > 0.2) {
      this.lastMoveAt = Date.now();
      this.lastMovePos = pos;
      this.recoveries = 0;
      return;
    }
    if (Date.now() - this.lastMoveAt < 5000) return;
    // Two rebuilds that do not help mean the file itself is the problem; stop
    // rather than loop play() on it forever.
    if (this.recoveries >= 2) {
      this.stopWatchdog();
      return;
    }
    this.recoveries += 1;
    this.lastMoveAt = Date.now();
    this.refreshAudioElement();
    void this.play();
  }

  /* --------------------------- persistence ---------------------------- */

  private persistSoon(delay: number): void {
    if (this.persistTimer !== undefined) window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = undefined;
      this.persistNow();
    }, delay);
  }

  private persistNow(): void {
    if (this.persistTimer !== undefined) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    this.lastPersist = Date.now();
    this.deps.onPersist({
      trackId: this.currentId,
      position: this.currentTime,
      queue: [...this.queue],
      index: this.index,
    });
  }

  private revokeUrls(): void {
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    if (this.coverUrl) URL.revokeObjectURL(this.coverUrl);
    this.audioUrl = null;
    this.coverUrl = null;
  }
}
