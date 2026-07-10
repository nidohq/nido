import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../../support/fixtures';
import { seedBank, withRetry } from '../../support/testnet';
import { createAndDeployAs } from '../../support/recovery';
import {
  Account,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
} from '@stellar/stellar-sdk';

/**
 * @testnet — real-chain end-to-end of the Adsum petition + trust dApp
 * (examples/adsum): create a petition, vouch for a bystander address via its
 * "direct address" (not the QR/pre-vouch invite path), sign the petition,
 * then verify BOTH contracts' on-chain state via rpc simulation readers (no
 * indexer — this mirrors the app's own read layer, `src/lib/petitions.ts` /
 * `trust.ts`).
 *
 * MODEL: structurally mirrors example-dapp.testnet.spec.ts (seedBank,
 * page-error collection, a Node-side `simulateView` helper built only on
 * `@stellar/stellar-sdk` — no `@nidohq/passkey-sdk` barrel import, which
 * trips Playwright's TS transform — race success-vs-error UI states rather
 * than timing out blind, and `test.info().annotations` at the end). Account
 * creation itself, though, uses `tests/support/recovery.ts`'s
 * `createAndDeployAs` (the CURRENT reservation → subdomain →
 * autopass/register → `#enroll-continue` dummy-commitment flow) rather than
 * example-dapp's inline `#create-btn`/`#c-address-result` steps: those
 * predate the wallet reskin (see recovery.ts's own doc comment) and no
 * longer match the app's home page.
 *
 * WHY ONE ACCOUNT IS ENOUGH: `web_of_trust.vouch(from, to)` only
 * `require_auth`s `from` — `to` is stored as plain data with no existence
 * check (confirmed in contracts/web-of-trust/src/contract.rs). So "vouch
 * A→B via direct address" needs exactly one real, deployed account (the
 * petitioner, who also signs their own petition — the contract doesn't
 * forbid a creator signing their own bill) plus one throwaway G-address
 * that never needs funding or deployment, exactly like the fast lane's
 * `VOUCH_TARGET` fixture (tests/e2e/ui/adsum.spec.ts) — just a real,
 * never-touched keypair instead of a scenario constant.
 *
 * DAPP WRITES GO THROUGH A REAL SIGN POPUP (not a full-page redirect, unlike
 * example-dapp's session-key delegation): `wallet.signTransaction`
 * (@nidohq/stellar-wallets-kit-module's `NidoModule`) opens
 * `window.open('<c-address>.<base>/sign/?kind=tx&...', 'nido-wallet', ...)`
 * and awaits a `postMessage` back (packages/stellar-wallets-kit-module/src/
 * redirect.ts). `approveInPopup` below captures that popup via the OPENER
 * page's `page.waitForEvent('popup')` (the 'popup' event fires on the page
 * that called `window.open`, not on the `BrowserContext`), clicks its
 * `#approve` (same ids dapp-sign-tx.testnet.spec.ts drives directly), and
 * waits for it to close.
 *
 * RUN (quarantined testnet tier; needs NIDO_TEST_BANK_SECRET in
 * tests/.env.testnet — optional, only speeds up friendbot-adjacent steps):
 *
 *   `just test-e2e-adsum-testnet` does all of the below. To run by hand:
 *
 *   1. Build the wallet WITH the relayer configured — CRITICAL, and NOT what
 *      `just build-astro` / `test-e2e-testnet` do (see justfile's
 *      test-e2e-adsum-testnet comment): every write here (create_petition /
 *      vouch / sign) is a third-party dApp raw-xdr sign, which
 *      packages/frontend routes through `relayerSubmitAndConfirm`
 *      (packages/frontend/src/lib/signing/submit.ts) with NO fallback for an
 *      unset `PUBLIC_RELAYER_URL` — it would hit a relative "/relay" on the
 *      wallet's own static server (404) instead of the hosted relayer.
 *        PUBLIC_RELAYER_URL=https://nido.fly.dev \
 *        PUBLIC_RELAYER_SIM_SOURCE=GAL42RUBXKQSVSJWBXFTBB4GFKMPQXA3SOJVGP6UMRJT2SGEIR63JFK2 \
 *          npx astro build --root packages/frontend
 *   2. Build the example for LOCAL (apex base, wallet → local server), with
 *      the SAME testnet block test.yml's e2e job builds it with (commit
 *      547a0db) plus PUBLIC_NIDO_BASE pointed at step 1's wallet:
 *        cd examples/adsum && \
 *        PUBLIC_STELLAR_NETWORK=TESTNET \
 *        PUBLIC_STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
 *        PUBLIC_STELLAR_RPC_URL="https://soroban-testnet.stellar.org" \
 *        PUBLIC_STELLAR_HORIZON_URL="https://horizon-testnet.stellar.org" \
 *        PUBLIC_NIDO_BASE="http://localhost:4399" npm run build
 *   3. set -a; . ./tests/.env.testnet; set +a
 *      npx playwright test tests/e2e/testnet/adsum.testnet.spec.ts \
 *        --project=testnet-chromium
 *   (Playwright starts BOTH the wallet server (4399) and, since
 *   examples/adsum/dist now exists, the adsum static server (4401) — see
 *   playwright.config.ts's conditional webServer entry.)
 *
 * NOT independently re-validated end-to-end against live testnet in the
 * environment this was written in — no tests/.env.testnet / bank secret was
 * available, so this run only confirms the spec compiles and is picked up by
 * the right project (see task-10-report.md). The dApp-raw-xdr-via-relayer
 * path this depends on is the same one dapp-sign-tx.testnet.spec.ts already
 * documents "EXPECTED SUCCESS" for a different contract; a rejection here
 * (surfaced verbatim by `approveInPopup`) is real signal, not a flake to
 * paper over.
 */

