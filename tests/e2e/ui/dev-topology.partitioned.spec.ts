import { test, expect } from '@playwright/test';
import { StrKey } from '@stellar/stellar-sdk';

// Local development serves the main site at nido.localhost and each account
// one label below it, so the two share a registrable domain the way nido.fyi
// and <c>.nido.fyi do (packages/frontend/src/lib/devHost.ts). On bare
// localhost every <c>.localhost is a site of its own: with storage partitioned
// as browsers ship it (this spec runs only in the *-partitioned projects), the
// account page's storage bridge writes into a partition the main site never
// reads, and the main site keeps the account on "Finishing setup…".

const PORT = Number(process.env.E2E_PORT || 4399);
const APEX = `http://nido.localhost:${PORT}`;
const A = StrKey.encodeContract(Buffer.alloc(32, 7));
const ACCOUNT = `http://${A.toLowerCase()}.nido.localhost:${PORT}`;

test.describe('@fast local development topology', () => {
  test('the main site sees an account set up on its account address', async ({ page }) => {
    // No chain: balances, names and setup checks fail fast.
    await page.context().route(/^https:\/\//, (route) => route.abort());

    // The main site started the setup, so it lists the account as pending.
    await page.goto(`${APEX}/`);
    await page.evaluate((a) => {
      localStorage.setItem('nido:testnet:pending', JSON.stringify([{ contractId: a, setupKey: 'salt-a' }]));
    }, A);

    // The account's own address finishes it and hands it to the main site
    // through the storage bridge.
    await page.goto(`${ACCOUNT}/account/`);
    await page.evaluate((a) => localStorage.setItem('nido:testnet:accounts', JSON.stringify([a])), A);
    const bridged = page.waitForEvent('framedetached', (f) => f.url().includes('/nido-storage-bridge/'));
    await page.reload();
    await bridged;

    await page.goto(`${APEX}/`);
    await page.locator('[data-mynido-trigger]:visible').first().click();
    const panel = page.locator('[data-mynido-panel]:visible').first();
    await expect(panel.locator(`.mn-row[data-balance-for="${A}"]`)).toBeVisible();
    await expect(panel).not.toContainText('Finishing setup…');
  });
});
