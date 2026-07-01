import { test, expect, SEED_HEX } from '../../support/fixtures';
import { createNidoAccount } from '../../support/createFlow';
import { seedBank, withRetry } from '../../support/testnet';
import { credentialFor } from '../../support/auth/seed';
import { seedSessionKey } from '../../support/sessionKey';
import {
  Account,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
} from '@stellar/stellar-sdk';

const PORT = Number(process.env.E2E_PORT || 4399);
const DAPP = `http://dapp.localhost:${PORT}`;
const RPC_URL = 'https://soroban-testnet.stellar.org';
const DUMMY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
// Scope target for the session key: the deployed status-message contract on
// testnet (mirrors STATUS_FALLBACK in dapp-sign-tx.testnet.spec.ts). It's a
// real C-address that satisfies the delegate page's target regex.
const TARGET = 'CD5FK6CQ7QIZ5ONARG36Y53ERI5PIBGELSJUTD7OXYLK6EQAS4N3TFBV';

const enc = encodeURIComponent;

/**
 * Node-side mirror of `findRuleForPubkey` (packages/frontend/src/lib/
 * policyChainFetch.ts). Inlined here using ONLY `@stellar/stellar-sdk` — we do
 * NOT import the `@nidohq/passkey-sdk` barrel (its untranspiled `export * as`
 * namespace trips Playwright's TS transform in the Node test process; see the
 * Phase-3a dapp-sign-tx spec).
 *
 * Simulates `get_context_rules_count` then `get_context_rule(i)` on the account,
 * decodes each rule RAW via `scValToNative`, and scans every signer for an
 * `["External", verifierAddr, pubkeyBytes]` whose pubkey hex equals `pubkeyHex`.
 * Returns the matching rule id (or null). Also exposes the verifier + context
 * type of the match for diagnostics.
 */
