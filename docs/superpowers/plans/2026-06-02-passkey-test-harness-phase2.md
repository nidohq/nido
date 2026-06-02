# Passkey Test Harness — Phase 2 (Testnet Tier) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a quarantined, real-testnet e2e tier that drives the full on-chain lifecycle — create + deploy a smart account and claim a name — using the Phase 1 shim for passkey auth, with a funded-bank submitter, bounded retries, and unique-per-run names.

**Architecture:** A new `@testnet` tier (`tests/e2e/testnet/`) runs under dedicated Playwright projects (`testnet-chromium`, `testnet-webkit`) with per-project retries, kept separate from the `@fast` tier so chain flakiness never blocks routine runs (quarantine). Tests reuse the Phase 1 `TestAuthenticator` fixture — the synthetic P-256 passkey produces signatures testnet's on-chain verifier accepts. A `tests/support/testnet.ts` helper seeds a pre-funded "bank" submitter into `localStorage` (env-gated, friendbot fallback), generates unique names, and provides retry/backoff.

**Tech Stack:** Playwright 1.58.2, the Phase 1 shim/fixtures, `@stellar/stellar-sdk` (already a frontend dep), real Stellar testnet (`soroban-testnet.stellar.org` + friendbot). No new runtime deps.

**Scope:** Phase 2 only. Phase 0 (BrowserStack-iOS spike), Phase 3 (dapp/SEP-7 + multi-actor recovery/session-key), and Phase 4 (real-device matrix) remain separate plans. **Release-name cleanup is out of scope** — the account page has no release UI and on-chain release itself needs a passkey-signed call; idempotency is achieved via unique-per-run names instead (documented in Task 5).

---

## Context the implementer needs (verified against the reskinned `feat/nido-rebrand` UI)

**Create + deploy** (`packages/frontend/src/pages/index.astro` + `new-account/index.astro`):
- Home page has `#create-btn` (hero) and `#create-btn-band` (footer) — target `#create-btn`.
- Click → `#progress-info` spinner → friendbot funds a random keypair → `factory.get_c_address` (RPC) → `#c-address-result` is populated (the C-address) and `#passkey-section` unhides with `#setup-link` whose `href` is `…/new-account/?key=<secret>` on the C-address subdomain.
- Navigate to that href → new-account page → `#register-btn` → passkey `create()` (the shim handles it) → credential saved to `localStorage` → **auto-deploys** (no `#deploy-btn`): animates `#check-0/1/2`, then reveals **`#done-section`** with `#account-link` (→ `/account/`). `#done-section` visible = deployed on testnet.

**Claim name** (`account/index.astro`):
- On `<caddr>.localhost/account/`: `#home-mode` visible, `#name-section` → `#name-claim` with `#name-input` (pattern `[a-z][a-z0-9]*`, maxlen 15) + `#claim-name-btn`.
- Click → builds + simulates `registry.register` (RPC) using the submitter keypair `localStorage['g2c:name-keypair']` (friendbot-funded if absent) → redirects to `…/account/?sign=<HEX_HASH>&callback=<urlenc(/account/?nameresult=1)>`.
- Signing mode: `#signing-mode` shown, `#approve-btn` → `navigator.credentials.get()` (shim) → redirect back to `…?nameresult=1&authenticatorData=…&clientDataJSON=…&signature=…&publicKey=…`.
- Return flow: injects signature, re-simulates (enforce), submits, polls `getTransaction`, `saveAccountName`, then redirects to the **name subdomain** `…//<name>.localhost/account/`. Success signal: URL becomes the name subdomain (or `#name-result` contains "registered" before redirect).

**Reliability seams:**
- Submitter/fee-payer: `localStorage['g2c:name-keypair']` = a Stellar secret string (`S…`). Pre-seed it (the bank) to skip friendbot for the name tx. Account-creation funding (home) is separate and always uses friendbot.
- The shim's account address is NOT deterministic here — the home flow derives the C-address from the random funder keypair via `factory.get_c_address`, so every run deploys a fresh account. Don't assume a fixed address; capture it from `#c-address-result`.