const PORT = Number(process.env.E2E_PORT || 4399); // wallet frontend
const ADSUM_PORT = Number(process.env.E2E_ADSUM_PORT || 4401); // adsum dApp
const ADSUM = `http://localhost:${ADSUM_PORT}`;
const RPC_URL = 'https://soroban-testnet.stellar.org';
const PASSPHRASE = 'Test SDF Network ; September 2015';
const DUMMY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

// examples/adsum/dist is gitignored and only present once `npm run build` has
// run there. Skip gracefully rather than fail against a webServer entry
// playwright.config.ts never started — same guard tests/e2e/ui/adsum.spec.ts
// uses, resolved from process.cwd() (Playwright transpiles specs to
// CommonJS, so import.meta isn't available here).
const adsumDistPath = join(process.cwd(), 'examples/adsum/dist');
test.skip(!existsSync(adsumDistPath), 'examples/adsum/dist not built');

// Committed staging ids — examples/adsum/environments.toml's
// [staging.contracts], the same ones the built dist's
// src/contracts/{petitions,web_of_trust}.ts pin (and DEPLOYED.md's Adsum
// entry: unverified/adsum-petitions, unverified/adsum-web-of-trust).
const PETITIONS_ID = 'CAUPKCFWVRFRMZXKVMSSZPN6OURTTDS6TDKS6JGXR5XE3D2BEYGT2QJH';
const TRUST_ID = 'CDI5YRC4K54QHJW63ONUQPZ6GOAU254GP43OWGCPK3QVPUKPIQIQGIFS';

// --- Node-side on-chain readers (stellar-sdk only). Mirrors example-dapp
// .testnet.spec's / recovery.testnet.spec's `simulateView` helpers. ---

async function simulateView(
  contractId: string,
  method: string,
  ...args: ReturnType<typeof nativeToScVal>[]
) {
  const server = new rpc.Server(RPC_URL);
  const source = new Account(DUMMY_SOURCE, '0');
  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(contractId).call(method, ...args))
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

async function hasSignedOnChain(id: number, addr: string): Promise<boolean> {
  const rv = await simulateView(
    PETITIONS_ID,
    'has_signed',
    nativeToScVal(id, { type: 'u32' }),
    nativeToScVal(addr, { type: 'address' }),
  );
  return scValToNative(rv) as boolean;
}