async function findRuleForPubkey(
  account: string,
  pubkeyHex: string,
): Promise<{ ruleId: number; verifier: string; contextType: string } | null> {
  const server = new rpc.Server(RPC_URL);

  async function simulateView(method: string, ...args: ReturnType<typeof nativeToScVal>[]) {
    const source = new Account(DUMMY_SOURCE, '0');
    const tx = new TransactionBuilder(source, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(new Contract(account).call(method, ...args))
      .setTimeout(0)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(
        `simulateView ${method}: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`,
      );
    }
    const result = (sim as rpc.Api.SimulateTransactionSuccessResponse).result;
    if (!result) throw new Error(`simulateView ${method}: no result`);
    return result.retval;
  }

  // Decode the bytes a raw-`scValToNative` External signer hands back (it may
  // arrive as Uint8Array, a number[], or an object with numeric keys).
  function bytesToHex(raw: unknown): string | null {
    if (raw instanceof Uint8Array) {
      return Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    if (Array.isArray(raw)) {
      return (raw as number[]).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    if (typeof raw === 'object' && raw !== null) {
      const obj = raw as Record<string, number>;
      const ordered: number[] = [];
      for (let j = 0; obj[j as unknown as string] !== undefined; j++) {
        ordered.push(obj[j as unknown as string]);
      }
      if (ordered.length > 0) {
        return ordered.map((b) => b.toString(16).padStart(2, '0')).join('');
      }
    }
    return null;
  }

  // Raw-decoded Soroban enum: a tag-first array (e.g. ["CallContract", addr]),
  // or a bare symbol for a fieldless variant (e.g. "Default").
  function ctxTypeLabel(ct: unknown): string {
    if (Array.isArray(ct)) return ct.map((v) => String(v)).join(':');
    return String(ct);
  }

  const countRv = await simulateView('get_context_rules_count');
  const count = scValToNative(countRv) as number;
  const lowerHex = pubkeyHex.toLowerCase();

  for (let i = 0; i < count; i++) {
    const ruleRv = await simulateView('get_context_rule', nativeToScVal(i, { type: 'u32' }));
    const native = scValToNative(ruleRv) as {
      id?: number;
      signers?: unknown[];
      context_type?: unknown;
    };
    for (const s of native.signers ?? []) {
      // ["External", verifier, pubkey_bytes]
      if (Array.isArray(s) && s[0] === 'External') {
        const candidateHex = bytesToHex(s[2]);
        if (candidateHex && candidateHex.toLowerCase() === lowerHex) {
          return {
            ruleId: native.id ?? i,
            verifier: String(s[1]),
            contextType: ctxTypeLabel(native.context_type),
          };
        }
      }
    }
  }
  return null;
}

/**
 * Read `get_message(author)` off the status-message (TARGET) contract — the
 * on-chain truth that the session-key-signed tx actually wrote the note.
 * Returns the stored note string, or null if unset. Node-side, no SDK barrel.
 */
async function getMessageOnChain(target: string, author: string): Promise<string | null> {
  const server = new rpc.Server(RPC_URL);
  const source = new Account(DUMMY_SOURCE, '0');
  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(target).call('get_message', nativeToScVal(author, { type: 'address' })))
    .setTimeout(0)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`get_message sim: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const rv = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
  if (!rv) return null;
  const v = scValToNative(rv);
  return v == null ? null : String(v);
}

/**
 * @testnet — real-chain end-to-end of the session-key delegation ceremony.
 *
 * A dApp wants the account to grant a scoped session key. It opens
 * `<caddr>.localhost/security/delegate/?origin&target&pubkey&duration&return`.
 * The account owner approves; the page builds
 * `add_context_rule({ context_type: CallContract(target), name:'session-key',
 * signers:[External(verifier, sessionPubkey)] })` and signs it with the PRIMARY
 * passkey (shim → computeAuthDigest), then redirects `?delegation=ok`.
 *
 * This is a SELF-modification — the account adds its OWN rule — so it's
 * authorized by the account's Default rule. We EXPECT SUCCESS. A `#status`
 * "Failed: …" here would be a genuine contract-auth finding (a self-add being
 * rejected) and is surfaced verbatim rather than swallowed.
 *
 * After the redirect we verify on-chain (Node-side, mirroring findRuleForPubkey)
 * that the session pubkey is now an External signer on some rule of the account.
 */
test.describe('@testnet session-key delegation install (primary-passkey signed)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('installs a scoped session key via /security/delegate/ and verifies it on-chain', async ({
    page,
    context,
  }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // -----------------------------------------------------------------
    // PART A — create + deploy a v0.7 account (mirrors account-lifecycle)
    // -----------------------------------------------------------------

    // 1-3) Create + deploy via the My Nido menu, register the passkey (shim) →
    //       #done-section. Registration stores the primary ('default') credential
    //       on the C-address origin, so the delegate page (same origin) signs the
    //       add_context_rule with it. C-address + its subdomain host.
    const { cAddress, host } = await createNidoAccount(page, PORT);
    const cred = await page.evaluate(
      (cid) => localStorage.getItem(`passkey:${cid}:credentialId`),
      cAddress,
    );
    expect(cred).toBeTruthy();
    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);

    // -----------------------------------------------------------------
    // PART B — the dApp's session key (deterministic, Node-side)
    // -----------------------------------------------------------------

    // The dApp generated its own session keypair; we derive the public half
    // deterministically. publicKeyHex is 65-byte uncompressed SEC1 (0x04 || x ||
    // y), matching the delegate page's /^04[0-9a-fA-F]{128}$/ pubkey regex.
    const session = await credentialFor(SEED_HEX, 'session');
    expect(session.publicKeyHex).toMatch(/^04[0-9a-fA-F]{128}$/);

    // -----------------------------------------------------------------
    // PART C — drive the /security/delegate/ ceremony on the account subdomain
    // -----------------------------------------------------------------

    const delegateUrl =
      `http://${host}/security/delegate/?origin=${enc(DAPP)}` +
      `&target=${TARGET}` +
      `&pubkey=${session.publicKeyHex}` +
      `&duration=24h` +
      `&return=${enc(`${DAPP}/cb`)}`;
    await page.goto(delegateUrl, { waitUntil: 'domcontentloaded' });

    // Request surfaced correctly + approval allowed (validate() passed).
    await expect(page.locator('#pubkey-text')).toHaveText(session.publicKeyHex);
    await expect(page.locator('#target-text')).toHaveText(TARGET);
    await expect(page.locator('#approve')).toBeEnabled({ timeout: 30_000 });

    // -----------------------------------------------------------------
    // PART D — approve → shim signs with primary passkey → ?delegation=ok
    // -----------------------------------------------------------------

    await page.locator('#approve').click();

    // Race the success redirect against the page's own "Failed: …" #status so an
    // on-chain rejection surfaces verbatim instead of timing out blind.
    const outcome = await Promise.race([
      page
        .waitForURL('**/cb?delegation=ok**', { timeout: 180_000 })
        .then(() => 'ok' as const),
      page
        .locator('#status')
        .filter({ hasText: /Failed:/ })
        .first()
        .waitFor({ state: 'visible', timeout: 180_000 })
        .then(() => 'failed' as const),
    ]).catch(() => 'timeout' as const);

    if (outcome !== 'ok') {
      // Surface the ceremony / on-chain error verbatim. A failure here is an
      // important finding: a SELF-modification (the account adding its own rule)
      // should authorize under the account's Default rule, so an unexpected
      // rejection is real signal — REPORT it, don't loosen the assert.
      const statusText = (await page.locator('#status').textContent().catch(() => null))?.trim();
      throw new Error(
        `session-key install did not reach ?delegation=ok (outcome=${outcome}). ` +
          `#status="${statusText ?? '<none>'}". ` +
          `account=${cAddress} target=${TARGET} sessionPubkey=${session.publicKeyHex}. ` +
          `EXPECTED SUCCESS — a self-add of a context rule authorizes under the Default rule.`,
      );
    }
    expect(outcome).toBe('ok');

    // -----------------------------------------------------------------
    // PART E — verify on-chain the session key is now an External signer
    // -----------------------------------------------------------------

    // Retry the rule read: after the redirect the install tx has closed, but a
    // different RPC node can briefly lag behind ledger close. withRetry (backoff)
    // avoids a spurious null from that race; it throws (→ test fails) if the rule
    // genuinely never appears.
    const match = await withRetry(
      async () => {
        const m = await findRuleForPubkey(cAddress, session.publicKeyHex);
        if (!m) throw new Error('session pubkey not yet visible on any rule');
        return m;
      },
      { tries: 4, baseMs: 1500 },
    );
    expect(
      match,
      `session pubkey ${session.publicKeyHex} not found as an External signer on any rule of ${cAddress}`,
    ).not.toBeNull();
    expect(match!.ruleId).toBeGreaterThanOrEqual(0);

    // -----------------------------------------------------------------
    // PART F — USE the installed session key to sign a target invocation
    // -----------------------------------------------------------------
    //
    // Task 2: the dApp now SIGNS with the installed session key. We open the
    // status-message dApp, seed the SessionKeyMaterial the dApp reads
    // (`loadSessionKeyMaterial(account, STATUS_CONTRACT)` → localStorage key
    // `nido.<account>.session-key.<STATUS_CONTRACT>`; see support/sessionKey.ts),
    // then drive "set note". With material present the page takes the in-page
    // SESSION path (status-message/index.astro ~L499-635): it discovers the
    // session rule via `findRuleForPubkey`, computes
    // `computeAuthDigest(signature_payload, [thatRuleId])`, signs via
    // `navigator.credentials.get` (the shim dispatches by the session
    // credentialId → session key), injects the External(verifier, sessionPubkey)
    // signature, and submits — authorized under rule 1, NOT the primary's
    // Default rule. NO `/account/?sign=` wallet redirect.
    //
    // STATUS_CONTRACT resolves via `fetchRegistryAddress("status-message")`,
    // whose hardcoded fallback equals TARGET, so the install rule (scoped
    // `CallContract(TARGET)`) is the rule the session signer lands on and the
    // rule the session sign targets.

    // 1) Open the status-message dApp on the apex origin (localhost) — the same
    //    origin Part A's account-create used, where seedBank already seeded the
    //    fee payer (sm:keypairSecret). `loadSessionKeyMaterial` reads localStorage
    //    on THIS origin, so we seed the session material here.
    await page.goto(`http://localhost:${PORT}/status-message/`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('#contract-input')).toBeVisible({ timeout: 30_000 });

    // 2) Seed the session material the dApp's session-sign path reads. Keyed by
    //    STATUS_CONTRACT (== TARGET via the registry fallback). The credentialId
    //    + pubkey reproduce the deterministic session credential installed in
    //    Part C, so findRuleForPubkey finds rule 1 and the shim signs with it.
    const seeded = await seedSessionKey(page, cAddress, TARGET, SEED_HEX);
    expect(seeded.publicKeyHex).toBe(session.publicKeyHex);

    // Reload so the page reads the freshly-seeded material on init.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#contract-input')).toBeVisible({ timeout: 30_000 });

    // Sanity: the material is actually present on this origin under the exact key.
    const present = await page.evaluate(
      ([acc, tgt]) => !!localStorage.getItem(`nido.${acc}.session-key.${tgt}`),
      [cAddress, TARGET] as const,
    );
    expect(present, 'session material not seeded on the status-message origin').toBe(true);

    // 3) Drive "set note". With material present this takes the SESSION path
    //    (in-page sign with the session key) — it must NOT redirect to
    //    /account/?sign=. Guard against the redirect: if it fires, the session
    //    material wasn't picked up and the test should fail loudly rather than
    //    silently exercising the primary path.
    await page.locator('#contract-input').fill(cAddress);
    const sessionNote = `sess-${Date.now().toString(36)}`;
    await page.locator('#message-input').fill(sessionNote);

    const redirected = page
      .waitForURL('**/account/?sign=**', { timeout: 120_000 })
      .then(() => 'redirected' as const)
      .catch(() => null);

    await page
      .locator('#set-form button[type="submit"], #set-form button:not([type])')
      .first()
      .click();

    // 4) Outcome race: session-sign success (#status-value "successfully"), the
    //    page's #error-box (in-page failure surfaced verbatim), or an unexpected
    //    wallet redirect (session path NOT taken).
    const useOutcome = await Promise.race([
      page
        .locator('#status-value')
        .filter({ hasText: /successfully/i })
        .first()
        .waitFor({ timeout: 180_000 })
        .then(() => 'session-set' as const),
      page
        .locator('#error-box')
        .filter({ hasText: /\S/ })
        .first()
        .waitFor({ state: 'visible', timeout: 180_000 })
        .then(() => 'rejected' as const),
      redirected,
    ]).catch(() => 'timeout' as const);

    if (useOutcome !== 'session-set') {
      // Surface the in-page / on-chain error verbatim. A rejection HERE is a
      // genuine contract-auth finding: the session rule's CallContract(TARGET)
      // scope vs the actual invocation context, a digest/rule-id mismatch, or an
      // injection-shape problem. The status-message guard spec proves the SAME
      // update_message invocation succeeds under the PRIMARY Default-rule sign,
      // so a failure that's specific to the SESSION sign isolates the session-key
      // authorization path. Report the exact text; do NOT loosen the assert.
      const errText = (await page.locator('#error-box').textContent().catch(() => null))?.trim();
      const statusText = (await page.locator('#status-value').textContent().catch(() => null))?.trim();
      const url = page.url();
      throw new Error(
        `session-key set-note did NOT succeed (outcome=${useOutcome}). ` +
          `url="${url}" error-box="${errText ?? '<none>'}" ` +
          `status-value="${statusText ?? '<none>'}". ` +
          `account=${cAddress} target=${TARGET} ruleId=${match!.ruleId} ` +
          `sessionPubkey=${session.publicKeyHex}. ` +
          `EXPECTED SUCCESS — the session key is installed on rule ${match!.ruleId} ` +
          `scoped to CallContract(${TARGET}) and update_message invokes that ` +
          `contract. If outcome=redirected, the session material was not read on ` +
          `this origin (the page fell back to the primary /account/?sign= path).`,
      );
    }
    expect(useOutcome).toBe('session-set');

    // Success indicators (mirror the status-message guard spec).
    await expect(page.locator('#result-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#tx-link')).toBeVisible({ timeout: 10_000 });

    // On-chain truth: confirm the SESSION-key-signed tx actually wrote the note
    // (not just that the dApp showed a success UI). Retry for RPC ledger lag.
    const onChainNote = await withRetry(
      async () => {
        const m = await getMessageOnChain(TARGET, cAddress);
        if (m !== sessionNote) throw new Error(`get_message="${m}" != "${sessionNote}" (not yet visible?)`);
        return m;
      },
      { tries: 4, baseMs: 1500 },
    );
    expect(onChainNote).toBe(sessionNote);

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);
    test.info().annotations.push({ type: 'cAddress', description: cAddress });
    test.info().annotations.push({ type: 'sessionPubkey', description: session.publicKeyHex });
    test.info().annotations.push({ type: 'ruleId', description: String(match!.ruleId) });
    test.info().annotations.push({ type: 'verifier', description: match!.verifier });
    test.info().annotations.push({ type: 'contextType', description: match!.contextType });
    test.info().annotations.push({ type: 'sessionNote', description: sessionNote });
  });
});
