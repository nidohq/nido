# Unified Transaction-Signing Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every primary-passkey authorization moment (name claim, transfer, session-key grant/revoke, explicit dApp approval) through one canonical `/sign/` page that shows a human-readable transaction summary, an expandable raw-details panel, runs the passkey ceremony, submits (via relayer for own actions; relayer-submit-then-return-hash for dApps), and shows progress to confirmation.

**Architecture:** A new `lib/signing/` module group defines a serializable `SignRequest` intent, per-kind operation builders, and a unified `runSign` lifecycle engine that generalizes today's `primaryPasskeySigner.signAndSubmit` and `walletSign.signTransactionXdr`. The `/sign/` Astro page becomes a thin shell over `runSign`. The name-claim, transfer, session-grant/revoke, and dApp paths become thin callers that build a `SignRequest` and navigate to `/sign/`; the inline claim ticker, the `#signing-mode` view, and the bespoke `/security/delegate/` shell are deleted.

**Tech Stack:** Astro 5, TypeScript (strict, validated by `astro check`), `@stellar/stellar-sdk` ^15.1.0, contract bindings (`@nidohq/smart-account`, `@nidohq/factory`, `@nidohq/spending-limit-policy`), `@nidohq/passkey-sdk` (relayer client + injectors), Vitest 4 + jsdom for unit tests.

## Global Constraints

Copied verbatim from the spec and verified against the code. Every task's requirements implicitly include this section.

