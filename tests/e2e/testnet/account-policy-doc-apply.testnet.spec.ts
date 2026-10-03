import { rpc, Contract, Networks, Account, TransactionBuilder, scValToNative } from '@stellar/stellar-sdk';
import { test, expect } from '../../support/fixtures';
import { createAndDeployAs } from '../../support/recovery';

const PORT = Number(process.env.E2E_PORT || 4399);
const RPC_URL = 'https://soroban-testnet.stellar.org';
const DUMMY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
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
 * @testnet — the policy-document UI (`/account/policy/`,
 * `PolicyBuilder.ts`/`PolicyInspector.ts`) driving a real `apply_doc` on a
 * fresh Perch account, end to end through the page: load the policy page,
 * add a delegated-key admin rule, submit (signed by the account's passkey),
 * see the success toast, and confirm on chain via `applied_doc_hash()` that
 * a new document replaced the first one.
 */
test.describe('@testnet account policy page — real apply_doc via the policy UI', () => {
  test.describe.configure({ timeout: 300_000 });

  test('adding an admin key through /account/policy/ lands a real apply_doc', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const { cAddress: account, host } = await createAndDeployAs(page, PORT, `policy-doc-${Date.now()}`);
    const truncated = `${DUMMY_ADMIN_ADDRESS.slice(0, 6)}…${DUMMY_ADMIN_ADDRESS.slice(-6)}`;

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

    const hashBefore = await readAppliedDocHash(account);

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

    const hashAfter = await readAppliedDocHash(account);
    expect(hashAfter).not.toBeNull();
    expect(hashAfter).not.toBe(hashBefore);

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
