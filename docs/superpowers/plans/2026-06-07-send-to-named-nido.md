# Send to a Named Nido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user type a named nido (`alice`, or the cosmetic `alice.nido`) as the Send recipient and have it resolve to the correct account contract (C-address) before sending.

**Architecture:** Frontend-only. Normalize the typed string (strip cosmetic suffix), resolve it to an address via the read-only name-registry (`resolveFriendInput`), display the resolved address (anti-spoof), and feed the **resolved address** into the existing `sendXlm` so the passkey signs over the concrete address (TOCTOU-safe). No contract change.

**Tech Stack:** TypeScript, Astro (inline client script), `@stellar/stellar-sdk`, `@g2c/passkey-sdk`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-07-send-to-named-nido-design.md`

**Branch:** `feat/send-to-named-nido` (stacked on `fix/name-claim-bug-3`, PR #63 → #61).

---

## File Structure

- **Create** `packages/frontend/src/lib/recipientInput.ts` — pure helpers: `normalizeRecipientInput` (strip cosmetic suffix) and `resolveSendRecipient` (normalize + `resolveFriendInput`). One responsibility: turn a typed recipient string into a resolved `{kind,address}`.
- **Create** `packages/frontend/src/lib/recipientInput.test.ts` — unit tests for both.
- **Modify** `packages/passkey-sdk/src/resolve.ts` — add `lookupName` (reverse: address → registered name) mirroring `resolveName`.
- **Modify** `packages/passkey-sdk/src/index.ts` — export `lookupName`.
- **Modify** `packages/frontend/src/pages/account/index.astro` — Send panel markup (placeholder + resolve-status element) and the input/submit handlers.
- **Modify** `tests/e2e/ui/account-ui.spec.ts` — @fast sanity that the resolve-status element exists.
- **Create** `tests/e2e/testnet/send-to-name.testnet.spec.ts` — real round-trip: claim a name on a recipient, send to it by name from another account, assert balance moved.

---

## Task 1: `normalizeRecipientInput` + `resolveSendRecipient` (pure core)

**Files:**
- Create: `packages/frontend/src/lib/recipientInput.ts`
- Test: `packages/frontend/src/lib/recipientInput.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/frontend/src/lib/recipientInput.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { normalizeRecipientInput, resolveSendRecipient } from './recipientInput.js';

// A valid testnet contract + ed25519 strkey for passthrough assertions.
const C = 'CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY';
const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('normalizeRecipientInput', () => {
  it('strips a trailing .nido suffix to the bare label', () => {
    expect(normalizeRecipientInput('alice.nido')).toBe('alice');
  });
  it('strips a trailing .nido.fyi suffix', () => {
    expect(normalizeRecipientInput('alice.nido.fyi')).toBe('alice');
  });
  it('strips a trailing .localhost suffix (dev)', () => {
    expect(normalizeRecipientInput('alice.localhost')).toBe('alice');
  });
  it('lowercases when stripping a suffix', () => {
    expect(normalizeRecipientInput('ALICE.NIDO')).toBe('alice');
  });
  it('passes a bare label through unchanged (trimmed)', () => {
    expect(normalizeRecipientInput('  alice  ')).toBe('alice');
  });
  it('passes a C-address through unchanged (case preserved)', () => {
    expect(normalizeRecipientInput(C)).toBe(C);
  });
  it('passes a G-address through unchanged', () => {
    expect(normalizeRecipientInput(G)).toBe(G);
  });
  it('leaves an unknown dotted string alone', () => {
    expect(normalizeRecipientInput('alice.example')).toBe('alice.example');
  });
});

