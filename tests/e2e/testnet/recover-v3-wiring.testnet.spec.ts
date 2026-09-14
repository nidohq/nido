import { test, expect } from '../../support/fixtures';
import { seedBank } from '../../support/testnet';
import { createAndDeployAs } from '../../support/recovery';

const PORT = Number(process.env.E2E_PORT || 4399);

// Stage 3 recovery-controller v2 (adds reconfigure/config_hash — the
// ZK/guardian convergence fix). See packages/passkey-sdk/src/recoveryStage3/deployment.ts.
const RECOVERY_CONTROLLER_ID = 'CBYSWPHNWAHYUBZO5TBTO5MCW2ZC45F2C3L4JSUZXYQFNMHTOBOCCHZU';
// Any well-formed G-address — GuardianOnly mode just needs a nonempty
// guardian list; this probe doesn't drive a real recovery attempt.
const DUMMY_GUARDIAN = 'GAMPJROHOAW662FINQ4XQOY2ULX5IEGYXCI4SMZYE75EHQBR6PSTJG3M';
const BASELINE_DOC = JSON.stringify({
  version: 1,
  network: 'Test SDF Network ; September 2015',
  signers: [
    {
      id: 'admin',
      verifier: 'CACVGSAHYFBXY4LJKWW5B57LAAXHCZVDZOANUTYPLNV6HHQI4Q35EGMY',
      key: `04${'11'.repeat(64)}`,
    },
  ],
  rules: [{ name: 'admin', principals: { type: 'all', signers: ['admin'] }, scope: { type: 'self-admin' } }],
});

/**
 * @testnet — live probe for the account-wiring fix (the account-wiring fix (on
 * PR #206), RE-RUN after the factory fix for the ZK/guardian convergence fix
 * (`contracts/factory/src/contract.rs::deploy_account_contract` no longer
 * unconditionally wires new accounts to the M1 `nido-zk-recovery` pool).
 *
 * HISTORY: this spec originally expected a freshly created account to start
 * genuinely `unwired` (`recovery_controller() == null`). A live run
 * falsified that at the time — the doc-only factory then in production
 * wired EVERY new account to the M1 pool at construction, so the spec was
 * rewritten to instead prove the mismatch-DETECTION path (Enroll correctly
 * refusing on a wired-elsewhere account) rather than the happy path. The
 * ZK/guardian convergence fix removed that unconditional wiring (DEPLOYED.md's Factory
 * entry, 2026-09-14 upgrade) — so THIS version returns to the originally
 * intended assertion, now true: a fresh account really does start unwired,
 * and `recover-v3`'s wire -> enroll flow completes end to end against it.
 *
 * Live-probes:
 *  1. A freshly created account (current, post-fix factory) reports
 *     `checkAccountWiring` status `'unwired'`, NOT `'wired-to-different-
 *     controller'` — the M1-pool pre-wiring is gone.
 *  2. `recover-v3`'s "Wire account to controller" + Enroll (GuardianOnly)
 *     both succeed, landing a real `RecoveryConfig` on the Stage 3
 *     controller.
 *  3. The Status panel's independent read-back shows `wiring.status ===
 *     'wired-to-target'`, a non-null `config`, and a non-null `configHash`
 *     — confirmed against real on-chain state via `stellar contract invoke`.
 */
test.describe('@testnet recover-v3 account wiring', () => {
  test.describe.configure({ timeout: 180_000 });

  test('fresh (post factory-fix) account starts unwired: wire -> enroll succeeds end to end', async ({
    page,
    context,
  }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const { cAddress, host } = await createAndDeployAs(page, PORT, 'stage3-wiring-probe-v2');

    await page.goto(`http://${host}/security/recover-v3/`, { waitUntil: 'domcontentloaded' });
    await page.locator('#cfg-controller').fill(RECOVERY_CONTROLLER_ID);

    // --- 1. Fresh account starts genuinely unwired (the factory fix) ---
    await page.locator('#wiring-check').click();
    await expect(page.locator('#wiring-status')).toContainText(/NOT wired/i, { timeout: 30_000 });
    await expect(page.locator('#cfg-enroll')).toBeDisabled();
    await expect(page.locator('#wiring-wire')).toBeVisible();

    // --- 2. Wire the account to the Stage 3 controller ---
    await page.locator('#wiring-wire').click();
    await expect(page.locator('#wiring-status')).toContainText(/^Wired\. tx:/, { timeout: 60_000 });

    await page.locator('#wiring-check').click();
    await expect(page.locator('#wiring-status')).toContainText(/wired to this controller/i, { timeout: 30_000 });
    await expect(page.locator('#cfg-enroll')).toBeEnabled();

    // --- 3. Enroll (GuardianOnly, minimal config) ---
    await page.locator('#cfg-mode').selectOption('GuardianOnly');
    await page.locator('#cfg-guardians').fill(DUMMY_GUARDIAN);
    await page.locator('#cfg-threshold').fill('1');
    await page.locator('#cfg-baseline-doc').fill(BASELINE_DOC);
    await page.locator('#cfg-enroll').click();
    await expect(page.locator('#cfg-status')).toContainText(/^Enrolled\. tx:/, { timeout: 60_000 });

    // --- 4. Status panel's independent read-back ---
    await page.locator('#status-refresh').click();
    await expect(page.locator('#status-out')).toContainText('"wired-to-target"', { timeout: 30_000 });
    const statusJson = (await page.locator('#status-out').textContent())!.trim();
    const status = JSON.parse(statusJson) as {
      wiring: { status: string; currentControllerId: string | null };
      config: unknown;
      configHash: string | null;
    };
    expect(status.wiring.status).toBe('wired-to-target');
    expect(status.wiring.currentControllerId).toBe(RECOVERY_CONTROLLER_ID);
    expect(status.config).not.toBeNull();
    expect(status.configHash).toMatch(/^[0-9a-f]{64}$/);

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);

    test.info().annotations.push({ type: 'cAddress', description: cAddress });
    test.info().annotations.push({ type: 'controller', description: RECOVERY_CONTROLLER_ID });
    test.info().annotations.push({ type: 'configHash', description: status.configHash ?? '' });
  });
});
