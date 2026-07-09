import { test, expect, useIdentity, SEED_HEX } from '../../support/fixtures';
import { seedBank, withRetry } from '../../support/testnet';
import { credentialFor } from '../../support/auth/seed';
import { createAndDeployAs } from '../../support/recovery';
import type { Page } from '@playwright/test';
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

// Unverified registry on testnet (same one `fetchRegistryAddress` resolves
// through in the app). Hardcoded fallback = the live testnet zk-recovery
// controller from DEPLOYED.md, used only if the registry lookup itself is
// unreachable — mirrors dapp-sign-tx.testnet.spec.ts's fetchRegistryAddress.
const REGISTRY_ID = 'CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S';
const ZK_RECOVERY_FALLBACK = 'CB2PYUHYSWFTZAX3ARYZ4ZP4VJNLYJQMP7T7JE5RRZMOPLPAHSGBZS37';

/**
 * Resolve a contract NAME via the on-chain registry, with a hardcoded
 * fallback. Inlined (rather than importing `@nidohq/passkey-sdk`'s
 * `fetchRegistryAddress`) for the same reason dapp-sign-tx.testnet.spec.ts
 * inlines its own copy: the SDK's index barrel transitively imports
 * `@nidohq/smart-account`'s compiled dist, whose `export * as` namespace
 * trips Playwright's TS transform in the Node test process.
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
  return ZK_RECOVERY_FALLBACK;
}

/**
 * Node-side mirror of `findRuleForPubkey` (copied verbatim from
 * recovery.testnet.spec.ts / session-key.testnet.spec.ts — same duplication
 * rationale: only `@stellar/stellar-sdk`, never the SDK barrel, in the Node
 * test process). Scans every context rule on `account` for an
 * `["External", verifierAddr, pubkeyBytes]` signer matching `pubkeyHex`.
 */
async function findRuleForPubkey(
  account: string,
  pubkeyHex: string,
): Promise<{ ruleId: number; verifier: string } | null> {
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

  const countRv = await simulateView('get_context_rules_count');
  const count = scValToNative(countRv) as number;
  const lowerHex = pubkeyHex.toLowerCase();

  for (let i = 0; i < count; i++) {
    const ruleRv = await simulateView('get_context_rule', nativeToScVal(i, { type: 'u32' }));
    const native = scValToNative(ruleRv) as { id?: number; signers?: unknown[] };
    for (const s of native.signers ?? []) {
      if (Array.isArray(s) && s[0] === 'External') {
        const candidateHex = bytesToHex(s[2]);
        if (candidateHex && candidateHex.toLowerCase() === lowerHex) {
          return { ruleId: native.id ?? i, verifier: String(s[1]) };
        }
      }
    }
  }
  return null;
}

const EVENT_NAME = 'leaf_inserted';

/**
 * Direct-from-chain replacement for the pool-indexer's `GET /leaves`. Mirrors
 * `infra/pool-indexer/src/scanner.ts`'s `SorobanEventsSource.getEvents`
 * byte-for-byte (same topic filter, same `data_format = "map"` decode) —
 * intentionally NOT importing that module (it's a separate npm workspace
 * package, not wired into this repo's shared test deps).
 *
 * WHY this exists instead of just letting the real deployed pool-indexer
 * serve `/leaves`: that worker only scans on a 15-MINUTE cron
 * (see `infra/pool-indexer/wrangler.toml`'s `[triggers].crons`), with no
 * on-demand "scan now" endpoint. A leaf inserted by this test's enrollment
 * step would not be visible to `/leaves` for up to 15 minutes — far past any
 * reasonable e2e timeout, and non-deterministic besides. This function
 * queries the SAME real on-chain `leaf_inserted` events the indexer itself
 * scans, live, via `rpc.Server.getEvents` — no chain state, root, or proof is
 * faked; only the indexer's convenience HTTP cache is swapped for an
 * equivalent direct read (the indexer is explicitly documented as
 * "trust-free, availability-only" — clients always re-verify the rebuilt
 * root against the contract's own `current_root`, which still happens for
 * real here via `verifyAgainstOnChainRoot` inside `syncPoolAndLocate`).
 */
