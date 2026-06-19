# Name-Centric Inline Claim — Design

**Date:** 2026-06-18
**Branch:** `feat/name-inline-claim`
**Status:** Approved design, pending spec review

## Problem

Today the app is **account-centric**: you create/own a smart account, then
optionally claim a human-readable name for it. Visiting an *unclaimed* name
subdomain such as `alice.nido.fyi` is a dead end — `resolveAccount` finds no
registry entry and the account page renders an error: *"Name 'alice' not found
in the registry."* There is no way to claim a name *from the name's own
subdomain*, and the existing claim flow (triggered from an account's page)
bounces the user through a separate `?sign=` approval surface and several
redirects, with only plain status text for progress.

We want landing on an available name subdomain to **become the claim entry
point**: confirm who is claiming, run the claim with visible progress, and end
on the account dashboard at the friendly name.

## Hard Constraint: WebAuthn rpId

`rpId` is set to `window.location.hostname` everywhere a passkey is created or
asserted (`account/index.astro:375`, `walletSign.ts:245,383`,
`primaryPasskeySigner.ts:168`, `new-account/index.astro`, recovery, etc.). A
passkey is therefore bound to the **full subdomain** it was created on. An
account's passkey lives on the account's own subdomain (`<contractId>.nido.fyi`
for an unnamed account, or `<name>.nido.fyi` once named). It **cannot** be
asserted on `alice.nido.fyi`.

Consequence — there are two distinct passkey moments:

- **Moment A — authorize `register(alice)`.** Requires the claiming account's
  existing passkey, so it **must** run on the account's own subdomain. This
  forces one redirect away from `alice.nido.fyi`.
- **Moment B — mint an `alice.nido.fyi` passkey.** Makes the account usable at
  the friendly name. This genuinely runs on `alice.nido.fyi`.

Re-architecting `rpId` to the registrable apex (`nido.fyi`) so one passkey works
across all subdomains was considered and **rejected** for this work: existing
passkeys would not migrate, it weakens the per-account binding the `?sign=`
surface relies on (`sign/index.astro:35`), and it needs a dedicated security
review.

## Goals

- Visiting an **available** name subdomain shows a claim experience, not an error.
- The claiming account is identified explicitly, with a picker fallback.
- The authorizing passkey ceremony runs inline (progress card), **not** via the
  `?sign=` redirect bounce.
- After the name resolves, mint the friendly-name passkey inline on the name
  subdomain, then land on the dashboard.

## Non-Goals (YAGNI)

- Apex-`rpId` re-architecture (rejected above).
- Rename semantics for an account that already has a name. The claimer is
  identified by an explicit C-address; the registry contract is the source of
  truth for what a given account is allowed to claim. We do not pre-filter or
  special-case named accounts in the UI.
- Creating a brand-new account inline on the name subdomain. A visitor with no
  account is sent to `/new-account/` (see Flow → "0 accounts").

## Flow

```
alice.nido.fyi  (resolve "alice")
│
├─ taken     → existing dashboard (unchanged)
├─ invalid   → "not a valid name" message (no claim affordance)
└─ AVAILABLE → syncNidoStorageViaBridge() → read accounts list
      │
      ├─ 0 accounts         → CTA → /new-account/?then=claim:alice
      ├─ ?account=C… in URL  → that account preselected, skip picker
      └─ ≥1 account          → CONFIRM SCREEN
                               "alice is available — claim it for <label>"
                               default = most-recently-used account
                               [ Claim ]   [ Use a different account → picker ]
                                  │
                                  ▼  embed chosen C-address as a link param
   redirect → https://<accountHost>/account/?claim=alice&account=<C-addr>&from=alice.nido.fyi
   (accountHost = that account's own subdomain — rpId matches its passkey)
                                  │
                                  ▼  INLINE CLAIM  (passkey moment A)
   progress card (reuse new-account ticker style):
     1. build register(alice) tx        2. sign with passkey (inline, no ?sign= bounce)
     3. submit (relayer / classic)      4. await confirmation
   [ arrived with no account context → launch picker instead ]
                                  │  on success
                                  ▼
   redirect → https://alice.nido.fyi/account/?namepasskey=1   (name now resolves)
                                  │
                                  ▼  MINT FRIENDLY PASSKEY  (passkey moment B) — on alice.nido.fyi
   inline "set up your alice passkey" card + progress
                                  │
                                  ▼
                           reveal dashboard (#home-mode)
```

## Components

### 1. Available-name entry view on `alice.nido.fyi` (new)
- In `account/index.astro` name-resolution path, add an **available** branch
  (registry returns null *and* the name is syntactically valid). Instead of the
  error box, render a confirm card.
- Confirm card: name (`alice`), the default claimer label (most-recently-used
  account — name if it has one, else short C-address), a **Claim** button, and a
  **Use a different account** affordance that opens the **picker** (reuse the My
  Nido switcher list, `nidoSwitcher` / `myNidoModel`).
- Account list comes from `syncNidoStorageViaBridge()` + `localNidoSnapshot()`.
- "Most-recently-used" ordering: the snapshot's account list order is the
  available signal today; if no explicit recency exists, define one (e.g. a
  `nido:lastUsed` timestamp written on account use) or document that first-in-
  list is treated as most-recent. **Decision for this spec:** add a lightweight
  `nido:lastUsed:<contractId>` timestamp updated whenever an account page loads,
  and sort the picker by it; fall back to list order when absent.
- `?account=<C-addr>` param: if present and valid, preselect that account and
  skip straight to the confirm/claim action (no picker).
- On **Claim**: build the hand-off URL with the chosen C-address as a param and
  `window.location.assign` to the account's own subdomain.

### 2. Inline claim controller on `/account/` (new — replaces `?sign=` bounce for claims)
- Detect `?claim=<name>` on `/account/`. The claiming account is the page's own
  subdomain account (host), cross-checked against the `?account=` param.
- If the page has no usable account context (direct hit, missing/mismatched
  param) → launch the picker rather than erroring.
- Render a **progress card** modeled on the new-account creation checklist
  (`new-account/index.astro:82-119` step/ticker styles): build → sign → submit →
  confirm, each pending → active → done.
- Reuse existing claim machinery: register simulation, `buildAuthHash`, relayer
  vs classic submit, `waitForConfirmation`. The change is that **moment-A passkey
  runs inline** via the existing inline assertion path
  (`account/index.astro:447+` / `primaryPasskeySigner`) instead of redirecting to
  `?sign=`.
- On failure: show the error in the card with a retry affordance; preserve the
  pending-claim localStorage keys so retry does not rebuild from scratch
  needlessly.
- On success: `window.location.assign` to
  `https://alice.nido.fyi/account/?namepasskey=1`.

### 3. Friendly-passkey step on `alice.nido.fyi` (enhance existing `?namepasskey=1`)
- `?namepasskey=1` already reveals `#register-section`. Upgrade this to an inline
  progress flow (moment B): create the `alice.nido.fyi` passkey with a progress
  card, persist the credential (`sdkSaveCredential`), then reveal `#home-mode`
  (the dashboard).
- Keep it skippable is **out of scope** for this spec — the chosen design is
  "prompt inline"; user can still navigate away, but no explicit skip button.

### 4. Return-intent plumbing (new)
- `/new-account/?then=claim:alice`: after a brand-new account is created and
  deployed, instead of (or in addition to) landing on the bare dashboard, honor
  `then=claim:<name>` by redirecting into the claim flow for `<name>` (i.e. to
  `https://<name>.nido.fyi/?account=<new C-addr>` so the confirm→claim path runs).

## Data / State

- **Accounts list:** `nido:accounts` via `localNidoSnapshot` /
  `syncNidoStorageViaBridge` (cross-subdomain bridge to apex).
- **Names map:** `nido:names:<contractId>` → name. Updated on successful claim
  (existing `finishClaim` behavior).
- **Recency (new):** `nido:lastUsed:<contractId>` → epoch ms, written on account
  page load, read for picker default ordering. Synced opportunistically via the
  existing bridge if cheap; otherwise local-only (default ordering is a UX nicety,
  not correctness).
- **Pending claim (existing):** `nido:name-pending`, `nido:name-claim-hash`,
  `nido:name-txXdr` — reused by the inline controller; cleared on success.
- **URL params:** `?account=<C-addr>` (claimer), `?claim=<name>` (target name on
  the account subdomain), `?from=<host>` (origin breadcrumb), `?namepasskey=1`
  (friendly-passkey step), `?then=claim:<name>` (return intent).

## Edge Cases

- **Name taken** → existing dashboard, unchanged.
- **Name invalid/reserved** (fails `VALID_NAME_RE` = `^[a-z][a-z0-9]{0,14}$`) →
  informational message, no claim button.
- **0 accounts** → `/new-account/?then=claim:alice`.
- **Multiple accounts** → picker, defaulting to most-recently-used; switchable.
- **`?account=` param present** → skip picker.
- **Direct hit on `/account/?claim=` with no/mismatched account** → launch picker.
- **Account already has a name** → not special-cased in UI; C-address identifies
  the claimer and the registry contract enforces validity. *(To confirm during
  implementation: does the registry permit an account to (re)claim/replace a
  name? If it hard-rejects, surface that error in the progress card.)*
- **Bridge sync fails / times out** → fall back to local snapshot; if still 0
  accounts, treat as "0 accounts".

## Reuse vs New

**Reuse:** `resolveAccount`, `syncNidoStorageViaBridge` / `localNidoSnapshot`,
`myNidoModel` / `nidoSwitcher`, claim tx build + `relayerClient` submit +
`waitForConfirmation`, new-account progress-ticker markup/styles,
`#register-section`, inline passkey assertion path.

**New:** available-name confirm/picker view; `?claim=` inline-claim controller
(replacing the `?sign=` bounce for claims); `?then=` return-intent handling;
`nido:lastUsed` recency.

## Testing

- **Unit (vitest):** name-state classification (taken / available / invalid);
  claimer selection (param > most-recent > picker); hand-off URL construction
  (correct `accountHost` for named vs unnamed account, params encoded);
  return-intent parsing (`then=claim:alice`).
- **Pure-logic extraction:** put claimer-selection and URL-construction in a
  testable lib module (e.g. `lib/claimFlow.ts`) so the `.astro` glue stays thin.
- **Manual / Playwright (testnet):** full happy path across the two subdomains
  (requires real passkey virtual authenticator — note rpId differs per
  subdomain, so the harness must register credentials per host).

## Open Questions (to resolve in implementation, non-blocking)

1. Registry behavior when an already-named account claims a second name (replace
   vs reject). Drives whether step 2 needs a "you already have a name" guard.
2. Whether `nido:lastUsed` should sync cross-subdomain or stay local (default:
   local; revisit if the picker default feels wrong across devices/subdomains).
