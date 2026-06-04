# Nido Landing Redesign + "My Nido" Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the landing into an always-on info page whose only account entry point is one premium "My Nido" nav menu (0 → create, 1 → that Nido, 2+ → selector).

**Architecture:** Extract three shared helpers (`balance`, `avatarStyle`, `myNidoModel`, `createNido`) so the menu and the wallet page share one implementation, add a self-contained `MyNidoMenu.astro` (button + popover + controller), then restructure `index.astro` to drop the old full-page welcome-back swap and mount the menu in the nav. Account presentation moves entirely into the menu.

**Tech Stack:** Astro (static build), TypeScript, `@stellar/stellar-sdk`, the `@g2c/passkey-sdk` storage/url helpers, vitest, Playwright (via `astro preview`).

**Spec:** `docs/superpowers/specs/2026-06-03-nido-landing-redesign-design.md`

**Working directory:** all paths are under `packages/frontend/`. Run all `npm` commands from `packages/frontend/`.

**Known baseline:** `npm run check` reports **2 pre-existing errors** (`src/lib/recoveryActions.ts:213`, `src/pages/account/index.astro` `navigator.credentials.get` overload). These are NOT introduced by this work — "no new diagnostics" means the count stays at 2.

---

## File Structure

- **Create** `src/lib/balance.ts` — `fetchXlmBalance(contractAddress, rpcUrl?)`. Shared XLM balance read (extracted from the account page).
- **Create** `src/lib/balance.test.ts` — placeholder-free unit note (the function is network-bound; see Task 1).
- **Create** `src/lib/avatarStyle.ts` — `avatarBackground(seed)` returning the brand-hue radial-gradient CSS (extracted from `Avatar.astro`, so the menu's JS rows and the Astro component can't diverge).
- **Create** `src/lib/avatarStyle.test.ts` — hue-validity unit tests (no NaN, in `[0,360)`).
- **Create** `src/lib/myNidoModel.ts` — pure `buildMyNidoModel(...)` state derivation.
- **Create** `src/lib/myNidoModel.test.ts` — unit tests for 0/1/2+/pending/mixed.
- **Create** `src/lib/createNido.ts` — `createNido(host)` reservation flow (extracted from `index.astro`).
- **Create** `src/components/MyNidoMenu.astro` — trigger button + popover + client controller.
- **Modify** `src/components/Avatar.astro` — use `avatarBackground`.
- **Modify** `src/pages/account/index.astro` — import `fetchXlmBalance` from lib; drop the inline copy and the now-unused `Asset`/`Contract`/`scValToNative` imports.
- **Modify** `src/pages/index.astro` — mount `<MyNidoMenu />`; hero/CTA buttons fire `nido:open-menu`; remove the welcome-back swap, the inline create logic, and the landing account list.

---

## Task 1: Extract `lib/balance.ts` (shared XLM balance read)

**Files:**
- Create: `src/lib/balance.ts`
- Modify: `src/pages/account/index.astro`

- [ ] **Step 1: Create the shared balance helper**

Create `src/lib/balance.ts`:

```ts
import {
  Account,
  Address,
  Asset,
  Contract,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";

/**
 * Read a Soroban account's native-XLM balance via a read-only simulate of the
 * XLM SAC `balance` call. Returns a 7-dp decimal string (e.g. "12.5000000").
 * Returns "0" when the contract has no balance entry or simulation fails.
 * Extracted verbatim from account/index.astro so the wallet page and the
 * My Nido menu share one implementation.
 */
export async function fetchXlmBalance(
  contractAddress: string,
  rpcUrl: string = DEFAULT_RPC_URL,
): Promise<string> {
  const server = new rpc.Server(rpcUrl);
  const xlmSacId = Asset.native().contractId(Networks.TESTNET);
  const xlmContract = new Contract(xlmSacId);

  const dummySource = new Account(
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    "0",
  );

  const tx = new TransactionBuilder(dummySource, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      xlmContract.call("balance", Address.fromString(contractAddress).toScVal()),
    )
    .setTimeout(0)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return "0";

  const successSim = sim as rpc.Api.SimulateTransactionSuccessResponse;
  if (!successSim.result) return "0";

  const rawBalance = scValToNative(successSim.result.retval) as bigint;
  const xlm = Number(rawBalance) / 10_000_000;
  return xlm.toFixed(7);
}
```

- [ ] **Step 2: Rewire the account page to import it**

In `src/pages/account/index.astro`, add the import next to the other lib imports
(after `import { formatXlm } from "../../lib/money";`):

```ts
  import { fetchXlmBalance } from "../../lib/balance";
```

Then delete the inline `async function fetchXlmBalance(contractAddress: string): Promise<string> { ... }`
definition (the whole function under the `// --- Balance ---` comment). Leave the
`// --- Balance ---` comment and the call site (`fetchXlmBalance(contractId).then(...)`) intact.

- [ ] **Step 3: Remove the now-unused stellar-sdk imports from the account page**

