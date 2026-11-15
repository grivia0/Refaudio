import { defineConfig, type Project } from '@playwright/test';
import { join } from 'node:path';

const PORT = 4173;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * The suite targets an iPhone 11-sized viewport with a Safari user agent, because
 * that is the device this app is built for. Chromium runs by default; set
 * PLAYWRIGHT_WEBKIT=1 to also run the same specs in WebKit (needs its system
 * libraries, which rolling distros like CachyOS may not provide).
 */
const projects: Project[] = [{ name: 'chromium', use: { browserName: 'chromium' } }];
if (process.env.PLAYWRIGHT_WEBKIT === '1') {
  projects.push({ name: 'webkit', use: { browserName: 'webkit' } });
}

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects,
  webServer: [
    {
      command: `npm run preview -- --port ${PORT} --strictPort`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Same zero-dependency server users run, pointed at the WAV fixtures.
      command: `INBOX_DIR=${join(process.cwd(), 'tests', 'fixtures')} PORT=8765 node scripts/inbox-server.mjs`,
      url: 'http://127.0.0.1:8765/api/files',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
