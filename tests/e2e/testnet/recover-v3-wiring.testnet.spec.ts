import { test, expect } from '../../support/fixtures';
import { seedBank } from '../../support/testnet';
import { createAndDeployAs } from '../../support/recovery';

const PORT = Number(process.env.E2E_PORT || 4399);

// Live-probe deploy of `contracts/recovery-controller` used only by this
// spec. No constructor (shared, per-account storage only) — deployed once via
// `stellar contract deploy` against testnet identity `theahaco` for this probe.
// See DEPLOYED.md for the rest of the stack's addresses; this one is
// deliberately NOT added there (a throwaway probe instance, not part of the
// app's real deployed set).
const RECOVERY_CONTROLLER_ID = 'CDHB5B3GI63EQKPLSQWB6OKBZKMBLRAA3SHOBCYAPTDZ6ZN3YLADTHL6';
// The M1 `nido-zk-recovery` pool/controller the doc-only factory wires EVERY
// new account to at construction (see DEPLOYED.md's M2 section: "every
// account this factory creates now installs the zero-signer CallContract(self)
// recovery rule ... whether or not its owner ever uses recovery"). Confirmed
// live by this very probe below — a BRAND NEW account, seconds old, already
// reports this as its `recovery_controller()` before this spec touches it.
const M1_POOL_ID = 'CAUZ6WFUTTZCJQNNL5D3BNZSG7FYYGX46BDJE6G2XVVCGN76RKE5ESAR';

/**
 * @testnet — live probe for the account-wiring bug a captain live-test
 * caught on PR 206 (Enroll silently no-op'd because the account was wired to
 * a DIFFERENT, pre-existing controller).
 *
 * ORIGINAL PLAN vs WHAT THIS PROBE ACTUALLY PROVES: this spec was first
 * written expecting a freshly created account to start UNWIRED
 * (`recovery_controller() == null`), matching `accountWiring.ts`'s
 * documented 'unwired' case. Running it live against testnet falsified that
 * assumption in the best possible way: the doc-only factory
 * (`CCJFOM6U…`) wires EVERY account it creates to the M1 pool
 * (`CAUZ6WFU…`) at construction — there is no such thing as a "fresh,
 * unwired" account from the current factory. That means the captain's bug
 * was not a one-off misconfiguration on his particular test account; it is
 * the UNIVERSAL state of every account this factory has ever minted. Only a
 * real 7-day `initiate_recovery_rule_removal` -> `execute_recovery_rule_removal`
 * wall-clock migration (`contracts/smart-account/src/contract.rs`) can ever
 * change that — not reproducible in a single test run, so this probe does
 * not attempt it (matches `accountWiring.ts`'s already-documented "Known
 * limit").
 *
 * So the live-reproducible, live-provable claim is the mismatch-detection
 * path itself — exactly the captain's scenario, on a brand-new account:
 *
 *  1. A freshly created account (doc-only factory) is ALREADY wired to the
 *     M1 pool, not the Stage 3 probe controller — `checkAccountWiring`
 *     reports 'wired-to-different-controller' with `currentControllerId`
 *     equal to the M1 pool address.
 *  2. The page's Enroll button is disabled in this state — no orphaned
 *     config can be written through the UI.
 *  3. Even if a caller forces the button enabled and clicks anyway (bypassing
 *     the UI-level gate), the click handler's OWN defensive re-check catches
 *     it and refuses before building/signing any transaction — the fix is
 *     not just a disabled attribute, it is enforced at the point of action.
 *  4. The Status panel's independent read-back agrees: `wiring.status` is
 *     `'wired-to-different-controller'`, and — since Enroll never ran —
 *     `config`/`configHash` are both null (nothing was ever written to the
 *     Stage 3 controller for this account).
 */
test.describe('@testnet recover-v3 account wiring', () => {
  test.describe.configure({ timeout: 180_000 });

  test('fresh factory account is already wired to the M1 pool: Enroll is blocked, not a silent no-op', async ({
    page,
    context,
  }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const { cAddress, host } = await createAndDeployAs(page, PORT, 'stage3-wiring-probe');

    await page.goto(`http://${host}/security/recover-v3/`, { waitUntil: 'domcontentloaded' });
    await page.locator('#cfg-controller').fill(RECOVERY_CONTROLLER_ID);

    // --- 1. Fresh account is already wired — to the M1 pool, not our controller ---
    await page.locator('#wiring-check').click();
    await expect(page.locator('#wiring-status')).toContainText(/wired to a DIFFERENT controller/i, {
      timeout: 30_000,
    });
    await expect(page.locator('#wiring-status')).toContainText(M1_POOL_ID);
    await expect(page.locator('#cfg-enroll')).toBeDisabled();
    await expect(page.locator('#wiring-wire')).toBeHidden();

    // --- 2/3. Even a forced click (UI gate bypassed) is refused by the ---
    //          handler's own defensive re-check, before any tx is built.
    await page.evaluate(() => {
      (document.getElementById('cfg-enroll') as HTMLButtonElement).disabled = false;
    });
    await page.locator('#cfg-enroll').click();
    await expect(page.locator('#cfg-status')).toContainText(/wired to a different controller/i, {
      timeout: 15_000,
    });
    await expect(page.locator('#cfg-status')).toContainText(/inert no-op/i);

    // --- 4. Status panel's independent read-back agrees ---
    await page.locator('#status-refresh').click();
    await expect(page.locator('#status-out')).toContainText('"wired-to-different-controller"', {
      timeout: 30_000,
    });
    const statusJson = (await page.locator('#status-out').textContent())!.trim();
    const status = JSON.parse(statusJson) as {
      wiring: { status: string; currentControllerId: string | null };
      config: unknown;
      configHash: string | null;
    };
    expect(status.wiring.status).toBe('wired-to-different-controller');
    expect(status.wiring.currentControllerId).toBe(M1_POOL_ID);
    expect(status.config).toBeNull();
    expect(status.configHash).toBeNull();

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);

    test.info().annotations.push({ type: 'cAddress', description: cAddress });
    test.info().annotations.push({ type: 'probeController', description: RECOVERY_CONTROLLER_ID });
    test.info().annotations.push({ type: 'actualWiredController', description: M1_POOL_ID });
  });
});
