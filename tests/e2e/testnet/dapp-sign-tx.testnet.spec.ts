import { test, expect, SEED_HEX } from '../../support/fixtures';
import { seedBank } from '../../support/testnet';
import { seedCredential } from '../../support/auth/seed';
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
} from '@stellar/stellar-sdk';

const PORT = Number(process.env.E2E_PORT || 4399);
const DAPP = `http://dapp.localhost:${PORT}`;
const RPC_URL = 'https://soroban-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';
const REGISTRY_ID = 'CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S';
// One hardcoded fallback, mirroring passkey-sdk's REGISTRY_FALLBACKS — used only
// if the on-chain registry lookup is unreachable / has no mapping.
const STATUS_FALLBACK = 'CD5FK6CQ7QIZ5ONARG36Y53ERI5PIBGELSJUTD7OXYLK6EQAS4N3TFBV';
const DUMMY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/**
 * Resolve a contract NAME via the on-chain registry, with a hardcoded fallback.
 * Inlined here (rather than importing `fetchRegistryAddress` from
 * `@g2c/passkey-sdk`) because the SDK's index barrel transitively imports the
 * `smart-account` contract binding, whose untranspiled `export * as` namespace
 * trips Playwright's TS transform in the Node test process. This mirrors the
 * SDK's `registryLookup` + fallback exactly (it only needs @stellar/stellar-sdk).
 */
async function fetchRegistryAddress(name: string): Promise<string> {
  try {
    const server = new rpc.Server(RPC_URL);
    const registry = new Contract(REGISTRY_ID);
    const source = new Account(DUMMY_SOURCE, '0');
    const tx = new TransactionBuilder(source, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(registry.call('fetch_contract_id', nativeToScVal(name, { type: 'string' })))
      .setTimeout(0)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationError(sim)) {
      const result = (sim as rpc.Api.SimulateTransactionSuccessResponse).result;
      const addr = result ? (scValToNative(result.retval) as string | null) : null;
      if (addr) return addr;
    }
  } catch {
    /* fall through to hardcoded fallback */
  }
  return STATUS_FALLBACK;
}

/**
 * @testnet — real-chain end-to-end of the dApp tx-signing ceremony.
 *
 * Drives a Soroban `udpate_message` (sic — the status-message contract method
 * is literally misspelled) transaction through `<caddr>.localhost/sign/?kind=tx`.
 * The dApp side (this Node test) builds an UNSIGNED tx XDR; `/sign/` strips the
 * auth, simulates on testnet, signs the smart account's auth entry with the
 * primary passkey (shim, via walletSign.signTransactionXdr → computeAuthDigest),
 * and on success full-page-redirects (no opener) to
 * `return?g2c_signed=<signed-xdr>&kind=tx`.
 *
 * We EXPECT SUCCESS: the Phase-2 status-message guard already proves
 * `udpate_message` authorizes on-chain under the account's Default rule. So
 * `/sign/`'s internal simulate + assemble must produce a signed XDR and redirect.
 * (We assert the redirect — signing, not submitting; SEP-43 semantics.) An
 * `#error-box` failure here is unexpected and is surfaced verbatim.
 */
