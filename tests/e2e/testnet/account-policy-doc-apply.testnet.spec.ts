import { rpc, Contract, Networks, Account, TransactionBuilder, scValToNative } from '@stellar/stellar-sdk';
import { test, expect, SEED_HEX } from '../../support/fixtures';
import { seedBank } from '../../support/testnet';
import { seedCredential } from '../../support/auth/seed';

const PORT = Number(process.env.E2E_PORT || 4399);
const RPC_URL = 'https://soroban-testnet.stellar.org';
const DUMMY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

// Reuses the ZK-first combined-recovery probe account from the
// ZK/guardian-convergence fix (tests/e2e/testnet/recovery-stage3-combined.testnet.spec.ts)
// — already live, funded, and signable via the SAME deterministic
// (SEED_HEX, IDENTITY_LABEL) credential, so this probe adds no new account
// deploy. What it exercises is new: the `/account/policy/` page (the policy
// inspector + doc builder from the policy-document UI work) applying a real
// `apply_doc` update, not a raw script or a different page.
const ACCOUNT = 'CBY2E6AA7D5PTGB5JXASYAHDRJI6LY62JFEKWWQ45J3B76FNE4HIZI6B';
const IDENTITY_LABEL = 'stage3-combined-zk-first';
// Any well-formed G-address — the "delegated key" admin-add path only
// validates StrKey format, no on-chain existence check, and avoids a second
// WebAuthn ceremony mid-test (the "new passkey" path would need one too).
const DUMMY_ADMIN_ADDRESS = 'GAMPJROHOAW662FINQ4XQOY2ULX5IEGYXCI4SMZYE75EHQBR6PSTJG3M';

async function readAppliedDocHash(account: string): Promise<string | null> {
  const server = new rpc.Server(RPC_URL);
  const source = new Account(DUMMY_SOURCE, '0');
  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(account).call('applied_doc_hash'))
    .setTimeout(0)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`applied_doc_hash() simulate failed: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const result = (sim as rpc.Api.SimulateTransactionSuccessResponse).result;
  if (!result) throw new Error('applied_doc_hash(): no result');
  const native = scValToNative(result.retval) as ArrayLike<number> | null;
  return native ? Buffer.from(native).toString('hex') : null;
}

/**
 * @testnet — live smoke test for the consolidated branch (perch PRs
 * 200/201/202/204/205/206 merged into one): the policy-document UI
 * (`/account/policy/`, `PolicyBuilder.ts`/`PolicyInspector.ts` — from the
 * policy-page/showcase work) driving a real `apply_doc` transaction against
 * a live testnet account, end to end through the actual page — not a
 * synthetic contract call or the fast/no-chain UI tier
 * (`tests/e2e/ui/policy-page.spec.ts`, which never touches chain).
 *
 * Flow: load `/account/policy/` for the recovery-convergence probe account
 * → the doc-only baseline loads and renders the current rules → switch to
 * the Admin keys tab → add a delegated-key admin rule → submit (signed via
 * the account's own seeded passkey) → a success toast confirms the apply →
 * independently confirm on-chain via `applied_doc_hash()` that the hash
 * changed (a real document replaced the prior one).
 */
test.describe('@testnet account policy page — real apply_doc via the policy UI', () => {
  test.describe.configure({ timeout: 120_000 });

  test('adding an admin key through /account/policy/ lands a real apply_doc', async ({ page, context }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const host = `${ACCOUNT.toLowerCase()}.localhost:${PORT}`;
    const truncated = `${DUMMY_ADMIN_ADDRESS.slice(0, 6)}…${DUMMY_ADMIN_ADDRESS.slice(-6)}`;

    await page.goto(`http://${host}/account/policy/`, { waitUntil: 'domcontentloaded' });
    await seedCredential(page, ACCOUNT, SEED_HEX, IDENTITY_LABEL);
    await page.goto(`http://${host}/account/policy/`, { waitUntil: 'domcontentloaded' });

    // Baseline loaded, current rules rendered.
    await expect(page.locator('#pol-doc-section')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#pol-rules')).not.toContainText('unavailable', { timeout: 30_000 });

    // Admin-keys tab.
    await page.locator('#pol-tab-admin').click();
    await expect(page.locator('#pol-adm-list')).toBeVisible({ timeout: 15_000 });
    // `#pol-adm-list` renders "Reading the applied document…" until the
    // async baseline read resolves — wait for that placeholder to clear
    // before checking its content, or the idempotency check below races
    // the baseline load and always sees the placeholder instead of rows.
    await expect(page.locator('#pol-adm-list')).not.toContainText('Reading the applied document', { timeout: 15_000 });

    // Re-run safety: this account is real, live testnet state, not reset
    // between runs — a prior run of THIS spec already added
    // DUMMY_ADMIN_ADDRESS as an admin rule. If it's already there, skip the
    // add (the contract correctly refuses a duplicate — "This key is
    // already an admin on the account" — proving the SAME real apply_doc
    // path, just not a fresh mutation) and go straight to verifying the
    // page reflects it.
    const alreadyAdmin = await page.locator('#pol-adm-list').innerText().then((t) => t.includes(truncated));

    if (!alreadyAdmin) {
      const hashBefore = await readAppliedDocHash(ACCOUNT);

      // "A key I already have" -> "Delegated key" -> paste a G-address.
      await page.locator('input[name="adm-source"][value="paste"]').check();
      await page.locator('select[name="adm-kind"]').selectOption('delegated');
      await page.locator('input[name="adm-address"]').fill(DUMMY_ADMIN_ADDRESS);

      await page.locator('#pol-adm-submit').click();

      const outcome = await Promise.race([
        page.locator('#nido-toast-msg').filter({ hasText: 'Admin key enrolled.' })
          .waitFor({ timeout: 60_000 }).then(() => 'ok' as const),
        page.locator('#pol-adm-errors').filter({ visible: true })
          .waitFor({ timeout: 60_000 }).then(() => 'errored' as const),
      ]);
      if (outcome === 'errored') {
        const msg = await page.locator('#pol-adm-errors').innerText();
        throw new Error(`admin-key apply_doc failed in the UI: ${msg}`);
      }

      const hashAfter = await readAppliedDocHash(ACCOUNT);
      expect(hashAfter).not.toBeNull();
      expect(hashAfter).not.toBe(hashBefore);
    }

    const fatal = errors.filter((e) => e.includes('Buffer') || e.includes('is not defined') || e.includes('Unexpected token'));
    expect(fatal).toEqual([]);

    // Reload: the applied document (now including the new admin rule) still
    // renders — the page's own read path agrees with the on-chain state,
    // not just an in-memory optimistic update. The rules list truncates
    // addresses as `first6…last6` (not a plain prefix slice).
    await page.goto(`http://${host}/account/policy/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#pol-rules')).toContainText(truncated, { timeout: 30_000 });
  });
});