In `src/pages/account/index.astro`, the `@stellar/stellar-sdk` import list had
`Asset`, `Contract`, and `scValToNative` used **only** by the moved function.
Remove those three names from the import block (keep `Networks`, `Address`,
`Contract`→removed, `TransactionBuilder`, `Transaction`, `Account`, `Operation`,
`Keypair`, `rpc`, `nativeToScVal` — all still used by the name-claim flow).

The import block becomes:

```ts
  import {
    Networks,
    Address,
    TransactionBuilder,
    Transaction,
    Account,
    Operation,
    Keypair,
    rpc,
    nativeToScVal,
  } from "@stellar/stellar-sdk";
```

- [ ] **Step 4: Verify build + check + tests (refactor — behavior unchanged)**

This is a pure extraction; the account page must behave identically.

Run: `npm run build`
Expected: `9 page(s) built`, no errors.

Run: `npm run check 2>&1 | grep -c "error"`
Expected: the baseline count only (2 errors; the line count may show the two `error` lines). Confirm no error mentions `balance.ts` and no NEW error/warning appears for `account/index.astro` beyond the pre-existing `navigator.credentials.get` one.

Run: `npm test`
Expected: `31 passed` (unchanged — no new tests yet).

- [ ] **Step 5: Commit**

```bash
git add src/lib/balance.ts src/pages/account/index.astro
git commit -m "refactor(frontend): extract fetchXlmBalance into lib/balance.ts"
```

---

## Task 2: Extract `lib/avatarStyle.ts` (shared brand-hue avatar)

The menu builds avatar elements in client JS, so the C-04 brand-hue algorithm must
live in one place to avoid divergence from `Avatar.astro`.

**Files:**
- Create: `src/lib/avatarStyle.ts`
- Create: `src/lib/avatarStyle.test.ts`
- Modify: `src/components/Avatar.astro`

- [ ] **Step 1: Write the failing test**

Create `src/lib/avatarStyle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { avatarBackground } from "./avatarStyle.js";

describe("avatarBackground", () => {
  it("is deterministic for a given seed", () => {
    expect(avatarBackground("alice")).toBe(avatarBackground("alice"));
  });

  it("produces valid in-range hues (never NaN) across many seeds", () => {
    const seeds = ["alice", "nido", "bob", "", ">>>edge"].concat(
      Array.from({ length: 300 }, (_, i) => "seed" + i),
    );
    for (const seed of seeds) {
      const css = avatarBackground(seed);
      const hues = [...css.matchAll(/hsl\((\d+(?:\.\d+)?)\s/g)].map((m) =>
        Number(m[1]),
      );
      expect(hues.length).toBe(2);
      for (const h of hues) {
        expect(Number.isNaN(h)).toBe(false);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(360);
      }
    }
  });

  it("returns a radial-gradient string", () => {
    expect(avatarBackground("nido")).toMatch(/^radial-gradient\(/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/avatarStyle.test.ts`
Expected: FAIL — `Cannot find module './avatarStyle.js'` / `avatarBackground is not a function`.

- [ ] **Step 3: Implement `avatarStyle.ts`**

Create `src/lib/avatarStyle.ts` (the hue logic is lifted verbatim from `Avatar.astro`):

```ts
// FNV-1a 32-bit hash (matches Avatar.astro / the prototype's hashStr).
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// C-04: brand-adjacent hue anchors (coral / amber / honey / teal / indigo / plum)
// instead of the full wheel, with unsigned shifts to avoid the signed-shift NaN.
const ANCHORS = [14, 28, 40, 186, 250, 332];

/**
 * Deterministic identicon gradient for a seed (e.g. an address). Same seed →
 * same gradient. Returns a CSS `radial-gradient(...)` string usable as a
 * `background` value, in the Nido warm palette.
 */
export function avatarBackground(seed: string): string {
  const h = hashStr(seed);
  const j = ((h >>> 11) % 16) - 8;
  const hue1 = (ANCHORS[h % ANCHORS.length] + j + 360) % 360;
  const hue2 = (ANCHORS[(h >>> 5) % ANCHORS.length] - j + 360) % 360;
  return `radial-gradient(circle at 32% 28%, hsl(${hue1} 58% 60%), hsl(${hue2} 60% 42%))`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/avatarStyle.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Rewire `Avatar.astro` to use the helper**

In `src/components/Avatar.astro`, replace the frontmatter hue block. Remove the
local `hashStr` function, the `anchors`/`j`/`hue1`/`hue2` lines, and the
`background: radial-gradient(...)` style entry; import and call `avatarBackground`.

The frontmatter becomes:

```astro
---
// Deterministic identicon avatar — a hash→hsl radial gradient circle.
// Pure presentation; the same `seed` always yields the same colors.
import { avatarBackground } from "../lib/avatarStyle";

interface Props {
  /** Seed string (e.g. an address). Same seed → same gradient. Default "nido". */
  seed?: string;
  /** Diameter in px. Default 34. */
  size?: number;
  /** Optional class on the wrapper. */
  class?: string;
}

const { seed = "nido", size = 34, class: className } = Astro.props;

