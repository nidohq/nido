import { test, expect } from '../../support/fixtures';
import { seedBank } from '../../support/testnet';

const PORT = Number(process.env.E2E_PORT || 4399);

// Real-chain: slow + retried. Quarantined via the testnet-* projects.
//
// REGRESSION GUARD FOR BUG #1 — "set note" primary-passkey signing.
// The status-message page redirects to /account/?sign=<digest> for the
// PRIMARY passkey to sign. The signed assertion is later injected and the tx
// submitted; the on-chain OZ v0.7 WebAuthn verifier checks the assertion
// against auth_digest = computeAuthDigest(signature_payload, context_rule_ids),
// NOT the bare signature_payload. Bug #1 was: the page signed the bare auth
// hash, so the verifier rejected with ChallengeInvalid (#3114) and the note
// was never set.
//
// THE FIX (already applied to status-message/index.astro): the ?sign= challenge
// is now `buf2hex(computeAuthDigest(new Uint8Array(authHash), [0]))`. With the
// fix in place this test SUCCEEDS on testnet (the note is set). If someone
// reverts to signing the bare hash, the on-chain verifier rejects with
// ChallengeInvalid and the success assertion below fails.
test.describe('@testnet status-message set-note (bug #1 regression)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('create + deploy (v0.7), then set a note via primary-passkey signing', async ({ page, context }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // ---------------------------------------------------------------
    // PART A — create + deploy a v0.7 account (mirrors account-lifecycle)
    // ---------------------------------------------------------------

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

    // Credential persisted on the C-address origin — the /account/ signing page
    // (same origin) will load it when we round-trip there to sign the note.
    const cred = await page.evaluate(
      (cid) => localStorage.getItem(`passkey:${cid}:credentialId`),
      cAddress,
    );
    expect(cred).toBeTruthy();
    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);

    // ---------------------------------------------------------------
    // PART B — set a note via the status-message dApp
    // ---------------------------------------------------------------

    // 4) Open the status-message dApp on the apex (localhost). It resolves the
    //    status-message contract via the on-chain registry (hardcoded fallback
    //    exists), takes the ACCOUNT contract id in #contract-input, and uses
    //    sm:keypairSecret (seeded by seedBank) as the fee payer.
    await page.goto(`http://localhost:${PORT}/status-message/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#contract-input')).toBeVisible({ timeout: 30_000 });

    await page.locator('#contract-input').fill(cAddress);
    const note = `nest-${Date.now().toString(36)}`;
    await page.locator('#message-input').fill(note);

    // The "Set note" button is the lone submit button inside <form id="set-form">.
    await page.locator('#set-form button[type="submit"], #set-form button:not([type])').first().click();

    // 5) Set-note builds+simulates update_message, then redirects to the
    //    C-address subdomain for primary-passkey signing (?sign=<digest>).
    await page.waitForURL('**/account/?sign=**', { timeout: 90_000 });
    await expect(page.locator('#signing-mode')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#approve-btn')).toBeVisible({ timeout: 15_000 });

    // 6) Approve → shim signs the digest → redirect back to the status-message
    //    page with ?result=1 and the assertion params; the return handler
    //    injects the signature and submits the tx.
    await page.locator('#approve-btn').click();
    await page.waitForURL(/\/status-message\/\?result=1/, { timeout: 90_000 });

    // 7) ASSERT the note was set SUCCESSFULLY on-chain.
    //    The result section becomes visible and #status-value reaches
    //    "Message updated successfully!" once getTransaction returns SUCCESS.
    //    Race that against the page's error box so a regression fails fast with
    //    the on-chain error text rather than timing out blind.
    await expect(page.locator('#result-section')).toBeVisible({ timeout: 30_000 });

    const outcome = await Promise.race([
      page
        .locator('#status-value')
        .filter({ hasText: /successfully/i })
        .first()
        .waitFor({ timeout: 120_000 })
        .then(() => 'note-set' as const),
      page
        .locator('#error-box')
        .filter({ hasText: /\S/ })
        .first()
        .waitFor({ state: 'visible', timeout: 120_000 })
        .then(() => 'rejected-on-chain' as const),
    ]).catch(() => 'timeout' as const);

    if (outcome !== 'note-set') {
      // Surface the on-chain error verbatim to make a regression (or a NEW,
      // different on-chain failure) debuggable from the test log.
      const errText = (await page.locator('#error-box').textContent().catch(() => null))?.trim();
      const statusText = (await page.locator('#status-value').textContent().catch(() => null))?.trim();
      throw new Error(
        `set-note did not succeed (outcome=${outcome}). ` +
          `error-box="${errText ?? '<none>'}" status-value="${statusText ?? '<none>'}". ` +
          `If this is "ChallengeInvalid" / contract error #3114, bug #1 has regressed ` +
          `(the page signed the bare auth hash instead of computeAuthDigest).`,
      );
    }
    expect(outcome).toBe('note-set');

    // The tx link to Stellar Expert is revealed on success.
    await expect(page.locator('#tx-link')).toBeVisible({ timeout: 10_000 });

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);
    test.info().annotations.push({ type: 'cAddress', description: cAddress });
    test.info().annotations.push({ type: 'note', description: note });
  });
});
