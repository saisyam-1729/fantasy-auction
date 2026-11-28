import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests: real browsers against a local dev server and the real Supabase
 * project named in .env.local. Run with `npm run e2e` (see e2e/README in the repo README).
 *
 * They create throwaway users (@e2e.invalid) and rooms named E2E..., and delete
 * everything again afterwards (e2e/global-teardown.ts, or `npm run e2e:cleanup`).
 * Locally they use your installed Chrome; set E2E_CHANNEL= (empty) to use
 * Playwright's own Chromium after `npx playwright install chromium`.
 */
const channel = process.env.E2E_CHANNEL === undefined ? 'chrome' : process.env.E2E_CHANNEL || undefined

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  // the tests share one set of users and rooms, so run one at a time
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:3100',
    channel,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1366, height: 800 },
  },
  webServer: {
    command: 'npm run dev -- --port 3100',
    url: 'http://localhost:3100/auth',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
