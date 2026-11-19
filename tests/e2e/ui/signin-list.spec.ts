import { StrKey } from '@stellar/stellar-sdk';
import { test, expect } from '../../support/fixtures';
import type { BrowserContext, Page } from '@playwright/test';
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

/**
 * WebKit's storage model (Safari, and every browser on iOS): a frame whose
 * origin differs from the top page's gets its own localStorage, apart from
 * that origin's real storage, even when both are one site. Playwright's
 * WebKit doesn't do this, and Chromium and Firefox share a same-site frame's
 * storage, so the storage bridge looked fine in every engine here. This
 * imitates it in any engine.
 */
async function emulateWebKitPartitioning(context: BrowserContext) {
  await context.addInitScript(() => {
    if (window.top === window) return;
    const ancestors = location.ancestorOrigins;
    const top = ancestors?.length
      ? ancestors[ancestors.length - 1]!
      : document.referrer
        ? new URL(document.referrer).origin
        : null;
    if (!top || top === location.origin) return;
    const real = window.localStorage;
    const prefix = `__partition(${top})__`;
    const keys = () => {
      const out: string[] = [];
      for (let i = 0; i < real.length; i++) {
        const key = real.key(i);
        if (key?.startsWith(prefix)) out.push(key.slice(prefix.length));
      }
      return out;
    };
    const partitioned = {
      getItem: (key: string) => real.getItem(prefix + key),
      setItem: (key: string, value: string) => real.setItem(prefix + key, String(value)),
      removeItem: (key: string) => real.removeItem(prefix + key),
      clear: () => keys().forEach((key) => real.removeItem(prefix + key)),
      key: (i: number) => keys()[i] ?? null,
      get length() {
        return keys().length;
      },
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => partitioned });
  });
}

/** Open the apex's My Nido menu. */
async function openApexMenu(page: Page) {
  await page.goto(`https://${APEX}/`);
  const menu = page.locator('.mynido').filter({ has: page.locator('[data-mynido-trigger]:visible') }).first();
  await menu.locator('[data-mynido-trigger]').click();
  return menu;
}

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

/** This browser's own origin for ACCOUNT holds it as active, with its passkey. */
async function seedActiveAccount(page: Page) {
  await page.goto(`${accountOrigin(ACCOUNT)}/__blank`);
  await page.evaluate(
    ({ id, key }) => {
      localStorage.setItem('nido:mainnet:accounts', JSON.stringify([id]));
      localStorage.setItem(`passkey:${id}:credentialId`, 'Y3JlZA');
      localStorage.setItem(`passkey:${id}:publicKey`, key);
    },
    { id: ACCOUNT, key: reads.ownerKey },
  );
}

