import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4399);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: { baseURL, trace: 'on-first-retry' },
  webServer: {
    command: `node tests/support/server.mjs`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    env: { E2E_PORT: String(PORT) },
  },
  projects: [
    // Cross-browser shim lane (@fast). Excludes *.cdp.spec.ts.
    {
      name: 'chromium',
      testIgnore: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testIgnore: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testIgnore: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Safari'] },
    },
    // Chromium-only fidelity lane: real virtual authenticator.
    {
      name: 'chromium-cdp',
      testMatch: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
