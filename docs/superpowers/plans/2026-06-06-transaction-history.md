# Transaction / Activity History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a g2c wallet user a readable history of their smart account's on-chain activity (payments + smart-account operations) as a "Recent activity" card on the account home and a dedicated paginated `/account/activity` page.

**Architecture:** Client-side only. A hybrid data layer fetches full history from the Stellar Expert `/tx` endpoint (primary) and falls back to Soroban RPC `getEvents` (recent window) when Expert is unavailable. Both feed a shared, pure classification layer that turns decoded Soroban contract events into normalized `ActivityItem` rows. Astro pages/components render the rows with the existing Nido design-system classes.

**Tech Stack:** Astro 5 + vanilla TypeScript, `@stellar/stellar-sdk` 15.1.0 (already bundled), Vitest. No new dependencies.

---

## Verified facts (do not re-derive — confirmed live during design)

- **Wallet account is a C-address (contract).** Classic Horizon account history does not apply.
- **Stellar Expert full history** (works on testnet + public from a browser origin; 402 to non-browser; rate-limited):
  `GET https://api.stellar.expert/explorer/testnet/tx?account[]={C-address}&order=desc&limit=25[&cursor={paging_token}]`
  → `{ _links: { next: { href } }, _embedded: { records: [ { id, hash, ledger, ts, protocol, body, meta, result, paging_token } ] } }`.
  `ts` is unix seconds. `body`/`meta` are base64 XDR. `_links.next.href` carries `cursor=<paging_token>` (absent at end).
- **Soroban RPC** (no gating; recent window ~24h, 7d max): `rpc.Server(RPC_URL).getEvents(...)`. `RPC_URL = https://soroban-testnet.stellar.org`, `Networks.TESTNET`.
- **Decoding (verified against real protocol-26 testnet bytes):**
  - `xdr.TransactionMeta.fromXDR(metaB64, "base64")`; `.switch()` is `3` (V3) or `4` (V4). **Protocol 23+ uses V4** — handle both:
    - V3: `meta.v3().sorobanMeta()?.events()` → `ContractEvent[]`.
    - V4: `meta.v4().operations().flatMap(op => op.events())` **and** `meta.v4().events().map(te => te.event())` → `ContractEvent[]`.
  - `ContractEvent`: `.contractId()` returns a **Buffer** (`StrKey.encodeContract(buf)` → C-address) or `null`; `.body().v0().topics()` → `ScVal[]`; `.body().v0().data()` → `ScVal`. Decode with `scValToNative`.
  - Envelope (best-effort top-level fn): `xdr.TransactionEnvelope.fromXDR(bodyB64,"base64")`; `env.v1().tx().operations()`; for `op.body().switch().name === "invokeHostFunction"` → `op.body().invokeHostFunctionOp().hostFunction()`; if `.switch().name === "hostFunctionTypeInvokeContract"` → `.invokeContract()` with `.functionName().toString()` and `Address.fromScAddress(.contractAddress()).toString()`.
- **Event topic[0] strings (verified from OZ stellar-accounts @ rev 637c53a8 and from real events):**
  - SAC payment: `transfer` — topics `["transfer", from, to, assetStr]`, data = i128 → **BigInt stroops**. `assetStr` is `"native"` for XLM, else `"CODE:ISSUER"`.
  - Smart-account: `signer_added`, `signer_removed`, `policy_added`, `policy_removed`, `context_rule_added`, `context_rule_removed`, `context_rule_updated` (also accept legacy `context_rule_meta_updated`), and registry `signer_registered`, `policy_registered`, `signer_deregistered`, `policy_deregistered`. All snake_case; topics `[name, id:u32]`.
- **Native SAC id (testnet):** `Asset.native().contractId(Networks.TESTNET)` = `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`. Derive at runtime; do not hardcode.
- A real `create_account` tx in the test fixture emits, in one tx: `signer_registered` + `context_rule_added` + `transfer` (funding). This is the canonical grouping test.
- **Existing helpers to reuse:** `lib/money.ts` (`stroopsToXlm`, `formatXlm`), `lib/address.ts` (`shortAddr`), `lib/balance.ts` (RPC pattern). Co-located `*.test.ts` is the repo's unit-test convention. Async UI uses the `MyNidoMenu.astro` skeleton→DOM pattern; runtime-injected rows need `is:global` styles.

**Test fixture already captured & on disk (uncommitted):**
`packages/frontend/src/lib/activity/__fixtures__/expert-tx-testnet.json` — 4 real testnet `/tx` records incl. the `create_account` record (index 2) with the transfer+rule+signer events, and a `_links.next.href` with a cursor. Commit it in Task 4.

Run all commands from `packages/frontend/` unless noted. Test runner: `npm test` (= `vitest run`) from `packages/frontend/`.

---

## Task 1: `lib/network.ts` — centralized network config

**Files:**
- Create: `packages/frontend/src/lib/network.ts`
- Test: `packages/frontend/src/lib/network.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/src/lib/network.test.ts
import { describe, it, expect } from "vitest";
import { Asset, Networks } from "@stellar/stellar-sdk";
import { RPC_URL, NETWORK_PASSPHRASE, NETWORK_NAME, EXPERT_API_BASE, EXPLORER_BASE, NATIVE_SAC_ID } from "./network.js";

describe("network config", () => {
  it("targets testnet", () => {
    expect(NETWORK_PASSPHRASE).toBe(Networks.TESTNET);
    expect(NETWORK_NAME).toBe("testnet");
    expect(RPC_URL).toBe("https://soroban-testnet.stellar.org");
    expect(EXPERT_API_BASE).toBe("https://api.stellar.expert/explorer/testnet");
    expect(EXPLORER_BASE).toBe("https://stellar.expert/explorer/testnet");
  });
  it("derives the native SAC id", () => {
    expect(NATIVE_SAC_ID).toBe(Asset.native().contractId(Networks.TESTNET));
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- network`
Expected: FAIL ("Cannot find module './network.js'").

- [ ] **Step 3: Implement**

```ts
// packages/frontend/src/lib/network.ts
import { Asset, Networks } from "@stellar/stellar-sdk";

/** Single source of truth for the network this build targets (currently testnet). */
export const NETWORK_NAME = "testnet" as const;
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = "https://soroban-testnet.stellar.org";

/** Stellar Expert JSON API + human explorer base, network-scoped. */
export const EXPERT_API_BASE = `https://api.stellar.expert/explorer/${NETWORK_NAME}`;
export const EXPLORER_BASE = `https://stellar.expert/explorer/${NETWORK_NAME}`;