test.describe('@testnet dapp tx signing (udpate_message)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('signs an update_message tx via /sign/?kind=tx and redirects g2c_signed', async ({
    page,
    context,
  }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // -----------------------------------------------------------------
    // PART A — create + deploy a v0.7 account (mirrors account-lifecycle)
    // -----------------------------------------------------------------

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

    // 3) Register passkey (shim) → auto-deploy → #done-section. Registration
    //    stores the primary ('default') credential on the C-address origin, so
    //    the /sign/ page (same origin) finds it via loadCredential.
    await page.locator('#register-btn').click();
    await expect(page.locator('#done-section')).toBeVisible({ timeout: 120_000 });
    const cred = await page.evaluate(
      (cid) => localStorage.getItem(`passkey:${cid}:credentialId`),
      cAddress,
    );
    expect(cred).toBeTruthy();
    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);

    // -----------------------------------------------------------------
    // PART B — build an UNSIGNED udpate_message tx XDR (in this Node process)
    // -----------------------------------------------------------------

    // Resolve the status-message contract id via the on-chain registry (has a
    // hardcoded fallback inside fetchRegistryAddress, so it always resolves).
    const statusId = await fetchRegistryAddress('status-message');
    expect(statusId).toMatch(/^C[A-Z2-7]{55}$/);

    // Tx source / fee payer: reuse the funded bank if present, else friendbot a
    // fresh keypair. The smart account authorizes via its passkey; this source
    // is only the fee payer (never the signer of the smart-account auth entry).
    const bankSecret = process.env.G2C_TEST_BANK_SECRET;
    let sourceKp: Keypair;
    if (bankSecret) {
      sourceKp = Keypair.fromSecret(bankSecret);
    } else {
      sourceKp = Keypair.random();
      const fb = await fetch(`${FRIENDBOT_URL}?addr=${sourceKp.publicKey()}`);
      if (!fb.ok) throw new Error(`Friendbot funding failed: ${fb.statusText}`);
    }

    const server = new rpc.Server(RPC_URL);
    const sourceAccount = await server.getAccount(sourceKp.publicKey());

    // Build udpate_message(message: string, author: address). Arg ORDER matches
    // the contract spec (message first, then author = the smart account). Do NOT
    // simulate or sign here — /sign/ strips+rebuilds+simulates+signs the auth.
    const message = `hi from e2e ${Date.now()}`;
    const op = new Contract(statusId).call(
      'udpate_message',
      nativeToScVal(message, { type: 'string' }),
      Address.fromString(cAddress).toScVal(),
    );
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '10000000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(op)
      .setTimeout(0)
      .build();
    const b64 = tx.toXDR();

    // -----------------------------------------------------------------
    // PART C — drive the /sign/?kind=tx ceremony on the account subdomain
    // -----------------------------------------------------------------

    const ret = `${DAPP}/cb`;
    const signUrl =
      `http://${host}/sign/?kind=tx` +
      `&xdr=${encodeURIComponent(b64)}` +
      `&network=${encodeURIComponent('Test SDF Network ; September 2015')}` +
      `&dapp=${encodeURIComponent(DAPP)}` +
      `&return=${encodeURIComponent(ret)}`;
    await page.goto(signUrl, { waitUntil: 'domcontentloaded' });

    // The account has its passkey from registration → #approve should be
    // enabled. If the credential isn't found (#needs-register), seed it on this
    // origin and reload (defensive — registration normally already stored it).
    if (await page.locator('#needs-register').isVisible().catch(() => false)) {
      await seedCredential(page, cAddress, SEED_HEX, 'default');
      await page.goto(signUrl, { waitUntil: 'domcontentloaded' });
    }
    await expect(page.locator('#needs-register')).toBeHidden();
    await expect(page.locator('#approve')).toBeEnabled({ timeout: 30_000 });

    // -----------------------------------------------------------------
    // PART D — approve → shim signs → redirect to return?g2c_signed=…&kind=tx
    // -----------------------------------------------------------------

    await page.locator('#approve').click();

    // Race the success redirect against the page's own #error-box so an on-chain
    // failure surfaces verbatim instead of timing out blind.
    const outcome = await Promise.race([
      page
        .waitForURL('**/cb?g2c_signed=**', { timeout: 180_000 })
        .then(() => 'signed' as const),
      page
        .locator('#error-box')
        .filter({ hasText: /\S/ })
        .first()
        .waitFor({ state: 'visible', timeout: 180_000 })
        .then(() => 'error' as const),
    ]).catch(() => 'timeout' as const);

    if (outcome !== 'signed') {
      // Surface the on-chain / ceremony error verbatim. A failure here is an
      // important finding: we believed udpate_message authorizes under the
      // Default rule (Phase-2 status-message guard proves it), so an
      // unexpected auth rejection (e.g. #3114 ChallengeInvalid, #3002
      // UnvalidatedContext) is real signal — REPORT it, don't loosen the assert.
      const errText = (await page.locator('#error-box').textContent().catch(() => null))?.trim();
      const statusText = (await page.locator('#status').textContent().catch(() => null))?.trim();
      throw new Error(
        `tx signing did not produce a g2c_signed redirect (outcome=${outcome}). ` +
          `error-box="${errText ?? '<none>'}" status="${statusText ?? '<none>'}". ` +
          `account=${cAddress} statusContract=${statusId}. ` +
          `EXPECTED SUCCESS — udpate_message should authorize under the Default rule.`,
      );
    }
    expect(outcome).toBe('signed');

    // Assert the redirect query: kind=tx and a non-empty signed XDR.
    const u = new URL(page.url());
    expect(u.searchParams.get('kind')).toBe('tx');
    const signedXdr = u.searchParams.get('g2c_signed');
    expect(signedXdr).toBeTruthy();
    expect((signedXdr ?? '').length).toBeGreaterThan(0);

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);
    test.info().annotations.push({ type: 'cAddress', description: cAddress });
    test.info().annotations.push({ type: 'statusContract', description: statusId });
    test.info().annotations.push({ type: 'message', description: message });
  });
});