async function fetchPoolLeavesFromChain(
  controllerId: string,
): Promise<{ index: number; leaf: string }[]> {
  const server = new rpc.Server(RPC_URL);
  const latest = await server.getLatestLedger();
  // getEvents retention on soroban-testnet.stellar.org is ~120,960 ledgers
  // (~7 days at 5s/ledger) back from the tip; the controller was deployed
  // TODAY (2026-07-03, DEPLOYED.md), so any window that size safely covers
  // its entire lifetime without hitting "startLedger must be within range".
  const startLedger = Math.max(1, latest.sequence - 120_000);
  const eventNameXdr = nativeToScVal(EVENT_NAME, { type: 'symbol' }).toXDR('base64');
  const filters = [
    {
      type: 'contract' as const,
      contractIds: [controllerId],
      topics: [[eventNameXdr, '*']],
    },
  ];

  const leaves: { index: number; leaf: string }[] = [];
  let cursor: string | undefined;
  for (;;) {
    const response = cursor
      ? await server.getEvents({ filters, cursor, limit: 1000 })
      : await server.getEvents({ filters, startLedger, limit: 1000 });
    for (const ev of response.events) {
      if (ev.topic.length < 2) continue;
      const index = Number(scValToNative(ev.topic[1]));
      const data = scValToNative(ev.value) as { leaf?: Uint8Array } | undefined;
      const leafBytes = data?.leaf;
      if (leafBytes == null || leafBytes.length !== 32) continue;
      leaves.push({ index, leaf: `0x${Buffer.from(leafBytes).toString('hex')}` });
    }
    if (!response.cursor || response.events.length < 1000) break;
    cursor = response.cursor;
  }
  leaves.sort((a, b) => a.index - b.index);
  return leaves;
}

/** Installs the `/leaves` route interception described above, scoped to this
 *  one `page`. Must be called before any navigation that might trigger
 *  `syncPoolAndLocate` (both the ceremony's "Step 3" sync AND its internal
 *  re-sync inside `initiateZkRecovery` hit this same endpoint). */
async function installLivePoolBypass(page: Page, controllerId: string): Promise<void> {
  await page.route('**/leaves', async (route) => {
    let leaves: { index: number; leaf: string }[];
    try {
      leaves = await fetchPoolLeavesFromChain(controllerId);
    } catch (e) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: `live pool bypass failed: ${e instanceof Error ? e.message : String(e)}` }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ leaves }),
    });
  });
}

/**
 * @testnet — real-chain, real-proof end-to-end of ZK (seed-phrase) account
 * recovery: enroll -> lose the device -> real browser `prove()` -> initiate
 * -> wait out the (real, 60s) timelock -> complete -> the recovered passkey
 * controls the account on-chain.
 *
 * Against the LIVE deployed testnet contracts (DEPLOYED.md, M4):
 *   zk-recovery CB2PYUHYSWFTZAX3ARYZ4ZP4VJNLYJQMP7T7JE5RRZMOPLPAHSGBZS37
 *   (delay_secs=60, timelock_floor_secs=0 — e2e-tuned so the whole lifecycle
 *   fits in one test) and zk-verifier CAD36MGYPRX6HBSWSQ33SOI2DBRSQ4WZW3TL56PZZNRPHO4PMCH5QFEP,
 *   both registry-resolved at runtime (no address hardcoded into the app).
 *
 * Enrollment uses the visible MIGRATION path (`enroll_zk_recovery` +
 * `insert_for` via the `#zk-migration-card` on security/), not creation-time
 * enrollment — the live factory is still v1 (no `create_account_v2`), so
 * `createAndDeployAs` always picks "skip" at account creation (see its
 * comment in tests/support/recovery.ts) and this spec enrolls afterwards
 * with a mnemonic it captures and controls.
 *
 * See `installLivePoolBypass` above for the one piece of real infrastructure
 * this test intentionally does NOT wait on (the pool-indexer's 15-minute
 * cron) — everything else (enrollment txs, proving, initiate, timelock,
 * completion, and the final on-chain signer check) is the real thing.
 */