async function vouchesReceivedOnChain(addr: string): Promise<string[]> {
  const rv = await simulateView(TRUST_ID, 'vouches_received', nativeToScVal(addr, { type: 'address' }));
  return scValToNative(rv) as string[];
}

/**
 * Seed the SAME localStorage keys the app's `WalletProvider` (borrowed from
 * the stellar-scaffold template — identical scheme to
 * examples/status-message-dapp) reads, so it connects as `cAddress` without
 * opening the kit's `/connect/` picker popup. Mirrors
 * example-dapp.testnet.spec.ts's Part B seeding exactly (same four
 * JSON-encoded keys); `examples/adsum/src/util/storage.ts`'s `TypedStorage`
 * JSON-encodes every value, same as the example dApp's own storage util.
 */
async function connectAs(page: Page, cAddress: string): Promise<void> {
  await page.evaluate(
    ([addr, pass]) => {
      localStorage.setItem('walletId', JSON.stringify('nido'));
      localStorage.setItem('walletAddress', JSON.stringify(addr));
      localStorage.setItem('walletNetwork', JSON.stringify('testnet'));
      localStorage.setItem('networkPassphrase', JSON.stringify(pass));
    },
    [cAddress, PASSPHRASE] as const,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
}

/**
 * Trigger `action` (a click that fires `wallet.signTransaction`), capture the
 * Nido sign popup it opens (the 'popup' event fires on `page`, the opener —
 * NOT on the `BrowserContext`, which only has a broader 'page' event),
 * approve it (`#approve` — same id dapp-sign-tx.testnet.spec.ts drives
 * directly on the same page, here on the popup instead), and wait for it to
 * post its result back to the opener and self-close (redirect.ts's
 * `postResultToOpener`). Surfaces an on-chain rejection (`#error-box`),
 * before OR after the approve click, verbatim rather than timing out blind —
 * mirrors dapp-sign-tx's and recovery.testnet.spec's race-then-throw style.
 */
async function approveInPopup(page: Page, action: () => Promise<void>, label: string): Promise<void> {
  const popupPromise = page.waitForEvent('popup', { timeout: 30_000 });
  await action();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded').catch(() => {});

  const ready = await Promise.race([
    popup
      .locator('#approve')
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => 'ready' as const),
    popup
      .locator('#error-box')
      .filter({ hasText: /\S/ })
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => 'error' as const),
  ]).catch(() => 'timeout' as const);

  if (ready !== 'ready') {
    const errText = (await popup.locator('#error-box').textContent().catch(() => null))?.trim();
    if (!popup.isClosed()) await popup.close().catch(() => {});
    throw new Error(
      `${label}: sign popup did not become approvable (outcome=${ready}). error-box="${errText ?? '<none>'}"`,
    );
  }

  await expect(popup.locator('#approve')).toBeEnabled({ timeout: 30_000 });
  await popup.locator('#approve').click();

  const outcome = await Promise.race([
    popup.waitForEvent('close', { timeout: 200_000 }).then(() => 'closed' as const),
    popup
      .locator('#error-box')
      .filter({ hasText: /\S/ })
      .first()
      .waitFor({ state: 'visible', timeout: 200_000 })
      .then(() => 'error' as const),
  ]).catch(() => 'timeout' as const);

  if (outcome !== 'closed') {
    const errText = popup.isClosed()
      ? null
      : (await popup.locator('#error-box').textContent().catch(() => null))?.trim();
    if (!popup.isClosed()) await popup.close().catch(() => {});
    throw new Error(
      `${label}: sign popup did not close after approve (outcome=${outcome}). error-box="${errText ?? '<none>'}"`,
    );
  }
}

