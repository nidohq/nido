import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.E2E_PORT || 4399);
const baseURL = `http://localhost:${PORT}`;
const ADSUM_PORT = Number(process.env.E2E_ADSUM_PORT || 4401);

// examples/adsum/dist is a build artifact (gitignored) -- only present when
// `cd examples/adsum && npm run build` has been run. A fresh checkout (and,
// notably, CI unless it explicitly builds the example -- see the e2e job's
// "Build adsum example" step) won't have it. Gating the webServer entry on
// its presence keeps a missing dist from taking down the whole @fast lane:
// Playwright's array-form `webServer` waits on every entry's readiness probe
// before starting any tests, so one entry that 404s forever times out the
// entire run. tests/e2e/ui/adsum.spec.ts skips itself the same way.
const adsumDist = join(__dirname, 'examples/adsum/dist');
const adsumServerEntry = {
  command: `node tests/support/adsum-server.mjs`,
  url: `http://localhost:${ADSUM_PORT}`,
  reuseExistingServer: !process.env.CI,
  env: { E2E_ADSUM_PORT: String(ADSUM_PORT) },
};

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
    // it can be navigated directly against a chain-mocked RPC. Only included
    // when its dist is built -- see the adsumDist comment above.
    ...(existsSync(adsumDist) ? [adsumServerEntry] : []),
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
