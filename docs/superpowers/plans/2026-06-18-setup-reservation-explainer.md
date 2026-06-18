# Setup Reservation Explainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reserve→subdomain "blink" with an explicit "Setting up your Nido" explainer shown on the reservation page, held long enough to read, then redirecting to the account subdomain's ready step.

**Architecture:** Account setup reserves the C-address on the apex host, then hard-navigates to the account's own subdomain. Today that snap reads as a glitch. We add a dedicated `preparing-section` to `new-account/index.astro` shown during reservation (spinning Nest + explanation), hold it for a minimum dwell via a new `withMinimumDuration` helper, then redirect. The passkey-creating click stays on the subdomain page (security invariant: `rpId = subdomain`). We also remove the earlier "continuity splash" hack, which this supersedes.

**Tech Stack:** Astro (inline `<script>` page logic), TypeScript, Vitest (frontend unit tests), `@stellar/stellar-sdk` (Soroban RPC), `@nidohq/passkey-sdk` (`accountUrl`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-18-setup-reservation-explainer-design.md`.
- Do NOT move passkey creation off the account subdomain — the passkey-creating click stays on page 2 (`rpId = window.location.hostname`); per-account isolation depends on it.
- Minimum dwell for the explainer: **2500 ms**.
- Copy verbatim:
  - Heading: `Setting up your Nido`
  - Body: `We're reserving your private address and moving you into your own secure space. This only takes a moment.`
  - Status (initial): `Reserving your address…`
  - Status (pre-redirect): `Taking you there…`
  - Status (error): `Setup paused`
  - Error banner: `Couldn't prepare your Nido: ${err.message}`
- Keep the existing `display=optional` font change (already on this branch); do not revert it.
- Frontend unit tests live in `packages/frontend/src/lib/*.test.ts` and import local modules with a `.js` extension. All commands run from `packages/frontend`.

---

### Task 1: `withMinimumDuration` helper (unit-tested)

A small, pure timing helper: run a promise and a minimum-duration timer concurrently, return the promise's value once both settle. Injectable `sleep` keeps it deterministically testable.

**Files:**
- Create: `packages/frontend/src/lib/withMinimumDuration.ts`
- Test: `packages/frontend/src/lib/withMinimumDuration.test.ts`

**Interfaces:**
- Produces: `withMinimumDuration<T>(work: Promise<T>, minMs: number, sleep?: (ms: number) => Promise<void>): Promise<T>` — resolves to `work`'s value no sooner than `minMs`; rejects if `work` rejects.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/lib/withMinimumDuration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { withMinimumDuration } from './withMinimumDuration.js';

describe('withMinimumDuration', () => {
  it('does not resolve before the minimum-duration timer settles', async () => {
    let releaseSleep!: () => void;
    const sleep = () => new Promise<void>((r) => { releaseSleep = r; });
    let resolved: string | null = null;
    const p = withMinimumDuration(Promise.resolve('addr'), 2500, sleep)
      .then((v) => { resolved = v; return v; });

    // Let work's microtask flush; the (unresolved) sleep must still hold us.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(null);

    releaseSleep();
    await p;
    expect(resolved).toBe('addr');
  });

  it('waits for work even after the timer settles', async () => {
    let settleWork!: (v: string) => void;
    const work = new Promise<string>((r) => { settleWork = r; });
    let resolved: string | null = null;
    const p = withMinimumDuration(work, 0, () => Promise.resolve())
      .then((v) => { resolved = v; return v; });

    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(null); // timer done, work not

    settleWork('late');
    await p;
    expect(resolved).toBe('late');
  });

  it('propagates rejection from work', async () => {
    await expect(
      withMinimumDuration(Promise.reject(new Error('boom')), 0, () => Promise.resolve()),
    ).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- withMinimumDuration`
Expected: FAIL — cannot resolve `./withMinimumDuration.js` (module not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `packages/frontend/src/lib/withMinimumDuration.ts`:

```ts
/**
 * Resolve `work`, but never sooner than `minMs`. Runs the promise and a
 * minimum-duration timer concurrently and returns the promise's value once
 * both have settled — used to hold a transient UI (the setup explainer) on
 * screen long enough to read even when the underlying work finishes fast.
 * If `work` rejects, the rejection propagates.
 *
 * `sleep` is injectable so callers (and tests) can substitute the timer.
 */
export function withMinimumDuration<T>(
  work: Promise<T>,
  minMs: number,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  return Promise.all([work, sleep(minMs)]).then(([result]) => result);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- withMinimumDuration`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/withMinimumDuration.ts packages/frontend/src/lib/withMinimumDuration.test.ts
git commit -m "feat(frontend): add withMinimumDuration timing helper"
```

---

### Task 2: Remove the continuity splash and `prepared=1` flag

Revert the earlier continuity-splash hack (commit `e17a41e`) — the explainer supersedes it. After this task the flow returns to its pre-splash behavior (the blink is back, temporarily) but in a clean state for Task 4.

**Files:**
- Modify: `packages/frontend/src/pages/new-account/index.astro` (remove the page-2 splash block; strip `&prepared=1` + its comment from the redirect)

- [ ] **Step 1: Remove the continuity-splash block**

Delete this entire block (currently lines ~441–470, between the `isSetupReservation` block and `function saltBytes()`):

```ts
  // Continuity splash. Reservation happens on the apex/preview host, which
  // spins the Nest while it works, then hard-navigates to the account's own
  // subdomain (a different origin — no shared state, no cross-document view
  // transition possible). Landing here cold would snap from that spinner to
  // the static step, reading as a blink. When we arrive with `prepared=1`,
  // mirror the spinning "preparing" state for a beat so the spinner looks
  // continuous across the navigation, then reveal the ready step.
  if (params.get("prepared") === "1" && contractId && !isSetupReservation) {
    const $btnSpan = $registerBtn.querySelector("span")!;
    const readyDisabled = $registerBtn.disabled;
    const readyBtnLabel = $btnSpan.textContent;
    const readyIntro = $passkeyIntro.textContent;

    $passkeySection.classList.add("setup-reserving");
    $registerBtn.disabled = true;
    $btnSpan.textContent = "Preparing your Nido...";
    $passkeyIntro.textContent =
      "Your Nido address is being prepared. Read what's protected here while setup finishes.";

    window.setTimeout(() => {
      $passkeySection.classList.remove("setup-reserving");
      $registerBtn.disabled = readyDisabled;
      $btnSpan.textContent = readyBtnLabel;
      $passkeyIntro.textContent = readyIntro;
      // One-shot: drop the flag so a refresh or back-nav doesn't replay it.
      params.delete("prepared");
      const query = params.toString();
      history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }, 650);
  }
```

Leave the blank line so `function saltBytes()` still has spacing before it.

- [ ] **Step 2: Strip the `prepared=1` flag from the redirect**

Replace the comment + redirect line in `reserveNidoAddress` (currently lines ~516–521):

```ts
      // `prepared=1` tells the destination subdomain it arrived straight from
      // this reservation, so it can keep the spinning "preparing" state for a
      // beat instead of snapping to the static step (see the continuity block
      // near the top of the script). The redirect is a cross-subdomain hard
      // navigation, so this flag is the only way to carry that intent across.
      window.location.replace(accountUrl(window.location.host, cAddress, `/new-account/?salt=${encodeURIComponent(saltHex!)}&prepared=1#salt=${encodeURIComponent(saltHex!)}`));
```

with:

```ts
      window.location.replace(accountUrl(window.location.host, cAddress, `/new-account/?salt=${encodeURIComponent(saltHex!)}#salt=${encodeURIComponent(saltHex!)}`));
```

- [ ] **Step 3: Verify the page-2 splash is gone**

Run: `grep -n "prepared" packages/frontend/src/pages/new-account/index.astro`
Expected: no matches.

- [ ] **Step 4: Type-check the page**

Run: `npm run check`
Expected: no NEW type errors introduced by this change (the project has a known small baseline — compare against `git stash`'d baseline if unsure). If `astro check` cannot run because workspace packages aren't built, build them first per the repo README, then re-run.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/pages/new-account/index.astro
git commit -m "revert(frontend): drop continuity-splash hack (superseded by explainer)"
```

---

### Task 3: Add the `preparing-section` markup and style

Add the explainer section (hidden by default) and the flex layout it needs while shown. Not wired up yet — Task 4 shows it.

**Files:**
- Modify: `packages/frontend/src/pages/new-account/index.astro` (add `<section>` after `done-section`; add one style rule)

**Interfaces:**
- Produces (DOM ids consumed by Task 4): `#preparing-section`, `#preparing-status-text`.

- [ ] **Step 1: Add the section markup**

Immediately after the closing `</section>` of `done-section` (the `<section id="done-section" class="hidden">…</section>`), add:

```astro
    <!-- ===================== RESERVING · explainer (page 1) ===================== -->
    <section id="preparing-section" class="hidden" style="min-height:440px;">
      <div style="display:grid; place-items:center; margin:32px 0 26px;">
        <Nest size={104} spin dur={1.1} />
      </div>
      <h1 class="disp" style="font-weight:800; font-size:28px; line-height:1.06; text-align:center;">
        Setting up your Nido
      </h1>
      <p class="mut" style="font-size:14.5px; line-height:1.55; margin-top:12px; text-align:center; max-width:330px; margin-inline:auto;">
        We're reserving your private address and moving you into your own secure space. This only takes a moment.
      </p>
      <div class="mut" style="display:flex; align-items:center; justify-content:center; gap:8px; font-size:13px; margin-top:26px; opacity:.85;">
        <span class="dot acc"></span><span id="preparing-status-text">Reserving your address…</span>
      </div>
    </section>
```

(`Nest` is already imported at the top of the file.)

- [ ] **Step 2: Add the flex layout rule**

In the page's `<style is:global>` block, directly below the existing `#deploy-section:not(.hidden) { display: flex; flex-direction: column; }` rule, add:

```css
  #preparing-section:not(.hidden) { display: flex; flex-direction: column; }
```

- [ ] **Step 3: Visually verify the section renders (mock-show in a browser)**

Build/preview the page, then in the browser console reveal it:

```js
document.getElementById('passkey-section').style.display = 'none';
document.getElementById('account-chip').style.display = 'none';
document.getElementById('preparing-section').classList.remove('hidden');
```

Expected: centered spinning Nest, "Setting up your Nido", the body copy, and "● Reserving your address…". The two rings spin independently (per-ring animation).

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: no new type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/pages/new-account/index.astro
git commit -m "feat(frontend): add the Setting up your Nido explainer section"
```

---

### Task 4: Wire the page-1 explainer flow (reserve + min-dwell + redirect)

Refactor `reserveNidoAddress` to *resolve a C-address* instead of redirecting itself, and drive the explainer: show the section, run the reservation under a 2.5s minimum dwell, swap the status, then redirect. On error, show the failure on the explainer.

**Files:**
- Modify: `packages/frontend/src/pages/new-account/index.astro` (imports; UI refs; the `isSetupReservation` block; `reserveNidoAddress`)

**Interfaces:**
- Consumes: `withMinimumDuration` (Task 1); `#preparing-section`, `#preparing-status-text` (Task 3).

- [ ] **Step 1: Import the helper**

In the `<script>` import group (where `shortAddr` etc. are imported), add:

```ts
  import { withMinimumDuration } from "../../lib/withMinimumDuration";
```

- [ ] **Step 2: Add UI refs**

Next to the other `const $… = document.getElementById(...)` refs (after `$passkeyIntro`), add:

```ts
  const $preparingSection = document.getElementById("preparing-section")!;
  const $preparingStatusText = document.getElementById("preparing-status-text")!;
```

- [ ] **Step 3: Replace the `isSetupReservation` block with the explainer flow**

Replace the current block (lines ~433–439):

```ts
  if (isSetupReservation && saltHex) {
    $passkeySection.classList.add("setup-reserving");
    $registerBtn.disabled = true;
    $registerBtn.querySelector("span")!.textContent = "Preparing your Nido...";
    $passkeyIntro.textContent = "Your Nido address is being prepared. Read what's protected here while setup finishes.";
    void reserveNidoAddress();
  }
```

with:

```ts
  if (isSetupReservation && saltHex) {
    // Show the dedicated explainer while we reserve the address on this host,
    // then hard-navigate to the account's own subdomain. The passkey step
    // (page 2) is where the user actually creates their passkey.
    $passkeySection.classList.add("hidden");
    $accountChip.classList.add("hidden");
    $preparingSection.classList.remove("hidden");
    void runReservationFlow();
  }

  async function runReservationFlow() {
    clearError();
    try {
      // Hold the explainer for at least 2.5s so it's readable even when the
      // reservation RPC is fast; a slow RPC simply extends the dwell.
      const cAddress = await withMinimumDuration(reserveNidoAddress(), 2500);
      $preparingStatusText.textContent = "Taking you there…";
      window.location.replace(
        accountUrl(
          window.location.host,
          cAddress,
          `/new-account/?salt=${encodeURIComponent(saltHex!)}#salt=${encodeURIComponent(saltHex!)}`,
        ),
      );
    } catch (err: any) {
      $preparingStatusText.textContent = "Setup paused";
      showError(`Couldn't prepare your Nido: ${err.message}`);
    }
  }
```

- [ ] **Step 4: Refactor `reserveNidoAddress` to return the C-address**

Replace the whole `reserveNidoAddress` function (currently `async function reserveNidoAddress() { … }`, lines ~479–528) with:

```ts
  async function reserveNidoAddress(): Promise<string> {
    if (!RELAYER_URL || !RELAYER_SIM_SOURCE) {
      throw new Error("Relayer is not configured for account setup.");
    }
    const server = new rpc.Server(RPC_URL);
    const sourceAccount = await waitForSourceAccount(server, RELAYER_SIM_SOURCE);

    const simTxn = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: await fetchRegistryAddress("factory"),
          function: "get_c_address",
          args: [xdr.ScVal.scvBytes(Buffer.from(saltBytes()))],
        }),
      )
      .setTimeout(0)
      .build();

    const sim = await server.simulateTransaction(simTxn);
    if (rpc.Api.isSimulationError(sim) || rpc.Api.isSimulationRestore(sim)) {
      throw new Error(`Simulation failed: ${"error" in sim ? sim.error : "restore needed"}`);
    }
    if (!sim.result) throw new Error("Address reservation returned no result.");

    const cAddress = Address.fromScVal(sim.result.retval).toString();
    savePendingAccount(cAddress, saltHex!);
    saveSetupSaltCookie(cAddress, saltHex!);
    await syncNidoStorageViaBridge();
    return cAddress;
  }
