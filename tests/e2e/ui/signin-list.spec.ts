import { StrKey } from '@stellar/stellar-sdk';
import { test, expect } from '../../support/fixtures';
import type { Page } from '@playwright/test';
import { ACCOUNT, APEX, accountOrigin, mockSetupChain, reads } from '../../support/setupFlowMock';

// The sign-in list: the accounts nido.fyi/connect/ offers a dApp. Each test
// runs on the wallet built for mainnet (see setupFlowMock.ts for the build),
// served under real-looking https hosts, with the chain and relayer mocked.
//
// On mainnet a new account reaches that list only through the storage bridge:
// its own origin (`<c>.nido.fyi`) frames the apex's bridge page, which stores
// it. A bridge that answered too slowly used to drop the account for good,
// and the chooser and bridge read and wrote the testnet namespace.

const DAPP = 'https://blog.example';
const SALT = '5a'.repeat(32);
const CONNECT = `https://${APEX}/connect/?dapp=${encodeURIComponent(DAPP)}&return=${encodeURIComponent(`${DAPP}/cb`)}`;
const OTHER = StrKey.encodeContract(Buffer.alloc(32, 0x0d));

/** Reserve an address on the apex and register a passkey on its own origin,
 *  up to the recovery choice. */
async function startSetup(page: Page) {
  await page.goto(`https://${APEX}/new-account/?setup=1#salt=${SALT}`);
  await page.locator('#preparing-continue').click();
  await page.waitForURL(`${accountOrigin(ACCOUNT)}/new-account/**`);
  await expect(page.locator('#recovery-enroll-section')).toBeVisible({ timeout: 15_000 });
}

/** Run account setup to the end: the hand-off to the new account's page. */
async function runSetup(page: Page) {
  await startSetup(page);
  await page.locator('#enroll-continue').click();
  await page.waitForURL(`${accountOrigin(ACCOUNT)}/account/`, { timeout: 45_000 });
}

async function chooserRows(page: Page) {
  await page.goto(CONNECT);
  await expect(page.locator('#accounts-checking')).toBeHidden({ timeout: 20_000 });
  return page.locator('#accounts-list .account-row');
}

async function apexStorage(page: Page): Promise<Record<string, string>> {
  await page.goto(`https://${APEX}/__blank`);
  return page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
}

