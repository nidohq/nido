import {
  Account, Contract, Networks, TransactionBuilder, nativeToScVal, scValToNative, rpc,
} from '@stellar/stellar-sdk';
import { test, expect, SEED_HEX } from '../../support/fixtures';
import { seedBank } from '../../support/testnet';
import { seedCredential } from '../../support/auth/seed';

const PORT = Number(process.env.E2E_PORT || 4399);
const RPC_URL = 'https://soroban-testnet.stellar.org';
const DUMMY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
// Stage 3 recovery-controller v2 (adds reconfigure/config_hash — the
// ZK/guardian convergence fix). See packages/passkey-sdk/src/recoveryStage3/deployment.ts.
const RECOVERY_CONTROLLER_ID = 'CBYSWPHNWAHYUBZO5TBTO5MCW2ZC45F2C3L4JSUZXYQFNMHTOBOCCHZU';
const DUMMY_FRIEND = 'GAMPJROHOAW662FINQ4XQOY2ULX5IEGYXCI4SMZYE75EHQBR6PSTJG3M';

// Pre-deployed directly via `stellar contract invoke create_account` against
// the live, upgraded factory (theahaco's own funded key, NOT the shared
// relayer) — see the final report for the exact commands. The shared
// relayer's 30 req/min per-IP token bucket (infra/relayer/README.md) was
// exhausted by this session's own earlier testing, so `createAndDeployAs`
// (which needs the relayer for account CREATION specifically) is not usable
// right now; the security-page operations below (`signAndSubmit`) fall back
// to classic/friendbot self-submission when the relayer isn't configured at
// build time (this build has PUBLIC_RELAYER_URL unset), so those steps are
// unaffected either way. Each account's passkey is the SAME deterministic
// (SEED_HEX, label) credential `seedCredential` seeds below, so the shim can
// sign for it exactly as if it had registered the passkey itself.
const ZK_FIRST_ACCOUNT = 'CBY2E6AA7D5PTGB5JXASYAHDRJI6LY62JFEKWWQ45J3B76FNE4HIZI6B';
const ZK_FIRST_LABEL = 'stage3-combined-zk-first';
const GUARDIAN_FIRST_ACCOUNT = 'CAWNROKYENDO6W2FPF4VIDO7CBUH6GOKVG2D72TGWEM3HTKNCA6NIDFZ';
const GUARDIAN_FIRST_LABEL = 'stage3-combined-guardian-first';

// Raw simulate + scValToNative, NOT the generated `@nidohq/recovery-controller`
// bindings — that package's `export * as contract from ...`/`export * as rpc
// from ...` namespace re-exports trip Playwright's Node-side TS transform
// (same class of issue `recovery.testnet.spec.ts`'s own `findRuleForPubkey`
// helper works around by staying on `@stellar/stellar-sdk` alone).
async function readCombinedConfig(account: string): Promise<{
  mode: string;
  guardians: string[];
  guardian_threshold: number;
  verifier: string | null;
  zk_pool: string | null;
} | null> {
  const server = new rpc.Server(RPC_URL);
  const source = new Account(DUMMY_SOURCE, '0');
  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(RECOVERY_CONTROLLER_ID).call('config', nativeToScVal(account, { type: 'address' })))
    .setTimeout(0)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`config() simulate failed: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const result = (sim as rpc.Api.SimulateTransactionSuccessResponse).result;
  if (!result) throw new Error('config(): no result');
  const native = scValToNative(result.retval) as {
    mode?: unknown;
    guardians?: string[];
    guardian_threshold?: number;
    verifier?: string | null;
    zk_pool?: string | null;
  } | null;
  if (!native) return null;
  // Raw-decoded Soroban enum: a tag-first array (e.g. ["Combined"]), or a
  // bare symbol for a fieldless variant.
  const modeTag = Array.isArray(native.mode) ? String(native.mode[0]) : String(native.mode);
  return {
    mode: modeTag,
    guardians: native.guardians ?? [],
    guardian_threshold: native.guardian_threshold ?? 0,
    verifier: native.verifier ?? null,
    zk_pool: native.zk_pool ?? null,
  };
}

/** Drives the real `/security/` "Add ZK recovery" (seed choice) card to
 *  completion — same selectors `zk-recovery.testnet.spec.ts` already
 *  exercises for the full recovery lifecycle; this probe only needs the
 *  enrollment half.
 *
 *  `renderZkMigrationCard`'s "already enrolled" probe
 *  (`zkAlreadyEnrolled`/`recovery_rule_id()`) can't distinguish "has a
 *  Stage 3 config with ZK" from "has ANY Stage 3 rule at all" — after a
 *  guardian-first enrollment the account already has a rule (from
 *  `install_recovery_rule`, mode-independent), so this card renders the
 *  "Already backed up" state instead of the fresh choices, even though ZK
 *  itself was never enrolled. The underlying "Add another recovery secret"
 *  reveal still reaches the identical `#zk-migration-seed` flow, so this
 *  probe adapts to whichever variant rendered rather than needing that
 *  display-level imprecision fixed (a separate, non-blocking polish item
 *  from the functional coexistence bug this probe targets). */
