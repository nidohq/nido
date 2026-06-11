import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// UI-only assertions migrated from the old account-name.spec.ts (its first
// describe block). No chain, no passkey, no hand-rolled server — these rely on
// the playwright.config webServer serving packages/frontend/dist.
//
// The Nido reskin removed the old `<h1>Contract Account Wallet</h1>` heading and
// gates several sections behind chain/passkey state revealed by JS. We keep only
// the assertions that hold without the chain, adapting selectors to the reskin.

const PORT = Number(process.env.E2E_PORT || 4399);
// Playwright transpiles specs to CommonJS (no "type":"module"), so import.meta
// is unavailable. Resolve dist from the project root (Playwright's cwd).
const DIST_DIR = join(process.cwd(), 'packages/frontend/dist');

// Deterministic fake C-address (valid strkey). The account page derives the
// contractId from the subdomain via contractIdFromHostname() and uppercases it,
// so visiting `<lower>.localhost` yields exactly FAKE_CONTRACT_ID.
const FAKE_CONTRACT_ID = 'CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY';
const ACCOUNT_URL = `http://${FAKE_CONTRACT_ID.toLowerCase()}.localhost:${PORT}/account/`;

test.describe('account page — UI only (no chain) @fast', () => {
  test('built HTML contains name section elements @fast', () => {
    const html = readFileSync(join(DIST_DIR, 'account/index.html'), 'utf-8');
    expect(html).toContain('id="name-section"');
    expect(html).toContain('id="claim-name-inline"');
    expect(html).toContain('id="claim-name-btn"');
    expect(html).toContain('id="name-input"');
  });

  test('page loads without fatal JS errors @fast', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(ACCOUNT_URL, { waitUntil: 'networkidle' });

    // The reskin reveals #home-mode synchronously on load (xe()) for a plain
    // /account/ visit (no ?sign=&callback=), without any chain call. Use it as
    // the "page booted its client script" anchor in place of the removed <h1>.
    await expect(page.locator('#home-mode')).toBeVisible();

    const fatal = errors.filter(
      (e) =>
        e.includes('Buffer') ||
        e.includes('is not defined') ||
        e.includes('Unexpected token'),
    );
    expect(fatal).toEqual([]);
  });

  test('name-claim form is revealed and validates input @fast', async ({ page }) => {
    await page.goto(ACCOUNT_URL, { waitUntil: 'networkidle' });
    await expect(page.locator('#home-mode')).toBeVisible();

    // SHOW_NAME_SECTION is on: on a contract subdomain the JS reveals the
    // claim-name button in the desktop greeting (no chain required). Clicking it
    // reveals the inline form. The claim button is wired to client-side
    // validation — an empty name surfaces the 1-15 chars error before any
    // network call.
    await expect(page.locator('#claim-name-top-btn')).toBeVisible();
    await page.locator('#claim-name-top-btn').click();
    await expect(page.locator('#claim-name-inline')).toBeVisible();
    await expect(page.locator('#claim-name-btn')).toBeVisible();

    await page.locator('#claim-name-btn').click();
    await expect(page.locator('#error-box')).toBeVisible();
    await expect(page.locator('#error-box')).toContainText('1-15 characters');
  });

});

// The XLM-only inline Send panel was retired from the account page in #78 (the
// multi-asset transfer rework): "Send" now opens the dedicated /transfer/ view,
// so the recipient input + its live resolve-status element moved there (renamed
// send-to → to-input, send-resolve → to-resolve). This UI-only check follows them.
test.describe('transfer page — UI only (no chain) @fast', () => {
  test('transfer view exposes a recipient resolve-status element @fast', () => {
    const html = readFileSync(join(DIST_DIR, 'transfer/index.html'), 'utf-8');
    expect(html).toContain('id="to-input"');
    expect(html).toContain('id="to-resolve"');
    expect(html).toContain('placeholder="name, C…, or G…"');
  });
});
