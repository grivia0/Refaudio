import { expect, test, type Page } from '@playwright/test';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FIRST = join(fixtures, 'Tester - First Tone.wav');
const SECOND = join(fixtures, 'Tester - Second Tone.wav');

/** Throwaway copies of a fixture, so the library is longer than one screen. */
function bulkTones(count: number): { dir: string; files: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'refaudio-bulk-'));
  const files: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const target = join(dir, `Bulk ${String(index).padStart(2, '0')}.wav`);
    copyFileSync(FIRST, target);
    files.push(target);
  }
  return { dir, files };
}

async function dismissInstallTip(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Keep Refaudio on your Home Screen' });
  if (await dialog.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Later' }).click();
    await expect(dialog).toBeHidden();
  }
}

async function importTones(page: Page): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add music' }).click();
  await page.getByRole('button', { name: 'Choose files' }).click();
  await (await chooser).setFiles([FIRST, SECOND]);
  await expect(page.getByRole('button', { name: /First Tone/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Second Tone/ }).first()).toBeVisible();
}

test('import, play, queue advance, reload persistence and backup round-trip', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('.brand__name')).toHaveText('Refaudio');
  await page.waitForTimeout(1800);
  await dismissInstallTip(page);

  await test.step('imports both WAV fixtures', async () => {
    await importTones(page);
    await expect(page.locator('.library__meta')).toContainText('2 songs');
  });

  await test.step('plays the first tone and advances the queue', async () => {
    await page.getByRole('button', { name: /First Tone/ }).first().click();

    const mini = page.locator('.mini');
    await expect(mini).toBeVisible();
    await expect(mini.locator('.mini__title')).toHaveText('First Tone');

    // Tapping play must reach the playing state on both engines.
    await mini.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(mini.locator('.mini__btn--play')).toHaveAttribute('aria-label', 'Pause', { timeout: 15_000 });
    await expect(page.locator('.toast--error')).toHaveCount(0);

    await mini.getByRole('button', { name: 'Next track' }).click();
    await expect(mini.locator('.mini__title')).toHaveText('Second Tone');
  });

  await test.step('opens the now playing sheet', async () => {
    await page.locator('.mini__open').click();
    await expect(page.locator('.now')).toHaveClass(/is-open/);
    await expect(page.locator('.now__title')).toHaveText('Second Tone');
    await page.getByRole('button', { name: 'Close player' }).click();
    await expect(page.locator('.now')).not.toHaveClass(/is-open/);
  });

  await test.step('survives a reload', async () => {
    await page.reload();
    await expect(page.locator('.mini')).toBeVisible();
    await expect(page.locator('.mini__title')).toHaveText('Second Tone');
    await expect(page.getByRole('button', { name: /First Tone/ }).first()).toBeVisible();
    await expect(page.locator('.library__meta')).toContainText('2 songs');
  });

  const backupPath = testInfo.outputPath('backup.zip');

  await test.step('exports a backup ZIP', async () => {
    await page.getByRole('tab', { name: 'Settings' }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Backup', exact: true }).click();
    const download = await downloading;
    await download.saveAs(backupPath);
    await expect(page.locator('.toast--success').last()).toContainText('Backup saved');
  });

  await test.step('clears the library', async () => {
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.getByRole('button', { name: 'Delete everything' }).click();
    await expect(page.locator('.toast--success').last()).toContainText('Library cleared');
    await page.getByRole('tab', { name: 'Library' }).click();
    await expect(page.getByText('Your library is empty')).toBeVisible();
  });

  await test.step('restores from the backup', async () => {
    await page.getByRole('tab', { name: 'Settings' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await (await chooser).setFiles(backupPath);
    await expect(page.locator('.toast').last()).toContainText('Restored 2 tracks', { timeout: 30_000 });

    await page.getByRole('tab', { name: 'Library' }).click();
    await expect(page.getByRole('button', { name: /First Tone/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Second Tone/ }).first()).toBeVisible();
    await expect(page.locator('.library__meta')).toContainText('2 songs');
  });
});

test('search filters the library', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1800);
  await dismissInstallTip(page);
  await importTones(page);

  const search = page.locator('.search input');
  await search.fill('second');
  await search.press('Enter');
  await expect(page.getByRole('button', { name: /Second Tone/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /First Tone/ })).toHaveCount(0);
  await expect(page.locator('.library__meta')).toContainText('1 song matched');
});