async function enrollZkViaSeed(page: import('@playwright/test').Page, host: string): Promise<void> {
  await page.goto(`http://${host}/security/`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#zk-migration-card')).toBeVisible({ timeout: 30_000 });

  // `renderZkMigrationCard` is async (one RPC round-trip to decide which
  // branch to render) — wait for WHICHEVER of the two possible buttons
  // actually shows up, rather than a single `.isVisible()` snapshot (which
  // doesn't wait at all and races the render).
  const addAnother = page.locator('#zk-migration-add-another');
  const freshSeed = page.locator('#zk-migration-seed');
  const which = await Promise.race([
    addAnother.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'already-enrolled' as const),
    freshSeed.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'fresh' as const),
  ]);
  if (which === 'already-enrolled') {
    await addAnother.click();
  }
  await expect(page.locator('#zk-migration-seed')).toBeVisible({ timeout: 30_000 });
  await page.locator('#zk-migration-seed').click();
  await expect(page.locator('#zk-migration-seed-words')).toBeVisible({ timeout: 10_000 });
  await page.locator('#zk-migration-seed-continue').click();

  const outcome = await Promise.race([
    page
      .locator('#zk-migration-status')
      .filter({ hasText: /backed up with a seed phrase/i })
      .first()
      .waitFor({ timeout: 120_000 })
      .then(() => 'ok' as const),
    page
      .locator('#zk-migration-status')
      .filter({ hasText: /Failed/i })
      .first()
      .waitFor({ timeout: 120_000 })
      .then(() => 'failed' as const),
  ]).catch(() => 'timeout' as const);

  if (outcome !== 'ok') {
    const status = (await page.locator('#zk-migration-status').textContent().catch(() => ''))?.trim();
    throw new Error(`ZK enrollment did not succeed (outcome=${outcome}). zk-migration-status="${status}"`);
  }
}

/** Drives the real `/security/` "Set up recovery" form for a 1-of-1 friend
 *  — same selectors `security-recovery-install.testnet.spec.ts` already
 *  exercises. Assumes the page is already open on the target account. */
async function enrollGuardianViaForm(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#add-recovery').click();
  await expect(page.locator('#recovery-form')).toBeVisible({ timeout: 10_000 });

  const friendRows = page.locator('#rc-friends .friend-row');
  await expect(friendRows).toHaveCount(3);
  await friendRows.nth(2).locator('.remove').click();
  await friendRows.nth(1).locator('.remove').click();
  await expect(page.locator('#rc-friends .friend-row')).toHaveCount(1);

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
    throw new Error(`guardian install did not succeed (outcome=${outcome}). form-error="${errText}"`);
  }
}

