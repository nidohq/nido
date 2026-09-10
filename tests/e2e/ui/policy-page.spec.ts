import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// UI-only assertions for the policy inspector + builder page (the perch
// policy-doc showcase). No chain, no passkey — like account-ui.spec.ts these
// rely on the playwright.config webServer serving packages/frontend/dist,
// plus client-side validation that fires before any network call.

const PORT = Number(process.env.E2E_PORT || 4399);
const DIST_DIR = join(process.cwd(), 'packages/frontend/dist');

// Deterministic fake C-address (valid strkey) — the page derives the account
// from the subdomain via contractIdFromHostname().
const FAKE_CONTRACT_ID = 'CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY';
const POLICY_URL = `http://${FAKE_CONTRACT_ID.toLowerCase()}.localhost:${PORT}/account/policy/`;

test.describe('policy page — UI only (no chain) @fast', () => {
  test('built HTML contains the inspector + doc sections @fast', () => {
    const html = readFileSync(join(DIST_DIR, 'account/policy/index.html'), 'utf-8');
    expect(html).toContain('id="pol-doc-section"');
    expect(html).toContain('id="pol-doc"');
    expect(html).toContain('id="pol-rules"');
    expect(html).toContain('id="pol-builder"');
  });

  test('page loads without fatal JS errors and mounts the doc-mode builder @fast', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(POLICY_URL, { waitUntil: 'networkidle' });

    // The builder mounts synchronously with the doc-mode tab selected; its
    // template form and the raw-rule tab prove the client script booted.
    await expect(page.locator('#pol-mode-doc')).toBeVisible();
    await expect(page.locator('input[name="doc-signer"]')).toBeVisible();
    await expect(page.locator('#pol-mode-raw')).toBeVisible();

    const fatal = errors.filter(
      (e) => e.includes('Buffer') || e.includes('is not defined') || e.includes('Unexpected token'),
    );
    expect(fatal).toEqual([]);
  });

  test('doc-mode template validates input before any network call @fast', async ({ page }) => {
    await page.goto(POLICY_URL, { waitUntil: 'networkidle' });
    await expect(page.locator('input[name="doc-signer"]')).toBeVisible();

    await page.locator('input[name="doc-signer"]').fill('not-an-address');
    await page.locator('input[name="doc-contract"]').fill('also-wrong');
    await page.locator('#pol-doc-submit').click();

    await expect(page.locator('#pol-doc-errors')).toBeVisible();
    await expect(page.locator('#pol-doc-errors')).toContainText('Session key');
    await expect(page.locator('#pol-doc-errors')).toContainText('Target contract');
  });

  test('mode toggle reveals the raw-rule form @fast', async ({ page }) => {
    await page.goto(POLICY_URL, { waitUntil: 'networkidle' });
    await expect(page.locator('#pol-mode-raw')).toBeVisible();

    await page.locator('#pol-mode-raw').click();
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('#pol-add-signer')).toBeVisible();
    // Doc form hides while raw is active.
    await expect(page.locator('input[name="doc-signer"]')).toBeHidden();
  });
});

test.describe('delegate-doc page — UI only (no chain) @fast', () => {
  const SIGNER_G = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
  const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';

  test('rejects a request with a missing origin @fast', async ({ page }) => {
    await page.goto(
      `http://${FAKE_CONTRACT_ID.toLowerCase()}.localhost:${PORT}/security/delegate-doc/` +
        `?target=${TARGET}&signer=${SIGNER_G}&return=https%3A%2F%2Fdapp.example%2F`,
      { waitUntil: 'networkidle' },
    );
    await expect(page.locator('#status')).toContainText('Missing origin');
    await expect(page.locator('#approve')).toBeDisabled();
  });

  test('renders a well-formed doc request with its preview scaffolding @fast', async ({ page }) => {
    await page.goto(
      `http://${FAKE_CONTRACT_ID.toLowerCase()}.localhost:${PORT}/security/delegate-doc/` +
        `?origin=https%3A%2F%2Fdapp.example&target=${TARGET}&signer=${SIGNER_G}` +
        `&functions=udpate_message&duration=24h&label=status-note-session` +
        `&return=https%3A%2F%2Fdapp.example%2Fpage`,
      { waitUntil: 'networkidle' },
    );
    await expect(page.locator('#origin-text')).toHaveText('https://dapp.example');
    await expect(page.locator('#signer-text')).toHaveText(SIGNER_G);
    await expect(page.locator('#functions-text')).toContainText('udpate_message');
    // The document preview builds offline (expiry may still be resolving, but
    // the canonical JSON contains the requested rule name either way).
    await expect(page.locator('#doc-json')).toContainText('status-note-session');
    await expect(page.locator('#approve')).toBeEnabled();
  });
});