test('creates a playlist, adds a track and plays it', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1800);
  await dismissInstallTip(page);
  await importTones(page);

  await test.step('adds the first tone to a new playlist', async () => {
    await page.getByRole('button', { name: /First Tone/ }).first().locator('.row__more').click();
    await page.getByRole('button', { name: 'Add to playlist…' }).click();
    await page.getByRole('button', { name: 'New playlist' }).click();

    const name = page.getByLabel('Name');
    await name.fill('Test list');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.locator('.toast').last()).toContainText('Created “Test list”');
  });

  await test.step('opens the playlist and plays it', async () => {
    await page.getByRole('tab', { name: 'Playlists' }).click();
    const card = page.locator('.pl-card', { hasText: 'Test list' });
    await expect(card).toBeVisible();
    await expect(card.locator('.pl-card__meta')).toContainText('1 song');

    await card.click();
    await expect(page.locator('.detail-head__title')).toHaveText('Test list');
    await expect(page.getByRole('button', { name: /First Tone/ }).first()).toBeVisible();

    await page.locator('.detail-head .icon-btn--accent').click();
    await expect(page.locator('.mini__title')).toHaveText('First Tone');
  });
});

test('track menu: like, info, queue and delete', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1800);
  await dismissInstallTip(page);
  await importTones(page);

  const row = page.getByRole('button', { name: /First Tone/ }).first();

  await test.step('likes the track', async () => {
    await row.locator('.row__more').click();
    await expect(page.locator('.action-sheet')).toContainText('Add to Liked');
    await page.getByRole('button', { name: 'Add to Liked' }).click();
    await expect(page.locator('.toast').last()).toContainText('Added to Liked');
  });

  await test.step('queues the track and clears it again', async () => {
    await row.locator('.row__more').click();
    await page.getByRole('button', { name: 'Play next' }).click();
    await expect(page.locator('.mini__title')).toHaveText('First Tone');

    await page.locator('.mini__open').click();
    await page.getByRole('button', { name: 'Open queue' }).click();
    await expect(page.locator('.sheet-panel__title')).toHaveText('Queue');
    await expect(page.locator('.queue-row')).toHaveCount(1);

    await page.locator('.queue-row .queue-tool').last().click();
    await expect(page.locator('.sheet-panel__list .empty')).toBeVisible();
    await page.locator('.sheet-panel__head .icon-btn').click();

    // Removing the last queued track stops playback and closes the sheet.
    await expect(page.locator('.now')).not.toHaveClass(/is-open/);
    await expect(page.locator('.mini')).toBeHidden();
  });

  await test.step('shows track info and deletes the track', async () => {
    await row.locator('.row__more').click();
    await page.getByRole('button', { name: 'Track info' }).click();
    await expect(page.locator('.modal__panel')).toContainText('File size');
    await page.getByRole('button', { name: 'Done' }).click();

    await row.locator('.row__more').click();
    await page.getByRole('button', { name: 'Delete from library' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.locator('.toast').last()).toContainText('Track deleted');
    await expect(page.locator('.library__meta')).toContainText('1 song');
    await expect(page.getByRole('button', { name: /First Tone/ })).toHaveCount(0);
  });
});