test.describe('@testnet zk recovery (real proof + real chain)', () => {
  test.describe.configure({ timeout: 360_000 });

  test('seed-enrolled account: prove() -> initiate -> timelock -> complete rotates the passkey on-chain', async ({
    page,
    context,
  }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const controllerId = await fetchRegistryAddress('zk-recovery');
    await installLivePoolBypass(page, controllerId);

    // --- SETUP: create + deploy the account (primary passkey = 'zk-owner') ---
    const acct = await createAndDeployAs(page, PORT, 'zk-owner');

    // --- ENROLL via the SEED method (visible migration path: enroll_zk_recovery + insert_for) ---
    await page.goto(`http://${acct.host}/security/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#zk-migration-card')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#zk-migration-seed')).toBeVisible({ timeout: 30_000 });
    await page.locator('#zk-migration-seed').click();
    await expect(page.locator('#zk-migration-seed-words')).toBeVisible({ timeout: 10_000 });

    // Capture the REAL generated mnemonic (rendered as "<n>. <word>" divs, same
    // shape new-account/index.astro's seed-reveal uses) — we re-enter this
    // exact phrase in #zk-mode below to derive the SAME recovery secret.
    const wordDivs = await page.locator('#zk-migration-seed-words > div').allTextContents();
    expect(wordDivs, 'migration card did not render 12 seed words').toHaveLength(12);
    const mnemonic = wordDivs.map((w) => w.replace(/^\d+\.\s*/, '')).join(' ');
    expect(mnemonic.split(' ')).toHaveLength(12);

    await page.locator('#zk-migration-seed-continue').click();
    const enrollOutcome = await Promise.race([
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

    if (enrollOutcome !== 'ok') {
      const status = (await page.locator('#zk-migration-status').textContent().catch(() => ''))?.trim();
      throw new Error(
        `ZK recovery enrollment did not succeed (outcome=${enrollOutcome}). ` +
          `zk-migration-status="${status}" account=${acct.cAddress}.`,
      );
    }

    // --- SIMULATE LOSS: fresh passkey via the recovery ceremony's #zk-mode ---
    await page.goto(`http://${acct.host}/security/recover/?zk=1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#zk-new-key')).toBeVisible({ timeout: 30_000 });

    await useIdentity(page, 'zk-rotated');
    await page.locator('#zk-new-key-btn').click();
    await expect(page.locator('#zk-secret')).toBeVisible({ timeout: 15_000 });

    // --- Derive the SAME secret from the SAME phrase, pool-sync, locate leaf ---
    await page.locator('#zk-mnemonic-input').fill(mnemonic);
    await page.locator('#zk-mnemonic-btn').click();
    await expect(page.locator('#zk-sync')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#zk-sync-status')).toContainText(/found your enrollment/i, {
      timeout: 60_000,
    });
    await expect(page.locator('#zk-initiate')).toBeVisible({ timeout: 15_000 });

    // --- REAL browser prove() + initiate_recovery ---
    await page.locator('#zk-initiate-btn').click();
    await expect(page.locator('#zk-prove')).toBeVisible({ timeout: 10_000 });

    const initiateOutcome = await Promise.race([
      page
        .locator('#zk-initiate-status')
        .filter({ hasText: /Recovery started/i })
        .first()
        .waitFor({ timeout: 180_000 })
        .then(() => 'ok' as const),
      page
        .locator('#zk-initiate-status')
        .filter({ hasText: /Failed/i })
        .first()
        .waitFor({ timeout: 180_000 })
        .then(() => 'failed' as const),
    ]).catch(() => 'timeout' as const);

    if (initiateOutcome !== 'ok') {
      const status = (await page.locator('#zk-initiate-status').textContent().catch(() => ''))?.trim();
      const proveStatus = (await page.locator('#zk-prove-status').textContent().catch(() => ''))?.trim();
      // HONESTY GATE (per the task brief): if real in-browser bb.js/WASM
      // proving cannot run in this headless Playwright environment at all
      // (crash/timeout/thread error), that's a real, specific finding — pin
      // it via test.fixme with the exact error rather than loosen this
      // assertion or fake a pass. Anything else (an on-chain rejection, a
      // pool-sync mismatch, etc.) is a real bug and should fail loudly.
      const looksLikeProvingEnvIssue =
        /WebAssembly|wasm|worker|SharedArrayBuffer|thread|memory access out of bounds|RuntimeError|out of memory/i.test(
          proveStatus + ' ' + status,
        );
      if (looksLikeProvingEnvIssue) {
        test.fixme(
          true,
          `Real in-browser zk proving did not complete in this environment ` +
            `(initiate outcome=${initiateOutcome}). zk-prove-status="${proveStatus}" ` +
            `zk-initiate-status="${status}". Enrollment (real enroll_zk_recovery + ` +
            `insert_for) DID complete on-chain for ${acct.cAddress} above; only the ` +
            `prove()/initiate_recovery step is blocked here.`,
        );
        return;
      }
      throw new Error(
        `initiate_recovery did not succeed (outcome=${initiateOutcome}). ` +
          `zk-prove-status="${proveStatus}" zk-initiate-status="${status}" account=${acct.cAddress}.`,
      );
    }

    await expect(page.locator('#zk-countdown')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#zk-countdown-text')).toContainText('Executable in');

    // --- Wait out the REAL timelock (delay_secs=60 on the live controller) ---
    await expect(page.locator('#zk-complete')).toBeVisible({ timeout: 120_000 });

    // --- Complete: zero-signer, permissionless add_context_rule ---
    await page.locator('#zk-complete-btn').click();
    const completeOutcome = await Promise.race([
      page
        .locator('#zk-complete-status')
        .filter({ hasText: /Done/i })
        .first()
        .waitFor({ timeout: 90_000 })
        .then(() => 'ok' as const),
      page
        .locator('#zk-complete-status')
        .filter({ hasText: /Failed/i })
        .first()
        .waitFor({ timeout: 90_000 })
        .then(() => 'failed' as const),
    ]).catch(() => 'timeout' as const);

    if (completeOutcome !== 'ok') {
      const status = (await page.locator('#zk-complete-status').textContent().catch(() => ''))?.trim();
      throw new Error(
        `recovery completion did not succeed (outcome=${completeOutcome}). ` +
          `zk-complete-status="${status}" account=${acct.cAddress}.`,
      );
    }

    // --- ON-CHAIN READ-BACK: the recovered passkey is now a real signer ---
    const rotated = await credentialFor(SEED_HEX, 'zk-rotated');
    expect(rotated.publicKeyHex).toMatch(/^04[0-9a-fA-F]{128}$/);
    const rotatedRule = await withRetry(
      async () => {
        const m = await findRuleForPubkey(acct.cAddress, rotated.publicKeyHex);
        if (!m) throw new Error(`recovered pubkey not yet an on-chain signer on ${acct.cAddress}`);
        return m;
      },
      { tries: 5, baseMs: 2000 },
    );
    expect(
      rotatedRule,
      `recovered pubkey ${rotated.publicKeyHex} not found as a signer on ${acct.cAddress}`,
    ).not.toBeNull();

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);
    test.info().annotations.push({ type: 'account', description: acct.cAddress });
    test.info().annotations.push({ type: 'recoveredPubkey', description: rotated.publicKeyHex });
    test.info().annotations.push({ type: 'recoveredRuleId', description: String(rotatedRule.ruleId) });
  });
});