/** Native-XLM Stellar Asset Contract id for this network. */
export const NATIVE_SAC_ID = Asset.native().contractId(NETWORK_PASSPHRASE);
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test -- network`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/network.ts packages/frontend/src/lib/network.test.ts
git commit -m "feat(frontend): add lib/network.ts central network config"
```

---

## Task 2: `lib/activity/types.ts` — shared types

**Files:**
- Create: `packages/frontend/src/lib/activity/types.ts`

No unit test (types only; consumers' tests exercise them).

- [ ] **Step 1: Create the file**

```ts
// packages/frontend/src/lib/activity/types.ts

/** Coarse bucket driving the row icon + grouping priority. */
export type ActivityKind =
  | "payment"   // SAC transfer in/out (never collapsed)
  | "recovery"  // social-recovery rule created/used
  | "rule"      // context_rule_added/removed/updated (non-recovery)
  | "signer"    // signer_added/removed
  | "policy"    // policy_added/removed
  | "registry"  // signer/policy registered/deregistered (low-signal bookkeeping)
  | "other";    // recognized invocation w/o a richer bucket, or generic fallback

/** A normalized, source-agnostic Soroban contract event. */
export interface DecodedEvent {
  contractId: string | null; // C-address of the emitting contract (StrKey)
  topics: unknown[];         // scValToNative'd; topics[0] is the event-name string
  data: unknown;             // scValToNative'd (e.g. BigInt stroops for transfer)
}

/** Output of decoding one Stellar Expert tx record (or one RPC tx group). */
export interface DecodedTx {
  txHash: string;
  ts: number;                 // unix seconds
  events: DecodedEvent[];
  invokedFn?: string;         // best-effort top-level invokeContract fn name
  invokedContract?: string;   // best-effort top-level target C-address
}

/** One rendered history row. */
export interface ActivityItem {
  // Stable key + cross-source dedup id.
  // Admin rows: `${txHash}`. Payment rows: `${txHash}:transfer:${i}`.
  id: string;
  txHash: string;
  timestamp: number;          // unix seconds
  kind: ActivityKind;
  direction?: "in" | "out";   // payments only
  title: string;              // "Received", "Sent", "Added a signer", ...
  subtitle?: string;          // counterparty (shortAddr) or detail
  amount?: string;            // display XLM string (payments)
  asset?: string;             // "XLM" or "CODE" (payments)
  counterparty?: string;      // full address (copy / title attr)
  explorerUrl: string;        // `${EXPLORER_BASE}/tx/${txHash}`
}

export interface ActivityPage {
  items: ActivityItem[];
  nextCursor: string | null;  // Expert paging_token; null when no more / on fallback
  source: "expert" | "rpc";
  partial: boolean;           // true on the RPC fallback (recent window only)
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/lib/activity/types.ts
git commit -m "feat(frontend): add activity history types"
```

---

## Task 3: `lib/activity/classify.ts` — pure classification + per-tx grouping

**Files:**
- Create: `packages/frontend/src/lib/activity/classify.ts`
- Test: `packages/frontend/src/lib/activity/classify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/src/lib/activity/classify.test.ts
import { describe, it, expect } from "vitest";
import { groupTxRows } from "./classify.js";
import type { DecodedTx } from "./types.js";

const SELF = "CCA2KXEUA4EQW3NL4QRCIZ2VRMA7V6A54DHXPA4RBTAGH72PCCYT5MSA";
const OTHER = "GCQZN6KXTEATCRNES3ZPTPZV4NNVK7CZKA6RHLMP2HPWP7SPDN7MFGBS";
const SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function tx(events: DecodedTx["events"], extra: Partial<DecodedTx> = {}): DecodedTx {
  return { txHash: "HASH", ts: 1780258391, events, ...extra };
}

describe("groupTxRows", () => {
  it("classifies an incoming transfer", () => {
    const rows = groupTxRows(
      tx([{ contractId: SAC, topics: ["transfer", OTHER, SELF, "native"], data: 99900000000n }]),
      SELF,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "HASH:transfer:0", kind: "payment", direction: "in",
      title: "Received", amount: "9990", asset: "XLM", counterparty: OTHER,
    });
    expect(rows[0].subtitle).toContain("GCQZ");
  });

  it("classifies an outgoing transfer", () => {
    const rows = groupTxRows(
      tx([{ contractId: SAC, topics: ["transfer", SELF, OTHER, "native"], data: 5000000n }]),
      SELF,
    );
    expect(rows[0]).toMatchObject({ kind: "payment", direction: "out", title: "Sent", amount: "0.5", asset: "XLM" });
  });

  it("collapses account-creation admin events into one row but keeps the funding payment", () => {
    const rows = groupTxRows(
      tx([
        { contractId: SELF, topics: ["signer_registered", 0], data: {} },
        { contractId: SELF, topics: ["context_rule_added", 0], data: { name: "default" } },
        { contractId: SAC, topics: ["transfer", OTHER, SELF, "native"], data: 99900000000n },
      ]),
      SELF,
    );
    // one payment row + one collapsed admin row (rule beats registry)
    expect(rows.map((r) => r.kind).sort()).toEqual(["payment", "rule"]);
    const admin = rows.find((r) => r.kind === "rule")!;
    expect(admin.id).toBe("HASH");
    expect(admin.title).toMatch(/rule|created/i);
  });

  it("maps signer + policy + recovery events by priority", () => {
    expect(groupTxRows(tx([{ contractId: SELF, topics: ["signer_added", 1], data: {} }]), SELF)[0].title).toBe("Added a signer");
    expect(groupTxRows(tx([{ contractId: SELF, topics: ["policy_removed", 1], data: {} }]), SELF)[0].title).toBe("Removed a policy");
    // recovery wins over the bundled signer/rule events
    const rec = groupTxRows(
      tx([
        { contractId: SELF, topics: ["context_rule_added", 2], data: { name: "recovery" } },
        { contractId: SELF, topics: ["signer_added", 2], data: {} },
      ], { invokedFn: "add_multisig_recovery" }),
      SELF,
    );
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ kind: "recovery", title: "Set up social recovery" });
  });

  it("falls back to the invoked fn, then to a generic row, never dropping a tx", () => {
    expect(groupTxRows(tx([], { invokedFn: "do_thing" }), SELF)[0]).toMatchObject({ kind: "other", title: "Called do_thing" });
    const generic = groupTxRows(tx([{ contractId: SELF, topics: ["mystery_event"], data: {} }]), SELF);
    expect(generic).toHaveLength(1);
    expect(generic[0].kind).toBe("other");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- classify`
Expected: FAIL ("Cannot find module './classify.js'").

- [ ] **Step 3: Implement**

```ts
// packages/frontend/src/lib/activity/classify.ts
import { stroopsToXlm, formatXlm } from "../money.js";
import { shortAddr } from "../address.js";
import { EXPLORER_BASE } from "../network.js";
import type { ActivityItem, ActivityKind, DecodedEvent, DecodedTx } from "./types.js";

const explorerUrl = (txHash: string) => `${EXPLORER_BASE}/tx/${txHash}`;
const eventName = (e: DecodedEvent): string =>
  Array.isArray(e.topics) && typeof e.topics[0] === "string" ? (e.topics[0] as string) : "";

/** Asset label from a transfer's topic[3] ("native" | "CODE:ISSUER" | undefined). */
function assetLabel(topic3: unknown): string {
  if (topic3 === "native" || topic3 == null) return "XLM";
  const s = String(topic3);
  return s.includes(":") ? s.split(":")[0] : s;
}

/** A single transfer event → a payment row. Returns null if it doesn't involve `self`. */
function paymentRow(e: DecodedEvent, idx: number, self: string, txHash: string, ts: number): ActivityItem | null {
  const [, from, to, asset] = e.topics as unknown[];
  const fromS = String(from), toS = String(to);
  const isOut = fromS === self, isIn = toS === self;
  if (!isOut && !isIn) return null;
  const counterparty = isOut ? toS : fromS;
  const amount = formatXlm(stroopsToXlm(e.data as bigint));
  return {
    id: `${txHash}:transfer:${idx}`,
    txHash, timestamp: ts, kind: "payment",
    direction: isOut ? "out" : "in",
    title: isOut ? "Sent" : "Received",
    subtitle: `${isOut ? "to" : "from"} ${shortAddr(counterparty, 4, 4)}`,
    amount, asset: assetLabel(asset), counterparty,
    explorerUrl: explorerUrl(txHash),
  };
}

/** Map a non-payment event name → {kind, title}. Unknown names → null. */
function adminMeta(name: string, isRecovery: boolean): { kind: ActivityKind; title: string } | null {
  if (isRecovery) return { kind: "recovery", title: "Set up social recovery" };
  switch (name) {
    case "context_rule_added": return { kind: "rule", title: "Created a rule" };
    case "context_rule_removed": return { kind: "rule", title: "Removed a rule" };
    case "context_rule_updated":
    case "context_rule_meta_updated": return { kind: "rule", title: "Updated a rule" };
    case "signer_added": return { kind: "signer", title: "Added a signer" };
    case "signer_removed": return { kind: "signer", title: "Removed a signer" };
    case "policy_added": return { kind: "policy", title: "Added a policy" };
    case "policy_removed": return { kind: "policy", title: "Removed a policy" };
    case "signer_registered": case "policy_registered":
    case "signer_deregistered": case "policy_deregistered":
      return { kind: "registry", title: "Updated account keys" };
    default: return null;
  }
}

// Higher number = higher priority when collapsing a tx's admin events into one row.
const PRIORITY: Record<ActivityKind, number> = {
  recovery: 5, rule: 4, signer: 3, policy: 2, registry: 1, other: 0, payment: 0,
};

/**
 * Turn one decoded transaction into display rows:
 *  - one row per `transfer` event that involves `self` (payments aren't collapsed);
 *  - all administrative events collapse into ONE representative row (highest priority);
 *  - a tx with no classifiable event → one row from the invoked fn, else a generic row.
 * Never returns an empty array (never drops a tx).
 */
export function groupTxRows(decoded: DecodedTx, self: string): ActivityItem[] {
  const { txHash, ts, events } = decoded;
  const rows: ActivityItem[] = [];

  events.forEach((e, i) => {
    if (eventName(e) === "transfer") {
      const r = paymentRow(e, i, self, txHash, ts);
      if (r) rows.push(r);
    }
  });

  // Recovery is signalled by the invoking fn (the bundled events look like a normal rule add).
  const isRecovery = decoded.invokedFn === "add_multisig_recovery";
  let best: { kind: ActivityKind; title: string } | null = null;
  for (const e of events) {
    const meta = adminMeta(eventName(e), isRecovery && eventName(e) === "context_rule_added");
    if (meta && (!best || PRIORITY[meta.kind] > PRIORITY[best.kind])) best = meta;
  }
  if (best) {
    rows.push({
      id: txHash, txHash, timestamp: ts, kind: best.kind, title: best.title,
      explorerUrl: explorerUrl(txHash),
    });
  }

  if (rows.length === 0) {
    rows.push({
      id: txHash, txHash, timestamp: ts, kind: "other",
      title: decoded.invokedFn ? `Called ${decoded.invokedFn}` : "Contract activity",
      explorerUrl: explorerUrl(txHash),
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test -- classify`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/activity/classify.ts packages/frontend/src/lib/activity/classify.test.ts
git commit -m "feat(frontend): classify decoded events into activity rows"
```

---

## Task 4: `lib/activity/decodeTx.ts` — decode Stellar Expert XDR records

**Files:**
- Create: `packages/frontend/src/lib/activity/decodeTx.ts`
- Test: `packages/frontend/src/lib/activity/decodeTx.test.ts`
- Commit fixture: `packages/frontend/src/lib/activity/__fixtures__/expert-tx-testnet.json` (already on disk)

- [ ] **Step 1: Write the failing test** (drives against the real captured fixture)

```ts
// packages/frontend/src/lib/activity/decodeTx.test.ts
import { describe, it, expect } from "vitest";
import { decodeExpertRecord } from "./decodeTx.js";
import fixture from "./__fixtures__/expert-tx-testnet.json" assert { type: "json" };

const records = (fixture as any)._embedded.records;
// Record index 2 is the create_account tx: signer_registered + context_rule_added + transfer.
const createAccount = records[2];

describe("decodeExpertRecord", () => {
  it("pulls txHash + ts straight from the record", () => {
    const d = decodeExpertRecord(createAccount);
    expect(d.txHash).toBe(createAccount.hash);
    expect(d.ts).toBe(createAccount.ts);
  });

  it("extracts the top-level invoked fn from the envelope", () => {
    expect(decodeExpertRecord(createAccount).invokedFn).toBe("create_account");
  });

  it("extracts V4 contract events incl. the funding transfer", () => {
    const names = decodeExpertRecord(createAccount).events.map((e) => e.topics[0]);
    expect(names).toContain("transfer");
    expect(names).toContain("context_rule_added");
    const transfer = decodeExpertRecord(createAccount).events.find((e) => e.topics[0] === "transfer")!;
    expect(typeof transfer.data).toBe("bigint");
    expect(transfer.topics[3]).toBe("native");
    expect(transfer.contractId).toBe("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
  });

  it("never throws on a record (returns events: [] on undecodable meta)", () => {
    expect(() => decodeExpertRecord({ hash: "x", ts: 1, body: "@bad@", meta: "@bad@" } as any)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- decodeTx`
Expected: FAIL ("Cannot find module './decodeTx.js'").

> If the JSON import errors, ensure `resolveJsonModule` is effectively on (Vitest/esbuild handles `assert { type: "json" }` by default in this repo; if not, `import fixture from "...json"` without the assertion also works).

- [ ] **Step 3: Implement** (decode code is verified against real protocol-26 bytes)

```ts
// packages/frontend/src/lib/activity/decodeTx.ts
import { xdr, scValToNative, Address, StrKey } from "@stellar/stellar-sdk";
import type { DecodedEvent, DecodedTx } from "./types.js";

interface ExpertRecord { hash: string; ts: number; body: string; meta: string; }

function decodeEvent(ev: xdr.ContractEvent): DecodedEvent {
  const cid = ev.contractId(); // Buffer (32 bytes) | null
  const contractId = cid ? StrKey.encodeContract(cid as unknown as Buffer) : null;
  const v0 = ev.body().v0();
  const topics = v0.topics().map((t) => {
    try { return scValToNative(t); } catch { return null; }
  });
  let data: unknown;
  try { data = scValToNative(v0.data()); } catch { data = null; }
  return { contractId, topics, data };
}

/** Collect every Soroban contract event from a TransactionMeta (V3 or V4). */
function metaEvents(metaB64: string): DecodedEvent[] {
  const meta = xdr.TransactionMeta.fromXDR(metaB64, "base64");
  const sw = meta.switch();
  const events: xdr.ContractEvent[] = [];
  if (sw === 3) {
    const sm = meta.v3().sorobanMeta();
    if (sm) events.push(...sm.events());
  } else if (sw === 4) {
    const v4 = meta.v4();
    for (const op of v4.operations()) events.push(...op.events());
    for (const te of v4.events()) events.push(te.event());
  }
  return events.map(decodeEvent);
}

/** Best-effort top-level invokeContract fn name + target from the envelope. */
function envelopeInvocation(bodyB64: string): { invokedFn?: string; invokedContract?: string } {
  try {
    const env = xdr.TransactionEnvelope.fromXDR(bodyB64, "base64");
    const name = env.switch().name;
    const tx =
      name === "envelopeTypeTx" ? env.v1().tx()
      : name === "envelopeTypeTxV0" ? env.v0().tx()
      : name === "envelopeTypeTxFeeBump" ? env.feeBump().tx().innerTx().v1().tx()
      : null;
    if (!tx) return {};
    for (const op of tx.operations()) {
      const b = op.body();
      if (b.switch().name !== "invokeHostFunction") continue;
      const hf = b.invokeHostFunctionOp().hostFunction();
      if (hf.switch().name !== "hostFunctionTypeInvokeContract") continue;
      const ic = hf.invokeContract();
      return {
        invokedFn: ic.functionName().toString(),
        invokedContract: Address.fromScAddress(ic.contractAddress()).toString(),
      };
    }
  } catch { /* fall through */ }
  return {};
}

/** Decode one Stellar Expert `/tx` record into a normalized DecodedTx. Never throws. */
export function decodeExpertRecord(rec: ExpertRecord): DecodedTx {
  let events: DecodedEvent[] = [];
  try { events = metaEvents(rec.meta); } catch { events = []; }
  return { txHash: rec.hash, ts: rec.ts, events, ...envelopeInvocation(rec.body) };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test -- decodeTx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit** (include the fixture)

```bash
git add packages/frontend/src/lib/activity/decodeTx.ts \
        packages/frontend/src/lib/activity/decodeTx.test.ts \
        packages/frontend/src/lib/activity/__fixtures__/expert-tx-testnet.json
git commit -m "feat(frontend): decode Stellar Expert tx XDR (V3/V4 events + envelope fn)"
```

---

## Task 5: `lib/activity/expertSource.ts` — Stellar Expert page fetch

**Files:**
- Create: `packages/frontend/src/lib/activity/expertSource.ts`
- Test: `packages/frontend/src/lib/activity/expertSource.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/src/lib/activity/expertSource.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchExpertPage, ExpertUnavailableError } from "./expertSource.js";
import fixture from "./__fixtures__/expert-tx-testnet.json" assert { type: "json" };

const ADDR = "CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S";
afterEach(() => vi.restoreAllMocks());

describe("fetchExpertPage", () => {
  it("maps records to rows and parses the next cursor", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200 }),
    );
    const page = await fetchExpertPage(ADDR, null);
    expect(page.source).toBe("expert");
    expect(page.partial).toBe(false);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.nextCursor).toBe("12235399753646080"); // from _links.next.href in the fixture
    expect(page.items.every((r) => r.explorerUrl.includes("/tx/"))).toBe(true);
  });

  it("throws ExpertUnavailableError on 402 (the fallback trigger)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 402 }));
    await expect(fetchExpertPage(ADDR, null)).rejects.toBeInstanceOf(ExpertUnavailableError);
  });

  it("throws ExpertUnavailableError on 429", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429 }));
    await expect(fetchExpertPage(ADDR, null)).rejects.toBeInstanceOf(ExpertUnavailableError);
  });

  it("sends the cursor when paginating", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }));
    await fetchExpertPage(ADDR, "999");
    expect(String(spy.mock.calls[0][0])).toContain("cursor=999");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- expertSource`
Expected: FAIL ("Cannot find module './expertSource.js'").

- [ ] **Step 3: Implement**

```ts
// packages/frontend/src/lib/activity/expertSource.ts
import { EXPERT_API_BASE } from "../network.js";
import { decodeExpertRecord } from "./decodeTx.js";
import { groupTxRows } from "./classify.js";
import type { ActivityItem, ActivityPage } from "./types.js";

const PAGE_LIMIT = 25;

/** Thrown when Stellar Expert refuses (402 / 429 / network) — signals the RPC fallback. */
export class ExpertUnavailableError extends Error {
  constructor(public status: number | "network") {
    super(`Stellar Expert unavailable (${status})`);
    this.name = "ExpertUnavailableError";
  }
}

/** Extract the `cursor` query param out of a Stellar Expert `_links.next.href`. */
function cursorFromHref(href: string | undefined): string | null {
  if (!href) return null;
  const m = /[?&]cursor=([^&]+)/.exec(href);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Fetch one page of full history from Stellar Expert and classify it. */
export async function fetchExpertPage(address: string, cursor: string | null): Promise<ActivityPage> {
  const url = new URL(`${EXPERT_API_BASE}/tx`);
  url.searchParams.append("account[]", address);
  url.searchParams.set("order", "desc");
  url.searchParams.set("limit", String(PAGE_LIMIT));
  if (cursor) url.searchParams.set("cursor", cursor);

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  } catch {
    throw new ExpertUnavailableError("network");
  }
  if (res.status === 402 || res.status === 429) throw new ExpertUnavailableError(res.status);
  if (!res.ok) throw new ExpertUnavailableError(res.status);

  const json = (await res.json()) as {
    _links?: { next?: { href?: string } };
    _embedded?: { records?: Array<{ hash: string; ts: number; body: string; meta: string }> };
  };
  const records = json._embedded?.records ?? [];
  const items: ActivityItem[] = records.flatMap((rec) => groupTxRows(decodeExpertRecord(rec), address));

  return {
    items,
    nextCursor: records.length < PAGE_LIMIT ? null : cursorFromHref(json._links?.next?.href),
    source: "expert",
    partial: false,
  };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test -- expertSource`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/activity/expertSource.ts packages/frontend/src/lib/activity/expertSource.test.ts
git commit -m "feat(frontend): Stellar Expert tx page source + fallback signal"
```

---

## Task 6: `lib/activity/rpcSource.ts` — recent events via Soroban RPC (fallback)

**Files:**
- Create: `packages/frontend/src/lib/activity/rpcSource.ts`
- Test: `packages/frontend/src/lib/activity/rpcSource.test.ts`

**Note:** the RPC fallback only covers the recent window. It queries the account's own emitted events (admin) plus native-SAC `transfer` events filtered to the account (in + out). It groups events by tx hash, then reuses `groupTxRows`.

- [ ] **Step 1: Write the failing test** (the `rpc.Server` is injected so the test mocks `getEvents`)

```ts
// packages/frontend/src/lib/activity/rpcSource.test.ts
import { describe, it, expect } from "vitest";
import { mapRpcEvents } from "./rpcSource.js";
import { nativeToScVal, Address } from "@stellar/stellar-sdk";

const SELF = "CCA2KXEUA4EQW3NL4QRCIZ2VRMA7V6A54DHXPA4RBTAGH72PCCYT5MSA";
const OTHER = "GCQZN6KXTEATCRNES3ZPTPZV4NNVK7CZKA6RHLMP2HPWP7SPDN7MFGBS";
const SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

// Shape mirrors rpc.Api.GetEventsResponse.events[]: topic[] + value are XDR ScVals.
function ev(contractId: string, topics: any[], data: any, txHash: string, ts: string) {
  return {
    contractId: { toString: () => contractId },
    topic: topics,                // already-built xdr.ScVal[]
    value: nativeToScVal(data, { type: "i128" }),
    txHash,
    ledgerClosedAt: ts,
  };
}

describe("mapRpcEvents", () => {
  it("groups events by tx hash and classifies them as a recent, partial page", () => {
    const transfer = ev(
      SAC,
      [nativeToScVal("transfer", { type: "symbol" }), Address.fromString(OTHER).toScVal(), Address.fromString(SELF).toScVal(), nativeToScVal("native", { type: "string" })],
      99900000000n, "TX1", "2026-06-01T00:00:00Z",
    );
    const page = mapRpcEvents([transfer], SELF);
    expect(page.source).toBe("rpc");
    expect(page.partial).toBe(true);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({ kind: "payment", direction: "in", amount: "9990" });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- rpcSource`
Expected: FAIL ("Cannot find module './rpcSource.js'").

- [ ] **Step 3: Implement**

```ts
// packages/frontend/src/lib/activity/rpcSource.ts
import { rpc, scValToNative, nativeToScVal, Address, xdr } from "@stellar/stellar-sdk";
import { RPC_URL, NATIVE_SAC_ID } from "../network.js";
import { groupTxRows } from "./classify.js";
import type { ActivityPage, DecodedEvent, DecodedTx } from "./types.js";

/** ~24h of testnet ledgers (≈5s/ledger). Stays within the public RPC retention window. */
const RECENT_LEDGERS = 17_280;

type RawEvent = {
  contractId: { toString(): string } | string;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
  txHash: string;
  ledgerClosedAt: string;
};

/** Decode one raw RPC event into a normalized DecodedEvent. */
function toDecoded(e: RawEvent): DecodedEvent {
  const cid = typeof e.contractId === "string" ? e.contractId : e.contractId?.toString?.() ?? null;
  return {
    contractId: cid,
    topics: e.topic.map((t) => { try { return scValToNative(t); } catch { return null; } }),
    data: (() => { try { return scValToNative(e.value); } catch { return null; } })(),
  };
}

/** Group raw RPC events by tx hash and classify them. Exposed for unit testing. */
export function mapRpcEvents(raw: RawEvent[], self: string): ActivityPage {
  const byTx = new Map<string, DecodedTx>();
  for (const e of raw) {
    const ts = Math.floor(new Date(e.ledgerClosedAt).getTime() / 1000);
    const tx = byTx.get(e.txHash) ?? { txHash: e.txHash, ts, events: [] };
    tx.events.push(toDecoded(e));
    byTx.set(e.txHash, tx);
  }
  const items = [...byTx.values()].flatMap((tx) => groupTxRows(tx, self));
  items.sort((a, b) => b.timestamp - a.timestamp);
  return { items, nextCursor: null, source: "rpc", partial: true };
}

/** Fetch the recent activity window for `address` from Soroban RPC. */
export async function fetchRpcRecent(address: string): Promise<ActivityPage> {
  const server = new rpc.Server(RPC_URL);
  const latest = await server.getLatestLedger();
  const startLedger = Math.max(1, latest.sequence - RECENT_LEDGERS);
  const transferSym = nativeToScVal("transfer", { type: "symbol" });
  const selfScv = Address.fromString(address).toScVal();

  const filters: rpc.Server.GetEventsRequest["filters"] = [
    { type: "contract", contractIds: [address], topics: [["*"]] },                         // admin events
    { type: "contract", contractIds: [NATIVE_SAC_ID], topics: [[transferSym, "*", selfScv]] }, // incoming
    { type: "contract", contractIds: [NATIVE_SAC_ID], topics: [[transferSym, selfScv, "*"]] }, // outgoing
  ];

  const raw: RawEvent[] = [];
  for (const filter of filters) {
    try {
      const res = await server.getEvents({ startLedger, filters: [filter], limit: 100 });
      raw.push(...(res.events as unknown as RawEvent[]));
    } catch { /* a single failing filter shouldn't sink the whole fallback */ }
  }
  return mapRpcEvents(raw, address);
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test -- rpcSource`
Expected: PASS (1 test).

> The pure `mapRpcEvents` is unit-tested. `fetchRpcRecent` (the live wiring) is exercised manually in Task 13. If `getEvents`/`getLatestLedger`/the `GetEventsRequest` filter type names differ in 15.1.0, adjust against `node_modules/@stellar/stellar-sdk` types — the `topics` wildcard is the string `"*"`; topic entries are `xdr.ScVal`.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/activity/rpcSource.ts packages/frontend/src/lib/activity/rpcSource.test.ts
git commit -m "feat(frontend): recent-window RPC getEvents fallback source"
```

---

## Task 7: `lib/activity/history.ts` — orchestrator (Expert → RPC fallback, dedup)

**Files:**
- Create: `packages/frontend/src/lib/activity/history.ts`
- Test: `packages/frontend/src/lib/activity/history.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/src/lib/activity/history.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadActivityPage } from "./history.js";
import * as expert from "./expertSource.js";
import * as rpcSrc from "./rpcSource.js";
import type { ActivityItem } from "./types.js";

const ADDR = "CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S";
const item = (id: string, ts: number): ActivityItem =>
  ({ id, txHash: id, timestamp: ts, kind: "other", title: "x", explorerUrl: "u" });
afterEach(() => vi.restoreAllMocks());

describe("loadActivityPage", () => {
  it("returns the Expert page when Expert works", async () => {
    vi.spyOn(expert, "fetchExpertPage").mockResolvedValue({
      items: [item("a", 2), item("b", 1)], nextCursor: "c1", source: "expert", partial: false,
    });
    const page = await loadActivityPage({ address: ADDR });
    expect(page.source).toBe("expert");
    expect(page.nextCursor).toBe("c1");
    expect(page.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("falls back to RPC when Expert is unavailable", async () => {
    vi.spyOn(expert, "fetchExpertPage").mockRejectedValue(new expert.ExpertUnavailableError(402));
    const rpcSpy = vi.spyOn(rpcSrc, "fetchRpcRecent").mockResolvedValue({
      items: [item("a", 1)], nextCursor: null, source: "rpc", partial: true,
    });
    const page = await loadActivityPage({ address: ADDR });
    expect(rpcSpy).toHaveBeenCalledWith(ADDR);
    expect(page).toMatchObject({ source: "rpc", partial: true, nextCursor: null });
  });

  it("dedups by id and sorts by timestamp desc", async () => {
    vi.spyOn(expert, "fetchExpertPage").mockResolvedValue({
      items: [item("a", 1), item("a", 1), item("b", 5)], nextCursor: null, source: "expert", partial: false,
    });
    const page = await loadActivityPage({ address: ADDR });
    expect(page.items.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("does not fall back on a non-Expert error (paging cursor still works)", async () => {
    vi.spyOn(expert, "fetchExpertPage").mockRejectedValue(new Error("boom"));
    await expect(loadActivityPage({ address: ADDR, cursor: "c1" })).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- history`
Expected: FAIL ("Cannot find module './history.js'").

- [ ] **Step 3: Implement**

```ts
// packages/frontend/src/lib/activity/history.ts
import { fetchExpertPage, ExpertUnavailableError } from "./expertSource.js";
import { fetchRpcRecent } from "./rpcSource.js";
import type { ActivityItem, ActivityPage } from "./types.js";

function dedupSort(items: ActivityItem[]): ActivityItem[] {
  const seen = new Map<string, ActivityItem>();
  for (const it of items) if (!seen.has(it.id)) seen.set(it.id, it);
  return [...seen.values()].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Load a page of activity. Primary source is Stellar Expert (full history,
 * paginated by `cursor`). If Expert is unavailable AND we're loading the first
 * page (no cursor), fall back to the recent-window RPC source.
 */
export async function loadActivityPage(opts: { address: string; cursor?: string | null }): Promise<ActivityPage> {
  const cursor = opts.cursor ?? null;
  try {
    const page = await fetchExpertPage(opts.address, cursor);
    return { ...page, items: dedupSort(page.items) };
  } catch (err) {
    // Only the recent-window fallback makes sense, and only for the first page.
    if (err instanceof ExpertUnavailableError && cursor === null) {
      const page = await fetchRpcRecent(opts.address);
      return { ...page, items: dedupSort(page.items) };
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test -- history`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the whole frontend suite + commit**

```bash
npm test
# Expected: all prior tests still green (50 baseline + new activity tests).
git add packages/frontend/src/lib/activity/history.ts packages/frontend/src/lib/activity/history.test.ts
git commit -m "feat(frontend): activity history orchestrator with RPC fallback"
```

---

## Task 8: `components/ActivityRow.astro` — one history row

**Files:**
- Create: `packages/frontend/src/components/ActivityRow.astro`

Presentational only (no unit test; verified via build + manual run). Uses Nido `.row` classes. Mirror the existing markup conventions in `MyNidoMenu.astro` / `account/index.astro`.

- [ ] **Step 1: Create the component**

```astro
---
// packages/frontend/src/components/ActivityRow.astro
import type { ActivityItem } from "../lib/activity/types.js";
interface Props { item: ActivityItem }
const { item } = Astro.props;
const iconClass = item.kind === "payment" ? (item.direction === "in" ? "in" : "acc") : "acc";
const sign = item.kind === "payment" ? (item.direction === "in" ? "+" : "−") : "";
const when = new Date(item.timestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
---
<a class="row activity-row" href={item.explorerUrl} target="_blank" rel="noopener noreferrer">
  <span class={`ricon ${iconClass}`} aria-hidden="true">{item.kind === "payment" ? (item.direction === "in" ? "↓" : "↑") : "•"}</span>
  <span class="rmain">
    <span class="rtitle">{item.title}</span>
    <span class="rsub">{item.subtitle ?? when}</span>
  </span>
  {item.amount && (
    <span class="ramt" title={item.counterparty}>{sign}{item.amount} <small>{item.asset}</small></span>
  )}
</a>

<style>
  .activity-row { text-decoration: none; color: inherit; }
  .activity-row:hover { background: var(--chip, #f4efe9); }
</style>
```

- [ ] **Step 2: Verify it compiles**

Run: `npx astro check 2>&1 | tail -5`
Expected: no NEW errors referencing `ActivityRow.astro` (the repo has a known ~2-error astro-check baseline — compare against it).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/ActivityRow.astro
git commit -m "feat(frontend): ActivityRow component"
```

---

## Task 9: `components/RecentActivityCard.astro` — home-page card

**Files:**
- Create: `packages/frontend/src/components/RecentActivityCard.astro`

Renders a card that, on the client, loads the first page and shows the top 5 rows (skeleton → rows / empty / error), plus a "View all →" link. The contract address is passed in as a prop (the account page already resolves it).

- [ ] **Step 1: Create the component**

```astro
---
// packages/frontend/src/components/RecentActivityCard.astro
// No SSR address exists — the smart account is resolved client-side from the
// hostname subdomain (same as account/index.astro and the sign/recover pages).
---
<section class="card recent-activity">
  <header class="ra-head">
    <span class="section-label">Recent activity</span>
    <a class="ra-all" href="/account/activity/">View all →</a>
  </header>
  <div class="ra-body" data-state="loading">
    <div class="ra-skeleton">
      <span class="skeleton">&nbsp;</span><span class="skeleton">&nbsp;</span><span class="skeleton">&nbsp;</span>
    </div>
    <div class="ra-list" hidden></div>
    <div class="empty ra-empty" hidden>No activity yet</div>
    <div class="ra-note mut" hidden>Showing recent activity</div>
  </div>
</section>

<style is:global>
  /* is:global: rows are injected via innerHTML, so scoped styles wouldn't reach them. */
  .recent-activity .ra-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .recent-activity .ra-all { font-size: 13px; color: var(--acc-btn, #c2410c); text-decoration: none; }
  .recent-activity .ra-skeleton { display: grid; gap: 10px; }
  .recent-activity .ra-skeleton .skeleton { height: 42px; border-radius: 10px; display: block; }
  .recent-activity .ra-note { font-size: 12px; margin-top: 8px; }
</style>

<script>
  import { loadActivityPage } from "../lib/activity/history.js";
  import type { ActivityItem } from "../lib/activity/types.js";
  import { contractIdFromHostname } from "@g2c/passkey-sdk";

  function rowHtml(it: ActivityItem): string {
    const icon = it.kind === "payment" ? (it.direction === "in" ? "↓" : "↑") : "•";
    const iconCls = it.kind === "payment" && it.direction === "in" ? "in" : "acc";
    const when = new Date(it.timestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const sign = it.kind === "payment" ? (it.direction === "in" ? "+" : "−") : "";
    const amt = it.amount ? `<span class="ramt">${sign}${it.amount} <small>${it.asset}</small></span>` : "";
    const sub = it.subtitle ?? when;
    return `<a class="row" href="${it.explorerUrl}" target="_blank" rel="noopener noreferrer">
      <span class="ricon ${iconCls}">${icon}</span>
      <span class="rmain"><span class="rtitle">${it.title}</span><span class="rsub">${sub}</span></span>${amt}
    </a>`;
  }

  async function init() {
    const card = document.querySelector<HTMLElement>(".recent-activity");
    if (!card) return;
    const skel = card.querySelector<HTMLElement>(".ra-skeleton")!;
    const list = card.querySelector<HTMLElement>(".ra-list")!;
    const empty = card.querySelector<HTMLElement>(".ra-empty")!;
    const note = card.querySelector<HTMLElement>(".ra-note")!;
    const body = card.querySelector<HTMLElement>(".ra-body")!;
    const address = contractIdFromHostname(window.location.hostname);
    if (!address) { skel.hidden = true; empty.hidden = false; return; }
    try {
      const page = await loadActivityPage({ address });
      skel.hidden = true;
      const top = page.items.slice(0, 5);
      if (top.length === 0) { empty.hidden = false; return; }
      list.innerHTML = top.map(rowHtml).join("");
      list.hidden = false;
      if (page.partial) note.hidden = false;
      body.dataset.state = "ready";
    } catch {
      skel.hidden = true;
      empty.textContent = "Couldn’t load activity";
      empty.hidden = false;
      body.dataset.state = "error";
    }
  }
  init();
</script>
```

- [ ] **Step 2: Verify it compiles**

Run: `npx astro check 2>&1 | tail -5`
Expected: no new errors referencing `RecentActivityCard.astro`.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/RecentActivityCard.astro
git commit -m "feat(frontend): RecentActivityCard home component"
```

---

## Task 10: `pages/account/activity/index.astro` — full paginated page

**Files:**
- Create: `packages/frontend/src/pages/account/activity/index.astro`

The address is resolved client-side from the hostname via `contractIdFromHostname` (same helper the sign/recover/delegate pages use), so there is no SSR address and no prop.

- [ ] **Step 1: Create the page**

```astro
---
// packages/frontend/src/pages/account/activity/index.astro
import NidoLayout from "../../../layouts/NidoLayout.astro";
---
<NidoLayout title="Activity" shell="app">
  <section class="card">
    <h1 class="section-label">Activity</h1>
    <div id="activity-root">
      <div id="activity-skeleton">
        <span class="skeleton">&nbsp;</span><span class="skeleton">&nbsp;</span><span class="skeleton">&nbsp;</span><span class="skeleton">&nbsp;</span>
      </div>
      <div id="activity-list" hidden></div>
      <div class="empty" id="activity-empty" hidden>No activity yet</div>
      <div class="alert info" id="activity-note" hidden>Showing recent activity (full history is temporarily unavailable).</div>
      <div class="alert danger" id="activity-error" hidden>
        Couldn’t load activity. <button class="btn ghost" id="activity-retry">Retry</button>
      </div>
      <button class="btn soft" id="activity-more" hidden>Load more</button>
    </div>
  </section>
</NidoLayout>

<style is:global>
  #activity-skeleton { display: grid; gap: 10px; }
  #activity-skeleton .skeleton { height: 48px; border-radius: 10px; display: block; }
  #activity-more { margin-top: 14px; }
</style>

<script>
  import { loadActivityPage } from "../../../lib/activity/history.js";
  import type { ActivityItem } from "../../../lib/activity/types.js";
  import { contractIdFromHostname } from "@g2c/passkey-sdk";

  function rowHtml(it: ActivityItem): string {
    const icon = it.kind === "payment" ? (it.direction === "in" ? "↓" : "↑") : "•";
    const iconCls = it.kind === "payment" && it.direction === "in" ? "in" : "acc";
    const when = new Date(it.timestamp * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const sign = it.kind === "payment" ? (it.direction === "in" ? "+" : "−") : "";
    const amt = it.amount ? `<span class="ramt">${sign}${it.amount} <small>${it.asset}</small></span>` : "";
    return `<a class="row" href="${it.explorerUrl}" target="_blank" rel="noopener noreferrer">
      <span class="ricon ${iconCls}">${icon}</span>
      <span class="rmain"><span class="rtitle">${it.title}</span><span class="rsub">${it.subtitle ?? when}</span></span>${amt}</a>`;
  }

  const root = document.getElementById("activity-root")!;
  const address = contractIdFromHostname(window.location.hostname);
  const skel = document.getElementById("activity-skeleton")!;
  const list = document.getElementById("activity-list")!;
  const empty = document.getElementById("activity-empty")!;
  const note = document.getElementById("activity-note")!;
  const errBox = document.getElementById("activity-error")!;
  const moreBtn = document.getElementById("activity-more") as HTMLButtonElement;
  let cursor: string | null = null;

  async function loadPage(first: boolean) {
    errBox.hidden = true;
    if (first) skel.hidden = false;
    moreBtn.disabled = true;
    try {
      const page = await loadActivityPage({ address: address!, cursor });
      skel.hidden = true;
      if (first && page.items.length === 0) { empty.hidden = false; return; }
      list.insertAdjacentHTML("beforeend", page.items.map(rowHtml).join(""));
      list.hidden = false;
      note.hidden = !page.partial;
      cursor = page.nextCursor;
      moreBtn.hidden = page.nextCursor === null;
      moreBtn.disabled = false;
    } catch {
      skel.hidden = true;
      errBox.hidden = false;
      moreBtn.hidden = true;
    }
  }

  moreBtn.addEventListener("click", () => loadPage(false));
  document.getElementById("activity-retry")!.addEventListener("click", () => loadPage(cursor === null));
  if (!address) { skel.hidden = true; empty.hidden = false; } else { loadPage(true); }
</script>
```

- [ ] **Step 2: Verify it compiles & routes**

Run: `npx astro check 2>&1 | tail -5` then `npm run build 2>&1 | tail -8`
Expected: build succeeds; `/account/activity/` appears in the build output. If `NidoLayout` has no `shell` prop, drop it (check the layout's Props).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/account/activity/index.astro
git commit -m "feat(frontend): paginated /account/activity page"
```

---

## Task 11: Add the sidebar nav entry

**Files:**
- Modify: `packages/frontend/src/components/Sidebar.astro`

- [ ] **Step 1: Read the file and locate the `NAV` array**

Run: `sed -n '1,40p' packages/frontend/src/components/Sidebar.astro`
Find the `NAV` array of `{ href, label, ... }` entries (around lines 12-15).

- [ ] **Step 2: Add an "Activity" entry**

The `NAV` array entries are `{ href, label, icon }` (verified). The `activity` icon already exists in `Icon.astro`. Insert an "Activity" entry (e.g. after `Home`):

```ts
{ href: "/account/activity/", label: "Activity", icon: "activity" },
```

- [ ] **Step 3: Verify**

Run: `npx astro check 2>&1 | tail -5`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/Sidebar.astro
git commit -m "feat(frontend): add Activity to the sidebar nav"
```

---

## Task 12: Mount the card on the account home

**Files:**
- Modify: `packages/frontend/src/pages/account/index.astro`

- [ ] **Step 1: Import the component** (add to the frontmatter import block)

```ts
import RecentActivityCard from "../../components/RecentActivityCard.astro";
```

- [ ] **Step 2: Place the card in the markup**

Find where the balance / quick-actions cards render (search for the `Send` quick action or `xlm-balance`). Add, on its own grid cell, after the balance/send area:

```astro
<RecentActivityCard />
```

No prop — the card resolves the account address client-side from the hostname (same as the rest of the page).

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -8`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/account/index.astro
git commit -m "feat(frontend): show Recent activity card on the account home"
```

---

## Task 13: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Unit tests**

Run: `cd packages/frontend && npm test`
Expected: all green (50 baseline + ~15 new).

- [ ] **Step 2: Type + build**

Run: `npx astro check 2>&1 | tail -5 && npm run build 2>&1 | tail -8`
Expected: astro check shows no new errors beyond the known baseline; build succeeds with `/account/activity/` emitted.

- [ ] **Step 3: Manual smoke (real testnet account)**

Run: `npm run dev` and open the account page for a smart account that has testnet history. Confirm:
- the "Recent activity" card populates (or shows the empty state);
- `/account/activity/` lists rows, "Load more" pages, each row links to `stellar.expert/.../tx/<hash>`;
- temporarily force the fallback (e.g. block `api.stellar.expert` in devtools) and confirm the page still shows recent rows with the "Showing recent activity" note instead of an error.

- [ ] **Step 4: Lint the touched files only** (repo `just check` is red on baseline — verify only your files)

Run: `cd packages/frontend && npx prettier --check "src/lib/activity/**/*.ts" "src/lib/network.ts"`
Fix any formatting; re-run.

- [ ] **Step 5: Final commit if any fixups**

```bash
git add -A && git commit -m "chore(frontend): tidy transaction-history feature" || echo "nothing to commit"
```

---

## Self-review notes (addressed)

- **Spec coverage:** network.ts (T1), types (T2), classify+grouping (T3), decodeTx V3/V4 (T4), expertSource+402 fallback signal (T5), rpcSource recent window (T6), history orchestrator+dedup (T7), ActivityRow/RecentActivityCard/activity page (T8-10), sidebar + home mount (T11-12), verification (T13). All spec sections map to a task.
- **Type consistency:** `ActivityItem`/`ActivityPage`/`DecodedEvent`/`DecodedTx` defined once in T2 and imported everywhere; `groupTxRows`, `decodeExpertRecord`, `fetchExpertPage`/`ExpertUnavailableError`, `fetchRpcRecent`/`mapRpcEvents`, `loadActivityPage` names are used identically across tasks.
- **Verified during planning:** `NidoLayout` accepts `shell="app"` (the default); the `Sidebar` `NAV` shape is `{ href, label, icon }` and the `activity` icon already exists in `Icon.astro`; the account address resolves client-side via `contractIdFromHostname(window.location.hostname)` from `@g2c/passkey-sdk` (returns `string | null` — both UI surfaces guard the null case).
- **Remaining to confirm at execution:** the `rpc.Server.getEvents` / `GetEventsRequest` filter type names in stellar-sdk 15.1.0 (Task 6) — verify against `node_modules/@stellar/stellar-sdk` types. The graceful generic-fallback row means any classifier mismatch degrades to a plain row, never crashes the page.