describe('resolveSendRecipient', () => {
  it("resolves a name (after suffix strip) via resolveName", async () => {
    const resolveName = vi.fn().mockResolvedValue(C);
    const res = await resolveSendRecipient('alice.nido', { resolveName });
    expect(resolveName).toHaveBeenCalledWith('alice');
    expect(res).toEqual({ kind: 'name', address: C, input: 'alice' });
  });
  it('returns null for an unregistered name', async () => {
    const resolveName = vi.fn().mockResolvedValue(null);
    expect(await resolveSendRecipient('ghost', { resolveName })).toBeNull();
  });
  it('returns a contract without calling resolveName', async () => {
    const resolveName = vi.fn();
    const res = await resolveSendRecipient(C, { resolveName });
    expect(resolveName).not.toHaveBeenCalled();
    expect(res).toEqual({ kind: 'contract', address: C, input: C });
  });
  it('returns null for garbage input', async () => {
    const resolveName = vi.fn();
    expect(await resolveSendRecipient('!!!', { resolveName })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w packages/frontend`
Expected: FAIL — `Cannot find module './recipientInput.js'` (file not created yet).

- [ ] **Step 3: Write the implementation**

Create `packages/frontend/src/lib/recipientInput.ts`:

```ts
import {
  resolveFriendInput,
  type ResolvedFriend,
  type ResolveFriendOptions,
} from '@g2c/passkey-sdk';

// Cosmetic suffixes a user might append to a nido name. Longest first so
// `alice.nido.fyi` strips the whole suffix, not just `.fyi`. These are pure
// UI convenience — the on-chain registry stores bare labels only.
const KNOWN_SUFFIXES = ['.nido.fyi', '.nido', '.localhost'];

/**
 * Normalize a typed recipient string for resolution. Strips a known cosmetic
 * nido suffix (lowercasing the remaining label), otherwise returns the trimmed
 * input untouched so a raw C…/G… address passes through with its case intact.
 */
export function normalizeRecipientInput(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  for (const suffix of KNOWN_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return lower.slice(0, -suffix.length);
    }
  }
  return trimmed;
}

/**
 * Resolve a typed Send recipient (nido name, `alice.nido`, C…, or G…) to a
 * concrete address. Thin wrapper: normalize then delegate to the SDK's
 * `resolveFriendInput`. Returns null when a name is unregistered or the input
 * is neither a valid name nor address.
 */
export function resolveSendRecipient(
  input: string,
  opts: ResolveFriendOptions,
): Promise<ResolvedFriend | null> {
  return resolveFriendInput(normalizeRecipientInput(input), opts);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w packages/frontend`
Expected: PASS — all `recipientInput` tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/recipientInput.ts packages/frontend/src/lib/recipientInput.test.ts
git commit -m "feat(send): recipientInput normalize + resolve helpers"
```

---

## Task 2: `lookupName` SDK helper (reverse name for display)

**Files:**
- Modify: `packages/passkey-sdk/src/resolve.ts` (append after `resolveNameCached`)
- Modify: `packages/passkey-sdk/src/index.ts:52`

This helper has no unit test (it is a thin RPC simulation, like the existing `resolveName`); it is exercised by the testnet e2e in Task 5.

- [ ] **Step 1: Add `lookupName` to `resolve.ts`**

Append to `packages/frontend/../passkey-sdk/src/resolve.ts` (i.e. `packages/passkey-sdk/src/resolve.ts`), after `resolveNameCached` (after line 103):

```ts
/**
 * Reverse lookup: the registered name for an address, or null. Read-only RPC
 * simulation of the registry's `lookup(owner) -> Option<String>`. Best-effort —
 * used only to display a canonical name next to a resolved address.
 */
export async function lookupName(
  rpcUrl: string,
  registryContractId: string,
  address: string,
  networkPassphrase: string
): Promise<string | null> {
  const server = new rpc.Server(rpcUrl);
  const registry = new Contract(registryContractId);
  const dummySource = new Account(DUMMY_SOURCE, "0");

  const tx = new TransactionBuilder(dummySource, {
    fee: "100",
    networkPassphrase,
  })
    .addOperation(
      registry.call("lookup", nativeToScVal(address, { type: "address" }))
    )
    .setTimeout(0)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return null;

  const successSim = sim as rpc.Api.SimulateTransactionSuccessResponse;
  if (!successSim.result) return null;

  try {
    const result = scValToNative(successSim.result.retval);
    return result || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Export it from `index.ts`**

In `packages/passkey-sdk/src/index.ts`, change line 52:

```ts
export { resolveName, resolveNameCached, lookupName } from "./resolve.js";
```

- [ ] **Step 3: Build the SDK so the frontend can import it**

Run: `npm run build -w @g2c/passkey-sdk`
Expected: `tsc` completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/passkey-sdk/src/resolve.ts packages/passkey-sdk/src/index.ts
git commit -m "feat(sdk): lookupName reverse name resolution"
```

---

## Task 3: Wire resolution into the Send panel

**Files:**
- Modify: `packages/frontend/src/pages/account/index.astro` (markup ~138-139, imports ~275-284, handler ~635-712)

- [ ] **Step 1: Update the Send "To" markup**

Replace lines 137-140 (the To field) with a friendlier placeholder and a resolve-status line:

```html
        <div class="field">
          <label for="send-to">To</label>
          <input id="send-to" class="input" placeholder="name, C…, or G…" autocomplete="off" spellcheck="false" />
          <div id="send-resolve" class="mut mono" style="font-size:12px; margin-top:6px; min-height:16px;"></div>
        </div>
```

- [ ] **Step 2: Update imports**

In the client `<script>` import block:

- Change the sendXlm import (line 284) from:

```ts
  import { sendXlm, validateRecipient } from "../../lib/sendXlm";
```

to:

```ts
  import { sendXlm } from "../../lib/sendXlm";
  import { resolveSendRecipient } from "../../lib/recipientInput";
```

- Add `resolveName` and `lookupName` to the existing `@g2c/passkey-sdk` import (the block around line 255-277 that already imports `fetchRegistryAddress`). Add these two named imports to that block:

```ts
    resolveName,
    lookupName,
```

- [ ] **Step 3: Add the resolver plumbing + as-you-type handler**

Immediately after the `$sendSubmit` element lookup (after line 638, before the `send-max` listener at line 640), insert:

```ts
    const NAME_NETWORK = "Test SDF Network ; September 2015";
    let _nameRegistryId: string | null = null;
    async function nameRegistryId(): Promise<string> {
      if (!_nameRegistryId) _nameRegistryId = await fetchRegistryAddress("name-registry");
      return _nameRegistryId;
    }
    // Always resolve FRESH (no cache) so a just-transferred name can't bind stale.
    const resolveNameFresh = async (name: string): Promise<string | null> =>
      resolveName(RPC_URL, await nameRegistryId(), name, NAME_NETWORK);

    const $sendResolve = document.getElementById("send-resolve")!;
    let resolveSeq = 0;
    let resolveTimer: ReturnType<typeof setTimeout> | undefined;

    $sendTo.addEventListener("input", () => {
      clearTimeout(resolveTimer);
      const raw = $sendTo.value;
      if (!raw.trim()) {
        $sendResolve.textContent = "";
        return;
      }
      $sendResolve.textContent = "Resolving…";
      resolveTimer = setTimeout(async () => {
        const myId = ++resolveSeq;
        try {
          const res = await resolveSendRecipient(raw, { resolveName: resolveNameFresh });
          if (myId !== resolveSeq) return; // a newer keystroke superseded us
          if (!res) {
            $sendResolve.textContent = "✗ No nido by that name (or invalid address)";
            return;
          }
          if (res.kind === "name") {
            $sendResolve.textContent = `✓ ${res.input} → ${shortAddr(res.address)}`;
          } else {
            let name: string | null = null;
            try {
              name = await lookupName(RPC_URL, await nameRegistryId(), res.address, NAME_NETWORK);
            } catch { /* reverse name is best-effort */ }
            if (myId !== resolveSeq) return;
            $sendResolve.textContent = name
              ? `✓ ${shortAddr(res.address)} (${name})`
              : `✓ ${shortAddr(res.address)}`;
          }
        } catch {
          if (myId === resolveSeq) $sendResolve.textContent = "✗ Couldn't resolve — try again";
        }
      }, 350);
    });
```

- [ ] **Step 4: Resolve at submit time and send to the resolved address**

In the `$sendSubmit` click handler, replace the recipient-validation block (lines 648-654):

```ts
      const to = $sendTo.value.trim();
      const amount = $sendAmount.value.trim();

      if (!validateRecipient(to)) {
        showError("Enter a valid address (starts with C… or G…).");
        return;
      }
```

with (note: resolution moved AFTER the amount/balance/passkey checks so we don't hit RPC on an obviously-bad amount — see next edit):

```ts
      const to = $sendTo.value.trim();
      const amount = $sendAmount.value.trim();
```

Then replace the start of the `try` block (lines 683-688) — from `$sendSubmit.disabled = true;` through the `sendXlm(...)` call — with a fresh resolve before sending:

```ts
      try {
        $sendSubmit.disabled = true;
        $sendResult.style.display = "block";
        $sendResult.textContent = "Resolving recipient…";

        // Resolve FRESH at submit; sign over the concrete address (TOCTOU-safe).
        const resolved = await resolveSendRecipient(to, { resolveName: resolveNameFresh });
        if (!resolved) {
          showError("Enter a valid nido name, C… or G… address.");
          $sendResult.style.display = "none";
          return;
        }
        const destination = resolved.address;
        const toLabel = resolved.kind === "name" ? `${resolved.input} (${shortAddr(destination)})` : shortAddr(destination);

        $sendResult.textContent = `Confirm with ${passkey.label} to send ${amount} XLM to ${toLabel}…`;

        await sendXlm({ smartAccount: contractId, destination, stroops });
```

- [ ] **Step 5: Clear the resolve status on success**

In the success branch, after `$sendTo.value = "";` (line 692), add:

```ts
        $sendResolve.textContent = "";
```

- [ ] **Step 6: Typecheck + build the frontend**

Run: `npm run check -w packages/frontend`
Expected: the existing 2-error baseline (`recoveryActions.ts:213`, `account/index.astro` WebAuthn `navigator.credentials` overload) and **no new errors**. In particular, no "validateRecipient declared but never read" and no unresolved `resolveSendRecipient`/`resolveName`/`lookupName`.

Run: `npm run build -w packages/frontend`
Expected: `[build] Complete!`

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/pages/account/index.astro
git commit -m "feat(account): resolve named nido recipients in the Send panel"
```

---

## Task 4: @fast e2e sanity for the resolve-status element

**Files:**
- Modify: `tests/e2e/ui/account-ui.spec.ts`

The @fast tier has no chain, so it can only assert the UI scaffolding is present (resolution itself needs RPC and is covered in Task 5).

- [ ] **Step 1: Add the assertion**

The Send panel is revealed on the contract subdomain. Add this test inside the `describe('account page — UI only (no chain) @fast', ...)` block (after the existing name-claim test):

```ts
  test('send panel exposes a recipient resolve-status element @fast', () => {
    const html = readFileSync(join(DIST_DIR, 'account/index.html'), 'utf-8');
    expect(html).toContain('id="send-to"');
    expect(html).toContain('id="send-resolve"');
    expect(html).toContain('placeholder="name, C…, or G…"');
  });
```

- [ ] **Step 2: Rebuild the frontend dist the static server serves**

Run: `npm run build -w packages/frontend`
Expected: `[build] Complete!`

- [ ] **Step 3: Run the @fast tier**

Run: `npm run test:e2e`
Expected: all `@fast` tests PASS, including the new send-panel assertion.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/ui/account-ui.spec.ts
git commit -m "test(e2e): @fast assertion for send resolve-status element"
```

---

## Task 5: Testnet e2e — send to a name end-to-end

**Files:**
- Create: `tests/e2e/testnet/send-to-name.testnet.spec.ts`

This is the real proof: claim a name on a recipient account, then from a second account send XLM **by name** and assert the recipient's on-chain balance increased. It reuses the testnet harness (`seedBank`, `uniqueName`) and the shim passkey, exactly like `account-lifecycle.testnet.spec.ts`.

- [ ] **Step 1: Write the test**

Create `tests/e2e/testnet/send-to-name.testnet.spec.ts`:

```ts
import { test, expect } from '../../support/fixtures';
import { seedBank, uniqueName } from '../../support/testnet';

const PORT = Number(process.env.E2E_PORT || 4399);

// Real-chain: slow + retried. Quarantined via the testnet-* projects.
test.describe('@testnet send to a named nido', () => {
  test.describe.configure({ timeout: 240_000 });

  // Helper: create an account via the home page, register its passkey (shim),
  // and return its C-address. The page host must be the C-address subdomain so
  // WebAuthn rpId matches the shim credential.
  async function createAccount(page: import('@playwright/test').Page) {
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
    return { cAddress, host };
  }

  test('claim a name on the recipient, then send to it by name', async ({ page, context }) => {
    await seedBank(context);

    // 1) Recipient account + claim a unique name.
    const recipient = await createAccount(page);
    const name = uniqueName('t', Date.now());
    await page.goto(`http://${recipient.host}/account/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#name-claim')).toBeVisible({ timeout: 30_000 });
    await page.locator('#name-input').fill(name);
    await page.locator('#claim-name-btn').click();
    await page.waitForURL('**/account/?sign=**', { timeout: 90_000 });
    await page.locator('#approve-btn').click();
    // Claim lands → page redirects to the name subdomain.
    await page.waitForURL((u) => u.hostname.startsWith(`${name}.`), { timeout: 120_000 });

    // 2) Sender account (fresh context state via a second account on the same page).
    const sender = await createAccount(page);
    await page.goto(`http://${sender.host}/account/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-mode')).toBeVisible({ timeout: 30_000 });

    // 3) Open Send, type the recipient's NAME, confirm it resolves.
    await page.locator('#send-section').waitFor({ state: 'attached' });
    await page.locator('#send-to').fill(name);
    await expect(page.locator('#send-resolve')).toContainText(`${name} →`, { timeout: 30_000 });

    // 4) Send a small amount and approve with the passkey.
    await page.locator('#send-amount').fill('1');
    await page.locator('#send-submit').click();
    // The send flow signs in-page (primaryPasskeySigner) — shim get() auto-approves.
    await expect(page.getByText(/Sent/i)).toBeVisible({ timeout: 120_000 });

    // 5) Assert the recipient received it: balance on its name subdomain is > 0.
    await page.goto(`http://${name}.localhost:${PORT}/account/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#balance')).toContainText(/\d/, { timeout: 60_000 });
  });
});
```

- [ ] **Step 2: Build the frontend (the testnet server serves dist)**

Run: `npm run build -w packages/frontend`
Expected: `[build] Complete!`

- [ ] **Step 3: Run the testnet test (manual; needs funding)**

Run: `G2C_TEST_BANK_SECRET=<funded-secret> npx playwright test tests/e2e/testnet/send-to-name.testnet.spec.ts --project=testnet-chromium`
Expected: PASS — the recipient's name resolves, the send confirms, and the recipient balance shows a non-zero value.

> If a selector (`#balance`, `#send-section`, `#create-btn`, `#setup-link`) differs at run time, fix the selector to match the live markup and re-run; do not weaken the balance assertion.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/testnet/send-to-name.testnet.spec.ts
git commit -m "test(e2e): testnet send-to-named-nido round-trip"
```

---

## Final: push & PR

- [ ] Push the branch: `git push origin feat/send-to-named-nido`
- [ ] Mark PR #63 ready for review (`gh pr ready 63`) once Tasks 1-4 are green locally.
- [ ] After #61 merges, retarget PR #63 to `main`: `gh pr edit 63 --base main`.

---

## Self-Review notes

- **Spec coverage:** name format accept-both (Task 1 normalize), frontend resolution (Tasks 1-3), confirmation/anti-spoof display incl. reverse name (Tasks 2-3), cache bypass for send (`resolveNameFresh`, Task 3), error handling for unresolvable/RPC failure (Task 3 steps 3-4), unit tests (Task 1), testnet e2e (Task 5). No contract change (none planned). ✓
- **Type consistency:** `resolveSendRecipient(input, {resolveName})` returns `ResolvedFriend | null`; `ResolvedFriend.kind` ∈ {name,contract,account}; `.address`/`.input` used consistently in Task 3. `lookupName(rpcUrl, registryId, address, passphrase)` signature matches its call sites. ✓
- **No placeholders:** every code step is complete. The only run-time `<…>` is the operator-supplied `G2C_TEST_BANK_SECRET`. ✓