test.describe('@fast sign-in list after account setup (mainnet build)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('a bridge slower than a second still lists the new account', async ({ context, page }) => {
    const chain = await mockSetupChain(context, { bridgeDelayMs: 1_500 });
    await runSetup(page);
    expect(chain.bridgeLoads).toBeGreaterThan(0);

    const rows = await chooserRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(ACCOUNT);
  });

  test('the chooser, the bridge and the home menu use the mainnet namespace', async ({ context, page }) => {
    await mockSetupChain(context);
    await runSetup(page);

    const stored = await apexStorage(page);
    expect(JSON.parse(stored['nido:mainnet:accounts'] ?? '[]')).toEqual([ACCOUNT]);
    expect(Object.keys(stored).filter((k) => k.startsWith('nido:testnet:'))).toEqual([]);

    const rows = await chooserRows(page);
    await expect(rows).toHaveCount(1);

    await page.goto(`https://${APEX}/`);
    const menu = page.locator('.mynido').filter({ has: page.locator('[data-mynido-trigger]:visible') }).first();
    await menu.locator('[data-mynido-trigger]').click();
    await expect(menu.locator('.mn-row')).toHaveCount(1);
    await expect(menu.locator('.mn-pending')).toHaveCount(0);
    await expect(menu.locator('.mn-row')).not.toContainText('Finishing setup');
  });

  test('a setup whose funding failed is still listed', async ({ context, page }) => {
    await mockSetupChain(context, { fundFails: true });
    await startSetup(page);
    await page.locator('#enroll-continue').click();
    await expect(page.locator('#error-box')).toContainText("Couldn't finish setting up your wallet", {
      timeout: 30_000,
    });

    const chooser = await context.newPage();
    const rows = await chooserRows(chooser);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(ACCOUNT);
  });

  test('an unanswered handoff is shown, retried, and lands', async ({ context, page }) => {
    const chain = await mockSetupChain(context);
    chain.bridgeDown = true;
    await runSetup(page);

    const notice = page.locator('.signin-notice');
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText('Not in your sign-in list yet');

    chain.bridgeDown = false;
    await notice.locator('button').click();
    await expect(notice).toBeHidden({ timeout: 20_000 });

    const rows = await chooserRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(ACCOUNT);
  });

  test('a setup whose secret expired is finished once its account exists', async ({ context, page }) => {
    await mockSetupChain(context, { deployed: [ACCOUNT] });
    // The apex keeps the address of a setup whose secret expired; this
    // browser holds the passkey the account was created with.
    await page.goto(`https://${APEX}/__blank`);
    await page.evaluate((id) => localStorage.setItem('nido:mainnet:pending', JSON.stringify([{ contractId: id }])), ACCOUNT);
    await page.goto(`${accountOrigin(ACCOUNT)}/__blank`);
    await page.evaluate(
      ({ id, key }) => {
        localStorage.setItem(`passkey:${id}:credentialId`, 'Y3JlZA');
        localStorage.setItem(`passkey:${id}:publicKey`, key);
      },
      { id: ACCOUNT, key: reads.ownerKey },
    );

    await page.goto(CONNECT);
    const finish = page.locator('#unfinished-list a.finish-setup');
    await expect(finish).toHaveAttribute('href', `//${ACCOUNT.toLowerCase()}.${APEX}/new-account/`);

    await page.goto(`${accountOrigin(ACCOUNT)}/new-account/`);
    await page.waitForURL(`${accountOrigin(ACCOUNT)}/account/`, { timeout: 45_000 });
    const rows = await chooserRows(page);
    await expect(rows).toHaveCount(1);
    await expect(page.locator('#unfinished-list .account-row')).toHaveCount(0);
  });

  test('an unfinished setup is shown with a way to finish it, and is not offered', async ({ context, page }) => {
    await mockSetupChain(context);
    await page.goto(`https://${APEX}/new-account/?setup=1#salt=${SALT}`);
    await expect(page.locator('#preparing-continue')).toBeEnabled({ timeout: 15_000 });

    const rows = await chooserRows(page);
    await expect(rows).toHaveCount(0);
    const unfinished = page.locator('#unfinished-list .account-row');
    await expect(unfinished).toHaveCount(1);
    await expect(unfinished).toContainText('Setup not finished');
    await expect(unfinished.locator('a.finish-setup')).toHaveAttribute(
      'href',
      `//${ACCOUNT.toLowerCase()}.${APEX}/new-account/#salt=${SALT}`,
    );
    await expect(page.locator('#no-accounts')).toBeHidden();
  });
});

test.describe('@fast sign-in list migration (mainnet build)', () => {
  test.describe.configure({ timeout: 60_000 });

  test('keeps a mainnet account this browser holds a passkey for, drops the rest, once', async ({
    context,
    page,
  }) => {
    await mockSetupChain(context, { deployed: [ACCOUNT] });
    // This browser registered ACCOUNT's passkey on its own origin; OTHER was
    // only ever visited.
    await page.goto(`${accountOrigin(ACCOUNT)}/__blank`);
    await page.evaluate((id) => {
      localStorage.setItem(`passkey:${id}:credentialId`, 'Y3JlZA');
      localStorage.setItem(`passkey:${id}:publicKey`, `04${'ab'.repeat(64)}`);
    }, ACCOUNT);
    // What the mainnet chooser and bridge wrote before the fix.
    await page.goto(`https://${APEX}/__blank`);
    await page.evaluate(
      ([a, b]) => localStorage.setItem('nido:testnet:accounts', JSON.stringify([a, b])),
      [ACCOUNT, OTHER],
    );

    const rows = await chooserRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(ACCOUNT);

    const after = await apexStorage(page);
    expect(JSON.parse(after['nido:mainnet:accounts']!)).toEqual([ACCOUNT]);
    expect(after['nido:testnet:accounts']).toBeUndefined();
    expect(after['nido:mainnet:accounts:migrated:v1']).toBeTruthy();

    // A second run changes nothing, even with an entry added since.
    await page.evaluate((b) => localStorage.setItem('nido:testnet:accounts', JSON.stringify([b])), OTHER);
    await chooserRows(page);
    expect(await apexStorage(page)).toEqual({ ...after, 'nido:testnet:accounts': JSON.stringify([OTHER]) });

    // The passkey record is untouched.
    await page.goto(`${accountOrigin(ACCOUNT)}/__blank`);
    expect(await page.evaluate((id) => localStorage.getItem(`passkey:${id}:publicKey`), ACCOUNT)).toBeTruthy();
  });
});
