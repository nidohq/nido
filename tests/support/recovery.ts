import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { useIdentity } from './fixtures';

/**
 * Create + deploy a fresh v0.7 account whose primary passkey is the shim's
 * `identityLabel` identity (distinct per actor — without this, every account
 * registers the SAME 'default' key, so the originator and a friend would share
 * a keypair and the recovery test would be meaningless). Mirrors
 * account-lifecycle.testnet.spec.ts steps 1-3. Returns the C-address + its
 * subdomain host.
 */
export async function createAndDeployAs(
  page: Page,
  PORT: number,
  identityLabel: string,
): Promise<{ cAddress: string; host: string }> {
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
  // Distinct identity for THIS account's primary passkey, set BEFORE register.
  // The shim mints the create()-time key from `nextLabel`; the stored
  // credentialId then deterministically reproduces the key on every get().
  await useIdentity(page, identityLabel);
  await page.locator('#register-btn').click();
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
  let installAlert: string | null = null;
  page.on('dialog', (d) => {
    if (/Failed to install recovery|did not resolve|at least one friend/i.test(d.message())) {
      installAlert = d.message();
    }
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
