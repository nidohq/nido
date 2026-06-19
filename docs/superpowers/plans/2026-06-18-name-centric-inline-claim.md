# Name-Centric Inline Claim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make landing on an *available* name subdomain (`alice.nido.fyi`) the entry point for claiming that name for an existing account — confirm the claimer, hand off to the account's own subdomain (forced by WebAuthn rpId), run the claim inline with a progress ticker, then land on the dashboard at the friendly name.

**Architecture:** Extract the claim's pure decisions (name state, claimer selection, hand-off/return URLs) into a unit-tested `lib/claimFlow.ts`, and the progress-ticker DOM into a unit-tested `lib/progressSteps.ts`. Wire both into `account/index.astro` (available-name entry + `?claim=` auto-run + inline passkey + progress card) and `new-account/index.astro` (`?then=claim:` return intent). Reuse all existing claim machinery (register sim, `buildAuthHash`, relayer/classic submit, `injectPasskeySignature`, `?namepasskey=1` moment-B passkey).

**Tech Stack:** Astro + TypeScript frontend (`packages/frontend`), Vitest (jsdom env), `@nidohq/passkey-sdk`, Soroban RPC, OZ relayer.

**Spec:** `docs/superpowers/specs/2026-06-18-name-centric-inline-claim-design.md`

**Working dir for all commands:** `packages/frontend`. Test runner: `npm test` (= `vitest run`). Build check: `npm run build` and `npm run check` (`astro check`).

---

## File Structure

**Create:**
- `src/lib/claimFlow.ts` — pure claim decisions: `classifyNameState`, `selectClaimer`, `formatClaimerLabel`, `buildClaimHandoffUrl`, `parseReturnIntent`, `buildClaimReturnUrl`.
- `src/lib/claimFlow.test.ts` — Vitest unit tests for the above.
- `src/lib/progressSteps.ts` — `mountSteps(container)` → controller that renders `.checkitem` steps as pending/active/done with sub-step tickers.
- `src/lib/progressSteps.test.ts` — Vitest (jsdom) tests for step transitions.
- `src/lib/lastUsed.ts` — `markUsed(id)` / `readLastUsed()` over `nido:lastUsed:<id>` localStorage keys.
- `src/lib/lastUsed.test.ts` — Vitest tests with a `StorageLike` fake.

**Modify:**
- `src/pages/account/index.astro` — available-name entry view, `?claim=` auto-run, extracted `runNameClaim()`/`finalizeClaim()`, inline moment-A passkey, progress card, `markUsed()` on load.
- `src/pages/new-account/index.astro` — honor `?then=claim:<name>` after deploy.

---

## Task 1: `claimFlow.ts` pure logic

**Files:**
- Create: `packages/frontend/src/lib/claimFlow.ts`
- Test: `packages/frontend/src/lib/claimFlow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/claimFlow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  classifyNameState,
  selectClaimer,
  formatClaimerLabel,
  buildClaimHandoffUrl,
  parseReturnIntent,
  buildClaimReturnUrl,
} from "./claimFlow";

// Valid strkey C-addresses (reused from other lib tests).
const C1 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const C2 = "CCV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XMCW";

describe("classifyNameState", () => {
  it("invalid for bad syntax", () => {
    expect(classifyNameState("Alice", null)).toBe("invalid"); // uppercase
    expect(classifyNameState("1abc", null)).toBe("invalid"); // leading digit
    expect(classifyNameState("toolongname12345", null)).toBe("invalid"); // 16 chars
    expect(classifyNameState("", null)).toBe("invalid");
  });
  it("taken when resolved", () => {
    expect(classifyNameState("alice", C1)).toBe("taken");
  });
  it("available when valid and unresolved", () => {
    expect(classifyNameState("alice", null)).toBe("available");
    expect(classifyNameState("a", null)).toBe("available");
    expect(classifyNameState("alice15charsok", null)).toBe("available");
  });
});

describe("selectClaimer", () => {
  it("param wins when a valid contract id", () => {
    expect(selectClaimer(C1, [C2], {})).toEqual({ contractId: C1, source: "param" });
  });
  it("lowercased param is normalised to upper", () => {
    expect(selectClaimer(C1.toLowerCase(), [], {})).toEqual({ contractId: C1, source: "param" });
  });
  it("ignores an invalid param", () => {
    expect(selectClaimer("not-a-contract", [C1], {})).toEqual({ contractId: C1, source: "single" });
  });
  it("none when no accounts and no param", () => {
    expect(selectClaimer(null, [], {})).toEqual({ contractId: null, source: "none" });
  });
  it("single account", () => {
    expect(selectClaimer(null, [C1], {})).toEqual({ contractId: C1, source: "single" });
  });
  it("multi → most-recently-used by lastUsed", () => {
    expect(selectClaimer(null, [C1, C2], { [C1]: 10, [C2]: 99 })).toEqual({
      contractId: C2,
      source: "recent",
    });
  });
  it("multi → falls back to list order when no timestamps", () => {
    expect(selectClaimer(null, [C1, C2], {})).toEqual({ contractId: C1, source: "recent" });
  });
});

describe("formatClaimerLabel", () => {
  it("uses the name when present", () => {
    expect(formatClaimerLabel(C1, "bob")).toBe("bob");
  });
  it("shortens the contract id when nameless", () => {
    expect(formatClaimerLabel(C1, null)).toBe("CAAA…BSC4");
  });
});

describe("buildClaimHandoffUrl", () => {
  it("targets the unnamed claimer's contract-id subdomain", () => {
    const url = buildClaimHandoffUrl({
      apexHost: "nido.fyi",
      fromHost: "alice.nido.fyi",
      claimName: "alice",
      claimerContractId: C1,
      claimerName: null,
    });
    expect(url).toBe(
      `https://${C1.toLowerCase()}.nido.fyi/account/?claim=alice&account=${C1}&from=alice.nido.fyi`,
    );
  });
  it("targets a named claimer's name subdomain", () => {
    const url = buildClaimHandoffUrl({
      apexHost: "nido.fyi",
      fromHost: "alice.nido.fyi",
      claimName: "alice",
      claimerContractId: C1,
      claimerName: "bob",
    });
    expect(url).toBe(`https://bob.nido.fyi/account/?claim=alice&account=${C1}&from=alice.nido.fyi`);
  });
  it("honours a custom protocol (dev http)", () => {
    const url = buildClaimHandoffUrl({
      apexHost: "localhost:4321",
      fromHost: "alice.localhost:4321",
      claimName: "alice",
      claimerContractId: C1,
      claimerName: null,
      protocol: "http:",
    });
    expect(url.startsWith("http://")).toBe(true);
  });
});

