import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Captures screenshots for manual review; no assertions beyond "it rendered". */
test('capture screens', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForTimeout(1800);
  const later = page.getByRole('button', { name: 'Later' });
  if (await later.isVisible().catch(() => false)) await later.click();

  await page.screenshot({ path: testInfo.outputPath('01-empty.png') });

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add music' }).click();
  await page.getByRole('button', { name: 'Choose files' }).click();
  await (await chooser).setFiles([
    join(fixtures, 'Tester - First Tone.wav'),
    join(fixtures, 'Tester - Second Tone.wav'),
  ]);

  await expect(page.getByRole('button', { name: /First Tone/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /First Tone/ }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('02-library.png') });

  await page.locator('.mini__open').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('03-now-playing.png') });
  await page.getByRole('button', { name: 'Close player' }).click();

  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('04-settings.png'), fullPage: true });

  await page.getByRole('tab', { name: 'Playlists' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('05-playlists.png') });

  await page.getByRole('tab', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: /First Tone/ }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('06-selecting.png') });
});
