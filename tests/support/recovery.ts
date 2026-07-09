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
 *     (seed/wallet/skip) → deploy() → `#done-section`.
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

  // A recovery-enrollment step (#recovery-enroll-section) sits between passkey
  // registration and deploy(). Enrolling at creation is now an optional reveal;
  // the primary action "Continue to my wallet" (#enroll-continue) takes the
  // no-enrollment dummy-commitment path. Callers of this helper want a PLAIN
  // create+deploy (specs that want ZK enrollment drive it themselves afterwards,
  // e.g. via the security/ page's migration card, with a mnemonic they control)
  // -- so always continue without a backup here.
  await page.locator('#enroll-continue').click();
  await page.locator('#done-section').waitFor({ state: 'visible', timeout: 120_000 });
  return { cAddress, host };
}

/**
 * Install an M-of-N recovery rule on the account currently loaded at `host`,
 * via the security page form (`mountRecoveryForm`). Friends are pre-deployed
 * account C-addresses. Signs the install (add_context_rule self-mod) with the
 * primary passkey.
 *
 * Adapted from the plan against the live form (recoveryForm.ts):
 *  - The form pre-populates THREE empty friend rows and starts threshold at 2.
 *    We fill the first `friendAddresses.length` rows and DELETE the remaining
 *    empty rows (each `.remove` click also clamps threshold down), so
 *    `validate()` ("Some friends did not resolve") passes.
 *  - Friend resolution is async (`resolveFriendInput`); for a C-address it's a
 *    local StrKey check, but we still WAIT for the row's `.resolve-status` to
 *    show the ✓ before saving.
 *  - `#rc-save` text is "Sign & save"; on success the form's innerHTML becomes
 *    "Recovery rule installed. Refreshing…" then reloads. On failure it
 *    `alert()`s "Failed to install recovery: <msg>" — we capture that dialog and
 *    throw so the caller sees the on-chain error verbatim.
 */
export async function installRecoveryRule(
  page: Page,
  host: string,
  friendAddresses: string[],
  threshold: number,
): Promise<void> {
  await page.goto(`http://${host}/security/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#add-recovery').click();
  await page.locator('#rc-friends .friend-row').first().waitFor({ timeout: 15_000 });

  // Surface a failing install: the form alert()s the contract/auth error.
  // Record the message for ANY dialog (not just the known failure patterns) so a
  // surprise prompt isn't swallowed silently. These are UI alerts — no secrets.
  let installAlert: string | null = null;
  page.on('dialog', (d) => {
    installAlert = d.message();
    d.accept().catch(() => {});
  });

  const rows = page.locator('#rc-friends .friend-row');

  // Fill the friend address rows (the form starts with 3 empty rows; add more
  // only if we need MORE than what's present).
  for (let i = 0; i < friendAddresses.length; i++) {
    if ((await rows.count()) <= i) await page.locator('#rc-add-friend').click();
    const row = rows.nth(i);
    await row.locator('input').fill(friendAddresses[i]);
    // Wait for the async resolve to land a ✓ (C-addresses resolve locally).
    await expect(row.locator('.resolve-status')).toContainText('✓', { timeout: 15_000 });
  }

  // Delete any leftover empty rows so validate() doesn't reject them. Removing
  // a row also clamps draft.threshold to the remaining count.
  while ((await rows.count()) > friendAddresses.length) {
    await rows.nth(friendAddresses.length).locator('button.remove').click();
  }
  await expect(page.locator('#rc-n-value')).toHaveText(String(friendAddresses.length), {
    timeout: 5_000,
  });

  // Set threshold (M) via the stepper. Clamped to [1, friends.length].
  for (let guard = 0; guard < 12; guard++) {
    const m = parseInt((await page.locator('#rc-m-value').textContent())!.trim(), 10);
    if (m === threshold) break;
    await page.locator(m < threshold ? '#rc-m-up' : '#rc-m-down').click();
  }
  await expect(page.locator('#rc-m-value')).toHaveText(String(threshold), { timeout: 5_000 });

  await page.locator('#rc-save').click();

  // Success: the form replaces its body with the "installed" notice (then
  // reloads). Failure: the dialog handler captured an alert. Race them.
  const ok = await page
    .locator('#recovery-form')
    .filter({ hasText: /installed/i })
    .first()
    .waitFor({ timeout: 120_000 })
    .then(() => true)
    .catch(() => false);

  if (!ok) {
    throw new Error(
      `installRecoveryRule did not confirm success on ${host}. ` +
        `alert=${installAlert ?? '<none>'} friends=[${friendAddresses.join(',')}] threshold=${threshold}`,
    );
  }
}
