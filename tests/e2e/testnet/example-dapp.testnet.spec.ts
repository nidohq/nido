import { test, expect, useIdentity } from '../../support/fixtures';
import { seedBank, withRetry } from '../../support/testnet';
import {
  Account,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
} from '@stellar/stellar-sdk';

/**
 * @testnet — real-chain end-to-end of the EXAMPLE dApp's Nido flow
 * (examples/status-message-dapp), the user-facing payoff of "log in with Nido =
 * create a passkey for this dApp":
 *
 *   1. Create + deploy a v0.7 smart account (wallet frontend).
 *   2. Open the example dApp (its own origin), seed the connected Nido account
 *      (skips the kit picker popup — orthogonal, covered elsewhere).
 *   3. Click the example's "Create dApp passkey" → startDelegation creates a
 *      session passkey at the dApp origin and full-page-redirects to the
 *      wallet's /security/delegate/, which the owner approves with the PRIMARY
 *      passkey (shim) → installs a CallContract-scoped session rule → returns.
 *   4. Verify the session key is on-chain.
 *   5. Click "Save" → the example signs update_message IN-PAGE with the session
 *      passkey (nidoSign.ts) and submits — NO wallet round-trip.
 *   6. Verify on-chain that the note was written.
 *
 * The session credential is the shim's deterministic 'session' identity, minted
 * by the example's own createSessionPasskey, so its pubkey flows through to the
 * on-chain rule and the in-page get() re-derives the same key.
 *
 * RUN (quarantined testnet tier; needs G2C_TEST_BANK_SECRET in tests/.env.testnet):
 *   1. Build the wallet:   npx tsc -p packages/passkey-sdk/tsconfig.json && \
 *                          npx astro build --root packages/frontend
 *   2. Build the example for LOCAL (apex base, wallet → local server):
 *        cd examples/status-message-dapp && \
 *        PUBLIC_STELLAR_NETWORK=TESTNET \
 *        PUBLIC_STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
 *        PUBLIC_STELLAR_RPC_URL="https://soroban-testnet.stellar.org" \
 *        PUBLIC_STELLAR_HORIZON_URL="https://horizon-testnet.stellar.org" \
 *        PUBLIC_G2C_BASE="http://localhost:4399" npx vite build
 *   3. Serve the example:  node tests/support/example-server.mjs &   (port 4400)
 *   4. set -a; . ./tests/.env.testnet; set +a
 *      npx playwright test tests/e2e/testnet/example-dapp.testnet.spec.ts \
 *        --project=testnet-chromium
 *   (Playwright starts the wallet server on 4399 via its webServer config.)
 */

const PORT = Number(process.env.E2E_PORT || 4399); // wallet frontend
const EX_PORT = Number(process.env.E2E_EXAMPLE_PORT || 4400); // example dApp
const EXAMPLE = `http://localhost:${EX_PORT}`;
const RPC_URL = 'https://soroban-testnet.stellar.org';
const DUMMY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
// The example targets its own committed status-message deployment (the contract
// id baked into examples/status-message-dapp/src/contracts/status_message.ts).
const CONTRACT = 'CBXVJXHPSYORSAHPX4I6NYPQMDJWK2STQCE6JTIM7FNV4OZSIDJFGNDM';

const PASSPHRASE = 'Test SDF Network ; September 2015';

// --- Node-side on-chain readers (stellar-sdk only; no @g2c/passkey-sdk barrel,
// which trips Playwright's TS transform). Copied from session-key.testnet.spec. ---

async function simulateView(account: string, method: string, ...args: ReturnType<typeof nativeToScVal>[]) {
  const server = new rpc.Server(RPC_URL);
  const source = new Account(DUMMY_SOURCE, '0');
  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(account).call(method, ...args))
    .setTimeout(0)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulateView ${method}: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const result = (sim as rpc.Api.SimulateTransactionSuccessResponse).result;
  if (!result) throw new Error(`simulateView ${method}: no result`);
  return result.retval;
}

function bytesToHex(raw: unknown): string | null {
  if (raw instanceof Uint8Array) return Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('');
  if (Array.isArray(raw)) return (raw as number[]).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, number>;
    const ordered: number[] = [];
    for (let j = 0; obj[j as unknown as string] !== undefined; j++) ordered.push(obj[j as unknown as string]);
    if (ordered.length) return ordered.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return null;
}

async function findRuleForPubkey(account: string, pubkeyHex: string): Promise<{ ruleId: number } | null> {
  const countRv = await simulateView(account, 'get_context_rules_count');
  const count = scValToNative(countRv) as number;
  const lowerHex = pubkeyHex.toLowerCase();
  for (let i = 0; i < count; i++) {
    const ruleRv = await simulateView(account, 'get_context_rule', nativeToScVal(i, { type: 'u32' }));
    const native = scValToNative(ruleRv) as { id?: number; signers?: unknown[] };
    for (const s of native.signers ?? []) {
      if (Array.isArray(s) && s[0] === 'External') {
        const cand = bytesToHex(s[2]);
        if (cand && cand.toLowerCase() === lowerHex) return { ruleId: native.id ?? i };
      }
    }
  }
  return null;
}

async function getMessageOnChain(target: string, author: string): Promise<string | null> {
  const rv = await simulateView(target, 'get_message', nativeToScVal(author, { type: 'address' }));
  const v = scValToNative(rv);
  return v == null ? null : String(v);
}