test.describe('@fast sign-in list after account setup (mainnet build)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('a bridge slower than a second still lists the new account', async ({ context, page }) => {
    const chain = await mockSetupChain(context, { bridgeDelayMs: 1_500 });
    await runSetup(page);
    expect(chain.bridgeLoads).toBeGreaterThan(0);
    // The bridge listed it: the way to the wallet didn't need the apex.
    expect(chain.handoffLoads).toBe(0);

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

    const menu = await openApexMenu(page);
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

  test('a handoff the bridge never answered lands through the apex', async ({ context, page }) => {
    const chain = await mockSetupChain(context);
    chain.bridgeDown = true;
    await runSetup(page);
    expect(chain.handoffLoads).toBe(1);
    await expect(page.locator('.signin-notice')).toBeHidden();

    const rows = await chooserRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(ACCOUNT);
  });

  test('an unanswered handoff is shown, retried, and lands', async ({ context, page }) => {
    // Funding fails, so setup stays on its page instead of going on to the
    // wallet (through the apex).
    const chain = await mockSetupChain(context, { fundFails: true });
    chain.bridgeDown = true;
    await startSetup(page);
    await page.locator('#enroll-continue').click();

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

  test('a setup whose secret expired is finished on a chain read slower than the passkey-step cap', async ({
    context,
    page,
  }) => {
    await mockSetupChain(context, { deployed: [ACCOUNT], firstChainReadDelayMs: 6_000 });
    await page.goto(`${accountOrigin(ACCOUNT)}/__blank`);
    await page.evaluate(
      ({ id, key }) => {
        localStorage.setItem(`passkey:${id}:credentialId`, 'Y3JlZA');
        localStorage.setItem(`passkey:${id}:publicKey`, key);
      },
      { id: ACCOUNT, key: reads.ownerKey },
    );

    await page.goto(`${accountOrigin(ACCOUNT)}/new-account/`);
    await page.waitForURL(`${accountOrigin(ACCOUNT)}/account/`, { timeout: 60_000 });
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

  test('a setup abandoned past its 30 minutes, whose address holds no account, is dropped', async ({
    context,
    page,
  }) => {
    await mockSetupChain(context);
    // Reserved 31 minutes ago and never finished: no passkey, no account.
    await page.goto(`https://${APEX}/__blank`);
    await page.evaluate(
      ({ id, salt }) => {
        localStorage.setItem('nido:mainnet:pending', JSON.stringify([{ contractId: id, setupKey: salt }]));
        localStorage.setItem('nido:mainnet:pending:ts', JSON.stringify({ [id]: Date.now() - 31 * 60_000 }));
      },
      { id: ACCOUNT, salt: SALT },
    );

    const menu = await openApexMenu(page);
    await expect(menu.locator('.mn-pending')).toHaveCount(0);
    await chooserRows(page);
    await expect(page.locator('#unfinished-list .account-row')).toHaveCount(0);
    expect(JSON.parse((await apexStorage(page))['nido:mainnet:pending'] ?? '[]')).toEqual([]);
  });
});

test.describe('@fast sign-in list in a browser that keeps a framed page\'s storage apart (WebKit)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('a finished setup is listed as an account on the apex, not as "Finishing setup"', async ({
    context,
    page,
  }) => {
    await emulateWebKitPartitioning(context);
    const chain = await mockSetupChain(context);
    await runSetup(page);
    // The bridge couldn't reach the apex's list, so setup went through it.
    expect(chain.handoffLoads).toBe(1);
    await expect(page.locator('.signin-notice')).toBeHidden();

    const menu = await openApexMenu(page);
    await expect(menu.locator('.mn-row')).toHaveCount(1);
    await expect(menu.locator('.mn-pending')).toHaveCount(0);
    const rows = await chooserRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(ACCOUNT);
  });

  test('an account whose setup finished from its row reaches the apex once its secret expired', async ({
    context,
    page,
  }) => {
    await emulateWebKitPartitioning(context);
    await mockSetupChain(context, { deployed: [ACCOUNT] });
    // A setup finished on its own origin while the bridge couldn't list it;
    // the apex kept only its address once the secret expired.
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

    const menu = await openApexMenu(page);
    await menu.locator('.mn-pending').click();
    await page.waitForURL(`${accountOrigin(ACCOUNT)}/account/`, { timeout: 45_000 });

    const after = await openApexMenu(page);
    await expect(after.locator('.mn-row')).toHaveCount(1);
    await expect(after.locator('.mn-pending')).toHaveCount(0);
  });

  test('an account page shows it is not listed and adds it through the apex', async ({ context, page }) => {
    await emulateWebKitPartitioning(context);
    const chain = await mockSetupChain(context, { deployed: [ACCOUNT] });
    // The account is active on its own origin; the apex still holds the
    // row it reserved.
    await page.goto(`https://${APEX}/__blank`);
    await page.evaluate(
      ({ id, salt }) => localStorage.setItem('nido:mainnet:pending', JSON.stringify([{ contractId: id, setupKey: salt }])),
      { id: ACCOUNT, salt: SALT },
    );
    await page.goto(`${accountOrigin(ACCOUNT)}/__blank`);
    await page.evaluate(
      ({ id, key }) => {
        localStorage.setItem('nido:mainnet:accounts', JSON.stringify([id]));
        localStorage.setItem(`passkey:${id}:credentialId`, 'Y3JlZA');
        localStorage.setItem(`passkey:${id}:publicKey`, key);
      },
      { id: ACCOUNT, key: reads.ownerKey },
    );

    await page.goto(`${accountOrigin(ACCOUNT)}/account/`);
    const notice = page.locator('.signin-notice');
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await notice.locator('button', { hasText: 'Add it' }).click();
    await page.waitForURL(`${accountOrigin(ACCOUNT)}/account/`, { timeout: 30_000 });
    expect(chain.handoffLoads).toBe(1);
    await expect(notice).toBeHidden({ timeout: 10_000 });

    const rows = await chooserRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(ACCOUNT);
  });

  test('the one-time migration keeps an account whose passkey this browser holds', async ({ context, page }) => {
    await emulateWebKitPartitioning(context);
    await mockSetupChain(context, { deployed: [ACCOUNT] });
    await page.goto(`${accountOrigin(ACCOUNT)}/__blank`);
    await page.evaluate(
      ({ id, key }) => {
        localStorage.setItem(`passkey:${id}:credentialId`, 'Y3JlZA');
        localStorage.setItem(`passkey:${id}:publicKey`, key);
      },
      { id: ACCOUNT, key: reads.ownerKey },
    );
    await page.goto(`https://${APEX}/__blank`);
    await page.evaluate((id) => localStorage.setItem('nido:mainnet:accounts', JSON.stringify([id])), ACCOUNT);

    const rows = await chooserRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(ACCOUNT);
    // The framed account origin answered that it can't tell, which it would
    // on every load: the account is kept and the migration is done.
    await expect(page.locator('#accounts-unchecked')).toBeHidden();
    const after = await apexStorage(page);
    expect(JSON.parse(after['nido:mainnet:accounts']!)).toEqual([ACCOUNT]);
    expect(after['nido:mainnet:accounts:migrated:v1']).toBeTruthy();
  });

  test('an account the apex never reserved is told so, instead of offered "Add it" again', async ({
    context,
    page,
  }) => {
    await emulateWebKitPartitioning(context);
    const chain = await mockSetupChain(context, { deployed: [ACCOUNT] });
    // The account is active on its own origin; the apex holds no row for it.
    await seedActiveAccount(page);

    await page.goto(`${accountOrigin(ACCOUNT)}/account/`);
    const notice = page.locator('.signin-notice');
    const add = notice.locator('button');
    await expect(add).toHaveText('Add it', { timeout: 30_000 });
    await add.click();
    await page.waitForURL(`${accountOrigin(ACCOUNT)}/account/`, { timeout: 30_000 });
    expect(chain.handoffLoads).toBe(1);

    await expect(notice).toContainText("can't be added to the main Nido site's list from this browser", {
      timeout: 30_000,
    });
    await expect(notice).toContainText('still works fully from its own address');
    await expect(add).toBeHidden();
    expect(chain.handoffLoads).toBe(1);
    expect(JSON.parse((await apexStorage(page))['nido:mainnet:accounts'] ?? '[]')).toEqual([]);
  });

  test('a crafted "not listed" link stores nothing and does not hide "Add it" on the next visit', async ({
    context,
    page,
  }) => {
    await emulateWebKitPartitioning(context);
    const chain = await mockSetupChain(context, { deployed: [ACCOUNT] });
    await seedActiveAccount(page);
    // What this origin records about the apex's list (nidoSharedStorage.ts).
    const stored = () =>
      page.evaluate(() =>
        Object.entries(localStorage)
          .filter(([key]) => key.startsWith('nido:mainnet:bridge:'))
          .sort(),
      );

    // A plain visit first, so what the page itself stores is already there.
    await page.goto(`${accountOrigin(ACCOUNT)}/account/`);
    const notice = page.locator('.signin-notice');
    const add = notice.locator('button');
    await expect(add).toHaveText('Add it', { timeout: 30_000 });
    const before = await stored();

    // Any site can link here with the hand-off's answer; the apex gave none.
    await page.goto(`${accountOrigin(ACCOUNT)}/__blank`);
    await page.goto(`${accountOrigin(ACCOUNT)}/account/#nido-signin-list=not-listed`);
    await expect(notice).toContainText("can't be added to the main Nido site's list", { timeout: 30_000 });
    expect(await stored()).toEqual(before);

    await page.goto(`${accountOrigin(ACCOUNT)}/__blank`);
    await page.goto(`${accountOrigin(ACCOUNT)}/account/`);
    await expect(add).toHaveText('Add it', { timeout: 30_000 });
    await expect(add).toBeVisible();
    expect(chain.handoffLoads).toBe(0);
  });
});

