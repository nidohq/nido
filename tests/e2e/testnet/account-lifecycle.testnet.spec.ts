import { test, expect } from '../../support/fixtures';
import { seedBank } from '../../support/testnet';

const PORT = Number(process.env.E2E_PORT || 4399);

// Real-chain: slow + retried. Quarantined via the testnet-* projects.
test.describe('@testnet account lifecycle', () => {
  test.describe.configure({ timeout: 180_000 });

  // PARKED: the claim-name feature is hidden behind SHOW_NAME_SECTION (=false)
  // in account/index.astro, so step 4's `#name-claim` never appears. Re-enable
  // this bug-#3 pin (remove `.skip`) when the flag is flipped back on.
  test.skip('create + deploy (v0.7), then claim a name — pins bug #3 (UnvalidatedContext)', async ({ page, context }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // 1) Home → create account (friendbot fund + factory.get_c_address).
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('#create-btn').click();
    await expect(page.locator('#c-address-result')).not.toBeEmpty({ timeout: 60_000 });
    const cAddress = (await page.locator('#c-address-result').textContent())?.trim() ?? '';
    expect(cAddress).toMatch(/^C[A-Z2-7]{55}$/);

    // 2) Follow the setup link (carries ?key=<secret>) to the C-address subdomain.
    const setupHref = await page.locator('#setup-link').getAttribute('href');
    expect(setupHref).toContain('/new-account/');
    expect(setupHref).toContain('key=');
    const key = new URL(setupHref!, 'http://x').searchParams.get('key')!;
    const host = `${cAddress.toLowerCase()}.localhost:${PORT}`;
    await page.goto(`http://${host}/new-account/?key=${encodeURIComponent(key)}`, {
      waitUntil: 'domcontentloaded',
    });

    // 3) Register passkey (shim) → auto-deploy → #done-section.
    await page.locator('#register-btn').click();
    await expect(page.locator('#done-section')).toBeVisible({ timeout: 120_000 });

    // Credential persisted; no fatal JS errors.
    const cred = await page.evaluate(
      (cid) => localStorage.getItem(`passkey:${cid}:credentialId`),
      cAddress,
    );
    expect(cred).toBeTruthy();
    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);

    // 4) Go to the account page on the C-address subdomain.
    await page.goto(`http://${host}/account/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-mode')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#name-claim')).toBeVisible({ timeout: 30_000 });

    // 5) Claim a unique name (Date.now() is fine in a Playwright test runtime).
    const { uniqueName } = await import('../../support/testnet');
    const name = uniqueName('t', Date.now());
    await page.locator('#name-input').fill(name);
    await page.locator('#claim-name-btn').click();

    // 6) Claim builds+simulates, then redirects into signing mode (?sign=...).
    await page.waitForURL('**/account/?sign=**', { timeout: 90_000 });
    await expect(page.locator('#signing-mode')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#approve-btn')).toBeVisible({ timeout: 10_000 });

    // 7) Approve → shim get() signs → redirect back to ?nameresult=1. Reaching
    //    nameresult validates the signing round-trip: the shim's get() produced
    //    an assertion the page accepted, and it redirected back to submit.
    await page.locator('#approve-btn').click();
    await page.waitForURL(/nameresult=1/, { timeout: 60_000 });

    // 8) PINS BUG #3 — UnvalidatedContext (smart-account contract error #3002).
    //    After the registry repoint, accounts are v0.7 and the
    //    challenge/signature/pubkey/verifier all verify on-chain — but the
    //    account's __check_auth rejects the external `registry.register` context
    //    under the Default rule (UnvalidatedContext). So the claim fails on-chain
    //    rather than landing on the name subdomain. No prior test caught this:
    //    `register_name_via_smart_account` uses env.mock_all_auths(), which
    //    bypasses __check_auth entirely.
    //    >>> WHEN BUG #3 IS FIXED (contract auth-model authorizes the register
    //        context): flip the expect below to 'name-claimed', i.e. assert
    //        success — the race already detects the name-subdomain redirect.
    const outcome = await Promise.race([
      page
        .getByText(/InvalidAction|Couldn't finish claiming|Re-simulation failed/i)
        .first()
        .waitFor({ timeout: 90_000 })
        .then(() => 'rejected-on-chain' as const),
      page
        .waitForURL((u) => u.hostname.startsWith(`${name}.`), { timeout: 90_000 })
        .then(() => 'name-claimed' as const),
    ]).catch(() => 'timeout' as const);
    expect(outcome).toBe('rejected-on-chain'); // BUG #3 pin — flip to 'name-claimed' once fixed

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);
    test.info().annotations.push({ type: 'cAddress', description: cAddress });
  });
});
