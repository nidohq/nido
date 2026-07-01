import { test, expect } from '../../support/fixtures';
import { seedBank, uniqueName } from '../../support/testnet';
import { createNidoAccount } from '../../support/createFlow';

const PORT = Number(process.env.E2E_PORT || 4399);

// Real-chain: slow + retried. Quarantined via the testnet-* projects.
test.describe('@testnet send to a named nido', () => {
  // 360s: two account creations + claim + send; relayer-mode submission adds
  // ~20-30s per signAndSubmit (queue + fee-bump + confirmation polling).
  test.describe.configure({ timeout: 360_000 });

  // Create an account via the My Nido menu, register its passkey (shim), return
  // its C-address + subdomain host. The page host must be the C-address subdomain
  // so WebAuthn rpId matches the shim credential.
  const createAccount = (page: import('@playwright/test').Page) => createNidoAccount(page, PORT);

  test('claim a name on the recipient, then send to it by name', async ({ page, context }) => {
    await seedBank(context);

    // 1) Recipient account + claim a unique name.
    const recipient = await createAccount(page);
    const name = uniqueName('t', Date.now());
    await page.goto(`http://${recipient.host}/account/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#name-claim')).toBeVisible({ timeout: 30_000 });
    await page.locator('#name-input').fill(name);
    await page.locator('#claim-name-btn').click();
    await page.waitForURL('**/account/?sign=**', { timeout: 90_000 });
    await page.locator('#approve-btn').click();
    // Claim lands → page redirects to the name subdomain.
    await page.waitForURL((u) => u.hostname.startsWith(`${name}.`), { timeout: 120_000 });

    // 2) Sender account (fresh context state via a second account on the same page).
    const sender = await createAccount(page);
    await page.goto(`http://${sender.host}/account/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-mode')).toBeVisible({ timeout: 30_000 });

    // 3) "Send" navigates to the /transfer/ view (#78 retired the inline
    //    panel). #send-action lives in .home-actions-mobile, which is
    //    display:none at the desktop viewport these projects run — click
    //    whichever .js-send control is visible in the current layout.
    await page.locator('.js-send:visible').first().click();
    await page.waitForURL('**/transfer/**', { timeout: 30_000 });
    await page.locator('#to-input').fill(name);
    await expect(page.locator('#to-resolve')).toContainText(`${name} →`, { timeout: 30_000 });

    // 4) Review, then confirm with the passkey (shim get() auto-approves).
    //    Review silently no-ops until the asset picker has loaded holdings
    //    (curated-list fetches + ledger probes) — wait for it to enable.
    await expect(page.locator('#asset-select')).toBeEnabled({ timeout: 60_000 });
    await page.locator('#amount-input').fill('1');
    await page.locator('#review-btn').click();
    await expect(page.locator('#confirm-btn')).toBeVisible({ timeout: 60_000 });
    await page.locator('#confirm-btn').click();
    // Positive success signal: the result step only appears after
    // signAndSubmit resolves, and its explorer link carries the tx hash
    // (real in both relayer and classic mode).
    await expect(page.locator('#result-step')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('#result-explorer')).toHaveAttribute('href', /\/tx\/[0-9a-f]{64}$/i);

    // 5) Assert the recipient received it: balance on its name subdomain is > 0.
    //    (#xlm-balance is the hero balance element; it renders "…" until the
    //    on-chain read completes, so a digit is the durable signal.)
    await page.goto(`http://${name}.localhost:${PORT}/account/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#xlm-balance')).toContainText(/\d/, { timeout: 60_000 });
  });
});
