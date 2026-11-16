import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const audioEl = 'audio[data-refaudio-audio]';
const keepAliveEl = 'audio[data-refaudio-keepalive]';

/** A tone long enough for the watchdog and the resume path to have time to run. */
function longTone(seconds: number): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'refaudio-long-'));
  const file = join(dir, `Long Tone ${seconds}s.wav`);
  const rate = 22050;
  const samples = Math.floor(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 0.2 * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
  return { dir, file };
}

async function dismissInstallTip(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Keep Refaudio on your Home Screen' });
  if (await dialog.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Later' }).click();
    await expect(dialog).toBeHidden();
  }
}

async function importFile(page: Page, file: string, title: RegExp): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add music' }).click();
  await page.getByRole('button', { name: 'Choose files' }).click();
  await (await chooser).setFiles([file]);
  await expect(page.getByRole('button', { name: title }).first()).toBeVisible();
}

/** Pretends the screen locked: the page is hidden for the app's checks. */
async function hidePage(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Counts how often the media pipeline is rebuilt (`load()` empties it). */
async function countRebuilds(page: Page): Promise<void> {
  await page.evaluate((sel) => {
    const audio = document.querySelector<HTMLAudioElement>(sel);
    if (!audio) throw new Error('audio element is not mounted');
    const win = window as Window & { rebuilds?: number };
    win.rebuilds = 0;
    audio.addEventListener('emptied', () => {
      win.rebuilds = (win.rebuilds ?? 0) + 1;
    });
  }, audioEl);
}

const rebuilds = (page: Page): Promise<number> =>
  page.evaluate(() => (window as Window & { rebuilds?: number }).rebuilds ?? 0);

/** How often the stubbed `play()` was aborted the way WebKit aborts it. */
const aborts = (page: Page): Promise<number> =>
  page.evaluate(() => (window as Window & { __rfAbort?: { aborts: number } }).__rfAbort?.aborts ?? -1);

const position = (page: Page): Promise<number> =>
  page.evaluate((sel) => document.querySelector<HTMLAudioElement>(sel)?.currentTime ?? 0, audioEl);

const paused = (page: Page): Promise<boolean> =>
  page.evaluate((sel) => document.querySelector<HTMLAudioElement>(sel)?.paused ?? true, audioEl);

/** While paused in the background a silent stream holds the audio session. */
const keepAlive = (page: Page): Promise<boolean> =>
  page.evaluate(
    (sel) => document.querySelector<HTMLAudioElement>(sel)?.paused === false,
    keepAliveEl,
  );

test('resuming after a lock-screen pause rebuilds the audio element', async ({ page }) => {
  // WebKit bug 323022: an interrupted page keeps an element that reports playing
  // while the audio session routes nothing. The source has to be re-attached.
  const tone = longTone(14);
  try {
    await page.goto('/');
    await page.waitForTimeout(1800);
    await dismissInstallTip(page);
    await importFile(page, tone.file, /Long Tone/);

    const mini = page.locator('.mini');
    await page.getByRole('button', { name: /Long Tone/ }).first().click();
    await expect(mini.locator('.mini__btn--play')).toHaveAttribute('aria-label', 'Pause', { timeout: 15_000 });

    // The element is in the document: iOS routes audio better that way.
    await expect(page.locator(audioEl)).toHaveCount(1);

    await expect.poll(() => position(page)).toBeGreaterThan(0.4);
    const pausedAt = await position(page);

    await countRebuilds(page);
    await hidePage(page);

    // The lock-screen pause runs through the same player.pause() the sheet uses.
    await mini.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(mini.locator('.mini__btn--play')).toHaveAttribute('aria-label', 'Play', { timeout: 15_000 });

    // ...and the lock-screen play button through player.play().
    await mini.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(mini.locator('.mini__btn--play')).toHaveAttribute('aria-label', 'Pause', { timeout: 15_000 });

    await expect.poll(() => rebuilds(page), { timeout: 10_000 }).toBeGreaterThan(0);
    // The position carries over into the rebuilt element instead of restarting.
    await expect.poll(() => position(page), { timeout: 10_000 }).toBeGreaterThan(pausedAt - 0.5);
    expect(await paused(page)).toBe(false);
  } finally {
    rmSync(tone.dir, { recursive: true, force: true });
  }
});

test('a frozen playback clock is rebuilt by the watchdog', async ({ page }) => {
  // The other half of the WebKit bug: `paused` is false, `currentTime` never
  // moves and no event fires, so the player has to poll to notice.
  const tone = longTone(20);
  try {
    await page.goto('/');
    await page.waitForTimeout(1800);
    await dismissInstallTip(page);
    await importFile(page, tone.file, /Long Tone/);

    const mini = page.locator('.mini');
    await page.getByRole('button', { name: /Long Tone/ }).first().click();
    await expect(mini.locator('.mini__btn--play')).toHaveAttribute('aria-label', 'Pause', { timeout: 15_000 });

    await countRebuilds(page);
    await page.evaluate((sel) => {
      const audio = document.querySelector<HTMLAudioElement>(sel);
      if (!audio) throw new Error('audio element is not mounted');
      const frozen = audio.currentTime;
      // Freeze the clock the way a dead audio session does.
      Object.defineProperty(audio, 'currentTime', { configurable: true, get: () => frozen, set: () => undefined });
      Object.defineProperty(audio, 'paused', { configurable: true, get: () => false });
    }, audioEl);

    await expect.poll(() => rebuilds(page), { timeout: 20_000 }).toBeGreaterThan(0);
  } finally {
    rmSync(tone.dir, { recursive: true, force: true });
  }
});

test('a lock-screen pause holds the audio session open for the next resume', async ({ page }) => {
  // iOS only lets a page pick its audio-session category while it is audible, so
  // a pause on the lock screen leaves the app unable to make the following
  // resume audible until it is opened again. A looping silent stream keeps the
  // session alive in between, which is what the lock-screen button needs.
  const tone = longTone(14);
  try {
    await page.goto('/');
    await page.waitForTimeout(1800);
    await dismissInstallTip(page);
    await importFile(page, tone.file, /Long Tone/);

    const mini = page.locator('.mini');
    await page.getByRole('button', { name: /Long Tone/ }).first().click();
    await expect(mini.locator('.mini__btn--play')).toHaveAttribute('aria-label', 'Pause', { timeout: 15_000 });
    await expect.poll(() => position(page)).toBeGreaterThan(0.4);

    await hidePage(page);
    await mini.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(mini.locator('.mini__btn--play')).toHaveAttribute('aria-label', 'Play', { timeout: 15_000 });

    // The track is paused; the session is still held by the silent stream.
    expect(await paused(page)).toBe(true);
    await expect(page.locator(keepAliveEl)).toHaveCount(1);
    await expect.poll(() => keepAlive(page), { timeout: 10_000 }).toBe(true);

    // The lock-screen play button then resumes into a live session instead of
    // reporting playing while routing nothing.
    await mini.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(mini.locator('.mini__btn--play')).toHaveAttribute('aria-label', 'Pause', { timeout: 15_000 });
    await expect.poll(() => position(page), { timeout: 10_000 }).toBeGreaterThan(1);

    // The stream hands the session over and disappears, so it never plays twice.
    await expect(page.locator(keepAliveEl)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('.toast--error')).toHaveCount(0);
  } finally {
    rmSync(tone.dir, { recursive: true, force: true });
  }
});

test('the iOS audio session is put back to playback on every start', async ({ page }) => {
  // iOS resets the category while the app is hidden; `auto` is the category that
  // plays with no sound, so every start and every unlock re-asserts it.
  await page.addInitScript(() => {
    const session = { type: 'auto' };
    Object.defineProperty(navigator, 'audioSession', { configurable: true, get: () => session });
  });

  const readType = (): Promise<string> =>
    page.evaluate(() => (navigator as Navigator & { audioSession?: { type: string } }).audioSession?.type ?? 'missing');

  await page.goto('/');
  await page.waitForTimeout(1800);
  await dismissInstallTip(page);
  expect(await readType()).toBe('playback');

  // iOS drops the category back to `auto` when the app is interrupted.
  await page.evaluate(() => {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'auto';
  });

  await importFile(page, join(fixtures, 'Tester - First Tone.wav'), /First Tone/);
  await page.getByRole('button', { name: /First Tone/ }).first().click();
  await expect(page.locator('.mini__btn--play')).toHaveAttribute('aria-label', 'Pause', { timeout: 15_000 });
  expect(await readType()).toBe('playback');
});

test('an aborted resume is retried instead of reported as a failure', async ({ page }) => {
  // iOS rejects a `play()` that overlaps the rebuild with
  // `AbortError: The operation aborted`. That used to reach the user as
  // "Playback failed: Operation aborted" and left the track sitting paused.
  await page.addInitScript(() => {
    const proto = HTMLMediaElement.prototype;
    const original = proto.play;
    const state = { abortNext: false, aborts: 0 };
    (window as Window & { __rfAbort?: typeof state }).__rfAbort = state;
    proto.play = function play(this: HTMLMediaElement): Promise<void> {
      if (state.abortNext) {
        state.abortNext = false;
        state.aborts += 1;
        return Promise.reject(new DOMException('The operation aborted.', 'AbortError'));
      }
      return original.call(this);
    };
  });

  const tone = longTone(14);
  try {
    await page.goto('/');
    await page.waitForTimeout(1800);
    await dismissInstallTip(page);
    await importFile(page, tone.file, /Long Tone/);

    const mini = page.locator('.mini');
    await page.getByRole('button', { name: /Long Tone/ }).first().click();
    await expect(mini.locator('.mini__btn--play')).toHaveAttribute('aria-label', 'Pause', { timeout: 15_000 });
    await expect.poll(() => position(page)).toBeGreaterThan(0.4);

    // The lock-screen pause arms the rebuild that the resume has to wait for.
    await hidePage(page);
    await mini.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(mini.locator('.mini__btn--play')).toHaveAttribute('aria-label', 'Play', { timeout: 15_000 });

    // Let the resume be the call WebKit aborts.
    await page.evaluate(() => {
      const state = (window as Window & { __rfAbort?: { abortNext: boolean } }).__rfAbort;
      if (state) state.abortNext = true;
    });
    await mini.getByRole('button', { name: 'Play', exact: true }).click();

    // Exactly one aborted attempt, then the retry plays; nothing blames the file.
    await expect.poll(() => aborts(page), { timeout: 10_000 }).toBe(1);
    await expect(mini.locator('.mini__btn--play')).toHaveAttribute('aria-label', 'Pause', { timeout: 15_000 });
    await expect.poll(() => position(page), { timeout: 10_000 }).toBeGreaterThan(1);
    await expect(page.locator('.toast--error')).toHaveCount(0);
    expect(await paused(page)).toBe(false);
  } finally {
    rmSync(tone.dir, { recursive: true, force: true });
  }
});