---

## File Structure

**New files:**
- `tests/support/testnet.ts` — testnet constants (RPC/friendbot URLs), `uniqueName()`, `seedBank(context)`, `withRetry()`.
- `tests/support/testnet.test.ts` — Vitest unit tests for `uniqueName`/`withRetry` (pure logic).
- `tests/e2e/testnet/account-lifecycle.testnet.spec.ts` — the create→deploy→claim-name lifecycle test (`@testnet`).

**Modified files:**
- `playwright.config.ts` — scope `@fast`/CDP projects to `tests/e2e/ui/`; add `testnet-chromium` + `testnet-webkit` projects (`testMatch` `testnet/`, `retries: 2`).
- `justfile` — add `test-e2e-testnet` (depends on `build-astro`).
- `tests/README.md` — document the testnet tier, the `G2C_TEST_BANK_SECRET` env, and quarantine.

---

## Task 1: testnet support helpers

**Files:**
- Create: `tests/support/testnet.ts`
- Test: `tests/support/testnet.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/support/testnet.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { uniqueName, withRetry } from './testnet';

describe('uniqueName', () => {
  it('matches the registry name rule [a-z][a-z0-9]* and is <=15 chars', () => {
    const n = uniqueName('t', 1717200000000);
    expect(n).toMatch(/^[a-z][a-z0-9]*$/);
    expect(n.length).toBeLessThanOrEqual(15);
  });
  it('is distinct for distinct timestamps', () => {
    expect(uniqueName('t', 1)).not.toBe(uniqueName('t', 2));
  });
});

describe('withRetry', () => {
  it('retries until success and returns the value', async () => {
    let n = 0;
    const v = await withRetry(async () => { if (++n < 3) throw new Error('x'); return 'ok'; }, { tries: 5, baseMs: 1 });
    expect(v).toBe('ok');
    expect(n).toBe(3);
  });
  it('throws the last error after exhausting tries', async () => {
    await expect(withRetry(async () => { throw new Error('boom'); }, { tries: 2, baseMs: 1 }))
      .rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `npx vitest run --config vitest.support.config.ts tests/support/testnet.test.ts`
Expected: FAIL "Cannot find module './testnet'".

- [ ] **Step 3: Implement `tests/support/testnet.ts`**

```ts
import type { BrowserContext } from '@playwright/test';

export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const FRIENDBOT_URL = 'https://friendbot.stellar.org';

/** localStorage key the app uses for the name-tx submitter/fee-payer. */
export const SUBMITTER_KEY = 'g2c:name-keypair';

/**
 * Registry-safe unique name: `<prefix>` + base36 of the timestamp, lowercased,
 * clamped to 15 chars, guaranteed to start with a letter.
 */
export function uniqueName(prefix: string, nowMs: number): string {
  const suffix = nowMs.toString(36).replace(/[^a-z0-9]/g, '');
  const base = (prefix.replace(/[^a-z]/g, '') || 't') + suffix;
  return base.slice(0, 15);
}

/**
 * Pre-seed a funded "bank" submitter so name txs skip friendbot. If
 * G2C_TEST_BANK_SECRET is unset, the app falls back to its own friendbot
 * funding (slower, flakier). Sets the key on every origin in the context.
 */
export async function seedBank(context: BrowserContext): Promise<void> {
  const secret = process.env.G2C_TEST_BANK_SECRET;
  if (!secret) return; // no bank → app friendbots its own submitter
  await context.addInitScript(
    ([k, v]) => {
      try { localStorage.setItem(k, v); } catch { /* pre-DOM on some engines */ }
    },
    [SUBMITTER_KEY, secret] as const,
  );
}

