import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4399);
const baseURL = `http://localhost:${PORT}`;
const ADSUM_PORT = Number(process.env.E2E_ADSUM_PORT || 4401);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: { baseURL, trace: 'on-first-retry' },
  webServer: [
    {
      command: `node tests/support/server.mjs`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      env: { E2E_PORT: String(PORT) },
    },
    // Adsum example dApp (tests/e2e/ui/adsum.spec.ts), served standalone so
    // it can be navigated directly against a chain-mocked RPC.
    {
      command: `node tests/support/adsum-server.mjs`,
      url: `http://localhost:${ADSUM_PORT}`,
      reuseExistingServer: !process.env.CI,
      env: { E2E_ADSUM_PORT: String(ADSUM_PORT) },
    },
  ],
  projects: [
    // Fast shim lane (@fast) — only tests/e2e/ui, excluding CDP specs.
    {
      name: 'chromium',
      testDir: 'tests/e2e/ui',
      testIgnore: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testDir: 'tests/e2e/ui',
      testIgnore: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testDir: 'tests/e2e/ui',
      testIgnore: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Safari'] },
    },
    // Chromium-only fidelity lane: real virtual authenticator.
    {
      name: 'chromium-cdp',
      testDir: 'tests/e2e/ui',
      testMatch: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Quarantined real-testnet tier — separate dir, extra retries.
    {
      name: 'testnet-chromium',
      testDir: 'tests/e2e/testnet',
      retries: 2,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'testnet-webkit',
      testDir: 'tests/e2e/testnet',
      retries: 2,
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
