import { test, expect, useIdentity, SEED_HEX } from '../../support/fixtures';
import { seedBank, withRetry } from '../../support/testnet';
import { credentialFor } from '../../support/auth/seed';
import { createAndDeployAs, installRecoveryRule } from '../../support/recovery';
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
const RPC_URL = 'https://soroban-testnet.stellar.org';
const DUMMY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/**
 * Node-side mirror of `findRuleForPubkey` (copied verbatim from
 * session-key.testnet.spec.ts). Uses ONLY `@stellar/stellar-sdk` — NOT the
 * `@g2c/passkey-sdk` barrel (its untranspiled `export * as` namespace trips
 * Playwright's TS transform in the Node test process).
 *
 * Simulates `get_context_rules_count` then `get_context_rule(i)` on the account,
 * decodes each rule RAW via `scValToNative`, and scans every signer for an
 * `["External", verifierAddr, pubkeyBytes]` whose pubkey hex equals `pubkeyHex`.
 * Returns the matching rule id (or null), plus the verifier + context type.
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
 * @testnet — real-chain end-to-end of the social-recovery (1-of-1) ceremony.
 *
 * An account with a friend-gated recovery rule rotates its passkey after the
 * owner "loses" their device:
 *  1) Deploy a friend account + the originator account with DISTINCT passkeys
 *     (useIdentity before each register — otherwise both register the same
 *     'default' key and the test is meaningless).
 *  2) Install a 1-of-1 recovery rule on the originator (CallContract(self),
 *     multisig-policy threshold 1, the friend as the sole signer). This is a
 *     primary-passkey self-mod (proven by the session-key install spec).
 *  3) Originator: create a fresh rotation passkey (#om-new-key), stage the
 *     rotation (#om-prepare — freezes the canonical parentSignatureExpiration-
 *     Ledger and emits the ?handoff= link).
 *  4) Friend: open the handoff link ON THE FRIEND'S subdomain (so loadCredential
 *     finds the friend's key), sign the nested auth entry with their OWN passkey
 *     (#fm-sign → #fm-blob).
 *  5) Originator: paste the blob, add it (#om-add-sig → 1/1), submit
 *     (#om-submit → #om-submit-status).
 *
 * ADDITIVE recovery (NOT a full rotation): this flow only ADDS the new passkey
 * to the account's Default rule (rule 0); the old/lost key is NOT revoked.
 * Soroban permits one InvokeHostFunction op per tx, so a rotation is a single
 * action and prepareRotation prefers ADDING the new key — the #om-remove-id
 * removal branch is never exercised here. After this test the account has BOTH
 * the old (lost) and new keys installed as signers on rule 0. Revoking the lost
 * key (filling #om-remove-id, a second rotation) is a deferred follow-on.
 *
 * ASSERT-OR-PIN: recovery is the most auth-fragile flow (nested friend auth
 * targeting the RECOVERING account's __check_auth + byte-identical parent
 * expiration + multisig threshold policy). If a step is rejected on-chain we
 * capture the EXACT #om-submit-status / #fm-status text and which step produced
 * it, then throw (documenting the failure) rather than mask it. On success we
 * independently verify on-chain (findRuleForPubkey) that the new key landed as a
 * signer — UI string + chain truth, mirroring the session-key spec's standard.
 */
