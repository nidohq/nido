import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { useIdentity } from './fixtures';

/** 32 random bytes as lowercase hex — the account-creation `salt` the current
 *  reservation flow expects (`createNido()` in the app generates one the same
 *  way and puts it in `?salt=`). */
function randomSaltHex(): string {
  const bytes = new Uint8Array(32);
  // Node 18+/browsers both expose global crypto.getRandomValues.
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create + deploy a fresh v0.7 account whose primary passkey is the shim's
 * `identityLabel` identity (distinct per actor — without this, every account
 * registers the SAME 'default' key, so the originator and a friend would share
 * a keypair and the recovery test would be meaningless). Returns the C-address
 * + its subdomain host.
 *
 * CURRENT create flow (Nido reskin — see `pages/index.astro`,
 * `lib/createNido.ts`, `pages/new-account/index.astro`):
 *   apex `/new-account/?salt=<hex>&setup=1`  (the "reservation" page —
 *     `#preparing-section`; the old home-page `#create-btn`/`#c-address-result`/
 *     `#setup-link` surfaces were removed in the reskin, which is why the prior
 *     version of this helper timed out on `#create-btn`)
 *   → `#preparing-continue` → hard-redirect to `<cAddress>.localhost:PORT/
 *     new-account/?salt=…&autopass=1` (the account's own subdomain)
 *   → autopass auto-registers the passkey → `#recovery-enroll-section`
 *     (continue / set up recovery after) → deploy() → `#done-section`.
 *
 * IDENTITY UNDER AUTOPASS: the subdomain page auto-registers the passkey
 * itself (`attemptAutoPasskey`), BEFORE any per-page `useIdentity` call could
 * run — so we seed the shim's `nextLabel` via a *context* init script instead.
 * Playwright runs every `addInitScript` before the document's own scripts (and
 * in registration order, after the auth-shim bundle that defines
 * `__testAuthenticator`), so the label is set the instant the shim exists and
 * wins the race with autopass's `create()`. Re-registered per navigation, which
 * is fine here (one account per helper call).
 *
 * NOTE: not re-validated end-to-end against live testnet in the environment
 * this was written in (account creation additionally needs the relayer baked
 * into the build — `PUBLIC_RELAYER_URL` at `astro build` time — which the
 * `just test-e2e-testnet` / `test-testnet.yml` build step does not currently
 * set; see task-6-report.md). The selectors/flow match the current app source.
 */
export async function createAndDeployAs(
  page: Page,
  PORT: number,
  identityLabel: string,
): Promise<{ cAddress: string; host: string }> {
  // Seed the primary-passkey identity for whenever the shim's create() fires
  // next (autopass on the subdomain, or a manual #register-btn click below).
  await page.context().addInitScript((label) => {
    const auth = (window as unknown as { __testAuthenticator?: { setNextLabel(l: string): void } })
      .__testAuthenticator;
    if (auth && typeof auth.setNextLabel === 'function') auth.setNextLabel(label);
  }, identityLabel);
  // Belt-and-suspenders for the current document (init scripts cover future
  // navigations; this covers the page we're already on).
  await useIdentity(page, identityLabel).catch(() => {});

  const salt = randomSaltHex();
  await page.goto(`http://localhost:${PORT}/new-account/?salt=${salt}&setup=1`, {
    waitUntil: 'domcontentloaded',
  });

  // Reservation: wait for the address to be reserved, then Continue hard-
  // redirects to the account's own subdomain.
  await expect(page.locator('#preparing-continue')).toBeEnabled({ timeout: 90_000 });
  await page.locator('#preparing-continue').click();

  // Land on `<cAddress>.localhost:PORT/new-account/…` and recover the C-address
  // from the hostname (StrKey C-addresses are upper-case base32; the subdomain
  // is the lower-cased form).
  await page.waitForURL(/\/\/c[a-z2-7]{55}\.localhost/i, { timeout: 90_000 });
  const host = new URL(page.url()).host;
  const cAddress = host.split('.')[0].toUpperCase();
  expect(cAddress).toMatch(/^C[A-Z2-7]{55}$/);

  // autopass should auto-register the passkey (shim create() needs no real user
  // activation); if it didn't fire, fall back to the manual button. Either way
  // we then land on the recovery-enrollment choice.
  const enrollShown = await page
    .locator('#recovery-enroll-section')
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!enrollShown) {
    await page.locator('#register-btn').click();
    await page.locator('#recovery-enroll-section').waitFor({ state: 'visible', timeout: 60_000 });
  }

  // The recovery choice (#recovery-enroll-section) sits between passkey
  // registration and deploy(). Callers want a PLAIN create+deploy (specs that
  // set up recovery drive /security/recovery/ themselves), so continue.
  await page.locator('#enroll-continue').click();
  await page.locator('#done-section').waitFor({ state: 'visible', timeout: 120_000 });
  return { cAddress, host };
}