/** Bounded retry with exponential backoff for transient testnet/RPC errors. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { tries?: number; baseMs?: number } = {},
): Promise<T> {
  const tries = opts.tries ?? 3;
  const baseMs = opts.baseMs ?? 500;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `npx vitest run --config vitest.support.config.ts tests/support/testnet.test.ts`
Expected: PASS (4 tests). Then run the whole support suite to confirm no regression: `npx vitest run --config vitest.support.config.ts` (expect all green).

- [ ] **Step 5: Commit**

```bash
git add tests/support/testnet.ts tests/support/testnet.test.ts
git commit -m "feat(test): testnet helpers (bank seed, unique name, retry)"
```

---

## Task 2: Playwright config — testnet projects + tier scoping

**Files:**
- Modify: `playwright.config.ts`

Goal: keep `@fast`/CDP projects matching only `tests/e2e/ui/`, and add two testnet projects that match only `tests/e2e/testnet/` with retries. This makes the testnet tier its own opt-in lane (quarantine).

- [ ] **Step 1: Replace the `projects` array and tighten matches**

Edit `playwright.config.ts` so the `projects` array is exactly:
```ts
  projects: [
    // Fast shim lane (@fast) — only tests/e2e/ui, excluding CDP specs.
    {
      name: 'chromium',
      testDir: 'tests/e2e/ui',
      testIgnore: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testDir: 'tests/e2e/ui',
      testIgnore: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testDir: 'tests/e2e/ui',
      testIgnore: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Safari'] },
    },
    // Chromium-only fidelity lane: real virtual authenticator.
    {
      name: 'chromium-cdp',
      testDir: 'tests/e2e/ui',
      testMatch: /\.cdp\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Quarantined real-testnet tier — separate dir, extra retries.
    {
      name: 'testnet-chromium',
      testDir: 'tests/e2e/testnet',
      retries: 2,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'testnet-webkit',
      testDir: 'tests/e2e/testnet',
      retries: 2,
      use: { ...devices['Desktop Safari'] },
    },
  ],
```
(Keep the rest of the config — `testDir: 'tests/e2e'` top-level, `webServer`, `use.baseURL`, reporters — unchanged. Per-project `testDir` narrows each project.)

- [ ] **Step 2: Verify project list**

Run: `npx playwright test --list 2>&1 | tail -20`
Expected: lists `chromium`/`firefox`/`webkit`/`chromium-cdp` (with the existing ui specs) and `testnet-chromium`/`testnet-webkit` (no tests yet — added next task), with NO config error. Confirm the fast projects no longer match anything outside `tests/e2e/ui`.

- [ ] **Step 3: Confirm the fast tier is unchanged**

Run: `npx playwright test --grep @fast`
Expected: 15 passed (unchanged from Phase 1 — the scoping didn't drop any ui specs).

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts
git commit -m "feat(test): scope fast/cdp projects to ui/, add quarantined testnet projects"
```

---

## Task 3: Create + deploy lifecycle test (testnet)

**Files:**
- Create: `tests/e2e/testnet/account-lifecycle.testnet.spec.ts`

This is **run-to-validate** against live testnet (no red-green unit cycle). Build it incrementally: first prove create + deploy reaches `#done-section`, then Task 4 extends the same test through name claim.

- [ ] **Step 1: Write the create+deploy test**

`tests/e2e/testnet/account-lifecycle.testnet.spec.ts`:
```ts
import { test, expect } from '../../support/fixtures';
import { seedBank } from '../../support/testnet';

const PORT = Number(process.env.E2E_PORT || 4399);

// Real-chain: slow + retried. Quarantined via the testnet-* projects.
test.describe('@testnet account lifecycle', () => {
  test.describe.configure({ timeout: 180_000 });

  test('create + deploy a smart account on testnet', async ({ page, context }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

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
    // Rewrite host→localhost:PORT subdomain form the static server serves.
    const key = new URL(setupHref!, 'http://x').searchParams.get('key')!;
    const host = `${cAddress.toLowerCase()}.localhost:${PORT}`;
    await page.goto(`http://${host}/new-account/?key=${encodeURIComponent(key)}`, {
      waitUntil: 'domcontentloaded',
    });

    // 3) Register passkey (shim) → auto-deploy → #done-section.
    await page.locator('#register-btn').click();
    await expect(page.locator('#done-section')).toBeVisible({ timeout: 120_000 });

    // Credential persisted; no fatal JS errors.
    const cred = await page.evaluate(
      (cid) => localStorage.getItem(`passkey:${cid}:credentialId`),
      cAddress,
    );
    expect(cred).toBeTruthy();
    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);

    // Stash for Task 4 (same file): the deployed account + setup key.
    test.info().annotations.push({ type: 'cAddress', description: cAddress });
  });
});
```

- [ ] **Step 2: Run against testnet on Chromium**

Run: `just build-astro && npx playwright test --project=testnet-chromium`
Expected: PASS (1 test) within ~1–2 min. If friendbot or RPC is rate-limited it auto-retries (retries: 2). If the success indicator differs from `#done-section` on the live build, inspect the new-account page (`packages/frontend/dist/new-account/index.html`) and adapt the wait to the real terminal state (e.g. `#account-link` visible), recording the change. If deploy legitimately fails on testnet (factory issue), capture `#error-box` text and report BLOCKED with the on-chain error — do not loosen the assertion to hide a real failure.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/testnet/account-lifecycle.testnet.spec.ts
git commit -m "test(e2e): testnet create + deploy lifecycle"
```

---

## Task 4: Extend to the full name-claim round-trip

**Files:**
- Modify: `tests/e2e/testnet/account-lifecycle.testnet.spec.ts`

Extend the same test (the deployed account + passkey already exist in this context's localStorage) through the claim → sign → submit round-trip. Keep it in ONE test so it builds on the just-deployed account.

- [ ] **Step 1: Append the claim flow to the test body** (after the `#done-section` assertion, before the `annotations.push`)

```ts
    // 4) Go to the account page on the C-address subdomain.
    await page.goto(`http://${host}/account/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-mode')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#name-claim')).toBeVisible({ timeout: 30_000 });

    // 5) Claim a unique name. Date.now() is unavailable in workflow scripts but
    //    fine in a Playwright test runtime.
    const { uniqueName } = await import('../../support/testnet');
    const name = uniqueName('t', Date.now());
    await page.locator('#name-input').fill(name);
    await page.locator('#claim-name-btn').click();

    // 6) Claim builds+simulates, then redirects into signing mode (?sign=...).
    await page.waitForURL('**/account/?sign=**', { timeout: 90_000 });
    await expect(page.locator('#signing-mode')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#approve-btn')).toBeVisible({ timeout: 10_000 });

    // 7) Approve → shim get() signs → redirect back to ?nameresult=1, then the
    //    return flow injects+submits+polls and finally redirects to the NAME
    //    subdomain on success.
    await page.locator('#approve-btn').click();
    await page.waitForURL(
      (u) => u.hostname.startsWith(`${name}.`) || /nameresult=1/.test(u.search),
      { timeout: 120_000 },
    );

    // 8) Confirm the name landed: either we're on the name subdomain, or the
    //    nameresult handler reported success.
    const onNameSubdomain = new URL(page.url()).hostname.startsWith(`${name}.`);
    if (!onNameSubdomain) {
      await expect(page.locator('#name-result')).toContainText(/registered|success/i, {
        timeout: 120_000,
      });
    }
    expect(errors.filter((e) => /No address credentials|Buffer|is not defined/.test(e))).toEqual([]);
```

(Update the test title to `'create + deploy, then claim a name on testnet'`.)

- [ ] **Step 2: Run the full lifecycle on Chromium**

Run: `just build-astro && npx playwright test --project=testnet-chromium`
Expected: PASS within ~2–3 min. Adapt the success wait (`waitForURL` predicate / `#name-result` text) to the real terminal state if it differs on the live build — inspect `account/index.astro`'s return flow and record any change. Retries:2 absorbs transient RPC/ledger timing. If the claim consistently fails on a real on-chain error, capture `#error-box`/`#name-result` text and report rather than masking.

- [ ] **Step 3: Run on WebKit too (cross-engine on testnet)**

Run: `npx playwright test --project=testnet-webkit`
Expected: PASS (the shim works on WebKit per Phase 1). If WebKit is materially flakier on the long chain waits, note it; the tier is quarantined so it won't block.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/testnet/account-lifecycle.testnet.spec.ts
git commit -m "test(e2e): testnet full name-claim passkey round-trip"
```

---

## Task 5: Recipe, docs, final verification

**Files:**
- Modify: `justfile`, `tests/README.md`

- [ ] **Step 1: Add the `just` recipe**

Append to `justfile` (builds first; runs only the testnet projects):
```make
# Quarantined real-testnet e2e tier (create+deploy, name claim); builds first.
# Optional: set G2C_TEST_BANK_SECRET to a funded testnet G-account secret to
# skip friendbot for the name submitter.
test-e2e-testnet: build-astro
    npx playwright test --project=testnet-chromium --project=testnet-webkit
```

- [ ] **Step 2: Document the tier in `tests/README.md`**

Append:
```markdown
## Testnet tier (`@testnet`, quarantined)

`just test-e2e-testnet` — real Stellar testnet: creates + deploys a smart
account and claims a name, using the shim for passkey auth (the synthetic
P-256 signature is accepted on-chain). Runs under the `testnet-chromium` /
`testnet-webkit` projects (retries: 2), kept out of `@fast` so chain flakiness
never blocks routine runs.

- Slow (~2–3 min/test) and dependent on testnet + friendbot availability.
- Optional `G2C_TEST_BANK_SECRET=<funded testnet G-account secret>` pre-seeds
  the name-tx fee-payer (`localStorage['g2c:name-keypair']`) to skip friendbot.
  Without it, the app funds its own submitter via friendbot (slower/flakier).
- Names are unique per run (timestamped). On-chain **release** is not exposed
  in the UI and is deferred — names are not cleaned up.
```

- [ ] **Step 3: Final verification — fast tier still green, testnet recipe runs**

Run:
```bash
just test-e2e            # 15/15 unchanged
just test-e2e-testnet    # testnet-chromium + testnet-webkit lifecycle (quarantined)
```
Expected: fast tier 15/15; testnet tier passes (or, if testnet/friendbot is down, reports the chain error — that's acceptable for a quarantined tier, but confirm the failure is environmental, not a harness bug, before committing).

- [ ] **Step 4: Commit**

```bash
git add justfile tests/README.md
git commit -m "chore(test): test-e2e-testnet recipe + testnet tier docs"
```

---

## Self-Review

**Spec coverage (Phase 2 portions of the design):**
- Tiered testnet e2e, quarantined (non-blocking), fewer browsers → Task 2 (separate `testnet-*` projects, retries; not in `@fast`), Task 5 (separate recipe).
- Flows: create+deploy → Task 3; claim name (full passkey round-trip) → Task 4. Both via the shim fixture (synthetic passkey accepted on-chain).
- Funded bank + retries → Task 1 (`seedBank`, `withRetry`) + Task 2 (project `retries: 2`). Bank is env-gated with friendbot fallback so the tier runs without provisioning.
- Idempotency → Task 1 `uniqueName` (release deferred; account address is funder-derived/non-deterministic, captured at runtime).

**Deviation from spec (recorded):** the spec listed "release name as cleanup," but the reskinned account page exposes no release UI and on-chain release needs its own passkey-signed call — so Phase 2 uses unique-per-run names instead and defers release. Surfaced in Task 5 docs.

**Placeholder scan:** No TBD/TODO. Testnet specs are explicitly "run-to-validate" (live chain) with concrete starting code + adaptation guidance keyed to exact element ids from the flow map — not placeholders.

**Type consistency:** `uniqueName(prefix, nowMs)`, `seedBank(context)`, `withRetry(fn, {tries, baseMs})`, `SUBMITTER_KEY` used consistently across Tasks 1/3/4. Project names `testnet-chromium`/`testnet-webkit` consistent across Tasks 2/5. `E2E_PORT` consistent with Phase 1.
