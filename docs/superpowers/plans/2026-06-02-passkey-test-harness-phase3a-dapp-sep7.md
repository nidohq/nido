# Passkey Test Harness — Phase 3a (Dapp / SEP-7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** E2E-test the dapp-facing wallet ceremonies — `/connect/` account picker and `/sign/` (message, authEntry, tx) — driving the wallet *as a dapp would*, using the shim for passkey auth.

**Architecture:** The connect/sign pages support a **redirect fallback** (when there's no popup opener, they redirect to the `return` URL with result params). Tests use that: navigate directly to the ceremony URL and assert the redirect carries the result — no popup/postMessage plumbing needed. Connect and message/authEntry signing need **no chain** (fast tier); tx-sign simulates+submits on testnet. A small Node-computed helper seeds the shim's deterministic credential into localStorage so sign tests don't have to run the full registration first.

**Tech Stack:** Playwright 1.60.x, the Phase 1 shim/fixtures, the existing `tests/support/{auth,testnet}.ts`, `@g2c/passkey-sdk` (signing), `@g2c/stellar-wallets-kit-module` (URL builders / result parsers, already unit-tested).

**Scope:** Phase 3a = dapp/SEP-7 only. **Phase 3b (multi-actor recovery + session-key delegation) is a separate plan** — it needs N independent shim identities and hits the contract auth-model. Note: on-chain signing flows may surface contract-auth issues (cf. bug #3 `UnvalidatedContext` from Phase 2); where an on-chain step is rejected for a real contract-side reason, **pin it** (assert the known failure with a "flip when fixed" comment) rather than mask.

---

## Context (verified against the current `feat/nido-rebrand` pages)

**Connect** (`/connect/` on the apex/wallet origin, `packages/frontend/src/pages/connect/index.astro`):
- Lists accounts from the wallet origin's localStorage as `.account-row` buttons inside `#accounts-list`; `#dapp-origin`, `#no-accounts`, `#cancel`, `#error-box`.
- On account click → `finish('?g2c_address=<C>')`; cancel → `finish('?g2c_connect=cancelled')`. `finish` posts to the popup opener if present, else **redirects to the `return` URL** with the result query string appended. Reads `?dapp=<origin>&return=<url>`; requires `return` same-origin with `dapp`.

**Sign** (`<caddr>.<base>/sign/`, `packages/frontend/src/pages/sign/index.astro`):
- `#dapp-origin`, `#kind-label`, `#account-text`, `#payload-text`, `#needs-register`, `#status`, `#approve`, `#cancel`.
- Reads `?kind=tx|message|authEntry&[xdr|message|authEntry]=…&network=&dapp=&return=`. `#approve` → signs via `walletSign.ts` (uses `computeAuthDigest` — correct) → `finish('?g2c_signed=<result>&kind=<kind>')`; cancel → `?g2c_sign=cancelled`. If no passkey for the account: shows `#needs-register`, `#approve` disabled.

**URL builders / result parsers:** `@g2c/stellar-wallets-kit-module` (`urls.ts` builds the URLs; `handover.ts` parses `?g2c_address=` / `?g2c_signed=`). These have unit tests already.

---

## File Structure

**New:**
- `tests/support/auth/seed.ts` — Node-side: compute the shim's deterministic `{credentialIdB64u, publicKeyHex}` for a label, and a Playwright helper to seed them into an account's localStorage (so sign tests skip registration).
- `tests/support/dapp.ts` — helpers to build connect/sign ceremony URLs (thin wrappers over the kit-module URL builders) + assert the redirect result.
- `tests/e2e/ui/dapp-connect.spec.ts` — `@fast` connect ceremony.
- `tests/e2e/ui/dapp-sign.spec.ts` — `@fast` message + authEntry signing.
- `tests/e2e/testnet/dapp-sign-tx.testnet.spec.ts` — `@testnet` tx signing (simulate + submit).

**Modify:** none (additive).

---

## Task 1: Deterministic credential seed helper

**Files:**
- Create: `tests/support/auth/seed.ts`
- Test: `tests/support/auth/seed.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/support/auth/seed.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { credentialFor } from './seed';

const SEED = '07'.repeat(32);

describe('credentialFor', () => {
  it('returns a base64url credentialId + 130-hex-char uncompressed pubkey, stable per label', async () => {
    const a = await credentialFor(SEED, 'originator');
    const b = await credentialFor(SEED, 'originator');
    expect(a).toEqual(b);
    expect(a.credentialIdB64u).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.publicKeyHex).toMatch(/^04[0-9a-f]{128}$/);
    expect((await credentialFor(SEED, 'friend-a')).publicKeyHex).not.toBe(a.publicKeyHex);
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `npx vitest run --config vitest.support.config.ts tests/support/auth/seed.test.ts`
Expected: FAIL "Cannot find module './seed'".

- [ ] **Step 3: Implement `tests/support/auth/seed.ts`**

```ts
import type { Page } from '@playwright/test';
import { credentialIdForLabel, privateKeyForCredentialId, publicKeyFromPrivate } from './vault';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function b64u(u: Uint8Array): string {
  return Buffer.from(u).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function hex(u: Uint8Array): string {
  return Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The shim's deterministic credential for `label` (same derivation the shim
 *  uses), in the storage encodings the app expects:
 *  credentialId → base64url, publicKey → hex. */
export async function credentialFor(seedHex: string, label: string) {
  const seed = hexToBytes(seedHex);
  const credId = await credentialIdForLabel(seed, label);
  const pub = publicKeyFromPrivate(await privateKeyForCredentialId(seed, credId));
  return { credentialIdB64u: b64u(credId), publicKeyHex: hex(pub) };
}

/** Seed the primary-passkey credential into an account's localStorage on the
 *  current page's origin (so signing flows find it via loadCredential, without
 *  running the registration UI first). Call after navigating to the account
 *  origin. Storage keys match packages/passkey-sdk/src/storage.ts. */
export async function seedCredential(page: Page, account: string, seedHex: string, label = 'default') {
  const cred = await credentialFor(seedHex, label);
  await page.evaluate(
    ([acc, cid, pk]) => {
      localStorage.setItem(`passkey:${acc}:credentialId`, cid);
      localStorage.setItem(`passkey:${acc}:publicKey`, pk);
    },
    [account, cred.credentialIdB64u, cred.publicKeyHex] as const,
  );
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `npx vitest run --config vitest.support.config.ts tests/support/auth/seed.test.ts`
Expected: PASS. Then the whole support suite: `npx vitest run --config vitest.support.config.ts` (all green).

- [ ] **Step 5: Commit**

```bash
git add tests/support/auth/seed.ts tests/support/auth/seed.test.ts
git commit -m "feat(test): deterministic credential seed helper for dapp sign tests"
```

---

## Task 2: Connect ceremony (`@fast`)

**Files:**
- Create: `tests/e2e/ui/dapp-connect.spec.ts`

The connect picker reads accounts from the wallet origin's localStorage (`saveAccount`) and, with no popup opener, redirects to `return` with `?g2c_address=`. No chain.

- [ ] **Step 1: Confirm the account-storage key + saveAccount shape**

Run:
```bash
grep -nE "saveAccount|loadAccounts|g2c:accounts|setItem" packages/passkey-sdk/src/storage.ts | head
```
Record the exact localStorage key/format `saveAccount` writes (e.g. `g2c:accounts` → JSON array of C-addresses). Use that to seed an account in Step 2 (or call `saveAccount` via `page.evaluate` + an injected import — simplest is to set the raw key/value you found).

- [ ] **Step 2: Write the test**

`tests/e2e/ui/dapp-connect.spec.ts`:
```ts
import { test, expect } from '../../support/fixtures';

const PORT = Number(process.env.E2E_PORT || 4399);
const ACCOUNT = 'CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY';
// dapp + return must be same-origin; use a dapp subdomain the static server also serves.
const DAPP = `http://dapp.localhost:${PORT}`;

test.describe('@fast dapp connect ceremony', () => {
  test('picker returns the chosen account via redirect', async ({ page }) => {
    // Seed one account into the wallet (apex) origin's storage, using the exact
    // key/format from Step 1. Example for a JSON-array store under g2c:accounts:
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((acc) => {
      // ADAPT this to the real saveAccount format discovered in Step 1.
      localStorage.setItem('g2c:accounts', JSON.stringify([acc]));
    }, ACCOUNT);

    const ret = `${DAPP}/cb`;
    await page.goto(
      `http://localhost:${PORT}/connect/?dapp=${encodeURIComponent(DAPP)}&return=${encodeURIComponent(ret)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await expect(page.locator('#accounts-list .account-row')).toHaveCount(1);
    await expect(page.locator('#dapp-origin')).toContainText('dapp.localhost');

    await page.locator('#accounts-list .account-row').first().click();
    // No opener → redirect to return with ?g2c_address=
    await page.waitForURL(`**/cb?g2c_address=${ACCOUNT}**`, { timeout: 10_000 });
    expect(new URL(page.url()).searchParams.get('g2c_address')).toBe(ACCOUNT);
  });

  test('cancel returns g2c_connect=cancelled', async ({ page }) => {
    const ret = `${DAPP}/cb`;
    await page.goto(
      `http://localhost:${PORT}/connect/?dapp=${encodeURIComponent(DAPP)}&return=${encodeURIComponent(ret)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.locator('#cancel').click();
    await page.waitForURL('**/cb?g2c_connect=cancelled**', { timeout: 10_000 });
  });
});
```

- [ ] **Step 3: Run on chromium/firefox/webkit**

Run: `npx playwright test tests/e2e/ui/dapp-connect.spec.ts --grep @fast`
Expected: PASS on all three. ADAPT the `g2c:accounts` seeding to the real format (Step 1) and the redirect assertion to the real param shape if it differs (inspect `connect/index.astro`'s `finish`). If the picker shows `#no-accounts` instead of a row, the seed format is wrong — fix per Step 1.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/ui/dapp-connect.spec.ts
git commit -m "test(e2e): dapp connect ceremony (fast, redirect path)"
```

---

## Task 3: Sign message + authEntry (`@fast`)

**Files:**
- Create: `tests/e2e/ui/dapp-sign.spec.ts`

`signMessage`/`signAuthEntry` don't simulate on chain — they hash/parse the payload and sign via the shim. Seed the credential (Task 1) so `#approve` is enabled.

- [ ] **Step 1: Write the test**

`tests/e2e/ui/dapp-sign.spec.ts`:
```ts
import { test, expect, SEED_HEX } from '../../support/fixtures';
import { seedCredential } from '../../support/auth/seed';

const PORT = Number(process.env.E2E_PORT || 4399);
const ACCOUNT = 'CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY';
const host = `${ACCOUNT.toLowerCase()}.localhost:${PORT}`;
const DAPP = `http://dapp.localhost:${PORT}`;

async function gotoSign(page: import('@playwright/test').Page, query: string) {
  // First land on the account origin to seed the credential, then load /sign/.
  await page.goto(`http://${host}/account/`, { waitUntil: 'domcontentloaded' });
  await seedCredential(page, ACCOUNT, SEED_HEX, 'default');
  const ret = `${DAPP}/cb`;
  await page.goto(
    `http://${host}/sign/?${query}&dapp=${encodeURIComponent(DAPP)}&return=${encodeURIComponent(ret)}`,
    { waitUntil: 'domcontentloaded' },
  );
}

test.describe('@fast dapp sign (message / authEntry)', () => {
  test('signs a message and returns g2c_signed', async ({ page }) => {
    await gotoSign(page, 'kind=message&message=' + encodeURIComponent('hello world'));
    await expect(page.locator('#needs-register')).toBeHidden();
    await expect(page.locator('#approve')).toBeEnabled();
    await page.locator('#approve').click();
    await page.waitForURL('**/cb?g2c_signed=**', { timeout: 15_000 });
    const u = new URL(page.url());
    expect(u.searchParams.get('kind')).toBe('message');
    expect(u.searchParams.get('g2c_signed')).toBeTruthy();
  });

  test('cancel returns g2c_sign=cancelled', async ({ page }) => {
    await gotoSign(page, 'kind=message&message=hi');
    await page.locator('#cancel').click();
    await page.waitForURL('**/cb?g2c_sign=cancelled**', { timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Run on all engines**

Run: `npx playwright test tests/e2e/ui/dapp-sign.spec.ts --grep @fast`
Expected: PASS across chromium/firefox/webkit. If `#approve` stays disabled (`#needs-register` shown), the credential seed didn't take — verify the storage keys vs `loadCredential` (Task 1) and that you seeded on the `${host}` origin. If `signMessage` requires an `authEntry`/`network` param you didn't pass, inspect `sign/index.astro` + `walletSign.ts::signMessageRaw` and adapt the query. If a `kind=authEntry` variant is straightforward, add an analogous test (build a dummy auth-entry XDR or reuse one the page accepts).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/ui/dapp-sign.spec.ts
git commit -m "test(e2e): dapp message signing ceremony (fast)"
```

---

## Task 4: Sign transaction (`@testnet`)

**Files:**
- Create: `tests/e2e/testnet/dapp-sign-tx.testnet.spec.ts`

Tx signing simulates on testnet, signs, and returns the signed XDR. Needs a deployed v0.7 account (create+deploy) + an `update_message` tx XDR for that account. We use status-message's `update_message` because the Phase-2 guard already proves it authorizes on-chain under the Default rule — so this **asserts SUCCESS** (not a pin). Run-to-validate.

- [ ] **Step 1: Write the test (mirror the lifecycle create+deploy, then drive /sign/?kind=tx)**

`tests/e2e/testnet/dapp-sign-tx.testnet.spec.ts`:
```ts
import { test, expect } from '../../support/fixtures';
import { seedBank } from '../../support/testnet';

const PORT = Number(process.env.E2E_PORT || 4399);

test.describe('@testnet dapp tx signing', () => {
  test.describe.configure({ timeout: 240_000 });

  test('signs a Soroban tx for a deployed account', async ({ page, context }) => {
    await seedBank(context);
    // 1) create + deploy a v0.7 account (mirror account-lifecycle.testnet.spec.ts
    //    steps 1-3): home #create-btn → #c-address-result → #setup-link ?key= →
    //    new-account #register-btn → #done-section. Capture cAddress + host.
    // 2) Build an UNSIGNED Soroban tx invoking the status-message contract's
    //    update_message(message, author=account) for the deployed account — the
    //    SAME op the status-message guard proved authorizes on-chain, so it
    //    reliably validates. Resolve the contract via the registry name
    //    "status-message" (fetchRegistryAddress; it has a hardcoded fallback),
    //    then build with @stellar/stellar-sdk:
    //      new Contract(statusId).call("update_message",
    //        nativeToScVal(message, { type: "string" }),
    //        Address.fromString(cAddress).toScVal())
    //    wrap in a TransactionBuilder (source = a friendbot/bank-funded G-account,
    //    networkPassphrase Networks.TESTNET), .build(), and base64-encode toXDR()
    //    into ?xdr=. No need to sign or attach auth entries — /sign/ strips and
    //    rebuilds them (see walletSign.ts).
    // 3) Navigate to http://<caddr>.localhost:PORT/sign/?kind=tx&xdr=<b64>&
    //    network=Test%20SDF%20Network%20;%20September%202015&dapp=...&return=...
    // 4) #approve → shim signs → assert redirect to return?g2c_signed=<xdr>&kind=tx.
    //    update_message is PROVEN to authorize under the Default rule (the
    //    status-message testnet guard passes), so EXPECT SUCCESS. If it
    //    unexpectedly fails, capture #error-box text and report — do NOT mask.
  });
});
```
This task is **run-to-validate**: implement the create+deploy (copy from the lifecycle spec) and the `update_message` tx construction, then run on testnet. Assert the `g2c_signed` redirect (success — `update_message` is proven to authorize). If it unexpectedly fails on-chain, capture the `#error-box` text and report rather than loosening the assertion.

- [ ] **Step 2: Run on testnet**

Run:
```bash
npx astro build --root ./packages/frontend
set -a; . tests/.env.testnet; set +a
npx playwright test --project=testnet-chromium tests/e2e/testnet/dapp-sign-tx.testnet.spec.ts
```
Expected: PASS asserting the `g2c_signed` redirect (update_message authorizes under the Default rule). Adapt timeouts/selectors to reality.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/testnet/dapp-sign-tx.testnet.spec.ts
git commit -m "test(e2e): testnet dapp tx signing (assert or pin)"
```

---

## Self-Review

**Spec coverage (Phase 3a portions):**
- Dapp connect ceremony → Task 2 (fast, redirect path). Cancel path covered.
- Dapp sign (message/authEntry) → Task 3 (fast; authEntry analogue noted). Cancel covered.
- Dapp sign (tx, SEP-7) → Task 4 (testnet, assert-or-pin).
- All driven via the shim (no real authenticator) and the redirect fallback (no popup plumbing), reusing the kit-module URL/result contract.

**Deferred (Phase 3b, separate plan):** multi-actor recovery (N+1 identities, nested auth, the recovery rule) and session-key delegation (cross-origin install + session-key signing). These need multiple shim identities + hit the contract auth-model; planned separately.

**Placeholder scan:** Tasks 1–3 have complete code. Task 4 is intentionally a run-to-validate scaffold (create+deploy is copied from the existing lifecycle spec; tx construction + assert/pin is integration work keyed to live behavior) — not a placeholder, but flagged as such. The connect-seeding (Task 2) and message-sign params (Task 3) have explicit "discover the real format/param, then adapt" steps with the exact grep — concrete, not vague.

**Type consistency:** `credentialFor(seedHex, label) → {credentialIdB64u, publicKeyHex}` and `seedCredential(page, account, seedHex, label)` (Task 1) used consistently in Task 3. `SEED_HEX` imported from the fixtures (Phase 1). `@fast` / `@testnet` tags + `E2E_PORT` consistent with Phases 1–2. Element ids (`#accounts-list`/`.account-row`/`#approve`/`#cancel`/`#needs-register`/`#dapp-origin`) match the verified pages.
