import { test, expect, SEED_HEX } from '../../support/fixtures';
import { seedBank } from '../../support/testnet';
import { seedCredential } from '../../support/auth/seed';

const PORT = Number(process.env.E2E_PORT || 4399);

// A genuinely fresh, UNWIRED account (recovery_controller: None), deployed
// directly against the on-chain smart-account wasm (not through the doc-only
// factory, which pre-wires every account to the M1 pool at genesis — see
// accountWiring.ts's "CONFIRMED LIVE" note and recover-v3-wiring.testnet.spec.ts).
// Deployed once via `stellar contract deploy --wasm-hash fe3b1878… -- --signers
// '[{"External":[<webauthn-verifier>, <pubkey>]}]' --policies '{}'` for this
// probe specifically. The signer's pubkey is the SAME deterministic
// (SEED_HEX, 'stage3-fresh-probe') credential `seedCredential` below seeds
// into localStorage, so the shim can actually sign for it.
const FRESH_UNWIRED_ACCOUNT = 'CCVXSIAVMOI4APBONN6CDHBONC7CYOJUM7VGVGCG7CJXRIIQCZN3M222';
const IDENTITY_LABEL = 'stage3-fresh-probe';
// Any well-formed G-address — resolveFriendInput only validates StrKey
// format, no on-chain existence check.
const DUMMY_FRIEND = 'GAMPJROHOAW662FINQ4XQOY2ULX5IEGYXCI4SMZYE75EHQBR6PSTJG3M';

/**
 * @testnet — live probe for captain issue #2 (002.msg): the REAL production
 * "Set up recovery" flow on `/security/` (NOT the recover-v3 spike page)
 * previously routed to a dead stub (`multisigRecoveryModule.buildInstall`
 * unconditionally threw `DOC_ONLY_ERROR`). Proves the fix end to end against
 * real testnet:
 *
 *  1. A genuinely fresh, unwired account (constructed directly, bypassing
 *     the doc-only factory's universal M1 pre-wiring — see the constant
 *     comment above) can complete "Set up recovery" for 1 of 1 friend
 *     WITHOUT hitting the old stub error.
 *  2. `buildInstall` correctly detects `'unwired'` and submits BOTH the
 *     wire (`enroll_zk_recovery`) and enroll transactions.
 *  3. Reloading `/security/` re-derives the block from chain
 *     (`fetchAllChainRules` -> `loadPolicyBlocks` ->
 *     `multisigRecoveryModule.fromChain` + the NEW
 *     `fetchPolicyState`/`fetchRecoveryControllerState` branch) and renders
 *     "1 of 1 friend can rotate this account's signers and rules" —
 *     confirming the Stage 3 PolicyState shape (`{guardians, threshold}`)
 *     round-trips correctly end to end.
 *
 * Does NOT probe a real recovery ATTEMPT (begin_attempt/evidence/complete)
 * — out of scope; this targets the install/render round trip specifically.
 *
 * NOT SAFE TO RE-RUN as committed: `RecoveryController::enroll` is one-shot
 * (`Error::AlreadyEnrolled` on a second call for the same account), and this
 * probe genuinely enrolls `FRESH_UNWIRED_ACCOUNT` for real. It already ran
 * successfully once against the address above (independently confirmed via
 * `stellar contract invoke ... config`/`recovery_controller` — see the PR
 * description/status report for the exact readback). A future run of this
 * spec must first raw-deploy a NEW unwired account (same recipe as the
 * constant comment below) and swap the address in — `createAndDeployAs`
 * cannot substitute here, since every account it creates goes through the
 * doc-only factory and arrives ALREADY wired to the M1 pool.
 */
test.describe('@testnet security page recovery install (Stage 3 routing)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('fresh unwired account: install 1-of-1 friend recovery via the real /security/ form', async ({
    page,
    context,
  }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const host = `${FRESH_UNWIRED_ACCOUNT.toLowerCase()}.localhost:${PORT}`;
    await page.goto(`http://${host}/security/`, { waitUntil: 'domcontentloaded' });
    await seedCredential(page, FRESH_UNWIRED_ACCOUNT, SEED_HEX, IDENTITY_LABEL);
    // Re-navigate so page-load logic (passkey status, chain-rule fetch) sees
    // the seeded credential from the start.
    await page.goto(`http://${host}/security/`, { waitUntil: 'domcontentloaded' });

    // Confirm the account starts with NO recovery block rendered (fresh,
    // unwired — no prior enrollment).
    const recoveryList = page.locator('#recovery-list');
    await expect(recoveryList).not.toContainText(/friend.*rotate/i, { timeout: 30_000 });

    await page.locator('#add-recovery').click();
    await expect(page.locator('#recovery-form')).toBeVisible({ timeout: 10_000 });

    // Draft starts with 3 empty friend rows; remove 2 down to 1-of-1.
    const friendRows = page.locator('#rc-friends .friend-row');
    await expect(friendRows).toHaveCount(3);
    await friendRows.nth(2).locator('.remove').click();
    await friendRows.nth(1).locator('.remove').click();
    await expect(page.locator('#rc-friends .friend-row')).toHaveCount(1);
    await expect(page.locator('#rc-m-value')).toHaveText('1'); // auto-clamped

    await page.locator('#rc-friends .friend-row input').fill(DUMMY_FRIEND);
    await expect(page.locator('#rc-friends .resolve-status')).toContainText('✓', { timeout: 10_000 });

    await page.locator('#rc-save').click();

    const outcome = await Promise.race([
      page
        .getByText(/Recovery rule installed/i)
        .first()
        .waitFor({ timeout: 90_000 })
        .then(() => 'installed' as const),
      page
        .locator('.form-error')
        .filter({ hasText: /.+/ })
        .first()
        .waitFor({ timeout: 90_000 })
        .then(() => 'failed' as const),
    ]).catch(() => 'timeout' as const);

    if (outcome !== 'installed') {
      const errText = await page.locator('.form-error').textContent().catch(() => '');
      throw new Error(`recovery install did not succeed (outcome=${outcome}). form-error="${errText}"`);
    }

    // The success path reloads the page after ~800ms; wait for the fresh
    // load's chain-derived render instead of racing it.
    await page.waitForURL(/\/security\/?$/, { timeout: 30_000 });
    await expect(page.locator('#recovery-list')).toContainText(/1 of 1 friend.*rotate/i, {
      timeout: 60_000,
    });

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);
    test.info().annotations.push({ type: 'account', description: FRESH_UNWIRED_ACCOUNT });
    test.info().annotations.push({ type: 'friend', description: DUMMY_FRIEND });
  });
});