- **Test command:** `cd packages/frontend && npx vitest run src/lib/<name>.test.ts` (single file); `npx vitest run -t "<substring>"` (single test); `npm test` == `vitest run` (full). Test env is `jsdom` (`vitest.config.ts`), include glob `src/**/*.test.ts`.
- **Test idiom:** pure logic only. Mock network with `vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status })))` + `afterEach(() => vi.restoreAllMocks())`. Inject fakes for storage/capabilities as params (the `lastUsed`/`passkeySupport` DI idiom); do **not** mock `navigator.credentials`. Use real strkey C-addresses: `C1 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"`, `C2 = "CCV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XMCW"`.
- **Type checking:** `cd packages/frontend && npm run check` (astro check) must pass with no errors. The repo is TS-strict.
- **Build gate for `.astro` pages:** `cd packages/frontend && npm run build` must pass.
- **XSS:** every interpolated user/on-chain/third-party field in an HTML string MUST be `esc()`-escaped (from `../html.js`). All review renderers already do this; new ones must too.
- **Auth-digest invariants (do not break):** `expirationOffset` MUST be passed identically to `buildAuthHash` AND `injectPasskeySignature`/`injectSignedAuthPayload` — `RELAYER_EXPIRATION_OFFSET = 120` in relayer mode, `undefined` otherwise. `contextRuleIds = [0]` MUST match between `computeAuthDigest` and the injector. Relayer mode SKIPS the enforce re-sim/footprint refit (the Channels plugin does it server-side); classic mode DOES it.
- **`relayerEnabled()`** = `RELAYER_URL.length > 0` (`RELAYER_URL` = `PUBLIC_RELAYER_URL`, trailing slashes stripped). `RELAYER_SIM_SOURCE` = `PUBLIC_RELAYER_SIM_SOURCE` (required when relayer enabled).
- **Serialization:** `SignRequest` is JSON-serialized into `sessionStorage`; all `bigint` fields are carried as decimal **strings** (`amountRaw`, `limit.stroops`) and parsed back with `BigInt(...)`. Use `crypto.randomUUID()` for request ids (app code; allowed).
- **Out of scope (do NOT touch):** in-page session-key signing in the example dApp (`examples/status-message-dapp/src/lib/nidoSign.ts`); the new-name passkey *registration* step after a claim (WebAuthn registration on the name's subdomain, `?namepasskey=1`); the relayer/factory/contract code.
- **dApp submitted-marker contract:** for `submitMode: "return-to-dapp"`, Nido submits via the relayer and returns `?nido_submitted=<hash>&kind=tx` to the dApp (NOT `?nido_signed=`). The dApp must treat this as already-submitted and NOT re-broadcast. The wallet-kit module surfaces this as a resolved hash.

---

## File Structure

**New files**
- `packages/frontend/src/lib/signing/signRequest.ts` — `SignRequest` + `OperationDescriptor` types; `stashSignRequest`/`loadSignRequest` (sessionStorage); `signRequestFromParams` (legacy `?kind=tx&xdr=...` → `SignRequest`).
- `packages/frontend/src/lib/signing/signRequest.test.ts`
- `packages/frontend/src/lib/signing/operationBuilders.ts` — `buildOperation(descriptor, ctx)` → an `xdr.Operation` for descriptor kinds `register`/`transfer`/`add-context-rule`/`remove-context-rule`.
- `packages/frontend/src/lib/signing/operationBuilders.test.ts`
- `packages/frontend/src/lib/signing/submit.ts` — `relayerSubmitAndConfirm(signedTx, { onPoll })` and `classicSubmitAndPoll(...)` extracted from `signAndSubmit`; pure-ish, fetch/server mockable.
- `packages/frontend/src/lib/signing/submit.test.ts`
- `packages/frontend/src/lib/signing/runSign.ts` — `runSign(req, hooks)` lifecycle engine.
- `packages/frontend/src/lib/transfer/techDetails.ts` — `renderTechDetails(txXdr, summary, authHashHex)` shared "Show technical details" expander HTML.
- `packages/frontend/src/lib/transfer/techDetails.test.ts`
- `packages/frontend/src/lib/transfer/sessionGrantReview.ts` — `renderSessionGrant(op, scope)` + the `SessionGrantScope` type (lives next to `review.ts`).
- `packages/frontend/src/lib/transfer/sessionGrantReview.test.ts`

**Modified files**
- `packages/frontend/src/lib/transfer/txSummary.ts` — recognize `add_context_rule`/`remove_context_rule` → new `OpSummary` variants.
- `packages/frontend/src/lib/transfer/review.ts` — `renderGenericOp` handles the new kinds; re-export `renderSessionGrant`.
- `packages/frontend/src/lib/primaryPasskeySigner.ts` — thread an optional `onProgress` hook through `signAndSubmit`; export the auth-hash hex it computed (for the tech panel).
- `packages/frontend/src/pages/sign/index.astro` — consume `SignRequest`; render via review layer + tech panel + editable slot; drive `runSign`; own progress + submit modes + return.
- `packages/frontend/src/pages/account/index.astro` — claim becomes a `SignRequest` caller; delete inline `runNameClaim` ceremony/submit, `#claim-progress` as the claim UI, `#signing-mode` + its bespoke renderers.
- `packages/frontend/src/pages/transfer/index.astro` — build the transfer operation, hand to `/sign/`.
- `packages/frontend/src/pages/security/delegate/index.astro` — build a `session-grant` `SignRequest` with an editable spending-limit control; delete the bespoke build/submit.
- `packages/frontend/src/lib/sessionKeyActions.ts` — `revokeSessionKey` builds a `session-revoke` `SignRequest` (or keeps `signAndSubmit` if revoke stays inline — see Task 18).
- `packages/stellar-wallets-kit-module/src/module.ts` — `signTransaction` resolves the dApp result from `?nido_submitted=` (hash) in addition to `?nido_signed=`.

---

## Phase 0 — Foundation libraries (no UI behavior change)

Pure modules, fully unit-tested. Old surfaces keep working untouched until Phase 2+.

### Task 1: `SignRequest` types + sessionStorage store

**Files:**
- Create: `packages/frontend/src/lib/signing/signRequest.ts`
- Test: `packages/frontend/src/lib/signing/signRequest.test.ts`

**Interfaces:**
- Produces:
  - `type OperationDescriptor = | { type: "register"; name: string } | { type: "transfer"; token: string; to: string; amountRaw: string; decimals?: number; code?: string } | { type: "add-context-rule"; target: string; signerPublicKeyHex: string; verifierAddress: string; validUntil: number | null; limit?: { stroops: string; periodLedgers: number } | null; label?: string } | { type: "remove-context-rule"; ruleId: number; target: string } | { type: "raw-xdr"; xdr: string }`
  - `type SignKind = "name-claim" | "transfer" | "session-grant" | "session-revoke" | "dapp-tx" | "generic"`
  - `type SubmitMode = "relayer" | "return-to-dapp"`
  - `type EditableControl = { field: "spending-limit"; initialStroops: string | null; initialPeriod: "day" | "week" | "30d" }`
  - `type ReturnTarget = { type: "route"; url: string } | { type: "dapp"; origin: string; returnUrl?: string }`
  - `interface SignRequest { v: 1; kind: SignKind; account: string; operation: OperationDescriptor; title: string; subtitle?: string; submitMode: SubmitMode; editable?: EditableControl[]; returnTarget: ReturnTarget; networkPassphrase?: string }`
  - `function stashSignRequest(req: SignRequest, store?: Storage): string` — returns an id; writes `JSON.stringify(req)` to `nido:signreq:<id>`.
  - `function loadSignRequest(id: string, store?: Storage): SignRequest | null` — parse + validate `v === 1`; returns null on missing/malformed.

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/src/lib/signing/signRequest.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { stashSignRequest, loadSignRequest, type SignRequest } from "./signRequest";

const C1 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

function fakeStore(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as Storage;
}

const sample: SignRequest = {
  v: 1, kind: "name-claim", account: C1,
  operation: { type: "register", name: "alice" },
  title: "Claim alice", submitMode: "relayer",
  returnTarget: { type: "route", url: "https://alice.nido.fyi/account/?namepasskey=1" },
};

describe("stash/load SignRequest", () => {
  let store: Storage;
  beforeEach(() => { store = fakeStore(); });

  it("round-trips a request through the store", () => {
    const id = stashSignRequest(sample, store);
    expect(typeof id).toBe("string");
    expect(loadSignRequest(id, store)).toEqual(sample);
  });
  it("returns null for an unknown id", () => {
    expect(loadSignRequest("nope", store)).toBeNull();
  });
  it("returns null for a wrong-version blob", () => {
    store.setItem("nido:signreq:x", JSON.stringify({ v: 2 }));
    expect(loadSignRequest("x", store)).toBeNull();
  });
  it("returns null for malformed json", () => {
    store.setItem("nido:signreq:y", "{not json");
    expect(loadSignRequest("y", store)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/signing/signRequest.test.ts`
Expected: FAIL — `Cannot find module './signRequest'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/frontend/src/lib/signing/signRequest.ts
export type OperationDescriptor =
  | { type: "register"; name: string }
  | { type: "transfer"; token: string; to: string; amountRaw: string; decimals?: number; code?: string }
  | {
      type: "add-context-rule";
      target: string;
      signerPublicKeyHex: string;
      verifierAddress: string;
      validUntil: number | null;
      limit?: { stroops: string; periodLedgers: number } | null;
      label?: string;
    }
  | { type: "remove-context-rule"; ruleId: number; target: string }
  | { type: "raw-xdr"; xdr: string };

export type SignKind =
  | "name-claim" | "transfer" | "session-grant" | "session-revoke" | "dapp-tx" | "generic";

export type SubmitMode = "relayer" | "return-to-dapp";

export type EditableControl = {
  field: "spending-limit";
  initialStroops: string | null;
  initialPeriod: "day" | "week" | "30d";
};

export type ReturnTarget =
  | { type: "route"; url: string }
  | { type: "dapp"; origin: string; returnUrl?: string };

export interface SignRequest {
  v: 1;
  kind: SignKind;
  account: string;
  operation: OperationDescriptor;
  title: string;
  subtitle?: string;
  submitMode: SubmitMode;
  editable?: EditableControl[];
  returnTarget: ReturnTarget;
  networkPassphrase?: string;
}

const KEY = (id: string) => `nido:signreq:${id}`;

export function stashSignRequest(req: SignRequest, store: Storage = sessionStorage): string {
  const id = crypto.randomUUID();
  store.setItem(KEY(id), JSON.stringify(req));
  return id;
}

export function loadSignRequest(id: string, store: Storage = sessionStorage): SignRequest | null {
  const raw = store.getItem(KEY(id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SignRequest;
    return parsed && parsed.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/signing/signRequest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/signing/signRequest.ts packages/frontend/src/lib/signing/signRequest.test.ts
git commit -m "feat(signing): SignRequest type + sessionStorage store"
```

---

### Task 2: Legacy param → `SignRequest` normalization

Preserves the existing wallet-kit `/sign/?kind=tx&xdr=&dapp=&return=&network=` entry by mapping it onto a `SignRequest`. The account is derived from the hostname by the caller and passed in.

**Files:**
- Modify: `packages/frontend/src/lib/signing/signRequest.ts`
- Test: `packages/frontend/src/lib/signing/signRequest.test.ts`

**Interfaces:**
- Consumes: `SignRequest`, `OperationDescriptor` (Task 1).
- Produces: `function signRequestFromParams(params: URLSearchParams, account: string | null): SignRequest | null` — returns a `dapp-tx` request for `kind=tx` with an `xdr` + `dapp`; returns null for unsupported/missing inputs (caller falls back to its own error path).

- [ ] **Step 1: Write the failing test** (append to `signRequest.test.ts`)

```ts
import { signRequestFromParams } from "./signRequest";

describe("signRequestFromParams (legacy dApp entry)", () => {
  const C1 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
  it("maps a kind=tx dApp request to a dapp-tx SignRequest", () => {
    const p = new URLSearchParams({
      kind: "tx", xdr: "AAAA==", dapp: "https://app.example",
      return: "https://app.example/cb", network: "Test SDF Network ; September 2015",
    });
    expect(signRequestFromParams(p, C1)).toEqual({
      v: 1, kind: "dapp-tx", account: C1,
      operation: { type: "raw-xdr", xdr: "AAAA==" },
      title: "Confirm it's you",
      subtitle: "https://app.example wants this account to sign a transaction.",
      submitMode: "return-to-dapp",
      returnTarget: { type: "dapp", origin: "https://app.example", returnUrl: "https://app.example/cb" },
      networkPassphrase: "Test SDF Network ; September 2015",
    });
  });
  it("returns null when xdr is missing", () => {
    expect(signRequestFromParams(new URLSearchParams({ kind: "tx", dapp: "https://x" }), C1)).toBeNull();
  });
  it("returns null when account is null", () => {
    expect(signRequestFromParams(new URLSearchParams({ kind: "tx", xdr: "AAAA==", dapp: "https://x" }), null)).toBeNull();
  });
  it("returns null for non-tx kinds (message/authEntry handled elsewhere)", () => {
    expect(signRequestFromParams(new URLSearchParams({ kind: "message", message: "hi", dapp: "https://x" }), C1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/signing/signRequest.test.ts`
Expected: FAIL — `signRequestFromParams is not a function`.

- [ ] **Step 3: Implement** (append to `signRequest.ts`)

```ts
export function signRequestFromParams(params: URLSearchParams, account: string | null): SignRequest | null {
  if (!account) return null;
  const kind = params.get("kind") ?? "tx";
  if (kind !== "tx") return null; // message/authEntry keep their own (non-submitting) path
  const xdr = params.get("xdr");
  const dapp = params.get("dapp");
  if (!xdr || !dapp) return null;
  const ret = params.get("return") ?? undefined;
  const network = params.get("network") ?? undefined;
  return {
    v: 1, kind: "dapp-tx", account,
    operation: { type: "raw-xdr", xdr },
    title: "Confirm it's you",
    subtitle: `${dapp} wants this account to sign a transaction.`,
    submitMode: "return-to-dapp",
    returnTarget: { type: "dapp", origin: dapp, returnUrl: ret },
    networkPassphrase: network,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/signing/signRequest.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/signing/signRequest.ts packages/frontend/src/lib/signing/signRequest.test.ts
git commit -m "feat(signing): normalize legacy dApp params into a SignRequest"
```

---

### Task 3: Recognize context-rule ops in `txSummary`

So the review layer can describe a `session-grant`/`session-revoke` like any other transaction.

**Files:**
- Modify: `packages/frontend/src/lib/transfer/txSummary.ts:8-19` (the `OpSummary` union) and `:21-72` (`describeInvokeContract`)
- Test: `packages/frontend/src/lib/transfer/txSummary.test.ts` (create if absent)

**Interfaces:**
- Produces: two new `OpSummary` variants — `{ kind: "session-grant"; contract: string; name: string; target: string; validUntil: number | null }` and `{ kind: "session-revoke"; contract: string; ruleId: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/src/lib/transfer/txSummary.test.ts
import { describe, it, expect } from "vitest";
import { describeHostFunction } from "./txSummary";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

function invoke(fn: string, args: xdr.ScVal[]): xdr.HostFunction {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(CONTRACT).toScAddress(),
      functionName: fn,
      args,
    }),
  );
}

describe("describeHostFunction — context rules", () => {
  it("summarizes remove_context_rule(id)", () => {
    const fn = invoke("remove_context_rule", [nativeToScVal(7, { type: "u32" })]);
    expect(describeHostFunction(fn)).toEqual({ kind: "session-revoke", contract: CONTRACT, ruleId: 7 });
  });
});
```

(The `add_context_rule` arg shape is a struct; assert it degrades to `session-grant` with `target`/`validUntil` read from the struct in Step 3. Add a second `it` once the struct field names are confirmed against the binding in `operationBuilders` — Task 4 builds the real op, so prefer asserting `add_context_rule` decode there with a round-trip. Keep this test focused on `remove_context_rule`, whose single `u32` arg is unambiguous.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/transfer/txSummary.test.ts`
Expected: FAIL — current code returns `{ kind: "invoke", ... }` for `remove_context_rule`.

- [ ] **Step 3: Implement**

Add to the `OpSummary` union (`txSummary.ts:8`):

```ts
  | { kind: "session-grant"; contract: string; name: string; target: string; validUntil: number | null }
  | { kind: "session-revoke"; contract: string; ruleId: number }
```

Inside `describeInvokeContract`, before the final `return { kind: "invoke", ... }`, within the `try`:

```ts
    // smart-account remove_context_rule(context_rule_id: u32)
    if (fn === "remove_context_rule" && args.length === 1) {
      const ruleId = scValToNative(args[0]) as number;
      if (typeof ruleId === "number") return { kind: "session-revoke", contract, ruleId };
    }

    // smart-account add_context_rule({ context_type, name, valid_until, signers, policies })
    if (fn === "add_context_rule" && args.length === 1) {
      const rule = scValToNative(args[0]) as {
        context_type?: { tag?: string; values?: unknown[] };
        name?: string;
        valid_until?: number | null;
      };
      const target =
        Array.isArray(rule.context_type?.values) && typeof rule.context_type!.values![0] === "string"
          ? (rule.context_type!.values![0] as string)
          : "";
      return {
        kind: "session-grant",
        contract,
        name: typeof rule.name === "string" ? rule.name : "session-key",
        target,
        validUntil: typeof rule.valid_until === "number" ? rule.valid_until : null,
      };
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/transfer/txSummary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/transfer/txSummary.ts packages/frontend/src/lib/transfer/txSummary.test.ts
git commit -m "feat(signing): describe add/remove_context_rule ops"
```

---

### Task 4: `renderSessionGrant` + `renderGenericOp` new kinds

**Files:**
- Create: `packages/frontend/src/lib/transfer/sessionGrantReview.ts`
- Test: `packages/frontend/src/lib/transfer/sessionGrantReview.test.ts`
- Modify: `packages/frontend/src/lib/transfer/review.ts:128-138` (`renderGenericOp`) to handle `session-grant`/`session-revoke`; re-export `renderSessionGrant`.

**Interfaces:**
- Consumes: `OpSummary` (Task 3), `esc`, `shortAddr`, `stroopsToXlm` (from `../money.js`), `PERIOD_LABEL` (from `../spendingLimitParams.js`).
- Produces: `interface SessionGrantScope { origin: string; limitStroops: string | null; period: "day" | "week" | "30d"; expiryLabel: string }` and `function renderSessionGrant(op: Extract<OpSummary, { kind: "session-grant" }>, scope: SessionGrantScope): string`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/src/lib/transfer/sessionGrantReview.test.ts
import { describe, it, expect } from "vitest";
import { renderSessionGrant, type SessionGrantScope } from "./sessionGrantReview";

const op = { kind: "session-grant" as const, contract: "CAAA…", name: "session-key", target: "CTARGET", validUntil: 123 };

describe("renderSessionGrant", () => {
  it("shows the app origin, cap, and expiry, escaping the origin", () => {
    const scope: SessionGrantScope = { origin: "https://app.example", limitStroops: "50000000", period: "day", expiryLabel: "7 days" };
    const html = renderSessionGrant(op, scope);
    expect(html).toContain("app.example");
    expect(html).toContain("5"); // 50000000 stroops = 5 XLM
    expect(html).toContain("per day");
    expect(html).toContain("7 days");
  });
  it("renders an unlimited cap when limitStroops is null", () => {
    const scope: SessionGrantScope = { origin: "https://x", limitStroops: null, period: "day", expiryLabel: "24 hours" };
    expect(renderSessionGrant(op, scope).toLowerCase()).toContain("any amount");
  });
  it("escapes a hostile origin", () => {
    const scope: SessionGrantScope = { origin: "https://x\"><img>", limitStroops: null, period: "day", expiryLabel: "x" };
    expect(renderSessionGrant(op, scope)).not.toContain("<img>");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/transfer/sessionGrantReview.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/frontend/src/lib/transfer/sessionGrantReview.ts
import { esc } from "../html.js";
import { shortAddr } from "../address.js";
import { stroopsToXlm } from "../money.js";
import { PERIOD_LABEL, type LimitPeriod } from "../spendingLimitParams.js";
import type { OpSummary } from "./txSummary.js";

export interface SessionGrantScope {
  origin: string;
  limitStroops: string | null;
  period: LimitPeriod;
  expiryLabel: string;
}

function row(label: string, valueHtml: string, first = false): string {
  const border = first ? "" : "border-top:1px solid var(--line-soft);";
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 0;${border}">
      <span class="mut" style="font-size:13px;font-weight:600;white-space:nowrap;">${label}</span>
      <span style="font-size:13.5px;font-weight:600;text-align:right;min-width:0;word-break:break-word;">${valueHtml}</span>
    </div>`;
}

export function renderSessionGrant(
  op: Extract<OpSummary, { kind: "session-grant" }>,
  scope: SessionGrantScope,
): string {
  const cap = scope.limitStroops == null
    ? `Any amount <span class="mut" style="font-weight:500;">(no cap)</span>`
    : `Up to ${esc(stroopsToXlm(BigInt(scope.limitStroops)))} XLM <span class="mut" style="font-weight:500;">${esc(PERIOD_LABEL[scope.period])}</span>`;
  return `<div class="card" style="padding:2px 16px;">
    ${row("Action", "Grant an app a session key", true)}
    ${row("App", `<span class="mono">${esc(scope.origin)}</span>`)}
    ${row("Can spend", cap)}
    ${row("Expires", esc(scope.expiryLabel))}
    ${row("On contract", `<span class="mono">${esc(shortAddr(op.target))}</span>`)}
  </div>`;
}
```

In `review.ts`, extend `renderGenericOp`'s ternary to add (before the `: op.kind === "other"` arm):

```ts
      op.kind === "session-grant"
        ? `Grants a session key to <code class="mono">${esc(op.target)}</code>`
        : op.kind === "session-revoke"
          ? `Revokes session-key rule #${op.ruleId}`
          :
```

and add `export { renderSessionGrant, type SessionGrantScope } from "./sessionGrantReview.js";` to `review.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/transfer/sessionGrantReview.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/transfer/sessionGrantReview.ts packages/frontend/src/lib/transfer/sessionGrantReview.test.ts packages/frontend/src/lib/transfer/review.ts
git commit -m "feat(signing): renderSessionGrant + generic op coverage for context rules"
```

---

### Task 5: Operation builders (descriptor → `xdr.Operation`)

Turns a `SignRequest.operation` into an op the lifecycle engine can sign. Reuses contract bindings + `extractXdrOperations` (`packages/passkey-sdk/src/assembledTx.ts:26`).

**Files:**
- Create: `packages/frontend/src/lib/signing/operationBuilders.ts`
- Test: `packages/frontend/src/lib/signing/operationBuilders.test.ts`

**Interfaces:**
- Consumes: `OperationDescriptor` (Task 1); bindings `add_context_rule`/`remove_context_rule` (`@nidohq/smart-account`), the name-registry `register` binding, the token `transfer` op the transfer page already builds, `spendingLimitParamsScVal` (`../spendingLimitParams.js`), `fetchRegistryAddress`.
- Produces: `async function buildOperation(d: Exclude<OperationDescriptor, { type: "raw-xdr" }>, account: string): Promise<xdr.Operation>`.

> **Note for the implementer:** the existing call sites are the source of truth for binding usage — copy the exact `register(...)` build from `account/index.astro` `runNameClaim` (`:1218-1341`), the `transfer` op from `transfer/index.astro`, and the `add_context_rule`/`remove_context_rule` build from `security/delegate/index.astro` (`:240-314`) and `sessionKeyActions.ts` (`:64-95`). `buildOperation` is a relocation of those builds behind one switch — no new on-chain behavior.

- [ ] **Step 1: Write the failing test** (round-trip: a built op decodes to the expected `OpSummary`)

```ts
// packages/frontend/src/lib/signing/operationBuilders.test.ts
import { describe, it, expect } from "vitest";
import { buildOperation } from "./operationBuilders";
import { describeOperation } from "../transfer/txSummary";

const C1 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

describe("buildOperation", () => {
  it("builds a register op that decodes to a name-register summary", async () => {
    const op = await buildOperation({ type: "register", name: "alice" }, C1);
    const summary = describeOperation(op);
    expect(summary).toMatchObject({ kind: "name-register", account: C1, name: "alice" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/signing/operationBuilders.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `buildOperation` as a switch over `d.type`, relocating the existing builds. For `register`, mirror `runNameClaim`'s registry-binding `register(account, name)` build and return the single `xdr.Operation` (via `extractXdrOperations(assembled)[0]`). For `transfer`, mirror the transfer page's `execute(token, "transfer", [from, to, amount])` build. For `add-context-rule`, mirror `delegate/index.astro:240-314` (`client.add_context_rule({ context_type: { tag: "CallContract", values: [target] }, name: d.label ?? "session-key", valid_until: d.validUntil ?? undefined, signers: [{ tag: "External", values: [d.verifierAddress, hex2buf(d.signerPublicKeyHex)] }], policies })`, where `policies` is built from `d.limit` via `spendingLimitParamsScVal(BigInt(d.limit.stroops), d.limit.periodLedgers)`), then `extractXdrOperations(assembled)[0]`. For `remove-context-rule`, mirror `sessionKeyActions.ts` `client.remove_context_rule({ context_rule_id: d.ruleId })`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/signing/operationBuilders.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/signing/operationBuilders.ts packages/frontend/src/lib/signing/operationBuilders.test.ts
git commit -m "feat(signing): buildOperation — descriptor to xdr.Operation"
```

---

### Task 6: Submit strategies extracted from `signAndSubmit`

Pull the relayer and classic submit-and-confirm tails out of `primaryPasskeySigner.signAndSubmit` so the lifecycle engine and the legacy signer share one tested implementation.

**Files:**
- Create: `packages/frontend/src/lib/signing/submit.ts`
- Test: `packages/frontend/src/lib/signing/submit.test.ts`
- Modify: `packages/frontend/src/lib/primaryPasskeySigner.ts:194-294` to call the extracted functions.

**Interfaces:**
- Produces:
  - `async function relayerSubmitAndConfirm(signedTx: Transaction, opts?: { onPoll?: (info: { status: RelayerStatus | null; attempt: number; maxAttempts: number }) => void }): Promise<{ hash: string }>` — `extractFuncAndAuth` → `submitSorobanTransaction` → `waitForConfirmation`; throws on missing id/hash (verbatim from `:194-219`).
  - `async function classicSubmitAndPoll(assembledTx: Transaction, submitter: Keypair, server: rpc.Server): Promise<rpc.Api.SendTransactionResponse>` — enforce re-sim + fee refit + sign + send + poll (verbatim from `:221-294`).
- Consumes: relayer client, `extractFuncAndAuth`, stellar-sdk `Transaction`/`rpc` (existing imports).

- [ ] **Step 1: Write the failing test** (relayer path, fetch mocked)

```ts
// packages/frontend/src/lib/signing/submit.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { relayerSubmitAndConfirm } from "./submit";
import { TransactionBuilder, Networks, Account, Operation, Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

afterEach(() => vi.restoreAllMocks());

// Minimal single-op invoke tx so extractFuncAndAuth() succeeds.
function fakeSignedTx() {
  const src = new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "1");
  const op = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({
      contractAddress: Address.fromString("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4").toScAddress(),
      functionName: "noop", args: [nativeToScVal(1, { type: "u32" })],
    })),
    auth: [],
  });
  return new TransactionBuilder(src, { fee: "100", networkPassphrase: Networks.TESTNET }).addOperation(op).setTimeout(0).build();
}

describe("relayerSubmitAndConfirm", () => {
  it("submits {func,auth} and resolves the confirmed hash", async () => {
    const calls: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u, init: any) => {
      calls.push(JSON.parse(init.body));
      const body = calls.length === 1
        ? { data: { transactionId: "tx1", hash: null, status: "submitted" } }
        : { data: { transactionId: "tx1", hash: "abc123", status: "confirmed" } };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const out = await relayerSubmitAndConfirm(fakeSignedTx());
    expect(out).toEqual({ hash: "abc123" });
    expect(calls[0]).toHaveProperty("func");
    expect(calls[0]).toHaveProperty("auth");
  });
});
```

> The relayer base URL must be set for this test. If `RELAYER_URL` is empty in the test env, pass an explicit `baseUrl` through `relayerSubmitAndConfirm` (add an optional `baseUrl` param defaulting to `RELAYER_URL`) so the test can supply `"https://relay.test"`. Confirm the `call()` POST shape (`{ data: { result } }` vs `{ data }`) against `packages/passkey-sdk/src/relayer.ts` and match the mock body accordingly.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/signing/submit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** by moving the verbatim bodies of `signAndSubmit:194-219` (relayer) and `:221-294` (classic) into `relayerSubmitAndConfirm`/`classicSubmitAndPoll`, then have `signAndSubmit` call them. Keep the existing `{ status: 'PENDING', hash, latestLedger: 0, latestLedgerCloseTime: 0 }` shape for `signAndSubmit`'s return by wrapping the relayer result.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/signing/submit.test.ts` then `npm run check`
Expected: PASS; type-check clean.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/signing/submit.ts packages/frontend/src/lib/signing/submit.test.ts packages/frontend/src/lib/primaryPasskeySigner.ts
git commit -m "refactor(signing): extract relayer/classic submit strategies"
```

---

### Task 7: `onProgress` hook + exported auth hash on `signAndSubmit`

So the canonical page can drive the progress ticker and show the auth digest in the tech panel without re-deriving it.

**Files:**
- Modify: `packages/frontend/src/lib/primaryPasskeySigner.ts:77-219`

**Interfaces:**
- Produces: `signAndSubmit(args: { account; operation; verifierAddress?; onProgress?: (p: { phase: "build" | "sign" | "submit" | "confirm"; detail?: string }) => void }): Promise<rpc.Api.SendTransactionResponse & { authHashHex: string }>`.

- [ ] **Step 1: Write the failing test** — assert the type by a compile-time usage in a `.test.ts` that imports `signAndSubmit` and calls `args.onProgress?.()` shape. (Runtime behavior needs a chain; cover via the route build gate instead.) Add a trivial unit asserting `signAndSubmit` is a function and accepts the new arg shape via a typed wrapper:

```ts
// packages/frontend/src/lib/primaryPasskeySigner.test.ts
import { describe, it, expect } from "vitest";
import { signAndSubmit } from "./primaryPasskeySigner";
describe("signAndSubmit surface", () => {
  it("is callable with onProgress in its args type", () => {
    const ref: Parameters<typeof signAndSubmit>[0] = {
      account: "C", operation: {}, onProgress: (p) => void p.phase,
    };
    expect(typeof signAndSubmit).toBe("function");
    expect(ref.onProgress).toBeTypeOf("function");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/primaryPasskeySigner.test.ts`
Expected: FAIL — `onProgress` not in args type (`npm run check` would also error).

- [ ] **Step 3: Implement** — add `onProgress?` to the args type; call `args.onProgress?.({ phase: "build" })` before sim, `{ phase: "sign" }` before `navigator.credentials.get`, `{ phase: "submit" }` before submit, `{ phase: "confirm" }` before `waitForConfirmation`; compute `authHashHex = buf2hex(challengeBytes)` and add it to both return objects.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/primaryPasskeySigner.test.ts` then `npm run check`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/primaryPasskeySigner.ts packages/frontend/src/lib/primaryPasskeySigner.test.ts
git commit -m "feat(signing): onProgress hook + exported auth hash on signAndSubmit"
```

---

### Task 8: Shared "technical details" expander

One implementation of the decoded-ops + raw-XDR + auth-hash + fee panel, replacing the two existing toggles.

**Files:**
- Create: `packages/frontend/src/lib/transfer/techDetails.ts`
- Test: `packages/frontend/src/lib/transfer/techDetails.test.ts`

**Interfaces:**
- Consumes: `TxSummary`/`describeTransaction` (`./txSummary.js`), `renderGenericOp` (`./review.js`), `esc`.
- Produces: `function renderTechDetails(input: { txXdr?: string; summary?: TxSummary; authHashHex?: string }): string` — an HTML string for the collapsible body (decoded op lines + raw XDR `<code>` + auth-hash row + fee). Best-effort: tolerates a missing `txXdr` (shows what it has).

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/src/lib/transfer/techDetails.test.ts
import { describe, it, expect } from "vitest";
import { renderTechDetails } from "./techDetails";

describe("renderTechDetails", () => {
  it("renders the auth hash and raw xdr when provided", () => {
    const html = renderTechDetails({ txXdr: "AAAA==", authHashHex: "deadbeef", summary: { fee: "100", ops: [{ kind: "other", type: "x" }] } });
    expect(html).toContain("deadbeef");
    expect(html).toContain("AAAA==");
  });
  it("escapes a hostile xdr blob", () => {
    expect(renderTechDetails({ txXdr: "<img>" })).not.toContain("<img>");
  });
  it("returns a non-empty string with no inputs", () => {
    expect(renderTechDetails({}).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/transfer/techDetails.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `renderTechDetails` assembling: a fee row (when `summary`), one `renderGenericOp(op)` per `summary.ops`, an "Auth hash" `<code>` row (when `authHashHex`), and a "Raw transaction" `<code class="mono" style="word-break:break-all">${esc(txXdr)}</code>` row (when `txXdr`). All interpolations `esc()`-escaped.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/transfer/techDetails.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/transfer/techDetails.ts packages/frontend/src/lib/transfer/techDetails.test.ts
git commit -m "feat(signing): shared technical-details expander"
```

---

### Task 9: `runSign` lifecycle engine

Single entry the `/sign/` page calls. Branches on `operation.type` (descriptor vs `raw-xdr`) and `submitMode`.

**Files:**
- Create: `packages/frontend/src/lib/signing/runSign.ts`
- Test: `packages/frontend/src/lib/signing/runSign.test.ts` (cover branch selection + the dApp return-shape; deep chains are covered by the build gate + manual verification)

**Interfaces:**
- Consumes: `SignRequest` (Task 1), `buildOperation` (Task 5), `signAndSubmit` (Task 7), `signTransactionXdr` (`../walletSign.js`), `relayerSubmitAndConfirm` (Task 6), `extractFuncAndAuth`, `TransactionBuilder`.
- Produces: `interface RunSignHooks { onProgress?: (p: { phase: string; detail?: string }) => void }` and `interface RunSignResult { hash: string }` and `async function runSign(req: SignRequest, hooks?: RunSignHooks): Promise<RunSignResult>`. For `submitMode: "return-to-dapp"` it still returns `{ hash }`; the page is responsible for `postResultToOpener("?nido_submitted=<hash>&kind=tx", ...)`.

**Behavior:**
- `operation.type !== "raw-xdr"` (own actions): `op = await buildOperation(operation, account)` → `res = await signAndSubmit({ account, operation: op, onProgress })` → `{ hash: res.hash }`. (signAndSubmit already handles relayer vs classic.)
- `operation.type === "raw-xdr"` (dApp): `signed = await signTransactionXdr({ account, txXdr, networkPassphrase, onStatus })` → since `submitMode === "return-to-dapp"` and Nido owns submission (model A), `tx = TransactionBuilder.fromXDR(signed, networkPassphrase)` → `{ hash } = await relayerSubmitAndConfirm(tx, { onPoll })`. Return `{ hash }`.

- [ ] **Step 1: Write the failing test** (mock the collaborators)

```ts
// packages/frontend/src/lib/signing/runSign.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../walletSign.js", () => ({ signTransactionXdr: vi.fn(async () => "SIGNEDXDR") }));
vi.mock("./submit", () => ({ relayerSubmitAndConfirm: vi.fn(async () => ({ hash: "dapphash" })) }));
vi.mock("../primaryPasskeySigner", () => ({ signAndSubmit: vi.fn(async () => ({ hash: "ownhash" })) }));
vi.mock("./operationBuilders", () => ({ buildOperation: vi.fn(async () => ({ __op: true })) }));
vi.mock("@stellar/stellar-sdk", async (orig) => {
  const real = await orig<any>();
  return { ...real, TransactionBuilder: { ...real.TransactionBuilder, fromXDR: () => ({ __tx: true }) } };
});

import { runSign } from "./runSign";
const C1 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

describe("runSign", () => {
  beforeEach(() => vi.clearAllMocks());
  it("own action: builds op, signs+submits, returns hash", async () => {
    const out = await runSign({
      v: 1, kind: "name-claim", account: C1,
      operation: { type: "register", name: "alice" },
      title: "t", submitMode: "relayer", returnTarget: { type: "route", url: "/x" },
    });
    expect(out).toEqual({ hash: "ownhash" });
  });
  it("dapp raw-xdr: signs then relayer-submits, returns hash", async () => {
    const out = await runSign({
      v: 1, kind: "dapp-tx", account: C1,
      operation: { type: "raw-xdr", xdr: "RAW" },
      title: "t", submitMode: "return-to-dapp",
      returnTarget: { type: "dapp", origin: "https://x" },
    });
    expect(out).toEqual({ hash: "dapphash" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/frontend && npx vitest run src/lib/signing/runSign.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** per the Behavior section.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/frontend && npx vitest run src/lib/signing/runSign.test.ts` then `npm run check`
Expected: PASS (2 tests); clean.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/signing/runSign.ts packages/frontend/src/lib/signing/runSign.test.ts
git commit -m "feat(signing): runSign lifecycle engine"
```

---

## Phase 1 — Canonical `/sign/` route consumes the engine

### Task 10: `/sign/` renders from a `SignRequest` (req store + legacy normalize)

Make `/sign/` resolve a `SignRequest` from `?req=<id>` (sessionStorage) OR normalize the legacy `?kind=tx&xdr=...` dApp params, then render identity + review (via `describeTransaction`/`renderTransferReview`/`renderNameRegister`/`renderSessionGrant`/`renderGenericOp`) + the `renderTechDetails` expander. Keep the existing `message`/`authEntry` kinds on their current path (untouched).

**Files:**
- Modify: `packages/frontend/src/pages/sign/index.astro` (script section, `:133-381`)

**Interfaces:**
- Consumes: `loadSignRequest`, `signRequestFromParams` (Tasks 1–2); `describeTransaction`, review renderers, `renderTechDetails`; `runSign` (Task 9); `postResultToOpener`; `withPasskeySheet`.

- [ ] **Step 1:** Add imports and resolve the request near the top of the `<script>`:

```ts
  import { loadSignRequest, signRequestFromParams, type SignRequest } from "../../lib/signing/signRequest";
  import { runSign } from "../../lib/signing/runSign";
  import { renderTechDetails } from "../../lib/transfer/techDetails.js";
  import { renderSessionGrant } from "../../lib/transfer/review.js";

  const account = contractIdFromHostname(window.location.hostname);
  const reqId = params.get("req");
  const req: SignRequest | null =
    (reqId ? loadSignRequest(reqId) : null) ?? signRequestFromParams(params, account);
```

- [ ] **Step 2:** When `req` is present, set `#dapp-origin`/`title`/`#kind-label` from `req.title`/`req.subtitle`, render the review for `req.operation` (decode `raw-xdr` via `describeTransaction`; for descriptor kinds, render directly from the descriptor — `register` → `renderNameRegister`, `transfer` → `renderTransferReview`, `add-context-rule` → `renderSessionGrant`), and wire `#toggle-raw` to `renderTechDetails(...)`. Preserve the existing `message`/`authEntry`/legacy behavior when `req` is null.

- [ ] **Step 3:** Verify the page builds and type-checks.

Run: `cd packages/frontend && npm run check && npm run build`
Expected: both pass.

- [ ] **Step 4:** Commit.

```bash
git add packages/frontend/src/pages/sign/index.astro
git commit -m "feat(sign): resolve and render from a SignRequest"
```

### Task 11: `/sign/` drives `runSign` + owns progress, submit, and return

**Files:**
- Modify: `packages/frontend/src/pages/sign/index.astro` (approve handler `:345-381`); add a progress ticker container (reuse the `.checkitem` markup + `mountSteps`).

- [ ] **Step 1:** Replace the `approve` handler's ceremony body: when `req` is set, `await runSign(req, { onProgress })` inside `withPasskeySheet`; drive a `mountSteps` ticker from `onProgress`. On success: if `req.returnTarget.type === "dapp"`, `postResultToOpener("?nido_submitted=" + hash + "&kind=tx", origin, returnUrl)`; if `route`, `window.location.href = req.returnTarget.url`. Keep the legacy `signTransactionXdr` → `?nido_signed=` path for `message`/`authEntry`/null-req.
- [ ] **Step 2:** Add error states (build/sign/submit/confirm failure) to `#error-box` with a retry that re-enables `approve` (except `RelayerError WAIT_TIMEOUT`, which must NOT re-enable — mirror the transfer page guard at `transfer/index.astro:646-657`).
- [ ] **Step 3:** `npm run check && npm run build`.
- [ ] **Step 4:** Commit `feat(sign): drive runSign with progress, submit modes, and return`.

### Task 12: wallet-kit module resolves the submitted hash

**Files:**
- Modify: `packages/stellar-wallets-kit-module/src/module.ts:168-183,244-258`

- [ ] **Step 1:** In `runSign`'s return parsing, accept `nido_submitted` (hash) in addition to `nido_signed`. `signTransaction` returns `{ signedTxXdr }` per SEP-43; for the submitted-marker case, return the hash in `signedTxXdr` and document that the tx is already on-chain (the dApp must read the result and NOT re-broadcast). Update the example dApp call site (`examples/status-message-dapp/src/components/StatusMessage.tsx`) to detect the submitted-marker and skip `signAndSend` for the smart-account branch.
- [ ] **Step 2:** Build the module + example dApp. Run: `cd packages/stellar-wallets-kit-module && npm run build` (or the workspace build).
- [ ] **Step 3:** Commit `feat(walletkit): resolve relayer-submitted hash for smart-account dApp txs`.

---

## Phase 2 — Migrate name-claim to `/sign/`

### Task 13: claim builds a `SignRequest` and navigates to `/sign/`

**Files:**
- Modify: `packages/frontend/src/pages/account/index.astro` (the `?claim=` auto-run block `:1343-1372`)

- [ ] **Step 1:** Replace the `?claim=` auto-run: instead of `runNameClaim(name)` inline, build `const req: SignRequest = { v: 1, kind: "name-claim", account, operation: { type: "register", name }, title: \`Claim ${name}\`, submitMode: "relayer", returnTarget: { type: "route", url: buildClaimReturnTarget(name) } }`, `const id = stashSignRequest(req)`, `window.location.href = \`/sign/?req=${id}\``. `buildClaimReturnTarget` returns the existing post-claim destination (`accountUrl(rootHost, name, "/account/?namepasskey=1")`).
- [ ] **Step 2:** Build + check. The `/sign/` page runs on the same account subdomain the `?claim=` block already redirected to, so `sessionStorage` is same-origin and `?req=` resolves.
- [ ] **Step 3:** Commit `feat(claim): route name-claim through the standard /sign/ surface`.

### Task 14: delete the inline claim ceremony/submit/ticker

**Files:**
- Modify: `packages/frontend/src/pages/account/index.astro`

- [ ] **Step 1:** Delete `runNameClaim` (`:1218-1341`), `finalizeClaim`/`finishClaim` (`:1376-1558`), the legacy `?nameresult=1` handler (`:1560-1573`), `signHash` (`:583-616`), the `#claim-progress` `<section>` (`:225-264`), and the `claimProgress()`/`showClaimProgressError()`/`RELAYER_EXPIRATION_OFFSET` helpers (`:420-449`) now unused. Keep `showClaimEntry`/`#claim-entry` and `buildClaimHandoffUrl` (the entry → account-subdomain hop is unchanged).
- [ ] **Step 2:** `npm run check && npm run build` — fix any now-dangling references.
- [ ] **Step 3:** Update/retarget `claimFlow.test.ts` if any helper signature changed (it should not — `claimFlow.ts` is untouched).
- [ ] **Step 4:** Commit `refactor(claim): delete inline ceremony/submit/ticker (now on /sign/)`.

### Task 15: delete `#signing-mode` and its bespoke renderers

**Files:**
- Modify: `packages/frontend/src/pages/account/index.astro`

- [ ] **Step 1:** Delete the `#signing-mode` `<div>` (`:49-106`), `initSigningMode` (`:844-1002`), `renderSignHashCard`/`renderStoredNameClaimDetails`/`renderClaimTxDetails` (`:782-842`), the `isSigningMode` entry detection (`:457-470`), the `describeSignRequest` import (`:403`), and the signing-mode branch of the init dispatch (`:1127-1142`) + the signing-mode-only name→contract-id redirect (`:505-528`). The init dispatch becomes `initHomeMode()` unconditionally (after the claim-entry/redirect checks).
- [ ] **Step 2:** Remove `signRequestSummary.ts` only if no other importer remains (grep first: `grep -rn "describeSignRequest\|signRequestSummary" packages/frontend/src`). If unused, delete it and its test.
- [ ] **Step 3:** `npm run check && npm run build`.
- [ ] **Step 4:** Commit `refactor(account): delete #signing-mode (superseded by /sign/)`.

---

## Phase 3 — Migrate transfer to `/sign/`

### Task 16: transfer hands its operation to `/sign/`

**Files:**
- Modify: `packages/frontend/src/pages/transfer/index.astro` (`onConfirm` `:625-668`)

- [ ] **Step 1:** Replace `onConfirm`'s `signAndSubmit({ account, operation: pending.operation })` with a `SignRequest{ kind: "transfer", operation: { type: "transfer", token, to, amountRaw: amount.toString(), decimals, code }, submitMode: "relayer", returnTarget: { type: "route", url: "/account/" } }`, stash it, and navigate to `/sign/?req=<id>`. The result/explorer step now lives on `/sign/`. Delete the transfer page's own review-status submit UI (`:71-99` result-step) or repoint it to a simple "opening signer…" line.
- [ ] **Step 2:** `npm run check && npm run build`.
- [ ] **Step 3:** Commit `feat(transfer): route transfer approval through /sign/`.

---

## Phase 4 — Migrate session grant + revoke to `/sign/`

### Task 17: grant becomes a caller with an editable spending-limit control

**Files:**
- Modify: `packages/frontend/src/pages/security/delegate/index.astro`; `packages/frontend/src/pages/sign/index.astro` (editable slot)

- [ ] **Step 1:** Add the editable spending-limit control to `/sign/`: when `req.editable` contains `{ field: "spending-limit" }`, render the limit-amount/limit-period/limit-none controls (move the markup from `delegate/index.astro:63-85` and the wiring from `:158-199`) above the approve button; on change, update the in-memory `req.operation.limit` and re-render `renderSessionGrant` + tech panel. The op is rebuilt by `buildOperation` at `runSign` time from the edited descriptor, so no live re-simulation is needed before approval.
- [ ] **Step 2:** Replace `delegate/index.astro`'s approve handler (`:240-314`): build `SignRequest{ kind: "session-grant", account, operation: { type: "add-context-rule", target, signerPublicKeyHex, verifierAddress, validUntil, limit, label }, title: "Grant a session key", submitMode: "relayer", editable: [{ field: "spending-limit", initialStroops, initialPeriod }], returnTarget: { type: "dapp", origin, returnUrl: backToDapp } }`, stash, navigate to `/sign/?req=<id>`. Keep the request-reading/param-validation (`:119-152`, `:201-238`).
- [ ] **Step 2a:** For `returnTarget.type === "dapp"` on a `session-grant` (not a tx), the page returns `?delegation=ok` (the existing contract) instead of `?nido_submitted=`. Add a `returnTarget` discriminator for this, or carry an explicit `successQuery` on the dapp ReturnTarget. Implement whichever keeps `delegationHandover.readDelegationReturn` working unchanged.
- [ ] **Step 3:** `npm run check && npm run build`.
- [ ] **Step 4:** Commit `feat(grant): render delegation grant as a standard signed tx on /sign/`.

### Task 18: revoke becomes a caller

**Files:**
- Modify: `packages/frontend/src/lib/sessionKeyActions.ts` (`revokeSessionKey` `:64-95`) and its callers (`SessionKeyCard.ts`)

- [ ] **Step 1:** `revokeSessionKey` builds a `SignRequest{ kind: "session-revoke", operation: { type: "remove-context-rule", ruleId, target }, submitMode: "relayer", returnTarget: { type: "route", url: "/security/" } }`, stash, navigate to `/sign/?req=<id>`. Preserve the local-material cleanup by doing it on the `/security/` page after a successful return (carry `?revoked=<ruleId>` in the return URL), OR keep `revokeSessionKey` inline via `signAndSubmit` if a redirect harms the revoke UX — decide based on whether revoke needs the standard review surface (the spec lists revoke as in-scope, so prefer the surface).
- [ ] **Step 2:** `npm run check && npm run build`.
- [ ] **Step 3:** Commit `feat(revoke): route session-key revoke through /sign/`.

---

## Phase 5 — Cleanup

### Task 19: delete dead code + final sweep

**Files:** `packages/frontend/src/**`

- [ ] **Step 1:** Grep for now-unused exports and delete them: `grep -rn "renderStoredNameClaimDetails\|renderClaimTxDetails\|initSigningMode\|RELAYER_EXPIRATION_OFFSET" packages/frontend/src` (should be empty). Delete `signRequestSummary.ts`/`.test.ts` if confirmed unused (Task 15 Step 2).
- [ ] **Step 2:** Confirm the two old "show details" toggles are gone (the `/sign/` `#toggle-raw` now uses `renderTechDetails`; the deleted `#signing-mode` had the other).
- [ ] **Step 3:** Full gate: `cd packages/frontend && npm test && npm run check && npm run build`.
- [ ] **Step 4:** Commit `chore(signing): remove dead signing surfaces`.

---

## Self-Review

**Spec coverage**
- §1 one canonical page → Tasks 10–11. ✅
- §2 `SignRequest` carries high-level op → Tasks 1, 5. ✅
- §2 review layer extends `review.ts`/`txSummary.ts` → Tasks 3, 4, 8. ✅
- §2 lifecycle engine generalizes `signAndSubmit` → Tasks 6, 7, 9. ✅
- §3 `/sign/` steps (resolve, rpId guard, build+sim, review, editable, ceremony, submit, return) → Tasks 10–11, 17 (editable). rpID guard: the claim/transfer/grant callers already run on the account subdomain (Tasks 13/16/17), so `/sign/` inherits the correct origin; the legacy dApp entry was already bound by `contractIdFromHostname`. ✅
- §4 consumers as thin callers (claim/transfer/grant/revoke/dApp) → Tasks 12–18. ✅
- §5 out of scope (session-key in-page signing, new-name passkey reg) → untouched (Global Constraints). ✅
- §6 deletions (`#signing-mode`, inline ticker, `/security/delegate/` shell, two toggles) → Tasks 14, 15, 17, 19. ✅
- §7 error handling + tests → Task 11 Step 2; unit tests in Tasks 1–9. ✅
- §8 risks (cross-subdomain handoff, pre-sim latency, submitted-marker) → handled: same-origin `sessionStorage` (Tasks 13/16/17 run on the account subdomain), skeleton during build (Task 11), submitted-marker (Task 12 + Global Constraints). ✅

**Placeholder scan:** Migration tasks (13–19) reference exact source line ranges to delete and the exact new code to write; `.astro` UI wiring is gated by `npm run check && npm run build` rather than vitest (the codebase does not unit-test `.astro` pages — see `vitest.config.ts` include glob). The two judgment calls (Task 18 revoke redirect-vs-inline; Task 17 Step 2a dapp success query) are called out explicitly with the deciding criterion, not left vague.

**Type consistency:** `SignRequest`/`OperationDescriptor`/`SubmitMode`/`ReturnTarget`/`EditableControl` are defined once (Task 1) and consumed unchanged in Tasks 2, 5, 9, 10–18. `runSign(req, hooks): Promise<{ hash }>` (Task 9) matches its callers (Task 11). `signAndSubmit`'s new `onProgress`/`authHashHex` (Task 7) matches `runSign`'s usage (Task 9). `OpSummary` new variants (Task 3) match `renderSessionGrant`/`renderGenericOp` (Task 4) and `describeOperation` round-trip (Task 5).