test.describe('@testnet example status-message dApp — Nido delegation + in-page sign', () => {
  test.describe.configure({ timeout: 300_000 });

  test('connect → create dApp passkey → in-page session sign update_message', async ({ page, context }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const consoleErrs: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrs.push(m.text());
    });

    // -------- PART A — create + deploy a v0.7 account (wallet frontend) --------
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('#create-btn').click();
    await expect(page.locator('#c-address-result')).not.toBeEmpty({ timeout: 60_000 });
    const cAddress = (await page.locator('#c-address-result').textContent())?.trim() ?? '';
    expect(cAddress).toMatch(/^C[A-Z2-7]{55}$/);

    const setupHref = await page.locator('#setup-link').getAttribute('href');
    const key = new URL(setupHref!, 'http://x').searchParams.get('key')!;
    const host = `${cAddress.toLowerCase()}.localhost:${PORT}`;
    await page.goto(`http://${host}/new-account/?key=${encodeURIComponent(key)}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('#register-btn').click();
    await expect(page.locator('#done-section')).toBeVisible({ timeout: 120_000 });

    // -------- PART B — open the EXAMPLE and seed the connected Nido account ----
    // The example's storage util JSON-encodes values; WalletProvider reads these
    // four keys and (for the popup-always g2c wallet) takes the cached address
    // without opening the picker.
    await page.goto(`${EXAMPLE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ([addr, pass]) => {
        localStorage.setItem('walletId', JSON.stringify('g2c'));
        localStorage.setItem('walletAddress', JSON.stringify(addr));
        localStorage.setItem('walletNetwork', JSON.stringify('testnet'));
        localStorage.setItem('networkPassphrase', JSON.stringify(pass));
      },
      [cAddress, PASSPHRASE] as const,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    const createPasskeyBtn = page.getByRole('button', { name: /Create dApp passkey/i });
    await expect(createPasskeyBtn).toBeVisible({ timeout: 30_000 });

    // -------- PART C — Create dApp passkey (mint 'session') → redirect ---------
    await useIdentity(page, 'session');
    await createPasskeyBtn.click();
    await page.waitForURL('**/security/delegate/**', { timeout: 60_000 });
    await expect(page.locator('#target-text')).toHaveText(CONTRACT, { timeout: 30_000 });
    await expect(page.locator('#approve')).toBeEnabled({ timeout: 30_000 });

    // -------- PART D — approve (primary passkey) → back to the example ---------
    await page.locator('#approve').click();
    const delegated = await Promise.race([
      page.waitForURL(`${EXAMPLE}/**`, { timeout: 200_000 }).then(() => 'back' as const),
      page
        .locator('#status')
        .filter({ hasText: /Failed:/ })
        .first()
        .waitFor({ state: 'visible', timeout: 200_000 })
        .then(() => 'failed' as const),
    ]).catch(() => 'timeout' as const);
    if (delegated !== 'back') {
      const st = (await page.locator('#status').textContent().catch(() => null))?.trim();
      throw new Error(
        `delegation did not return to the example (outcome=${delegated}). #status="${st ?? '<none>'}". account=${cAddress}`,
      );
    }
    // The example confirms the session is active.
    await expect(page.getByText(/dApp passkey active/i)).toBeVisible({ timeout: 30_000 });

    // -------- PART E — verify the session key is installed on-chain -----------
    const sessionPubkey = await page.evaluate(
      ([acc, c]) => {
        const raw = localStorage.getItem(`g2c.${acc}.session-key.${c}`);
        return raw ? (JSON.parse(raw).publicKey as string) : null;
      },
      [cAddress, CONTRACT] as const,
    );
    expect(sessionPubkey, 'session material not saved on the example origin').toMatch(/^04[0-9a-fA-F]{128}$/);
    const match = await withRetry(
      async () => {
        const m = await findRuleForPubkey(cAddress, sessionPubkey!);
        if (!m) throw new Error('session pubkey not yet visible on any rule');
        return m;
      },
      { tries: 5, baseMs: 1500 },
    );
    expect(match!.ruleId).toBeGreaterThanOrEqual(0);

    // -------- PART F — Save: in-page session-passkey sign of update_message ----
    const note = `ex-${Date.now().toString(36)}`;
    await page.locator('#status-draft').fill(note);
    await page.getByRole('button', { name: /^Save$/ }).click();

    const saved = page
      .getByText(/Saved on-chain/i)
      .first()
      .waitFor({ timeout: 200_000 })
      .then(() => 'saved' as const)
      .catch(() => 'timeout' as const);
    const outcome = await saved;

    if (outcome !== 'saved') {
      // Surface diagnostics verbatim (the example shows save errors in the draft
      // input's error slot).
      const cardText = (await page
        .locator('text=Your status')
        .locator('xpath=ancestor::*[1]')
        .textContent()
        .catch(() => null))?.trim();
      throw new Error(
        `example in-page session sign did NOT succeed (outcome=${outcome}). ` +
          `account=${cAddress} contract=${CONTRACT} ruleId=${match!.ruleId} ` +
          `sessionPubkey=${sessionPubkey}. card="${cardText ?? '<none>'}" ` +
          `consoleErrors=${JSON.stringify(consoleErrs.slice(-5))}`,
      );
    }

    // -------- On-chain truth: the session-signed tx wrote the note ------------
    const onChain = await withRetry(
      async () => {
        const m = await getMessageOnChain(CONTRACT, cAddress);
        if (m !== note) throw new Error(`get_message="${m}" != "${note}" (not yet visible?)`);
        return m;
      },
      { tries: 5, baseMs: 1500 },
    );
    expect(onChain).toBe(note);

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);
    test.info().annotations.push({ type: 'cAddress', description: cAddress });
    test.info().annotations.push({ type: 'sessionPubkey', description: sessionPubkey! });
    test.info().annotations.push({ type: 'ruleId', description: String(match!.ruleId) });
    test.info().annotations.push({ type: 'note', description: note });
  });
});