/**
 * @testnet — live probe for the ZK/guardian convergence fix: ZK recovery
 * (via `/security/`'s "Add ZK recovery") and guardian recovery (via
 * `/security/`'s "Set up recovery") must be able to coexist on ONE
 * `RecoveryController` instance regardless of which is added first —
 * that's `AuthMode::Combined`. Before this fix, ZK enrollment wired the
 * account directly to the M1 pool (a DIFFERENT controller from the
 * guardian flow's Stage 3 controller), so the second factor always hit
 * `wired-to-different-controller` and refused.
 *
 * Both orderings, both via the REAL production `/security/` forms (not
 * synthetic contract calls), against a factory that (as of this fix) mints
 * genuinely unwired accounts — confirmed independently via
 * `RecoveryController::config()` reading back `Combined` mode with BOTH
 * `guardians` (from the guardian flow) and `verifier`/`zk_pool` (from the
 * ZK flow) populated on the SAME config.
 *
 * NOT SAFE TO RE-RUN as committed: both `enroll`/`reconfigure` calls are
 * one-shot per (account, evidence-factor) — the two hardcoded accounts
 * above already ran through this probe successfully and are both already
 * `Combined` (independently confirmed via `stellar contract invoke ...
 * config` — see the final report for the exact readback). A future run
 * needs two freshly `create_account`-deployed accounts substituted in
 * (raw `stellar contract invoke create_account` against the live factory,
 * same recipe as `security-recovery-install.testnet.spec.ts`'s own note —
 * `createAndDeployAs` cannot substitute here either, for the same reason:
 * it needs the relayer for account CREATION, while this probe otherwise
 * runs in classic/friendbot mode).
 */
test.describe('@testnet recovery stage 3: ZK + guardian converge on Combined', () => {
  test.describe.configure({ timeout: 300_000 });

  test('ZK first, then guardian -> Combined on one controller', async ({ page, context }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const host = `${ZK_FIRST_ACCOUNT.toLowerCase()}.localhost:${PORT}`;
    await page.goto(`http://${host}/security/`, { waitUntil: 'domcontentloaded' });
    await seedCredential(page, ZK_FIRST_ACCOUNT, SEED_HEX, ZK_FIRST_LABEL);

    await enrollZkViaSeed(page, host);
    await page.goto(`http://${host}/security/`, { waitUntil: 'domcontentloaded' });
    await enrollGuardianViaForm(page);

    await page.waitForURL(/\/security\/?$/, { timeout: 30_000 });
    await expect(page.locator('#recovery-list')).toContainText(/1 of 1 friend.*rotate/i, { timeout: 60_000 });

    const cfg = await readCombinedConfig(ZK_FIRST_ACCOUNT);
    expect(cfg, 'RecoveryController::config returned no config').not.toBeNull();
    expect(cfg!.mode).toBe('Combined');
    expect(cfg!.guardians).toEqual([DUMMY_FRIEND]);
    expect(cfg!.guardian_threshold).toBe(1);
    expect(cfg!.verifier).not.toBeNull();
    expect(cfg!.zk_pool).not.toBeNull();

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);
    test.info().annotations.push({ type: 'account', description: ZK_FIRST_ACCOUNT });
    test.info().annotations.push({ type: 'order', description: 'zk-then-guardian' });
  });

  test('guardian first, then ZK -> Combined on one controller', async ({ page, context }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const host = `${GUARDIAN_FIRST_ACCOUNT.toLowerCase()}.localhost:${PORT}`;
    await page.goto(`http://${host}/security/`, { waitUntil: 'domcontentloaded' });
    await seedCredential(page, GUARDIAN_FIRST_ACCOUNT, SEED_HEX, GUARDIAN_FIRST_LABEL);
    await page.goto(`http://${host}/security/`, { waitUntil: 'domcontentloaded' });

    await enrollGuardianViaForm(page);
    await page.waitForURL(/\/security\/?$/, { timeout: 30_000 });
    await expect(page.locator('#recovery-list')).toContainText(/1 of 1 friend.*rotate/i, { timeout: 60_000 });

    await enrollZkViaSeed(page, host);

    const cfg = await readCombinedConfig(GUARDIAN_FIRST_ACCOUNT);
    expect(cfg, 'RecoveryController::config returned no config').not.toBeNull();
    expect(cfg!.mode).toBe('Combined');
    expect(cfg!.guardians).toEqual([DUMMY_FRIEND]);
    expect(cfg!.guardian_threshold).toBe(1);
    expect(cfg!.verifier).not.toBeNull();
    expect(cfg!.zk_pool).not.toBeNull();

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);
    test.info().annotations.push({ type: 'account', description: GUARDIAN_FIRST_ACCOUNT });
    test.info().annotations.push({ type: 'order', description: 'guardian-then-zk' });
  });
});