test.describe('@testnet adsum petition + trust dApp — create, vouch, sign', () => {
  test.describe.configure({ timeout: 600_000 });

  test('create petition → vouch A→B (direct address) → sign; has_signed + vouches_received on-chain', async ({
    page,
    context,
  }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // -------- PART A — create + deploy the petitioner's v0.7 account -------
    const petitioner = await createAndDeployAs(page, PORT, 'adsum-petitioner');

    // A plain, never-funded, never-deployed G-address. `vouch`'s `to` is just
    // stored data (no require_auth, no existence check) — the "direct
    // address" case, exactly like the fast lane's VOUCH_TARGET fixture, just
    // a real keypair instead of a scenario constant.
    const target = Keypair.random().publicKey();

    // -------- PART B — connect the adsum dApp as the petitioner ------------
    await page.goto(`${ADSUM}/`, { waitUntil: 'domcontentloaded' });
    await connectAs(page, petitioner.cAddress);

    // -------- PART C — create a petition (dApp write #1) --------------------
    const title = `E2E petition ${Date.now().toString(36)}`;
    const body = 'Filed by the Adsum testnet e2e spec — safe to ignore.';
    await expect(page.locator('#petition-title')).toBeVisible({ timeout: 30_000 });
    await page.locator('#petition-title').fill(title);
    await page.locator('#petition-body').fill(body);
    const postBtn = page.getByRole('button', { name: 'Post to the wall' });
    await expect(postBtn).toBeEnabled({ timeout: 30_000 });

    await approveInPopup(page, async () => postBtn.click(), 'create petition');

    // CreatePetition navigates to /petition/<id> on success (client-side route).
    await page.waitForURL(/\/petition\/\d+$/, { timeout: 60_000 });
    const petitionId = Number(new URL(page.url()).pathname.split('/').filter(Boolean).pop());
    expect(Number.isInteger(petitionId)).toBe(true);

    // -------- PART D — vouch for `target` via its direct address -----------
    await page.goto(`${ADSUM}/vouch?for=${target}`, { waitUntil: 'domcontentloaded' });
    const vouchBtn = page.getByRole('button', { name: 'Vouch' });
    await expect(vouchBtn).toBeEnabled({ timeout: 30_000 });

    await approveInPopup(page, async () => vouchBtn.click(), 'vouch');

    await expect(page.getByText(/Adsum — your vouch stands beside/)).toBeVisible({ timeout: 30_000 });

    // -------- PART E — sign the petition just created -----------------------
    await page.goto(`${ADSUM}/petition/${petitionId}`, { waitUntil: 'domcontentloaded' });
    const stamp = page.getByRole('button', { name: 'Adsum — I am present' });
    await expect(stamp).toBeEnabled({ timeout: 30_000 });

    await approveInPopup(page, async () => stamp.click(), 'sign petition');

    await expect(page.getByText('Adsum — your name is on the record.')).toBeVisible({ timeout: 30_000 });

    // -------- ON-CHAIN TRUTH — has_signed + vouches_received ----------------
    // withRetry absorbs RPC ledger-close lag between "the UI said it worked"
    // and the write actually being visible to a fresh simulation.
    const signed = await withRetry(
      async () => {
        const s = await hasSignedOnChain(petitionId, petitioner.cAddress);
        if (!s) throw new Error(`has_signed(${petitionId}, ${petitioner.cAddress}) still false`);
        return s;
      },
      { tries: 5, baseMs: 1500 },
    );
    expect(signed).toBe(true);

    const received = await withRetry(
      async () => {
        const r = await vouchesReceivedOnChain(target);
        if (!r.includes(petitioner.cAddress)) {
          throw new Error(
            `vouches_received(${target}) does not yet include ${petitioner.cAddress}: [${r.join(', ')}]`,
          );
        }
        return r;
      },
      { tries: 5, baseMs: 1500 },
    );
    expect(received).toContain(petitioner.cAddress);

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);
    test.info().annotations.push({ type: 'petitioner', description: petitioner.cAddress });
    test.info().annotations.push({ type: 'target', description: target });
    test.info().annotations.push({ type: 'petitionId', description: String(petitionId) });
  });
});