test('multi-select fills a playlist, the queue and deletes in bulk', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1800);
  await dismissInstallTip(page);
  await importTones(page);

  await test.step('ticks two rows and creates a playlist from them', async () => {
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await expect(page.locator('.select-bar')).toBeVisible();
    await expect(page.locator('.select-bar__count')).toHaveText('Nothing selected');

    await page.getByRole('button', { name: /First Tone/ }).first().click();
    await page.getByRole('button', { name: /Second Tone/ }).first().click();
    await expect(page.locator('.select-bar__count')).toHaveText('2 songs selected');
    await expect(page.locator('.row.is-selected')).toHaveCount(2);

    await page.getByRole('button', { name: 'Add to playlist' }).click();
    await expect(page.getByRole('dialog', { name: 'Add 2 songs' })).toBeVisible();
    await page.getByRole('button', { name: 'New playlist' }).click();
    await page.getByLabel('Name').fill('Roadtrip');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.locator('.toast').last()).toContainText('Created “Roadtrip” with 2 songs.');
    await expect(page.locator('.select-bar')).toBeHidden();
  });

  await test.step('shows both songs in the new playlist', async () => {
    await page.getByRole('tab', { name: 'Playlists' }).click();
    const card = page.getByRole('button', { name: /Roadtrip/ });
    await expect(card).toContainText('2 songs');
    await card.click();
    await expect(page.locator('.detail-head__sub')).toContainText('2 songs');
    await expect(page.getByRole('button', { name: /First Tone/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Second Tone/ }).first()).toBeVisible();
  });

  await test.step('queues everything with Select all', async () => {
    await page.getByRole('tab', { name: 'Library' }).click();
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.getByRole('button', { name: 'Select all' }).click();
    await expect(page.locator('.select-bar__count')).toHaveText('2 songs selected');
    await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible();

    await page.getByRole('button', { name: 'Add to queue' }).click();
    await expect(page.locator('.toast').last()).toContainText('Playing 2 songs.');
    await expect(page.locator('.select-bar')).toBeHidden();
    await expect(page.locator('.mini')).toBeVisible();
  });

  await test.step('deletes the whole selection', async () => {
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.getByRole('button', { name: 'Select all' }).click();
    await page.getByRole('button', { name: 'Delete selected songs' }).click();

    const dialog = page.getByRole('dialog', { name: 'Delete 2 songs?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.locator('.toast').last()).toContainText('2 songs deleted.');
    await expect(page.locator('.empty-card')).toBeVisible();
    await expect(page.locator('.library__meta')).toHaveText('');
    // The queue held both deleted songs, so playback stops and the mini player goes away.
    await expect(page.locator('.mini')).toBeHidden();
  });
});

test('pulls music from the LAN inbox', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1800);
  await dismissInstallTip(page);

  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Same origin' }).click();
  await page.getByLabel('Server URL').fill('http://127.0.0.1:8765');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'http://127.0.0.1:8765' })).toBeVisible();

  await page.getByRole('button', { name: 'Pull', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Pull from your computer?' })).toBeVisible();
  await page.getByRole('button', { name: 'Download' }).click();

  await expect(page.locator('.toast').last()).toContainText('2 added', { timeout: 45_000 });

  await page.getByRole('tab', { name: 'Library' }).click();
  await expect(page.locator('.library__meta')).toContainText('2 songs');
  await expect(page.getByRole('button', { name: /First Tone/ }).first()).toBeVisible();
});

test('inbox server copes with file names that are not plain ASCII', async ({ request }) => {
  // "Beyoncé – Déjà Vu" used to throw ERR_INVALID_CHAR in writeHead (header
  // values are latin1 only) and took the whole server process down.
  const name = 'Beyoncé – Déjà Vu (昼).wav';
  const copy = join(fixtures, name);
  copyFileSync(FIRST, copy);

  try {
    const listing = await request.get('http://127.0.0.1:8765/api/files');
    expect(listing.status()).toBe(200);
    const { files } = (await listing.json()) as { files: Array<{ name: string; size: number }> };
    const entry = files.find((file) => file.name === name);
    expect(entry).toBeTruthy();

    const response = await request.get(`http://127.0.0.1:8765/api/file/${encodeURIComponent(name)}`);
    expect(response.status()).toBe(200);
    // ASCII fallback for old clients, plus the real name as RFC 5987 UTF-8.
    expect(response.headers()['content-disposition']).toContain("filename*=UTF-8''");
    expect((await response.body()).length).toBe(entry?.size);

    // A stray "%" in the URL used to throw out of the request handler too.
    expect((await request.get('http://127.0.0.1:8765/api/file/%E0%A4%A')).status()).toBe(400);
    expect((await request.get('http://127.0.0.1:8765/api/files')).status()).toBe(200);
  } finally {
    rmSync(copy, { force: true });
  }
});