```

(Error UI and the redirect now live in `runReservationFlow`; `reserveNidoAddress` only reserves and returns, or throws.)

- [ ] **Step 5: Confirm the dead `setup-reserving` path is gone**

The page-1 spin previously relied on `#passkey-section.setup-reserving`. With Task 2 + this task, nothing adds `setup-reserving` anymore. Verify:

Run: `grep -n "setup-reserving" packages/frontend/src/pages/new-account/index.astro`
Expected: only the CSS rule lines (~156–165) remain — no JS `classList.add("setup-reserving")`. Leave the now-unused CSS in place (harmless) OR delete the `setup-reserving` style rules if the reviewer prefers a clean removal; either is acceptable. If deleting, remove lines `#passkey-section.setup-reserving …` through the `lock-info-cycle` keyframe.

- [ ] **Step 6: Type-check**

Run: `npm run check`
Expected: no new type errors. In particular `reserveNidoAddress` is now `Promise<string>` and its only caller (`withMinimumDuration(reserveNidoAddress(), 2500)`) consumes the string.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/pages/new-account/index.astro
git commit -m "feat(frontend): drive setup reservation through the explainer with a min-dwell"
```

---

### Task 5: End-to-end verification on the preview

No unit harness exists for the inline page flow (consistent with the rest of `new-account`), so verify the integration in a real browser against the deployed PR preview.

**Files:** none (verification only).

- [ ] **Step 1: Push and let the PR preview redeploy**

```bash
git push
```
Wait for the `114.nido.fyi` preview (or current PR number) to redeploy.

- [ ] **Step 2: Drive the happy path**

From the home page, start account creation so you land on `/new-account/?setup=1…`. Observe:
- The explainer shows: spinning Nest, "Setting up your Nido", body copy, "Reserving your address…".
- It stays on screen for at least ~2.5s even though the RPC is faster.
- The status flips to "Taking you there…", then the page navigates to the `…--<n>.nido.fyi/new-account` subdomain.
- Page 2 lands directly on the "Lock it to you" step with the "Create with a passkey" button ready (one click there).

- [ ] **Step 3: Verify the min-dwell with instrumentation (optional, precise)**

On the `?setup=1` page, before reservation resolves, time it in the console:

```js
performance.mark('explainer-start');
// when it redirects, the next page logs nothing — instead watch the status node:
new MutationObserver(() => {
  if (document.getElementById('preparing-status-text')?.textContent?.includes('Taking you'))
    console.log('held for', performance.now() - performance.getEntriesByName('explainer-start')[0].startTime, 'ms');
}).observe(document.getElementById('preparing-status-text'), { childList: true, characterData: true, subtree: true });
```

Expected: logged dwell ≥ ~2500 ms.

- [ ] **Step 4: Verify the error path**

Force a failure (e.g. with DevTools network offline, or block the Soroban RPC host) and reload the `?setup=1` page. Expected: the explainer shows, then the status changes to "Setup paused" and the error banner reads "Couldn't prepare your Nido: …"; no redirect happens.

- [ ] **Step 5: Regression check on page 2**

On a fresh account subdomain `…/new-account`, confirm: the ready step shows immediately (no leftover splash, no `prepared` in the URL), and clicking "Create with a passkey" still registers + deploys as before.

- [ ] **Step 6: Note results**

Record the observed happy-path behavior, the measured dwell, and the error-path behavior in the PR description / comment.

---

## Self-Review notes

- **Spec coverage:** preparing-section (Task 3) ✓; min-dwell 2500ms via helper (Tasks 1, 4) ✓; status swap "Reserving…"→"Taking you there…" (Tasks 3, 4) ✓; land directly on ready step (unchanged page-2; Task 2 removes splash) ✓; remove splash + `prepared=1` (Task 2) ✓; keep `display=optional` (Global Constraints — untouched) ✓; error handling (Task 4 + verified Task 5) ✓; testing (Tasks 1, 5) ✓; out-of-scope items not implemented ✓.
- **Type consistency:** `reserveNidoAddress(): Promise<string>` defined in Task 4 Step 4, consumed in Task 4 Step 3 via `withMinimumDuration(reserveNidoAddress(), 2500)`; helper signature from Task 1 matches. DOM ids `#preparing-section` / `#preparing-status-text` defined in Task 3, consumed in Task 4.
- **Placeholders:** none — all copy and code are concrete.
