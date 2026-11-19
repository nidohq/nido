import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4399);
// Nido's local topology: the main site on nido.localhost, accounts one label
// below it (packages/frontend/src/lib/devHost.ts). Browsers resolve every
// *.localhost name themselves; the server is probed on plain localhost, which
// Node's resolver knows.
const baseURL = `http://nido.localhost:${PORT}`;

// Storage partitioning as browsers ship it. Playwright switches it off by
// default (Chromium's ThirdPartyStoragePartitioning feature, Firefox's
// network.cookie.cookieBehavior 4), which hides a storage bridge split across
// sites, so *.partitioned.spec.ts runs only in the *-partitioned projects.
// Chromium reads only the last --disable-features switch: this one repeats
// Playwright's own list (playwright-core's chromiumSwitches, 1.60) without
// ThirdPartyStoragePartitioning and the Edge-only entries.
const PARTITIONED = /\.partitioned\.spec\.ts$/;
const CHROMIUM_PARTITIONED_ARGS = [
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,' +
    'DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,' +
    'MediaRouter,PaintHolding,Translate,AutoDeElevate,RenderDocument,OptimizationHints',
];

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
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { E2E_PORT: String(PORT) },
  },
  projects: [
    // Fast shim lane (@fast) — only tests/e2e/ui, excluding CDP specs.
    {
      name: 'chromium',
      testDir: 'tests/e2e/ui',
      testIgnore: [/\.cdp\.spec\.m?ts$/, PARTITIONED],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testDir: 'tests/e2e/ui',
      testIgnore: [/\.cdp\.spec\.m?ts$/, PARTITIONED],
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testDir: 'tests/e2e/ui',
      testIgnore: [/\.cdp\.spec\.m?ts$/, PARTITIONED],
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'chromium-partitioned',
      testDir: 'tests/e2e/ui',
      testMatch: PARTITIONED,
      use: { ...devices['Desktop Chrome'], launchOptions: { args: CHROMIUM_PARTITIONED_ARGS } },
    },
    {
      name: 'firefox-partitioned',
      testDir: 'tests/e2e/ui',
      testMatch: PARTITIONED,
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: { firefoxUserPrefs: { 'network.cookie.cookieBehavior': 5 } },
      },
    },
    // Chromium-only fidelity lane: real virtual authenticator.
    {
      name: 'chromium-cdp',
      testDir: 'tests/e2e/ui',
      testMatch: /\.cdp\.spec\.m?ts$/,
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