const style = [
  `width: ${size}px`,
  `height: ${size}px`,
  "border-radius: 50%",
  "flex: 0 0 auto",
  `background: ${avatarBackground(seed)}`,
  "box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.35)",
].join("; ");
---

<div class={className} style={style}></div>
```

- [ ] **Step 6: Verify build + tests**

Run: `npm run build`
Expected: `9 page(s) built`, no errors.

Run: `npm test`
Expected: `34 passed` (31 prior + 3 new).

- [ ] **Step 7: Commit**

```bash
git add src/lib/avatarStyle.ts src/lib/avatarStyle.test.ts src/components/Avatar.astro
git commit -m "refactor(frontend): extract avatarBackground into lib/avatarStyle.ts"
```

---

## Task 3: `lib/myNidoModel.ts` (pure state derivation, TDD)

**Files:**
- Create: `src/lib/myNidoModel.ts`
- Create: `src/lib/myNidoModel.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/myNidoModel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildMyNidoModel } from "./myNidoModel.js";

const nameOf = (names: Record<string, string>) => (id: string) =>
  names[id] ?? null;

describe("buildMyNidoModel", () => {
  it("is empty when there are no accounts and no pending", () => {
    const m = buildMyNidoModel([], [], () => null);
    expect(m.state).toBe("empty");
    expect(m.rows).toEqual([]);
  });

  it("is 'single' for exactly one active account", () => {
    const m = buildMyNidoModel(["CABC"], [], nameOf({ CABC: "alice" }));
    expect(m.state).toBe("single");
    expect(m.rows).toEqual([
      { contractId: "CABC", name: "alice", status: "active" },
    ]);
  });

  it("is 'multi' for two or more active accounts", () => {
    const m = buildMyNidoModel(["CABC", "CDEF"], [], () => null);
    expect(m.state).toBe("multi");
    expect(m.rows.map((r) => r.contractId)).toEqual(["CABC", "CDEF"]);
    expect(m.rows.every((r) => r.status === "active")).toBe(true);
  });

  it("lists active rows before pending rows and carries the resume key", () => {
    const m = buildMyNidoModel(
      ["CABC"],
      [{ contractId: "CPEND", secretKey: "S123" }],
      nameOf({ CABC: "alice" }),
    );
    expect(m.state).toBe("multi"); // 1 active + 1 pending = 2 rows
    expect(m.rows).toEqual([
      { contractId: "CABC", name: "alice", status: "active" },
      { contractId: "CPEND", name: null, status: "pending", resumeKey: "S123" },
    ]);
  });

  it("shows the create-card (empty) but still lists pending-only accounts", () => {
    const m = buildMyNidoModel(
      [],
      [{ contractId: "CPEND", secretKey: "S123" }],
      () => null,
    );
    expect(m.state).toBe("empty");
    expect(m.rows).toEqual([
      { contractId: "CPEND", name: null, status: "pending", resumeKey: "S123" },
    ]);
  });

  it("does not duplicate a pending account that is also active", () => {
    const m = buildMyNidoModel(
      ["CABC"],
      [{ contractId: "CABC", secretKey: "S123" }],
      () => null,
    );
    expect(m.rows).toEqual([
      { contractId: "CABC", name: null, status: "active" },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/myNidoModel.test.ts`
Expected: FAIL — `Cannot find module './myNidoModel.js'`.

- [ ] **Step 3: Implement `myNidoModel.ts`**

Create `src/lib/myNidoModel.ts`:

```ts
export type MyNidoRow = {
  contractId: string;
  name: string | null;
  status: "active" | "pending";
  /** present only for pending rows → resume at /new-account/?key=<resumeKey> */
  resumeKey?: string;
};

export type MyNidoModel = {
  state: "empty" | "single" | "multi";
  rows: MyNidoRow[];
};

export type PendingAccount = { contractId: string; secretKey: string };

/**
 * Derive the My Nido menu model from localStorage-backed account state.
 * Pure: no DOM, no network. `state` reflects the ACTIVE count only
 * (empty / single / multi); pending accounts are appended as rows after the
 * active ones but do not change `state` away from `empty` when there are no
 * active accounts.
 */
export function buildMyNidoModel(
  accounts: string[],
  pending: PendingAccount[],
  nameOf: (id: string) => string | null,
): MyNidoModel {
  const activeRows: MyNidoRow[] = accounts.map((contractId) => ({
    contractId,
    name: nameOf(contractId),
    status: "active",
  }));

  const activeSet = new Set(accounts);
  const pendingRows: MyNidoRow[] = pending
    .filter((p) => !activeSet.has(p.contractId))
    .map((p) => ({
      contractId: p.contractId,
      name: nameOf(p.contractId),
      status: "pending",
      resumeKey: p.secretKey,
    }));

  const activeCount = accounts.length;
  const state: MyNidoModel["state"] =
    activeCount === 0 ? "empty" : activeCount === 1 ? "single" : "multi";

  return { state, rows: [...activeRows, ...pendingRows] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/myNidoModel.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/myNidoModel.ts src/lib/myNidoModel.test.ts
git commit -m "feat(frontend): add buildMyNidoModel state derivation"
```

---

## Task 4: `lib/createNido.ts` (extract the reservation flow)

**Files:**
- Create: `src/lib/createNido.ts`

- [ ] **Step 1: Implement `createNido.ts`**

Create `src/lib/createNido.ts` (lifts the reservation half of `index.astro`'s
`createAccount`, minus the DOM/progress concerns — the caller handles UI):

```ts
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { Client } from "factory";
import { savePendingAccount, accountUrl, fetchRegistryAddress } from "@g2c/passkey-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";

/**
 * Reserve a new Nido: fund a fresh keypair via friendbot, derive its C-address
 * from the factory, persist it as pending, and return the URL of the
 * "Lock it to you" passkey step. The caller navigates to the returned URL.
 * Throws on funding / factory / registry failure.
 */
export async function createNido(host: string): Promise<string> {
  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();
  const secret = keypair.secret();

  const res = await fetch(`${FRIENDBOT_URL}?addr=${publicKey}`);
  if (!res.ok) throw new Error(`Funding failed: ${res.status}`);

  const client = new Client({
    contractId: await fetchRegistryAddress("factory"),
    networkPassphrase: Networks.TESTNET,
    rpcUrl: RPC_URL,
    publicKey,
  });

  const tx = await client.get_c_address({ funder: publicKey });
  const cAddress = tx.result;

  savePendingAccount(cAddress, secret);

  return accountUrl(host, cAddress, `/new-account/?key=${secret}`);
}
```

- [ ] **Step 2: Verify it type-checks via build**

(No standalone unit test — the function is entirely network/SDK orchestration; it is
covered by the Playwright create-path check in Task 7 and by the build's type check.)

Run: `npm run build`
Expected: `9 page(s) built`, no errors. (The module is not yet imported anywhere, but `astro check` in Task 7 will type-check it once `MyNidoMenu` imports it. To confirm now, run `npx tsc --noEmit src/lib/createNido.ts` is NOT reliable under Astro's setup — rely on the Task 5/7 build instead.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/createNido.ts
git commit -m "feat(frontend): add createNido reservation helper"
```

---

## Task 5: `components/MyNidoMenu.astro` (button + popover + controller)

**Files:**
- Create: `src/components/MyNidoMenu.astro`

- [ ] **Step 1: Create the component (markup + scoped styles + controller)**

Create `src/components/MyNidoMenu.astro`:

```astro
---
// Self-contained "My Nido" entry point: a nav trigger button + an anchored
// popover that adapts to account state (empty / single / multi, plus pending
// "finishing setup" rows). Drop <MyNidoMenu /> into the nav. The hero / CTA-band
// buttons open it by dispatching a `nido:open-menu` CustomEvent on window.
import Icon from "./Icon.astro";
import Nest from "./Nest.astro";
---

<div class="mynido" id="mynido">
  <button id="mynido-btn" class="mynido-btn" type="button" aria-haspopup="true" aria-expanded="false">
    My Nido <span class="mynido-caret"><Icon name="chevron-down" size={15} color="#fff" /></span>
  </button>
  <div id="mynido-panel" class="mynido-panel" role="menu" aria-hidden="true"></div>
</div>

<style>
  .mynido { position: relative; }
  .mynido-btn {
    display: inline-flex; align-items: center; gap: 7px;
    background: var(--acc-btn); color: #fff; font-family: var(--body);
    font-weight: 800; font-size: 13.5px; padding: 9px 16px; border: none;
    border-radius: var(--r-pill); cursor: pointer; box-shadow: var(--sh-acc);
    transition: box-shadow .3s, transform .12s;
  }
  .mynido-btn:active { transform: scale(.97); }
  .mynido-open .mynido-btn { box-shadow: 0 8px 26px rgba(207,74,30,.45); }
  .mynido-caret { display: inline-flex; transition: transform .42s cubic-bezier(.2,.9,.25,1.12); }
  .mynido-open .mynido-caret { transform: rotate(180deg); }

  .mynido-panel {
    position: absolute; top: calc(100% + 9px); right: 0; width: 300px; z-index: 90;
    background: var(--paper-2); border: 1px solid var(--line); border-radius: 20px;
    box-shadow: 0 28px 70px rgba(42,26,18,.20), 0 6px 16px rgba(42,26,18,.08);
    overflow: hidden; transform-origin: top right; display: none;
  }
  .mynido-panel::before {
    content: ""; position: absolute; top: -7px; right: 34px; width: 13px; height: 13px;
    background: #FFF1E8; border-left: 1px solid var(--line); border-top: 1px solid var(--line);
    transform: rotate(45deg);
  }
  .mynido-open .mynido-panel { display: block; }

  /* header */
  .mn-head { background: linear-gradient(135deg, #FFF1E8, var(--acc-soft)); padding: 15px 16px 13px; border-bottom: 1px solid var(--line-soft); }
  .mn-head .hl { font-family: var(--disp); font-weight: 800; font-size: 15px; }
  .mn-head .hs { font-size: 11px; color: var(--ink-soft); margin-top: 2px; }
  .mn-head .lockchip { float: right; background: var(--good-soft); color: var(--good); font-size: 9.5px; font-weight: 800; padding: 4px 9px; border-radius: var(--r-pill); }

  /* rows */
  .mn-body { padding: 7px; }
  .mn-row { display: flex; align-items: center; gap: 11px; padding: 10px; border-radius: 13px; cursor: pointer; text-decoration: none; color: var(--ink); }
  .mn-row:hover { background: var(--paper-3); }
  .mn-av { width: 36px; height: 36px; border-radius: 50%; flex: 0 0 auto; box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.4); position: relative; }
  .mn-av .st { position: absolute; right: -1px; bottom: -1px; width: 11px; height: 11px; border-radius: 50%; background: var(--good); border: 2px solid var(--paper-2); }
  .mn-main { flex: 1; min-width: 0; }
  .mn-name { font-weight: 800; font-size: 14px; }
  .mn-meta { font-size: 11px; color: var(--mut); font-family: var(--mono); }
  .mn-bal { text-align: right; font-weight: 800; font-size: 13px; white-space: nowrap; }
  .mn-bal small { color: var(--mut); font-weight: 700; font-size: 10px; }
  .mn-bal .skeleton { display: inline-block; width: 46px; height: 14px; vertical-align: middle; }
  .mn-chev { color: #c9b9a8; flex: 0 0 auto; }
  .mn-pending .mn-meta { color: var(--acc-ink); }

  .mn-div { height: 1px; background: var(--line-soft); margin: 5px 12px; }
  .mn-foot { display: flex; align-items: center; gap: 9px; padding: 11px 12px; cursor: pointer; color: var(--acc-ink); font-weight: 800; font-size: 12.5px; background: none; border: none; width: 100%; text-align: left; font-family: var(--body); }
  .mn-foot .pl { width: 24px; height: 24px; border-radius: 8px; background: var(--acc-soft); display: grid; place-items: center; }

  /* create-card (empty state) */
  .mn-create { padding: 20px 18px 18px; text-align: center; }
  .mn-create .t { font-family: var(--disp); font-weight: 800; font-size: 18px; margin-top: 12px; }
  .mn-create .s { font-size: 11.5px; color: var(--ink-soft); line-height: 1.45; margin: 7px 0 14px; }
  .mn-create .cbtn { width: 100%; }
  .mn-err { color: var(--danger); font-size: 12px; padding: 0 14px 12px; }

  /* motion — entrance only when motion is welcome */
  @media (prefers-reduced-motion: no-preference) {
    .mynido-open .mynido-panel { animation: mn-open .42s cubic-bezier(.2,.9,.25,1.12); }
    .mynido-open .mn-head,
    .mynido-open .mn-row,
    .mynido-open .mn-create,
    .mynido-open .mn-foot { animation: mn-rise .46s cubic-bezier(.2,.8,.25,1) both; }
    .mynido-open .mn-head { animation-delay: .06s; }
    .mynido-open .mn-row:nth-of-type(1) { animation-delay: .13s; }
    .mynido-open .mn-row:nth-of-type(2) { animation-delay: .20s; }
    .mynido-open .mn-row:nth-of-type(3) { animation-delay: .27s; }
    .mynido-open .mn-row:nth-of-type(n+4) { animation-delay: .30s; }
    .mynido-open .mn-foot { animation-delay: .35s; }
    .mn-av .st { animation: mn-pulse 2.4s ease-in-out infinite; }
  }
  @keyframes mn-open { from { opacity: 0; transform: scale(.94) translateY(-8px); } to { opacity: 1; transform: none; } }
  @keyframes mn-rise { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: none; } }
  @keyframes mn-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(14,154,168,.5); } 50% { box-shadow: 0 0 0 5px rgba(14,154,168,0); } }
</style>

<script>
  import {
    loadAccounts,
    loadPendingAccounts,
    loadAccountName,
    accountUrl,
    activateAccount,
  } from "@g2c/passkey-sdk";
  import { rpc, xdr } from "@stellar/stellar-sdk";
  import { buildMyNidoModel, type MyNidoRow } from "../lib/myNidoModel";
  import { fetchXlmBalance } from "../lib/balance";
  import { avatarBackground } from "../lib/avatarStyle";
  import { shortAddr } from "../lib/address";
  import { formatXlm } from "../lib/money";
  import { createNido } from "../lib/createNido";

  const RPC_URL = "https://soroban-testnet.stellar.org";

  const root = document.getElementById("mynido")!;
  const btn = document.getElementById("mynido-btn") as HTMLButtonElement;
  const panel = document.getElementById("mynido-panel")!;

  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

  function rowHtml(row: MyNidoRow): string {
    const av = `<span class="mn-av" style="background:${avatarBackground(row.contractId)}"><span class="st"></span></span>`;
    const title = esc(row.name ?? "Your Nido");
    if (row.status === "pending") {
      const href = accountUrl(window.location.host, row.contractId, `/new-account/?key=${row.resumeKey}`);
      return `<a class="mn-row mn-pending" role="menuitem" href="${href}">${av}
        <span class="mn-main"><span class="mn-name">${title}</span><span class="mn-meta">Finishing setup…</span></span>
        <span class="mn-chev">›</span></a>`;
    }
    const href = accountUrl(window.location.host, row.name ?? row.contractId, "/account/");
    return `<a class="mn-row" role="menuitem" href="${href}" data-balance-for="${row.contractId}">${av}
      <span class="mn-main"><span class="mn-name">${title}</span><span class="mn-meta">${esc(shortAddr(row.contractId, 6, 6))}</span></span>
      <span class="mn-bal"><span class="skeleton">&nbsp;</span></span>
      <span class="mn-chev">›</span></a>`;
  }

  function render() {
    const accounts = loadAccounts();
    const pending = loadPendingAccounts();
    const model = buildMyNidoModel(accounts, pending, loadAccountName);

    if (model.state === "empty") {
      const pendingRows = model.rows.map(rowHtml).join("");
      panel.innerHTML = `<div class="mn-create">
          <div style="display:grid;place-items:center;"><span id="mn-nest"></span></div>
          <div class="t">Create your Nido</div>
          <div class="s">A safe place for everything you own. Set up in seconds — just your face.</div>
          <button id="mn-create-btn" class="btn acc cbtn" type="button">Set up with your face</button>
        </div>
        ${pendingRows ? `<div class="mn-div"></div><div class="mn-body">${pendingRows}</div>` : ""}
        <div id="mn-err" class="mn-err" style="display:none"></div>`;
      // Render the Nest mark into the placeholder (mirror of Nest.astro's SVG).
      const nestHost = document.getElementById("mn-nest")!;
      nestHost.innerHTML = nestSvg(54);
      wireCreate();
      return;
    }

    const header =
      model.state === "single"
        ? `<div class="mn-head"><span class="lockchip">Only you</span><div class="hl">Welcome back</div><div class="hs">Your Nido is ready</div></div>`
        : `<div class="mn-head"><div class="hl">Your Nidos</div><div class="hs">${model.rows.length} on this device</div></div>`;

    panel.innerHTML = `${header}
      <div class="mn-body">
        ${model.rows.map(rowHtml).join("")}
        <div class="mn-div"></div>
        <button id="mn-create-btn" class="mn-foot" type="button"><span class="pl">+</span> Create another Nido</button>
      </div>
      <div id="mn-err" class="mn-err" style="display:none"></div>`;
    wireCreate();
    loadBalances();
  }

  // Minimal inline Nest mark (matches Nest.astro: dashed coral + honey rings, teal dot).
  function nestSvg(size: number): string {
    return `<svg width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="46" fill="none" stroke="var(--coral)" stroke-width="7" stroke-dasharray="14 9" stroke-linecap="round"/>
      <circle cx="60" cy="60" r="31" fill="none" stroke="var(--honey)" stroke-width="7" stroke-dasharray="11 8" stroke-linecap="round"/>
      <circle cx="60" cy="60" r="11" fill="var(--teal)"/></svg>`;
  }

  function wireCreate() {
    const cbtn = document.getElementById("mn-create-btn") as HTMLButtonElement | null;
    if (!cbtn) return;
    cbtn.addEventListener("click", async () => {
      const errEl = document.getElementById("mn-err")!;
      errEl.style.display = "none";
      cbtn.disabled = true;
      const label = cbtn.textContent;
      cbtn.textContent = "Reserving your Nido…";
      try {
        const url = await createNido(window.location.host);
        cbtn.textContent = "Taking you in…";
        window.location.href = url;
      } catch (err: any) {
        errEl.textContent = err?.message || String(err);
        errEl.style.display = "block";
        cbtn.disabled = false;
        cbtn.textContent = label;
      }
    });
  }

  async function loadBalances() {
    const rows = panel.querySelectorAll<HTMLElement>("[data-balance-for]");
    rows.forEach(async (rowEl) => {
      const id = rowEl.dataset.balanceFor!;
      const balEl = rowEl.querySelector(".mn-bal")!;
      try {
        const raw = await fetchXlmBalance(id, RPC_URL);
        balEl.innerHTML = `${formatXlm(raw)} <small>XLM</small>`;
      } catch {
        balEl.innerHTML = `<small>—</small>`;
      }
    });
  }

  // Promote any pending account that has since deployed, then re-render if needed.
  async function verifyPending() {
    const pending = loadPendingAccounts();
    if (pending.length === 0) return;
    const active = new Set(loadAccounts());
    let changed = false;
    const server = new rpc.Server(RPC_URL);
    for (const { contractId } of pending) {
      if (active.has(contractId)) continue;
      try {
        await server.getContractData(contractId, xdr.ScVal.scvLedgerKeyContractInstance());
        activateAccount(contractId);
        changed = true;
      } catch {
        /* not deployed yet */
      }
    }
    if (changed && root.classList.contains("mynido-open")) render();
  }

  function open() {
    render();
    root.classList.add("mynido-open");
    btn.setAttribute("aria-expanded", "true");
    panel.setAttribute("aria-hidden", "false");
  }
  function close() {
    root.classList.remove("mynido-open");
    btn.setAttribute("aria-expanded", "false");
    panel.setAttribute("aria-hidden", "true");
  }
  function toggle() {
    root.classList.contains("mynido-open") ? close() : open();
  }

  btn.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
  document.addEventListener("click", (e) => {
    if (root.classList.contains("mynido-open") && !root.contains(e.target as Node)) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  // Hero / CTA-band buttons open the same menu.
  window.addEventListener("nido:open-menu", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    open();
  });

  // Background: promote freshly-deployed pending accounts.
  void verifyPending();
</script>
```

- [ ] **Step 2: Confirm the `chevron-down` icon exists (or fall back)**

Run: `grep -n 'chevron-down\|chevron' src/components/Icon.astro`

If `chevron-down` is NOT a key in the icon map, replace `<Icon name="chevron-down" size={15} color="#fff" />`
in the component with a literal caret so the build never fails on a missing icon:

```astro
    My Nido <span class="mynido-caret" aria-hidden="true">▾</span>
```

(If the grep DID find `chevron-down`, leave the `<Icon>` as written.)

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: `9 page(s) built`, no errors. (The component isn't mounted yet; this confirms it compiles and all imports resolve — including `createNido`, exercising Task 4's types.)

- [ ] **Step 4: Commit**

```bash
git add src/components/MyNidoMenu.astro
git commit -m "feat(frontend): add self-contained MyNidoMenu component"
```

---

## Task 6: Restructure `index.astro` (mount the menu, remove the welcome-back swap)

**Files:**
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Mount `<MyNidoMenu />` in the nav and import it**

In the frontmatter imports of `src/pages/index.astro`, add:

```ts
import MyNidoMenu from "../components/MyNidoMenu.astro";
```

In the markup, replace the nav's GitHub-only link block so the nav holds the menu on
the right. Change the `<nav class="lp-nav">` so it contains the logo, the GitHub link,
and `<MyNidoMenu />`:

```astro
      <nav class="lp-nav">
        <Logo size={22} mark markSize={28} />
        <a
          class="lp-navlink"
          href="https://github.com/theahaco/g2c"
          target="_blank"
          rel="noopener"
          title="View on GitHub"
          style="margin-left: auto; display: inline-flex; align-items: center;"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>
        </a>
        <MyNidoMenu />
      </nav>
```

(The GitHub link's `margin-left: auto` pushes it + the menu to the right; the menu sits last.)

- [ ] **Step 2: Make the hero CTA state-neutral and event-driven**

Replace the hero CTA button (currently `id="create-btn"`, label "Create your Nido")
with a state-neutral "Get started" that opens the menu:

```astro
          <div class="lp-cta">
            <button id="get-started-hero" class="btn acc" style="width: auto; padding: 0 26px; height: 54px;">
              Get started <Icon name="arrow" size={18} color="#fff" />
            </button>
          </div>
```

Also delete the now-dead `<div id="progress-info" class="chip" style="display:none; margin-top: 16px;"></div>`
that followed the testnet line in the hero (the slimmed script no longer references it).

Replace the CTA-band button (currently `id="create-btn-band"`):

```astro
        <button id="get-started-band" class="btn acc" style="width: auto; padding: 0 28px; height: 54px; margin: 26px auto 0; position: relative;">
          Get started <Icon name="arrow" size={18} color="#fff" />
        </button>
```

- [ ] **Step 3: Delete the welcome-back markup**

Remove the entire `<!-- Your Nidos (active + freshly-created accounts) -->`
`<section id="accounts-section" ...>...</section>` block (the one containing
`#accounts-list` and `#create-another`). Also remove the leftover error-box if it is
only used by the deleted create flow — KEEP `#error-box` only if still referenced;
in this redesign the page no longer surfaces create errors (the menu owns them), so
also remove `<div id="error-box" class="alert danger" ...></div>`.

- [ ] **Step 4: Replace the page `<script>` with the slimmed version**

Replace the ENTIRE `<script> ... </script>` block at the bottom of `index.astro`
with the following (it keeps the name/dapp subdomain redirects verbatim, wires the
two "Get started" buttons to the `nido:open-menu` event, and drops all account-list /
create / welcome-back logic — that now lives in `MyNidoMenu`):

```astro
<script>
  import {
    isContractId,
    dappPathFromHostname,
    nameFromHostname,
    resolveNameCached,
    fetchRegistryAddress,
  } from "@g2c/passkey-sdk";

  const RPC_URL = "https://soroban-testnet.stellar.org";

  // --- Reserved dApp subdomain redirect ---
  const hostname = window.location.hostname;
  const dappPath = dappPathFromHostname(hostname);
  if (dappPath) {
    window.location.replace(dappPath);
  }

  // --- Name resolution redirect (if visiting via name subdomain) ---
  const detectedName = nameFromHostname(hostname);
  if (detectedName && !isContractId(detectedName)) {
    fetchRegistryAddress("name-registry")
      .then((nameRegistryId) =>
        resolveNameCached(
          RPC_URL,
          nameRegistryId,
          detectedName,
          "Test SDF Network ; September 2015",
        ),
      )
      .then((resolved) => {
        if (resolved) {
          window.location.replace("/account/");
        }
      })
      .catch(() => {
        // Name not found — continue showing the home page
      });
  }

  // --- "Get started" buttons open the My Nido menu ---
  function openMenu() {
    window.dispatchEvent(new CustomEvent("nido:open-menu"));
  }
  document.getElementById("get-started-hero")?.addEventListener("click", openMenu);
  document.getElementById("get-started-band")?.addEventListener("click", openMenu);
</script>
```

- [ ] **Step 5: Verify build + check + tests**

Run: `npm run build`
Expected: `9 page(s) built`, no errors.

Run: `npm run check 2>&1 | grep -E "error|warning" | grep -c "index.astro"`
Expected: `0` — the two old unused-import warnings (`stripSubdomain`, `contractIdFromHostname`) are gone because the slimmed script no longer imports them. (Total error count stays at the 2-error baseline, neither in `index.astro`.)

Run: `npm test`
Expected: `34 passed`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(frontend): info-only landing with My Nido menu; drop welcome-back swap"
```

---

## Task 7: Browser verification (Playwright) + final gates

**Files:** none (verification only)

- [ ] **Step 1: Build and start the preview server**

Run:
```bash
npm run build
npm run preview -- --host 0.0.0.0 --port 4321 > /tmp/nido-preview.log 2>&1 &
# wait until curl http://localhost:4321/ returns 200
```

- [ ] **Step 2: Verify the EMPTY state (no accounts)**

Drive with Playwright (`browser_navigate` to `http://localhost:4321/`, then `browser_evaluate`):
```js
() => {
  document.getElementById('mynido-btn').click();
  const p = document.getElementById('mynido-panel');
  return {
    open: document.getElementById('mynido').classList.contains('mynido-open'),
    hasCreateCard: !!p.querySelector('#mn-create-btn'),
    text: p.querySelector('.mn-create .t')?.textContent,
  };
}
```
Expected: `{ open: true, hasCreateCard: true, text: "Create your Nido" }`.

- [ ] **Step 3: Verify the SINGLE state**

```js
() => {
  localStorage.setItem('g2c:accounts', JSON.stringify(['CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC']));
  return localStorage.getItem('g2c:accounts');
}
```
Re-navigate to `http://localhost:4321/`, click the button, evaluate:
```js
() => {
  document.getElementById('mynido-btn').click();
  const p = document.getElementById('mynido-panel');
  return {
    header: p.querySelector('.mn-head .hl')?.textContent,
    rows: p.querySelectorAll('.mn-row').length,
    hasCreateAnother: /Create another/.test(p.querySelector('.mn-foot')?.textContent || ''),
  };
}
```
Expected: `{ header: "Welcome back", rows: 1, hasCreateAnother: true }`.

- [ ] **Step 4: Verify the MULTI state**

```js
() => {
  localStorage.setItem('g2c:accounts', JSON.stringify([
    'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH7',
  ]));
}
```
Re-navigate, click, evaluate header/rows. Expected: header `"Your Nidos"`, `rows: 2`.

- [ ] **Step 5: Verify outside-click + Escape close**

```js
() => {
  document.getElementById('mynido-btn').click();
  const openBefore = document.getElementById('mynido').classList.contains('mynido-open');
  document.body.click();
  const openAfterOutside = document.getElementById('mynido').classList.contains('mynido-open');
  document.getElementById('mynido-btn').click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  const openAfterEsc = document.getElementById('mynido').classList.contains('mynido-open');
  return { openBefore, openAfterOutside, openAfterEsc };
}
```
Expected: `{ openBefore: true, openAfterOutside: false, openAfterEsc: false }`.

- [ ] **Step 6: Clean up the browser + server**

Close the Playwright browser. Stop the preview server: `kill $(lsof -ti :4321)`.
Reset localStorage assumptions are per-test (fresh navigations), so no cleanup needed there.
Remove any stray screenshot artifacts before committing.

- [ ] **Step 7: Final gate**

Run: `npm run build` → `9 page(s) built`.
Run: `npm run check 2>&1 | tail -4` → confirm `2 errors` (baseline), `0` from the new files.
Run: `npm test` → `34 passed`.

- [ ] **Step 8: Commit any verification fixups (if needed) and finish**

If Steps 2–5 surfaced a bug, fix it in the relevant file, re-run the gate, and commit:
```bash
git add -A
git commit -m "fix(frontend): My Nido menu verification fixups"
```
If everything passed first time, there is nothing to commit in this task.

---

## Done criteria

- Landing shows the same info content for all visitors; no full-page welcome-back swap remains.
- The nav "My Nido" button opens the premium popover; "Get started" (hero + band) opens the same menu.
- Menu renders empty / single / multi correctly, lists pending "Finishing setup…" rows, fetches balances async with a skeleton, and respects `prefers-reduced-motion`.
- `buildMyNidoModel`, `avatarBackground` unit-tested (vitest **34 passed**).
- `npm run build` (9 pages) clean; `npm run check` at the 2-error baseline with no new diagnostics.
```