test.describe('@fast sign-in list on an account page opened before the apex was ever visited', () => {
  test.describe.configure({ timeout: 90_000 });

  // No apex page has marked the apex's storage as its own yet, so its bridge
  // answers as a separated one would, in a browser whose bridge is not.
  test('an account the apex already lists is confirmed in one step', async ({ context, page }) => {
    const chain = await mockSetupChain(context, { deployed: [ACCOUNT] });
    await page.goto(`https://${APEX}/__blank`);
    await page.evaluate((id) => localStorage.setItem('nido:mainnet:accounts', JSON.stringify([id])), ACCOUNT);
    await seedActiveAccount(page);

    await page.goto(`${accountOrigin(ACCOUNT)}/account/`);
    const notice = page.locator('.signin-notice');
    await notice.locator('button', { hasText: 'Add it' }).click({ timeout: 30_000 });
    await page.waitForURL(`${accountOrigin(ACCOUNT)}/account/`, { timeout: 30_000 });
    expect(chain.handoffLoads).toBe(1);
    const confirmed = () =>
      page.evaluate((id) => localStorage.getItem(`nido:mainnet:bridge:confirmed:${id}`), ACCOUNT);
    await expect.poll(confirmed, { timeout: 30_000 }).toBe('active');
    await expect(notice).toBeHidden();
    await expect(notice).not.toContainText("can't be added");
  });

  test('an account the apex holds no row for is listed by the sync after the apex visit', async ({
    context,
    page,
  }) => {
    const chain = await mockSetupChain(context, { deployed: [ACCOUNT] });
    await seedActiveAccount(page);

    await page.goto(`${accountOrigin(ACCOUNT)}/account/`);
    const notice = page.locator('.signin-notice');
    await notice.locator('button', { hasText: 'Add it' }).click({ timeout: 30_000 });
    await page.waitForURL(`${accountOrigin(ACCOUNT)}/account/`, { timeout: 30_000 });
    expect(chain.handoffLoads).toBe(1);

    // The apex refused the hand-off, but its bridge now sees its storage.
    await expect
      .poll(async () => page.evaluate((id) => localStorage.getItem(`nido:mainnet:bridge:confirmed:${id}`), ACCOUNT), {
        timeout: 30_000,
      })
      .toBe('active');
    await expect(notice).toBeHidden();
    await expect(notice).not.toContainText("can't be added");

    const rows = await chooserRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(ACCOUNT);
  });
});

test.describe('@fast sign-in list migration (mainnet build)', () => {
  test.describe.configure({ timeout: 60_000 });

  test('keeps a mainnet account this browser holds a passkey for, drops the rest, once', async ({
    context,
    page,
  }) => {
    await mockSetupChain(context, { deployed: [ACCOUNT] });
    // This browser registered ACCOUNT's passkey on its own origin; OTHER's
    // wallet page was only ever visited.
    await page.goto(`${accountOrigin(OTHER)}/account/`);
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
