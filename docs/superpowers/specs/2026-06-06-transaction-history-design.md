# Transaction / Activity History — Design Spec

**Date:** 2026-06-06
**Branch:** `feat/transaction-history`
**Status:** Implemented — **amended** (see Addendum) after a real-world data-source finding.

## Addendum (2026-06-06) — shipped as RPC-only "Recent activity"

The original design below picked **Stellar Expert `/tx` as the full-history
primary** with Soroban RPC `getEvents` as a fallback. Live verification during
implementation showed Stellar Expert's `/tx` (and `/contract`) endpoints are
**gated to stellar.expert's own origin**: CORS-blocked from any other browser
origin, and `402 Payment Required` server-side. Only `/directory` is CORS-open.
So `/tx` is **unusable from this app** — neither client-side (CORS) nor via a
simple server proxy (402). (My earlier "it works" check was misleading: that was
same-origin from inside stellar.expert's own SPA.)

**Decision (user-approved):** ship as **RPC-only "Recent activity."** Soroban RPC
`getEvents` is CORS-open and works from the app; the public testnet RPC retains
roughly the **last 7 days** of events (measured: a ~120,959-ledger window). That
is the source of truth.

What this changes vs. the design below:
- **Removed** the Stellar Expert source and the XDR-decode module (`expertSource`,
  `decodeTx`, and the captured fixture) — dead code given the gating.
- **`rpcSource` is the single source.** It queries the account's own admin events
  plus native-SAC `transfer` events to/from the account.
- **Tip-anchored chunked scan (NOT a single wide query).** `getEvents` only scans
  ~9k ledgers ascending from `startLedger` per request and returns oldest-first,
  and the busy native SAC trips a `[-32001]` processing limit over wide ranges. So
  `fetchRpcRecent` walks fixed ~9k-ledger chunks **backward from the chain tip**
  (newest first), each one bounded `startLedger`+`endLedger` request; it shrinks a
  chunk's span on `[-32001]` and stops when even the smallest fails — so coverage
  is the most recent contiguous span it can fetch (a few days at most, not 7), and
  a failure on the *newest* chunk surfaces as an error (not a false "empty").
- **No cursor pagination / "Load more"**; `ActivityPage` is just `{ items }`. The
  home card scans a shallower window (`maxChunks`) than the full activity page.
- **UI reframed as "Recent activity"** + a "View full history on Stellar Expert"
  link (the explorer *page* renders full history; only its `/tx` API is gated).
- Everything else (the event classification, the snake_case OZ event mapping, the
  two UI surfaces, the Nido styling, client-side address resolution) is unchanged.

**Path to true full history (not done):** point `getEvents` at a full-history
Soroban RPC provider (keyed) — the same `rpcSource`/`classify` code would then
page the entire history. Deferred; needs a provider choice.

The sections below describe the original (pre-pivot) design for context.

## 1. Goal

Give a logged-in g2c wallet user a readable history of their smart account's
on-chain activity: payments (received / sent) **and** smart-account operations
(added a signer, set up recovery, changed a policy, etc.). Surfaced in two
places:

- A **"Recent activity"** card on the account home (`account/index.astro`).
- A dedicated, paginated **`/account/activity`** page reachable from the sidebar.

## 2. Background & constraints (verified)

The wallet account is a **Soroban smart contract (C-address)**, not a classic
Stellar account (G-address). Classic Horizon account-history endpoints
(`/accounts/{id}/transactions|operations|payments`) **do not apply** to
contracts. Two data sources were verified live during design:

### 2a. Stellar Expert `/tx` (full history — primary)

```
GET https://api.stellar.expert/explorer/{network}/tx?account[]={C-address}&order=desc&limit=25[&cursor={paging_token}]
```

- Confirmed working on **testnet and public** (HTTP 200) **from a browser
  origin**. Returns HTTP **402** to non-browser clients and is **rate-limited**
  (429). Our Astro app runs in the browser, same as the Stellar Expert SPA that
  uses this exact call.
- Response shape:
  ```
  { _links: { self, prev, next: { href: ".../tx?...&cursor=<paging_token>" } },
    _embedded: { records: [ {
        id, hash, ledger,
        ts,            // unix seconds — used for the timestamp column
        protocol,
        body,          // base64 XDR TransactionEnvelope (the InvokeHostFunctionOp)
        meta,          // base64 XDR TransactionMeta (Soroban contract events + fn_call diag)
        result,        // base64 XDR TransactionResult
        paging_token   // cursor for the next page
    } ] } }
  ```
- Records carry **raw XDR**, not decoded operations. The client decodes
  `body`/`meta` with `@stellar/stellar-sdk` (already bundled) to extract the
  invoked function and the emitted contract events.
- Companion endpoint for resolving addresses to known labels (optional, nice to
  have): `GET /explorer/{network}/directory?address[]=...`.

### 2b. Soroban RPC `getEvents` (recent — fallback / freshness)

- `rpc.Server(RPC_URL).getEvents(...)` — same SDK/server the app already uses
  for balances.
- Returns contract events already as ScVals (topics + value).
- **Retention window: ~24h default, 7 days maximum** on public RPC. This makes
  it a *recent-activity* source, not full history — hence its role as a
  fallback and live-freshness layer, never the sole source for the full page.

### 2c. Why Hybrid

Stellar Expert gives full lifetime history but is an undocumented,
browser-gated, rate-limited endpoint. RPC `getEvents` is native and reliable but
windowed. Using Expert as primary with an RPC fallback gives full history when
available and graceful degradation (recent-only) when Expert is unreachable or
throttled.

### 2d. What the smart account emits (verified)

The smart-account contract delegates to OpenZeppelin `stellar-accounts`, which
emits semantic events. Plus the native asset SAC emits `transfer`. Both are read
the same way (decoded event topic[0] + data):

| Event topic[0] | Meaning |
| --- | --- |
| `transfer` (from SAC) | payment in/out; topics: `[transfer, from, to, asset?]`, data = amount (i128) |
| `ContextRuleAdded` | a rule was created (recovery rule when `CallContract == self`) |
| `ContextRuleRemoved` | a rule was deleted |
| `ContextRuleMetaUpdated` | a rule was renamed / re-dated |
| `SignerAdded` / `SignerRemoved` | signer changes |
| `PolicyAdded` / `PolicyRemoved` | policy changes |

Outgoing XLM (see `lib/sendXlm.ts`) is the account invoking
`execute(XLM_SAC, "transfer", [from, to, amount])`; this still emits the standard
`transfer` event, so the classifier keys on the **event**, not the op shape.

## 3. Architecture & module boundaries

All new code under `packages/frontend/src/`. Each `lib` module has one job and a
co-located `*.test.ts` (matching the repo's Vitest convention, e.g.
`money.test.ts`, `sendXlm.test.ts`).

| Module | Responsibility | I/O |
| --- | --- | --- |
| `lib/network.ts` *(new)* | Single source of truth: `RPC_URL`, `NETWORK_PASSPHRASE` (= `Networks.TESTNET`), `NETWORK_NAME` (`"testnet"`), `EXPERT_API_BASE` (`https://api.stellar.expert/explorer/testnet`), `EXPLORER_BASE` (`https://stellar.expert/explorer/testnet`). | none |
| `lib/activity/types.ts` *(new)* | `ActivityItem`, `ActivityKind`, `ActivityPage` types. | none |
| `lib/activity/classify.ts` *(new)* | **Pure** `classifyEvent(decodedEvent, selfAddress) -> ActivityItem \| null` and `classifyInvocation(fnName, target, selfAddress) -> ActivityItem`. The testable core; no network. | none |
| `lib/activity/decodeTx.ts` *(new)* | Decode a Stellar Expert record (`body` + `meta` base64 XDR) into `{ txHash, ts, fnCall?, events[] }` via stellar-sdk `xdr`. | none |
| `lib/activity/expertSource.ts` *(new)* | Fetch `/tx` page, map records through `decodeTx` + `classify`. Returns `ActivityPage` with `nextCursor`. | fetch |
| `lib/activity/rpcSource.ts` *(new)* | Fetch recent events via `getEvents` over the SAC + smart-account contract; map through `classify`. | RPC |
| `lib/activity/history.ts` *(new)* | Orchestrator: Expert primary → RPC fallback on 402/429/error; merge + dedup by `txHash`; sort by `ts` desc. `loadActivityPage({ address, cursor? })`. | composes above |
| `components/ActivityRow.astro` *(new)* | Render one `ActivityItem` (Nido `.row` markup). |  |
| `components/RecentActivityCard.astro` *(new)* | Home card: top ~5 + "View all →". |  |
| `pages/account/activity/index.astro` *(new)* | Full paginated page ("Load more"). |  |
| `components/Sidebar.astro` *(modify)* | Add an "Activity" nav entry. |  |
| `pages/account/index.astro` *(modify)* | Mount `RecentActivityCard`. |  |

### 3a. Targeted cleanup (`lib/network.ts`)

The RPC URL and `Networks.TESTNET` are currently re-hardcoded inline across
~9 files (`balance.ts`, `sendXlm.ts`, `createNido.ts`, etc.). This feature adds
`lib/network.ts` and reads its constants rather than hardcoding a tenth copy.
**Scope discipline:** only the new modules consume `network.ts` in this PR; we do
*not* sweep-migrate the existing nine call sites (that would balloon the diff and
risk unrelated regressions). The module is introduced here and existing sites
migrate opportunistically later, exactly as `address.ts` did.

## 4. Data model

```ts
type ActivityKind =
  | "payment"        // SAC transfer in/out
  | "signer"         // SignerAdded / SignerRemoved
  | "recovery"       // recovery rule created/used
  | "policy"         // PolicyAdded / PolicyRemoved
  | "rule"           // ContextRule added/removed/updated (non-recovery)
  | "other";         // recognized invocation w/o a richer bucket, or generic fallback

interface ActivityItem {
  // Stable key + cross-source dedup id. Admin rows: `${txHash}`.
  // Payment rows: `${txHash}:transfer:${i}` (i = index of the transfer event in the tx).
  id: string;
  txHash: string;
  timestamp: number;       // unix seconds (from `ts`)
  kind: ActivityKind;
  direction?: "in" | "out"; // payments only
  title: string;           // "Received", "Sent", "Added a signer", ...
  subtitle?: string;       // counterparty (shortAddr) or detail
  amount?: string;         // display XLM string (from stroopsToXlm) — payments
  asset?: string;          // "XLM" or short SAC id for non-native
  counterparty?: string;   // full address (for copy / title attr)
  explorerUrl: string;     // `${EXPLORER_BASE}/tx/${txHash}`
}

interface ActivityPage {
  items: ActivityItem[];
  nextCursor: string | null; // paging_token for the next Expert page; null at end
  source: "expert" | "rpc";  // drives the "recent only" UI note when "rpc"
  partial: boolean;          // true when on the RPC fallback (recent window only)
}
```

## 5. Data flow

1. UI calls `loadActivityPage({ address, cursor })`.
2. **Expert path:** GET `/tx?account[]={address}&order=desc&limit=25[&cursor]`.
   - For each record: `decodeTx(body, meta)` → invoked fn + contract events.
   - **Row granularity per tx** (so one user action isn't sprayed across rows,
     and batched payments aren't hidden):
     - one row per `transfer` event (payments are individually meaningful);
     - **all administrative events of a tx collapse into one representative row**,
       chosen by priority `recovery > rule > signer > policy > other` (e.g.
       `add_multisig_recovery`'s `ContextRuleAdded` + N×`SignerAdded` +
       `PolicyAdded` → a single "Set up social recovery" row);
     - a tx with no classifiable event → one `classifyInvocation` row from the
       top-level fn. **Never drop a tx.**
   - `nextCursor` = parse `cursor` out of `_links.next.href` (null if absent).
   - `source: "expert"`, `partial: false`.
3. **Fallback** (Expert returns 402 / 429 / network error): call `rpcSource`
   for the recent window, classified by the same rules. `source: "rpc"`,
   `partial: true`, `nextCursor: null` (no deep paging on the fallback).
4. Merge + dedup by `id` (a tx surfaced by both Expert and the RPC fallback
   appears once); sort `ts` desc.

## 6. Classification mapping

`classify` is a pure switch on `topic[0]` (events) / function name (invocations),
with a **generic fallback** so nothing is dropped:

| Source signal | `kind` | Row |
| --- | --- | --- |
| `transfer`, `to == self` | payment | ↙ "Received" · `+{amount} {asset}` · "from {shortAddr(from)}" |
| `transfer`, `from == self` | payment | ↗ "Sent" · `−{amount} {asset}` · "to {shortAddr(to)}" |
| `SignerAdded` / fn `add_signer` | signer | "Added a signer" |
| `SignerRemoved` / fn `remove_signer` | signer | "Removed a signer" |
| `ContextRuleAdded` w/ `CallContract(self)` · fn `add_multisig_recovery` | recovery | "Set up social recovery" |
| `ContextRuleAdded` (other) / fn `add_context_rule` | rule | "Created a rule" + name |
| `ContextRuleRemoved` / fn `remove_context_rule` | rule | "Removed a rule" |
| `ContextRuleMetaUpdated` / fn `update_context_rule_*` | rule | "Updated a rule" |
| `PolicyAdded` / fn `add_policy` | policy | "Added a policy" |
| `PolicyRemoved` / fn `remove_policy` | policy | "Removed a policy" |
| fn `execute(target, target_fn, …)` with no transfer event | other | "Called {target_fn}" |
| anything unrecognized | other | "Contract activity" + fn name |

Amounts: transfer `data` is an i128 → bigint stroops → `stroopsToXlm()` →
`formatXlm()`. Asset: native XLM detected by comparing the asset SAC id to
`Asset.native().contractId(NETWORK_PASSPHRASE)`; non-native shows `shortAddr` of
the SAC id as the asset label (richer per-asset metadata is a non-goal for v1).

## 7. UI surfaces

Both surfaces follow the existing async-load pattern in `MyNidoMenu.astro`
(skeleton → populate via DOM, error → graceful fallback). Styling uses the Nido
`.row`/`.ricon`/`.rmain`/`.ramt`/`.empty`/`.skeleton`/`.alert` classes already in
`styles/nido.css`. Rows injected at runtime use `is:global` styles (per the
known MyNidoMenu constraint).

- **`RecentActivityCard`** (home): heading "Recent activity", up to 5 rows,
  skeletons while loading, `.empty` ("No activity yet") when empty, a subtle note
  when `source === "rpc"` ("Showing recent activity"), and a "View all →" link to
  `/account/activity`.
- **`/account/activity`** page: `NidoLayout`, full list, **"Load more"** button
  driving `nextCursor`; loading / empty / error (`.alert` + Retry) states;
  the recent-only note when on the fallback. Each row links to its explorer tx.
- **Sidebar:** add an "Activity" entry to the `NAV` array in `Sidebar.astro`.

The current account address ("self") is obtained the same way
`account/index.astro` already derives `contractId` (host-subdomain / session).
Both new surfaces receive it from that existing resolution — no new identity
logic.

## 8. Error handling & reliability

- Expert 402 / 429 / fetch failure → silent fallback to RPC; show the
  "recent activity" note, not an error.
- All sources fail → `.alert` error state with a Retry button.
- Per-record decode errors are isolated: a record that fails XDR decode degrades
  to a generic "Contract activity" row (with its tx hash + explorer link); it
  never throws out of the page.
- Rate-limit politeness: page size 25; no auto-refresh polling; "Load more" is
  user-driven.

## 9. Testing (Vitest)

Fixtures captured from the real testnet `/tx` XDR pulled during design.

- `classify.test.ts` — the core. Fixture decoded events (`transfer` in, `transfer`
  out, `SignerAdded`, `add_multisig_recovery`, an unknown fn) → assert each
  `ActivityItem` (title, kind, direction, amount, counterparty).
- `decodeTx.test.ts` — a recorded base64 `body`+`meta` → assert extracted
  `txHash`, `ts`, fn name, and events.
- `expertSource.test.ts` — `fetch` mocked with a recorded `/tx` JSON page →
  assert mapped items + `nextCursor` parsing + that a 402 throws the
  fallback-signal error.
- `rpcSource.test.ts` — `getEvents` mocked → assert recent-window mapping.
- `history.test.ts` — Expert-success path; Expert-402 → RPC fallback
  (`source:"rpc"`, `partial:true`); merge/dedup/sort.

Manual verification: run the frontend (`TESTNET` env), open `/account/activity`
for an account with known testnet history, confirm rows + "Load more" + the
explorer links; simulate Expert failure to confirm the RPC fallback note.

## 10. Scope & non-goals (v1)

- **In:** payments (native XLM rich; other assets generic), smart-account ops via
  the known-verb table + generic fallback, both UI surfaces, hybrid data with
  fallback, pagination on the full page, unit tests.
- **Out:** decoding every operation's full argument list into prose; per-asset
  metadata/icons for non-native tokens; mainnet/network switching (stays
  testnet); CSV export; real-time push/auto-refresh; running our own indexer.

## 11. Risks / open questions

1. **Stellar Expert is undocumented.** Works today; RPC fallback covers outages.
   Accepted, flagged.
2. **XDR meta decoding depth.** We rely on `sorobanMeta` contract events +
   the top-level `InvokeHostFunctionOp` fn name. If a future protocol shifts the
   meta layout, `decodeTx` is the single place to adjust; the generic fallback
   keeps the page functional meanwhile.
3. **Self-address resolution** reuses the account page's existing mechanism; if
   that mechanism changes, both surfaces inherit the change (intentional).

## 12. File manifest

**New**

- `packages/frontend/src/lib/network.ts`
- `packages/frontend/src/lib/activity/types.ts`
- `packages/frontend/src/lib/activity/classify.ts` (+ `classify.test.ts`)
- `packages/frontend/src/lib/activity/decodeTx.ts` (+ `decodeTx.test.ts`)
- `packages/frontend/src/lib/activity/expertSource.ts` (+ `expertSource.test.ts`)
- `packages/frontend/src/lib/activity/rpcSource.ts` (+ `rpcSource.test.ts`)
- `packages/frontend/src/lib/activity/history.ts` (+ `history.test.ts`)
- `packages/frontend/src/components/ActivityRow.astro`
- `packages/frontend/src/components/RecentActivityCard.astro`
- `packages/frontend/src/pages/account/activity/index.astro`

**Modified**

- `packages/frontend/src/components/Sidebar.astro` (nav entry)
- `packages/frontend/src/pages/account/index.astro` (mount the card)