describe("parseReturnIntent", () => {
  it("parses claim:<name>", () => {
    expect(parseReturnIntent("claim:alice")).toEqual({ kind: "claim", name: "alice" });
  });
  it("lowercases the name", () => {
    expect(parseReturnIntent("claim:Alice")).toEqual({ kind: "claim", name: "alice" });
  });
  it("rejects invalid names", () => {
    expect(parseReturnIntent("claim:1bad")).toBeNull();
    expect(parseReturnIntent("claim:")).toBeNull();
  });
  it("null for absent/other", () => {
    expect(parseReturnIntent(null)).toBeNull();
    expect(parseReturnIntent("something")).toBeNull();
  });
});

describe("buildClaimReturnUrl", () => {
  it("returns to the name subdomain account page with the new account param", () => {
    const url = buildClaimReturnUrl({ apexHost: "nido.fyi", name: "alice", contractId: C1 });
    expect(url).toBe(`https://alice.nido.fyi/account/?account=${C1}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- claimFlow`
Expected: FAIL — `Cannot find module './claimFlow'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/claimFlow.ts`:

```ts
// Pure decisions for the name-claim flow. No DOM, no network — unit-tested.
// See docs/superpowers/specs/2026-06-18-name-centric-inline-claim-design.md
import { accountUrl, isContractId } from "@nidohq/passkey-sdk";

/** A valid Nido name: a lowercase letter then up to 14 lowercase letters/digits. */
export const VALID_NAME_RE = /^[a-z][a-z0-9]{0,14}$/;

export type NameState = "available" | "taken" | "invalid";

/**
 * Classify a name subdomain for the claim entry:
 *  - "invalid"   → fails VALID_NAME_RE (reserved/garbage)
 *  - "taken"     → registry resolved it to a contract id
 *  - "available" → valid syntax, no registry entry
 */
export function classifyNameState(name: string, resolved: string | null): NameState {
  if (!VALID_NAME_RE.test(name)) return "invalid";
  return resolved ? "taken" : "available";
}

export type ClaimerSource = "param" | "single" | "recent" | "none";

export interface ClaimerSelection {
  /** Chosen claimer contract id, or null when there is none to default to. */
  contractId: string | null;
  source: ClaimerSource;
}

/**
 * Pick which account claims the name:
 *  - explicit `?account=` param (a valid contract id) wins → "param"
 *  - exactly one known account → "single"
 *  - several → most-recently-used by `lastUsed`, ties broken by list order → "recent"
 *  - none → null / "none" (caller routes to /new-account)
 */
export function selectClaimer(
  paramAccount: string | null,
  accounts: string[],
  lastUsed: Record<string, number> = {},
): ClaimerSelection {
  if (paramAccount) {
    const id = paramAccount.toUpperCase();
    if (isContractId(id)) return { contractId: id, source: "param" };
  }
  if (accounts.length === 0) return { contractId: null, source: "none" };
  if (accounts.length === 1) return { contractId: accounts[0], source: "single" };
  let best = accounts[0];
  let bestTs = lastUsed[best] ?? 0;
  for (const id of accounts) {
    const ts = lastUsed[id] ?? 0;
    if (ts > bestTs) {
      best = id;
      bestTs = ts;
    }
  }
  return { contractId: best, source: "recent" };
}

/** Human label for a claimer row: its name, else a shortened contract id. */
export function formatClaimerLabel(contractId: string, name: string | null): string {
  if (name) return name;
  return `${contractId.slice(0, 4)}…${contractId.slice(-4)}`;
}

export interface HandoffParams {
  /** apex host, e.g. nido.fyi — use stripSubdomain(location.host). */
  apexHost: string;
  /** current host, e.g. alice.nido.fyi (breadcrumb). */
  fromHost: string;
  /** name being claimed, e.g. "alice". */
  claimName: string;
  /** claimer contract id (authoritative). */
  claimerContractId: string;
  /** claimer's existing name if any (its home subdomain key), else null. */
  claimerName: string | null;
  /** protocol incl. trailing colon, default "https:". */
  protocol?: string;
}

/**
 * Build the absolute URL that hands the claim off to the account's OWN
 * subdomain (where its passkey rpId matches), carrying the target name and the
 * authoritative claimer id as params. accountUrl returns a protocol-relative
 * `//host/path`, so we prepend the protocol.
 */
export function buildClaimHandoffUrl(p: HandoffParams): string {
  const key = p.claimerName ?? p.claimerContractId;
  const search = new URLSearchParams({
    claim: p.claimName,
    account: p.claimerContractId,
    from: p.fromHost,
  });
  const rel = accountUrl(p.apexHost, key, `/account/?${search.toString()}`);
  return `${p.protocol ?? "https:"}${rel}`;
}

export interface ReturnIntent {
  kind: "claim";
  name: string;
}

/** Parse a `?then=claim:alice` return intent. Null when absent/malformed. */
export function parseReturnIntent(then: string | null): ReturnIntent | null {
  if (!then) return null;
  const m = /^claim:(.+)$/.exec(then);
  if (!m) return null;
  const name = m[1].toLowerCase();
  return VALID_NAME_RE.test(name) ? { kind: "claim", name } : null;
}

export interface ReturnTargetParams {
  apexHost: string;
  name: string;
  contractId: string;
  protocol?: string;
}

/**
 * After new-account finishes, build the URL back to the name subdomain's
 * account page so the confirm→claim path runs for the freshly-created account.
 */
export function buildClaimReturnUrl(p: ReturnTargetParams): string {
  const search = new URLSearchParams({ account: p.contractId });
  const rel = accountUrl(p.apexHost, p.name, `/account/?${search.toString()}`);
  return `${p.protocol ?? "https:"}${rel}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- claimFlow`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/claimFlow.ts src/lib/claimFlow.test.ts
git commit -m "feat(frontend): claimFlow pure logic for name-centric inline claim"
```

---

## Task 2: `progressSteps.ts` step ticker controller

**Files:**
- Create: `packages/frontend/src/lib/progressSteps.ts`
- Test: `packages/frontend/src/lib/progressSteps.test.ts`

This extracts the new-account creation ticker (`new-account/index.astro` `renderCheck`/`setTicker`/`setCheckProgress`, lines ~258-290) into a reusable, container-scoped controller so the claim flow gets the same polished progress UI. The vitest env is already `jsdom` (`vitest.config.ts`), so `document` is available without a pragma.

- [ ] **Step 1: Write the failing test**

Create `src/lib/progressSteps.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mountSteps } from "./progressSteps";

function makeContainer(n: number): HTMLElement {
  const root = document.createElement("div");
  for (let i = 0; i < n; i++) {
    const item = document.createElement("div");
    item.className = "checkitem";
    const mark = document.createElement("span");
    mark.className = "check-mark";
    const sub = document.createElement("span");
    sub.className = "check-sub";
    sub.style.display = "none";
    item.append(mark, sub);
    root.append(item);
  }
  return root;
}

describe("mountSteps", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = makeContainer(3);
  });

  it("setProgress marks done/active/pending", () => {
    const c = mountSteps(root);
    c.setProgress(1, 1);
    const items = root.querySelectorAll<HTMLElement>(".checkitem");
    const marks = root.querySelectorAll<HTMLElement>(".check-mark");
    expect(items[0].style.opacity).toBe("1"); // done
    expect(marks[0].innerHTML).toContain("M5 13l4 4"); // check path
    expect(items[1].style.opacity).toBe("1"); // active
    expect(marks[1].innerHTML).toContain("spin"); // spinner
    expect(items[2].style.opacity).toBe(".4"); // pending
    expect(marks[2].innerHTML).toContain("border"); // ring
  });

  it("ticker sets and clears sub text", () => {
    const c = mountSteps(root);
    c.setProgress(0, 1);
    c.ticker(1, "Simulating…");
    const sub = root.querySelectorAll<HTMLElement>(".check-sub")[1];
    expect(sub.textContent).toBe("Simulating…");
    expect(sub.style.display).toBe("block");
    c.ticker(1, "");
    expect(sub.style.display).toBe("none");
  });

  it("changing progress away from a step clears its ticker", () => {
    const c = mountSteps(root);
    c.setProgress(0, 1);
    c.ticker(1, "working");
    c.setProgress(2, -1); // step 1 now done, no active
    const sub = root.querySelectorAll<HTMLElement>(".check-sub")[1];
    expect(sub.style.display).toBe("none");
  });

  it("finish marks every step done", () => {
    const c = mountSteps(root);
    c.finish();
    root.querySelectorAll<HTMLElement>(".check-mark").forEach((m) => {
      expect(m.innerHTML).toContain("M5 13l4 4");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- progressSteps`
Expected: FAIL — `Cannot find module './progressSteps'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/progressSteps.ts`:

```ts
// Reusable creation/claim progress ticker. Operates over a container whose
// direct children are `.checkitem` elements, each holding a `.check-mark` (icon
// slot) and an optional `.check-sub` (sub-step ticker). Mirrors the new-account
// creation ticker so the claim flow shows the same polished progress.

export type StepState = "pending" | "active" | "done";

export interface StepsController {
  /** Mark steps [0,done) done, `activeIdx` active (pass -1 for none), rest pending. */
  setProgress(done: number, activeIdx: number): void;
  /** Set/clear the sub-step ticker text under step i. */
  ticker(i: number, text: string): void;
  /** Mark every step done (terminal state). */
  finish(): void;
}

const DONE_MARK =
  '<span style="width:24px;height:24px;border-radius:50%;background:var(--good);display:grid;place-items:center;">' +
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg></span>';

const ACTIVE_MARK =
  '<svg class="spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 16"/><path d="M4 20v-4h4"/></svg>';

const PENDING_MARK =
  '<span style="width:24px;height:24px;border-radius:50%;border:2px solid var(--line);display:block;"></span>';

export function mountSteps(container: HTMLElement): StepsController {
  const items = () => Array.from(container.querySelectorAll<HTMLElement>(".checkitem"));

  function ticker(i: number, text: string) {
    const sub = items()[i]?.querySelector<HTMLElement>(".check-sub");
    if (!sub) return;
    sub.textContent = text;
    sub.style.display = text ? "block" : "none";
  }

  function render(i: number, state: StepState) {
    const item = items()[i];
    if (!item) return;
    item.style.opacity = state === "pending" ? ".4" : "1";
    if (state !== "active") ticker(i, "");
    const mark = item.querySelector<HTMLElement>(".check-mark");
    if (mark) mark.innerHTML = state === "done" ? DONE_MARK : state === "active" ? ACTIVE_MARK : PENDING_MARK;
  }

  function setProgress(done: number, activeIdx: number) {
    const n = items().length;
    for (let i = 0; i < n; i++) {
      render(i, i < done ? "done" : i === activeIdx ? "active" : "pending");
    }
  }

  function finish() {
    setProgress(items().length, -1);
  }

  return { setProgress, ticker, finish };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- progressSteps`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/progressSteps.ts src/lib/progressSteps.test.ts
git commit -m "feat(frontend): reusable progress-step ticker controller"
```

---

## Task 3: `lastUsed.ts` recency helper

**Files:**
- Create: `packages/frontend/src/lib/lastUsed.ts`
- Test: `packages/frontend/src/lib/lastUsed.test.ts`

Powers the multi-account picker default (`selectClaimer`'s `lastUsed` arg). Mirrors the `StorageLike` fake pattern used in `nidoSharedStorage.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/lastUsed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { markUsed, readLastUsed } from "./lastUsed";

function fakeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
}

const C1 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

describe("lastUsed", () => {
  it("markUsed writes a numeric timestamp under the prefixed key", () => {
    const store = fakeStore();
    markUsed(C1, store, 1234);
    expect(store.getItem(`nido:lastUsed:${C1}`)).toBe("1234");
  });

  it("readLastUsed collects prefixed keys into a record", () => {
    const store = fakeStore({ [`nido:lastUsed:${C1}`]: "42", "nido:accounts": "[]" });
    expect(readLastUsed(store)).toEqual({ [C1]: 42 });
  });

  it("readLastUsed ignores non-numeric values", () => {
    const store = fakeStore({ [`nido:lastUsed:${C1}`]: "nope" });
    expect(readLastUsed(store)).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lastUsed`
Expected: FAIL — `Cannot find module './lastUsed'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/lastUsed.ts`:

```ts
// Per-account "last used" timestamps, used only to default the multi-account
// claim picker. Best-effort UX nicety — local-only, never correctness-critical.
type StorageLike = Pick<Storage, "getItem" | "setItem" | "key" | "length">;

const PREFIX = "nido:lastUsed:";

function storageOrNull(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Record that `contractId` was just used (default: now). */
export function markUsed(
  contractId: string,
  store: StorageLike | null = storageOrNull(),
  now: number = Date.now(),
): void {
  if (!store) return;
  try {
    store.setItem(`${PREFIX}${contractId}`, String(now));
  } catch {
    /* ignore quota / disabled storage */
  }
}

/** Read all recency timestamps as a `{ contractId: epochMs }` record. */
export function readLastUsed(store: StorageLike | null = storageOrNull()): Record<string, number> {
  if (!store) return {};
  const out: Record<string, number> = {};
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const raw = store.getItem(key);
    const ts = raw ? Number(raw) : NaN;
    if (Number.isFinite(ts)) out[key.slice(PREFIX.length)] = ts;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lastUsed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lastUsed.ts src/lib/lastUsed.test.ts
git commit -m "feat(frontend): per-account lastUsed recency helper"
```

---

## Task 4: Extract `runNameClaim()` and `finalizeClaim()` on the account page

Refactor only — no behavior change yet. Splits the existing `$claimBtn` handler (lines ~999-1107) and the `nameresult=1` finalize block (lines ~1111-1276) into reusable functions, so later tasks can call them from the `?claim=` auto-run and the inline-passkey path. This task keeps the existing `?sign=` redirect intact.

**Files:**
- Modify: `packages/frontend/src/pages/account/index.astro`

- [ ] **Step 1: Extract `runNameClaim(name)`**

In the account-page `<script>`, define a function that contains the existing claim-build body. Replace the `$claimBtn` click handler body with a thin caller. The handler currently reads `$nameInput.value`; `runNameClaim` takes the name as a parameter instead.

Add (near the other claim helpers, before the `$claimBtn` listener):

```ts
// Build + simulate the register tx, then route to the passkey step.
// `name` is pre-validated lowercase. Today this redirects to the ?sign=
// surface; Task 6 swaps that for an inline ceremony.
async function runNameClaim(name: string) {
  clearError();
  if (!contractId) {
    showError("Navigate to your account's subdomain to claim a name.");
    return;
  }
  // ... MOVE the entire body of the existing $claimBtn handler here,
  //     EXCEPT the leading `const name = ...` read and its validation
  //     (the caller validates). Keep everything from
  //     `try { $claimBtn.disabled = true; ... }` through the final
  //     `} finally { $claimBtn.disabled = false; }`.
}
```

Then replace the existing `$claimBtn.addEventListener("click", async () => { ... })` with:

```ts
$claimBtn.addEventListener("click", () => {
  const name = $nameInput.value.trim().toLowerCase();
  if (!name || !/^[a-z][a-z0-9]*$/.test(name) || name.length > 15) {
    showError("Name must be 1-15 characters, lowercase letters and digits only, starting with a letter.");
    return;
  }
  void runNameClaim(name);
});
```

- [ ] **Step 2: Extract `finalizeClaim(sig)`**

The `nameresult=1` block reads the passkey result from URL params and runs the inject+submit+`finishClaim` async IIFE. Extract its async body into a named function that takes the four signature fields, so it can be called both from the existing `nameresult=1` path and (Task 6) inline.

Add:

```ts
interface PasskeySig {
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  publicKey: string;
}

// Inject the passkey signature into the stored claim tx, submit, and on success
// redirect to the name subdomain to register its passkey (moment B).
async function finalizeClaim(sig: PasskeySig) {
  $nameResult.style.display = "block";
  try {
    // ... MOVE the body of the existing `(async () => { ... })()` under
    //     `nameresult=1` here, replacing the four
    //     `params.get("authenticatorData")` / `clientDataJSON` / `signature`
    //     / `publicKey` reads with `sig.authenticatorData` etc.
  } catch (err: any) {
    showError(`Couldn't finish claiming your name: ${err.message}`);
    $nameResult.style.display = "none";
  }
}
```

Replace the existing `nameresult=1` block with a thin caller that preserves current behavior:

```ts
if (params.get("nameresult") === "1") {
  if (params.get("error")) {
    showError("Name claim was cancelled.");
  } else {
    const authenticatorData = params.get("authenticatorData");
    const clientDataJSON = params.get("clientDataJSON");
    const signature = params.get("signature");
    const publicKey = params.get("publicKey");
    if (authenticatorData && clientDataJSON && signature && publicKey) {
      void finalizeClaim({ authenticatorData, clientDataJSON, signature, publicKey });
    }
  }
}
```

- [ ] **Step 3: Type-check + build**

Run: `npm run check`
Expected: no NEW errors versus the pre-existing baseline (record the baseline error count first with `npm run check` on a clean checkout; see Pre-commit note below).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/account/index.astro
git commit -m "refactor(frontend): extract runNameClaim/finalizeClaim on account page"
```

> **Pre-commit note:** `just check` (fmt + clippy) is already red on `main` for unrelated Rust crates; this PR only touches `packages/frontend`. Verify only the files you changed: `npm run check` (astro) + `npm test`.

---

## Task 5: Available-name entry view on `alice.nido.fyi`

When a syntactically-valid name resolves to nothing (and we're not in signing mode), replace the "not found" error with a claim entry: confirm the claimer (param → most-recent → picker) and hand off to the account's subdomain.

**Files:**
- Modify: `packages/frontend/src/pages/account/index.astro`

- [ ] **Step 1: Add the entry markup**

Add a hidden section inside `#home-mode` (near `#claim-name-inline`, ~line 193). This is the available-name confirm card:

```html
<section id="claim-entry" class="hidden pad" style="padding-top:18px;">
  <span class="section-label" style="display:block; margin-bottom:12px;">Claim this name</span>
  <div class="card" style="padding:16px;">
    <p style="font-size:15px; font-weight:600; margin:0 0 6px;">
      <span id="claim-entry-name"></span> is available
    </p>
    <p class="mut" style="font-size:13.5px; line-height:1.5; margin:0 0 14px;">
      Claim it for <strong id="claim-entry-account"></strong>. We'll open your account's
      domain to confirm with your passkey, then bring you back here.
    </p>
    <button id="claim-entry-btn" class="btn acc">
      <Icon name="sparkle" size={18} color="#fff" /> Claim <span id="claim-entry-name2"></span>
    </button>
    <button id="claim-entry-switch" class="btn ghost sm" type="button" style="margin-top:8px; display:none;">
      Use a different account
    </button>
    <div id="claim-entry-picker" class="hidden" style="margin-top:10px;"></div>
  </div>
</section>
```

- [ ] **Step 2: Wire the available branch in name resolution**

In the name-resolution block (`account/index.astro` ~lines 396-421), the `else { showError("Name ... not found") }` branch fires when the registry returns null. Replace that `showError` with a call into the new entry. Import the new helpers at the top of the script:

```ts
import {
  classifyNameState,
  selectClaimer,
  formatClaimerLabel,
  buildClaimHandoffUrl,
} from "../../lib/claimFlow";
import { localNidoSnapshot, syncNidoStorageViaBridge } from "../../lib/nidoSharedStorage";
import { readLastUsed } from "../../lib/lastUsed";
```

Replace the `else` branch (currently `showError(\`Name "${detectedName}" not found in the registry.\`)`) with:

```ts
} else if (!isSigningMode) {
  await showClaimEntry(detectedName);
  return; // entry view owns the page from here
}
```

(Leave the signing-mode behavior unchanged — when signing against an unresolved name there is nothing to sign, so the original error is fine; keep `showError(...)` for the `isSigningMode` case by restructuring to `else if (!isSigningMode) {...} else { showError(...) }`.)

- [ ] **Step 3: Implement `showClaimEntry`**

Add this function in the script. It reads accounts (local first, then bridge-sync), picks the claimer, fills the card, and wires the buttons:

```ts
async function showClaimEntry(name: string) {
  const state = classifyNameState(name, null); // resolved was null in this branch
  if (state === "invalid") {
    showError(`"${name}" isn't a valid name.`);
    return;
  }

  const paramAccount = params.get("account");
  // Pull accounts from local storage, then refresh from the apex bridge.
  let snapshot = localNidoSnapshot();
  if (snapshot.accounts.length === 0) {
    await syncNidoStorageViaBridge();
    snapshot = localNidoSnapshot();
  }

  const apexHost = stripSubdomain(window.location.host);

  // No account anywhere → send to new-account (on the apex) with a return
  // intent. The apex has no contract subdomain, so build the URL directly
  // rather than via accountUrl.
  const choice = selectClaimer(paramAccount, snapshot.accounts, readLastUsed());
  if (choice.contractId === null) {
    window.location.href = `${window.location.protocol}//${apexHost}/new-account/?then=claim:${name}`;
    return;
  }

  const claimer = choice.contractId;
  const claimerName = snapshot.names[claimer] ?? null;

  const $entry = document.getElementById("claim-entry")!;
  document.getElementById("claim-entry-name")!.textContent = name;
  document.getElementById("claim-entry-name2")!.textContent = name;
  document.getElementById("claim-entry-account")!.textContent = formatClaimerLabel(claimer, claimerName);
  $entry.classList.remove("hidden");

  const handoff = () =>
    buildClaimHandoffUrl({
      apexHost,
      fromHost: window.location.host,
      claimName: name,
      claimerContractId: claimer,
      claimerName,
      protocol: window.location.protocol,
    });

  document.getElementById("claim-entry-btn")!.addEventListener("click", () => {
    window.location.href = handoff();
  });

  // Offer account switching only when there is more than one account.
  if (snapshot.accounts.length > 1) {
    const $switch = document.getElementById("claim-entry-switch") as HTMLButtonElement;
    $switch.style.display = "block";
    $switch.addEventListener("click", () => {
      const $picker = document.getElementById("claim-entry-picker")!;
      $picker.classList.toggle("hidden");
      if (!$picker.dataset.mounted) {
        renderClaimPicker($picker, name, apexHost, snapshot);
        $picker.dataset.mounted = "1";
      }
    });
  }
}
```

- [ ] **Step 4: Implement `renderClaimPicker`**

A minimal list of the user's accounts; clicking one hands off with that account as `?account=`:

```ts
function renderClaimPicker(
  host: HTMLElement,
  name: string,
  apexHost: string,
  snapshot: { accounts: string[]; names: Record<string, string> },
) {
  host.innerHTML = "";
  for (const id of snapshot.accounts) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "btn ghost sm";
    row.style.cssText = "display:block; width:100%; text-align:left; margin-bottom:6px;";
    row.textContent = formatClaimerLabel(id, snapshot.names[id] ?? null);
    row.addEventListener("click", () => {
      window.location.href = buildClaimHandoffUrl({
        apexHost,
        fromHost: window.location.host,
        claimName: name,
        claimerContractId: id,
        claimerName: snapshot.names[id] ?? null,
        protocol: window.location.protocol,
      });
    });
    host.append(row);
  }
}
```

- [ ] **Step 5: Type-check + build**

Run: `npm run check` then `npm run build`
Expected: no new errors; build succeeds.

- [ ] **Step 6: Manual verification**

Run `npm run dev`. Visit a known-available name subdomain in dev (e.g. `http://newname.localhost:4321/account/`). Expected: the "newname is available — Claim for <account>" card renders instead of an error (requires at least one account in localStorage; seed via the normal new-account flow first). Clicking **Claim** navigates to `<account-host>/account/?claim=newname&account=…`.

- [ ] **Step 7: Commit**

```bash
git add src/pages/account/index.astro
git commit -m "feat(frontend): available-name claim entry on name subdomains"
```

---

## Task 6: `?claim=` auto-run + inline moment-A passkey + progress card

On the account's own subdomain, `?claim=<name>` auto-runs the claim, doing the passkey inline (no `?sign=` bounce) and showing the progress ticker. The `?sign=` surface stays untouched for external dApps.

**Files:**
- Modify: `packages/frontend/src/pages/account/index.astro`

- [ ] **Step 1: Add the progress-card markup**

Add inside `#home-mode` (a hidden section, near `#claim-name-inline`):

```html
<section id="claim-progress" class="hidden pad" style="padding-top:18px;">
  <span class="section-label" style="display:block; margin-bottom:12px;">Claiming your name</span>
  <div class="card" style="padding:16px;">
    <div style="display:flex; flex-direction:column; gap:13px;">
      <div class="checkitem" style="display:flex; align-items:flex-start; gap:12px; opacity:.4; transition:opacity .3s;">
        <span class="check-mark" style="width:24px; height:24px; flex:0 0 auto; display:grid; place-items:center; margin-top:1px;"></span>
        <span style="display:flex; flex-direction:column; gap:2px; min-width:0;">
          <span class="check-text" style="font-size:14.5px; font-weight:600;">Preparing the claim</span>
          <span class="check-sub" style="display:none; font-size:12px; color:var(--mut);"></span>
        </span>
      </div>
      <div class="checkitem" style="display:flex; align-items:flex-start; gap:12px; opacity:.4; transition:opacity .3s;">
        <span class="check-mark" style="width:24px; height:24px; flex:0 0 auto; display:grid; place-items:center; margin-top:1px;"></span>
        <span style="display:flex; flex-direction:column; gap:2px; min-width:0;">
          <span class="check-text" style="font-size:14.5px; font-weight:600;">Confirm with your passkey</span>
          <span class="check-sub" style="display:none; font-size:12px; color:var(--mut);"></span>
        </span>
      </div>
      <div class="checkitem" style="display:flex; align-items:flex-start; gap:12px; opacity:.4; transition:opacity .3s;">
        <span class="check-mark" style="width:24px; height:24px; flex:0 0 auto; display:grid; place-items:center; margin-top:1px;"></span>
        <span style="display:flex; flex-direction:column; gap:2px; min-width:0;">
          <span class="check-text" style="font-size:14.5px; font-weight:600;">Publishing to Stellar</span>
          <span class="check-sub" style="display:none; font-size:12px; color:var(--mut);"></span>
        </span>
      </div>
      <div class="checkitem" style="display:flex; align-items:flex-start; gap:12px; opacity:.4; transition:opacity .3s;">
        <span class="check-mark" style="width:24px; height:24px; flex:0 0 auto; display:grid; place-items:center; margin-top:1px;"></span>
        <span style="display:flex; flex-direction:column; gap:2px; min-width:0;">
          <span class="check-text" style="font-size:14.5px; font-weight:600;">Name locked in</span>
          <span class="check-sub" style="display:none; font-size:12px; color:var(--mut);"></span>
        </span>
      </div>
    </div>
    <div id="claim-progress-error" class="hidden" style="margin-top:12px; font-size:13px; color:var(--bad);"></div>
  </div>
</section>
```

- [ ] **Step 2: Auto-run on `?claim=`**

In `initHomeMode` (after `contractId` is known and home mode is shown, near the existing claim wiring), add:

```ts
const claimParam = params.get("claim");
if (claimParam && contractId && !isSigningMode) {
  const name = claimParam.trim().toLowerCase();
  if (/^[a-z][a-z0-9]{0,14}$/.test(name)) {
    // Hide the normal dashboard sections; show the progress card.
    document.getElementById("claim-name-inline")?.classList.add("hidden");
    document.getElementById("claim-name-top-btn")?.classList.add("hidden");
    document.getElementById("claim-progress")!.classList.remove("hidden");
    void runNameClaim(name);
  }
}
```

- [ ] **Step 3: Make `runNameClaim` use the progress ticker + inline passkey**

Modify `runNameClaim` (from Task 4). Mount the ticker once and drive it through the phases; after computing `authHashHex` and storing the tx data, **sign inline** instead of redirecting:

```ts
import { mountSteps } from "../../lib/progressSteps";
// ... inside the script, lazily:
let claimSteps: ReturnType<typeof mountSteps> | null = null;
function claimProgress() {
  if (!claimSteps) {
    claimSteps = mountSteps(document.getElementById("claim-progress")!);
  }
  return claimSteps;
}
```

In `runNameClaim`, replace the plain `$nameResult.textContent = ...` status writes with ticker calls, and replace the trailing redirect:

```ts
// was:
//   const callback = `${...}/account/?nameresult=1`;
//   const signUrl = `/account/?sign=${authHashHex}&callback=${encodeURIComponent(callback)}`;
//   window.location.href = signUrl;
// now (inline passkey + finalize):
const steps = claimProgress();
steps.setProgress(1, 1); // step 0 (prepare) done, step 1 (passkey) active
steps.ticker(1, "Waiting for your passkey…");
const sig = await signHash(authHashHex); // existing inline assertion helper
steps.setProgress(2, 2); // passkey done, submitting active
await finalizeClaim({
  authenticatorData: sig.authenticatorData,
  clientDataJSON: sig.clientDataJSON,
  signature: sig.signature,
  publicKey: sig.publicKey,
});
```

> `signHash(hashHex)` (account page, ~line 471) returns `{ authenticatorData, clientDataJSON, signature, publicKey, ... }` as hex — exactly the four fields `finalizeClaim` needs. It requires a registered credential for `contractId`, which exists on the account's own subdomain.

Drive the early phase too — at the top of the build section: `claimProgress().setProgress(0, 0); claimProgress().ticker(0, "Building transaction…");` and update the ticker text at simulate.

- [ ] **Step 4: Drive the ticker inside `finalizeClaim`**

In `finalizeClaim`, replace its `$nameResult.textContent` writes with ticker updates on step 2 (submit) and mark step 3 done in `finishClaim`:

```ts
// submitting:
claimProgress().setProgress(2, 2);
claimProgress().ticker(2, "Submitting to the network…");
// waiting:
claimProgress().ticker(2, "Waiting for confirmation…");
// in finishClaim, before the redirect:
claimProgress().finish();
```

Keep the existing redirect to `accountUrl(rootHost, claimedName, "/account/?namepasskey=1")` in `finishClaim` — that lands on the name subdomain and triggers moment-B passkey registration (already inline via `?namepasskey=1`), then reveals the dashboard.

- [ ] **Step 5: Type-check + build**

Run: `npm run check` then `npm run build`
Expected: no new errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/pages/account/index.astro
git commit -m "feat(frontend): inline passkey + progress ticker for name claim"
```

---

## Task 7: `?then=claim:<name>` return intent in new-account

When a brand-new account finishes deploying with `?then=claim:alice`, send the user to `alice.<apex>/account/?account=<newId>` so the confirm→claim path runs for the fresh account (the "0 accounts" branch of Task 5).

**Files:**
- Modify: `packages/frontend/src/pages/new-account/index.astro`

- [ ] **Step 1: Honor the return intent at the success redirect**

Find the deploy-success redirect (the `window.location.href = "/account/"` near line ~705). Import the helpers and branch on the intent:

```ts
import { parseReturnIntent, buildClaimReturnUrl } from "../../lib/claimFlow";
import { stripSubdomain } from "@nidohq/passkey-sdk";
```

Replace the success redirect with:

```ts
const intent = parseReturnIntent(new URLSearchParams(window.location.search).get("then"));
if (intent) {
  const apexHost = stripSubdomain(window.location.host);
  window.location.href = buildClaimReturnUrl({
    apexHost,
    name: intent.name,
    contractId, // the freshly-created account's contract id (in scope at success)
    protocol: window.location.protocol,
  });
} else {
  window.location.href = "/account/";
}
```

> Confirm the variable holding the new account's contract id at the redirect site (it may be named differently, e.g. `accountId`/`deployed`). Use whatever the deploy path already has in scope.

- [ ] **Step 2: Type-check + build**

Run: `npm run check` then `npm run build`
Expected: no new errors; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/new-account/index.astro
git commit -m "feat(frontend): new-account honors claim return intent"
```

---

## Task 8: Record account recency on load

So the multi-account picker defaults to the most-recently-used account.

**Files:**
- Modify: `packages/frontend/src/pages/account/index.astro`

- [ ] **Step 1: Mark used when the dashboard loads for a real account**

In `initHomeMode` (where `contractId` is confirmed and home mode renders), add:

```ts
import { markUsed } from "../../lib/lastUsed";
// ... when home mode is active with a resolved contractId:
if (contractId) markUsed(contractId);
```

- [ ] **Step 2: Type-check + build**

Run: `npm run check` then `npm run build`
Expected: no new errors; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/account/index.astro
git commit -m "feat(frontend): record account recency for claim picker default"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole unit suite**

Run: `npm test`
Expected: all tests pass, including the new `claimFlow`, `progressSteps`, `lastUsed` suites.

- [ ] **Step 2: Type-check + production build**

Run: `npm run check && npm run build`
Expected: no new errors versus baseline; build succeeds.

- [ ] **Step 3: Manual end-to-end (dev, two subdomains)**

With at least one account seeded in localStorage:
1. Visit an available name subdomain `…/account/` → entry card shows, claimer correct.
2. Click **Claim** → lands on the account subdomain `?claim=…`, progress card runs, passkey prompt appears inline (one ceremony), tx submits.
3. On success → redirects to the name subdomain `?namepasskey=1` → moment-B passkey prompt → dashboard at the friendly name.
4. Multi-account: **Use a different account** reveals the picker; choosing one hands off with that `?account=`.
5. No-account: clearing localStorage then visiting the name → redirect to `/new-account/?then=claim:<name>`.

> Note: passkey rpId differs per subdomain, so a Playwright virtual authenticator must register credentials per host. Cross-subdomain passkey automation is a known harness gap (see passkey-e2e-harness work) — full automation is out of scope for this PR; manual verification is the gate.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/name-inline-claim
gh pr create --title "feat(frontend): claim a name inline from its subdomain" --body "<summary + test plan>"
```

---

## Self-Review Notes (author)

- **Spec coverage:** entry view (Task 5) ↔ spec §Components.1; `?claim=` inline controller + inline passkey + progress (Task 6) ↔ §Components.2; moment-B reuse (`?namepasskey=1`, unchanged) ↔ §Components.3; return intent (Task 7) ↔ §Components.4; recency (Tasks 3,8) ↔ §Data/State. Edge cases (taken/invalid/0-account/multi/param) ↔ Tasks 1 & 5.
- **Open question carried from spec:** registry behavior when an already-named account claims again. Surfaced at runtime — the existing `simulateTransaction` already throws "name may already be taken / simulation failed", which `runNameClaim`'s catch shows in the progress-card error area. No extra guard added (YAGNI); revisit if product wants a friendlier pre-check.
- **`?sign=` surface:** left intact for external dApps; only the *claim* path stops routing through it.
