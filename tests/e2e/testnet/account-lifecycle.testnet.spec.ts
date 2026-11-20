import { test, expect } from '../../support/fixtures';
import { seedBank } from '../../support/testnet';

const PORT = Number(process.env.E2E_PORT || 4399);

// Real-chain: slow + retried. Quarantined via the testnet-* projects.
test.describe('@testnet account lifecycle', () => {
  test.describe.configure({ timeout: 180_000 });

  // Un-parked: SHOW_NAME_SECTION is back on and bug #3 is fixed, so the full
  // claim round-trip should land on-chain (asserted at step 8).
  test('create + deploy (v0.7), then claim a name end-to-end', async ({ page, context }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // 1) Home → create account (friendbot fund + factory.get_c_address).
    await page.goto(`http://nido.localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('#create-btn').click();
    await expect(page.locator('#c-address-result')).not.toBeEmpty({ timeout: 60_000 });
    const cAddress = (await page.locator('#c-address-result').textContent())?.trim() ?? '';
    expect(cAddress).toMatch(/^C[A-Z2-7]{55}$/);

    // 2) Follow the setup link (carries ?key=<secret>) to the C-address subdomain.
    const setupHref = await page.locator('#setup-link').getAttribute('href');
    expect(setupHref).toContain('/new-account/');
    expect(setupHref).toContain('key=');
    const key = new URL(setupHref!, 'http://x').searchParams.get('key')!;
    const host = `${cAddress.toLowerCase()}.nido.localhost:${PORT}`;
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

    // 8) The full claim lands on-chain and the page redirects to the name
    //    subdomain. Bug #3 (previously pinned here) was NOT a contract
    //    auth-model issue — the Default rule authorizes the external
    //    `registry.register` context fine (proven by the non-mocked
    //    `smart_account_check_auth_with_passkey` integration test). The real
    //    cause was the frontend finalize step: it re-simulated the signed tx in
    //    default ("record") mode and re-ran `assembleTransaction`, which ignores
    //    the injected signature and sizes a footprint that omits __check_auth's
    //    reads. Fixed to re-simulate in "enforce" mode and splice sorobanData
    //    via cloneFrom (mirrors primaryPasskeySigner.signAndSubmit).
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
    expect(outcome).toBe('name-claimed');

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);
    test.info().annotations.push({ type: 'cAddress', description: cAddress });
  });
});