test('the shell is pinned to the real viewport height', async ({ page }) => {
  // A cold launch on iOS used to lay the app out for a stale viewport, leaving
  // the tab bar a few dozen pixels above the bottom edge until a bounce scroll.
  await page.goto('/');
  await expect(page.locator('.brand__name')).toHaveText('Refaudio');
  await page.waitForTimeout(1800);
  await dismissInstallTip(page);

  const measured = (): Promise<string> =>
    page.evaluate(() => document.documentElement.style.getPropertyValue('--app-vh').trim());

  const height = await page.evaluate(() => window.innerHeight);
  await expect.poll(measured).toBe(`${height}px`);

  const shell = await page.evaluate(() => {
    const tabbar = document.querySelector('.tabbar');
    if (!tabbar) return null;
    return {
      app: Math.round(document.querySelector('.app')?.getBoundingClientRect().height ?? 0),
      dockBottom: Math.round(tabbar.getBoundingClientRect().bottom),
      window: window.innerHeight,
    };
  });
  expect(shell).not.toBeNull();
  // The dock floats a few pixels above the edge, so it must sit *on* the bottom.
  expect(shell?.app).toBe(shell?.window);
  expect(shell?.dockBottom).toBeLessThanOrEqual(shell?.window ?? 0);
  expect(shell?.dockBottom).toBeGreaterThan((shell?.window ?? 0) - 40);

  // Rotating or resizing has to move the footer with the viewport.
  await page.setViewportSize({ width: 390, height: 620 });
  await expect
    .poll(() => page.evaluate(() => Math.round(document.querySelector('.app')?.getBoundingClientRect().height ?? 0)))
    .toBe(620);
  await expect.poll(measured).toBe('620px');
});

test('scrolling reuses rows instead of rebuilding them', async ({ page }) => {
  // Rebuilding rows on every scroll frame re-created each cover <img>, and the
  // gradient behind it showed until the new bitmap decoded: flashing artwork.
  const bulk = bulkTones(24);
  try {
    await page.goto('/');
    await expect(page.locator('.brand__name')).toHaveText('Refaudio');
    await page.waitForTimeout(1800);
    await dismissInstallTip(page);

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add music' }).click();
    await page.getByRole('button', { name: 'Choose files' }).click();
    await (await chooser).setFiles([FIRST, SECOND, ...bulk.files]);
    await expect(page.locator('.library__meta')).toContainText('26 songs', { timeout: 45_000 });

    const mounted = await page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('.scroller .row')];
      // Tag the nodes: a rebuild would replace them and lose the tag.
      for (const row of rows) row.dataset.tag = `row-${row.dataset.index}`;
      return rows.length;
    });
    expect(mounted).toBeGreaterThan(4);

    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.scroller');
      if (scroller) scroller.scrollTop = 180;
    });
    await page.waitForTimeout(250);

    const survivors = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>('.scroller .row')].filter(
          (row) => row.dataset.tag === `row-${row.dataset.index}`,
        ).length,
    );
    expect(survivors).toBeGreaterThan(3);

    // Scrolling back up must mount the first row again.
    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.scroller');
      if (scroller) scroller.scrollTop = 0;
    });
    await expect
      .poll(() => page.evaluate(() => document.querySelectorAll('.scroller .row[data-index="0"]').length))
      .toBe(1);
  } finally {
    rmSync(bulk.dir, { recursive: true, force: true });
  }
});
