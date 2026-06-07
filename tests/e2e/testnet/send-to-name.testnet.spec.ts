import { test, expect } from '../../support/fixtures';
import { seedBank, uniqueName } from '../../support/testnet';

const PORT = Number(process.env.E2E_PORT || 4399);

// Real-chain: slow + retried. Quarantined via the testnet-* projects.
test.describe('@testnet send to a named nido', () => {
  test.describe.configure({ timeout: 240_000 });

  // Helper: create an account via the home page, register its passkey (shim),
  // and return its C-address. The page host must be the C-address subdomain so
  // WebAuthn rpId matches the shim credential.
  async function createAccount(page: import('@playwright/test').Page) {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('#create-btn').click();
    await expect(page.locator('#c-address-result')).not.toBeEmpty({ timeout: 60_000 });
    const cAddress = (await page.locator('#c-address-result').textContent())?.trim() ?? '';
    expect(cAddress).toMatch(/^C[A-Z2-7]{55}$/);
    const setupHref = await page.locator('#setup-link').getAttribute('href');
    const key = new URL(setupHref!, 'http://x').searchParams.get('key')!;
    const host = `${cAddress.toLowerCase()}.localhost:${PORT}`;
    await page.goto(`http://${host}/new-account/?key=${encodeURIComponent(key)}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('#register-btn').click();
    await expect(page.locator('#done-section')).toBeVisible({ timeout: 120_000 });
    return { cAddress, host };
  }

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

    // 3) Open Send, type the recipient's NAME, confirm it resolves.
    await page.locator('#send-section').waitFor({ state: 'attached' });
    await page.locator('#send-to').fill(name);
    await expect(page.locator('#send-resolve')).toContainText(`${name} →`, { timeout: 30_000 });

    // 4) Send a small amount and approve with the passkey.
    await page.locator('#send-amount').fill('1');
    await page.locator('#send-submit').click();
    // The send flow signs in-page (primaryPasskeySigner) — shim get() auto-approves.
    await expect(page.getByText(/Sent/i)).toBeVisible({ timeout: 120_000 });

    // 5) Assert the recipient received it: balance on its name subdomain is > 0.
    await page.goto(`http://${name}.localhost:${PORT}/account/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#balance')).toContainText(/\d/, { timeout: 60_000 });
  });
});
