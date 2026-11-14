import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a running Tesorero stack.
 * - Local (default): `bash run-local.sh` starts a fresh API (:5080) + `vite preview` (:4173) and runs everything.
 * - Production smoke (non-mutating): E2E_BASE_URL=https://near.gesco.ec npx playwright test --project=responsive --project=pwa
 */
// localhost is the landing (multitenancy, ADR-0006); the demo tenant lives at demo.localhost.
const baseURL = process.env.E2E_BASE_URL ?? 'http://demo.localhost:4173';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    colorScheme: 'light',
  },
  projects: [
    // Functional flows mutate data: they run in order on a fresh database.
    { name: 'flows', testMatch: /flows\/.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    // Read-only checks: layout, accessibility and screenshots at four sizes.
    { name: 'responsive', testMatch: /responsive\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'pwa', testMatch: /pwa\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
});