test.describe('@testnet social recovery (1-of-1)', () => {
  test.describe.configure({ timeout: 360_000 });

  test('friend-gated key ADD (additive recovery): stage → friend signs → collect → submit', async ({
    page,
    context,
  }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // --- SETUP: deploy friend, then originator (distinct identities) ---
    const friend = await createAndDeployAs(page, PORT, 'friend-a');
    const orig = await createAndDeployAs(page, PORT, 'originator');

    // Install a 1-of-1 recovery rule on the originator; friend = friend account.
    await installRecoveryRule(page, orig.host, [friend.cAddress], 1);

    // --- ORIGINATOR: new key + stage rotation ---
    await page.goto(`http://${orig.host}/security/recover/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#originator-mode')).toBeVisible({ timeout: 30_000 });
    // The recovery rule must have been discovered (#om-no-rule stays hidden, the
    // stage UI shows). If #om-no-rule is shown, the install didn't land.
    await expect(page.locator('#om-no-rule')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#om-new-key')).toBeVisible({ timeout: 30_000 });

    // The NEW rotation passkey is a fresh identity (shim create() keys off it).
    await useIdentity(page, 'orig-rotated');
    await page.locator('#om-new-key').click();
    await expect(page.locator('#om-key-status')).toContainText(/created|0x|04|…/i, {
      timeout: 30_000,
    });
    await expect(page.locator('#om-prepare')).toBeEnabled({ timeout: 15_000 });
    await page.locator('#om-prepare').click();
    await expect(page.locator('#om-collect')).toBeVisible({ timeout: 90_000 });

    const handoff = (await page.locator('#om-link').inputValue()).trim();
    expect(handoff, '#om-prepare did not emit a handoff link').toContain('handoff=');

    // --- FRIEND: open handoff on the friend subdomain, sign ---
    // The handoff link points at the ORIGINATOR host; rewrite host→friend host
    // so the friend signs on THEIR subdomain where loadCredential finds the
    // friend's primary passkey.
    const handoffParam = new URL(handoff, `http://${orig.host}`).searchParams.get('handoff')!;
    await page.goto(
      `http://${friend.host}/security/recover/?handoff=${encodeURIComponent(handoffParam)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await expect(page.locator('#friend-mode')).toBeVisible({ timeout: 30_000 });
    // NOTE: the page fills #fm-account with `contractIdFromHostname(hostname)` —
    // i.e. the CURRENT (friend) subdomain's account, NOT the recovering
    // originator (a UI labeling quirk: the copy says "your friend …" but the
    // value is this account). So assert it equals the FRIEND address. The
    // originator↔friend link is enforced inside signRotationAsFriend, which
    // requires `handoff.friends.includes(friendAccount)`.
    await expect(page.locator('#fm-account')).toContainText(friend.cAddress.slice(0, 8));
    await page.locator('#fm-sign').click();

    // #fm-blob is a textarea revealed (and filled) only after a successful sign.
    // Race the success status against a "Failed: …" so a friend-side rejection
    // surfaces verbatim instead of timing out blind.
    const friendOutcome = await Promise.race([
      page
        .locator('#fm-status')
        .filter({ hasText: /Signed/i })
        .first()
        .waitFor({ timeout: 60_000 })
        .then(() => 'signed' as const),
      page
        .locator('#fm-status')
        .filter({ hasText: /Failed/i })
        .first()
        .waitFor({ timeout: 60_000 })
        .then(() => 'failed' as const),
    ]).catch(() => 'timeout' as const);

    if (friendOutcome !== 'signed') {
      const fmStatus = (await page.locator('#fm-status').textContent().catch(() => ''))?.trim();
      throw new Error(
        `friend sign step did not succeed (outcome=${friendOutcome}). ` +
          `fm-status="${fmStatus}" orig=${orig.cAddress} friend=${friend.cAddress}.`,
      );
    }
    const blob = (await page.locator('#fm-blob').inputValue()).trim();
    expect(blob.length, 'friend blob is empty').toBeGreaterThan(0);

    // --- ORIGINATOR: collect + submit ---
    await page.goto(`http://${orig.host}/security/recover/`, { waitUntil: 'domcontentloaded' });
    // Staging persists in the originator's localStorage, so #om-collect resumes.
    await expect(page.locator('#om-collect')).toBeVisible({ timeout: 30_000 });
    await page.locator('#om-paste').fill(blob);
    await page.locator('#om-add-sig').click();
    await expect(page.locator('#om-progress')).toContainText(/1\s*(of|\/)\s*1/i, {
      timeout: 15_000,
    });
    await expect(page.locator('#om-submit')).toBeEnabled({ timeout: 15_000 });
    await page.locator('#om-submit').click();

    // --- ASSERT or PIN ---
    // On success #om-submit-status reads "Rotation submitted: <hash>. …".
    // On failure it reads "Failed: <msg>". (This page has no #error-box.)
    const outcome = await Promise.race([
      page
        .locator('#om-submit-status')
        .filter({ hasText: /Rotation submitted|submitted|success|rotated|now active/i })
        .first()
        .waitFor({ timeout: 240_000 })
        .then(() => 'ok' as const),
      page
        .locator('#om-submit-status')
        .filter({ hasText: /Failed/i })
        .first()
        .waitFor({ state: 'visible', timeout: 240_000 })
        .then(() => 'failed' as const),
    ]).catch(() => 'timeout' as const);

    if (outcome !== 'ok') {
      const status = (await page.locator('#om-submit-status').textContent().catch(() => ''))?.trim();
      // PIN: recovery is the most auth-fragile flow (nested friend auth +
      // byte-identical parent expiration + multisig policy). A rejection here is
      // a real finding worth capturing precisely — do NOT loosen the assert.
      // >>> FLIP to assert 'ok' once recovery succeeds on-chain.
      throw new Error(
        `recovery submit did not succeed (outcome=${outcome}). ` +
          `om-submit-status="${status}" ` +
          `orig=${orig.cAddress} friend=${friend.cAddress}.`,
      );
    }
    expect(outcome).toBe('ok');

    // --- ON-CHAIN READ-BACK (chain truth, not just the UI string) ---
    // The UI said "Rotation submitted"; now independently confirm the new
    // rotation key actually landed as a signer on the originator's rules. Mirror
    // session-key's standard: derive the rotated key's pubkey deterministically
    // (same seed+label the shim's create() used at #om-new-key) and assert it's
    // an External signer on rule 0 (recovery ADDS the new primary key to the
    // Default rule). withRetry absorbs RPC ledger-close lag.
    const rotated = await credentialFor(SEED_HEX, 'orig-rotated');
    expect(rotated.publicKeyHex).toMatch(/^04[0-9a-fA-F]{128}$/);
    const rotatedRule = await withRetry(
      async () => {
        const m = await findRuleForPubkey(orig.cAddress, rotated.publicKeyHex);
        if (!m) {
          throw new Error(`rotated pubkey not yet an on-chain signer on ${orig.cAddress}`);
        }
        return m;
      },
      { tries: 4, baseMs: 1500 },
    );
    expect(
      rotatedRule,
      `rotated pubkey ${rotated.publicKeyHex} not found as a signer on ${orig.cAddress}`,
    ).not.toBeNull();
    // Recovery ADDS the new primary key to the Default rule (rule 0).
    expect(rotatedRule.ruleId).toBe(0);

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);
    test.info().annotations.push({ type: 'orig', description: orig.cAddress });
    test.info().annotations.push({ type: 'friend', description: friend.cAddress });
    test.info().annotations.push({ type: 'rotatedPubkey', description: rotated.publicKeyHex });
    test.info().annotations.push({ type: 'rotatedRuleId', description: String(rotatedRule.ruleId) });
  });
});
