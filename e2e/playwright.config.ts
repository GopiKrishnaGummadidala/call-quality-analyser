import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a real, running stack (frontend + API + PostgreSQL), by default the
 * docker compose setup on https://localhost:8443 (self-signed certificate). Every test starts from freshly re-seeded data
 * (see fixtures.ts), so tests run one at a time against the shared database.
 *
 *   E2E_BASE_URL   target (default https://localhost:8443; use http://localhost:5173 for `npm run dev`)
 *   E2E_CHANNEL    browser channel; defaults to the installed Google Chrome ("chrome").
 *                  No Chrome on the machine? `npx playwright install chrome` installs it.
 */
const channel = process.env.E2E_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://localhost:8443',
    // The local stack uses a self-signed certificate; a real deployment would not need this.
    ignoreHTTPSErrors: true,
    channel,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Video needs Playwright's ffmpeg (`npx playwright install ffmpeg`); opt in with E2E_VIDEO=1.
    video: process.env.E2E_VIDEO ? 'retain-on-failure' : 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], channel },
      testMatch: /smoke\.spec\.ts/, // the full suite runs on desktop; phones get a smoke pass
    },
  ],
});
