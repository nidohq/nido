# Unified Transaction-Signing Surface

**Date:** 2026-06-25
**Status:** Design — approved, pending implementation plan

## Summary

Today Nido presents transaction authorization in several inconsistent ways. A
name claim runs **inline** on the account page behind an opaque four-step
"Claiming your name" progress ticker that never shows the user *what
transaction they are signing*. A connected dApp's transaction goes to the
`/sign/` page. The account page also has its own `#signing-mode` view reached by
`?sign=&callback=`. Granting a dApp a session key has its own bespoke screen at
`/security/delegate/`. Each path re-implements transaction description, a
"show details" toggle, submission, and progress.

This design collapses every **primary-passkey authorization moment** onto **one
canonical signing page** (`/sign/`) that always behaves the same way:

1. Show a human-readable summary of the transaction.
2. Offer an expandable raw/technical-details panel.
3. Run the passkey ceremony.
4. Submit (via the relayer for the account's own actions; sign-and-submit-then-
   return for dApp requests).
5. Show post-submit progress through to confirmation.

The name claim, in particular, stops being an opaque inline ticker and becomes
a transaction you review and approve like any other — which is the motivating
requirement.

## Goal & non-goals

### In scope — the "primary-passkey moments"

These all route to the canonical signing surface:

- **Name claim** (`register(account, name)`) — the motivating case.
- **Asset transfer** (`transfer(...)` via the account).
- **Session-key grant** (`add_context_rule`) — currently the bespoke
  `/security/delegate/` screen.
- **Session-key revoke** (`remove_context_rule`).
- **Explicit dApp approval** — a dApp transaction that is *not* covered by an
  in-scope session key (no session key yet, or out of scope), so it needs an
  explicit passkey approval.

### Out of scope (explicit)

- **In-page session-key signing** (the example dApp's tips/status updates). After
  a one-time delegation grant, the dApp signs in-page with its own delegated
  session key and the relayer (or a throwaway source) submits — no Nido UI, no
  bounce. This frictionless path is the entire point of delegation and is **left
  untouched**.
- **New-name passkey registration after a claim.** Once a name is claimed the
  user is sent to the name's own subdomain to register a passkey *for that
  domain*. That is WebAuthn **registration**, not transaction signing, and is
  bound to a different rpId — it cannot run on the signing surface and remains
  the separate post-claim step it is today.
- **Relayer / contract architecture.** No changes to the relayer, the factory,
  or the smart-account contracts.

## Background — current state (verified against the code)

### Submission models

| Flow | Who submits | Path |
| --- | --- | --- |
| Nido's own actions (transfer, claim, status update) | **Relayer** (full lifecycle, returns hash) | `primaryPasskeySigner.signAndSubmit()` when `relayerEnabled()` |
| dApp via wallet-kit (`NidoModule.signTransaction`) | **dApp** (Nido returns signed XDR) | `/sign/` → `postResultToOpener` |
| In-page session-key tip/update | Relayer or throwaway source | `examples/.../nidoSign.ts` (session key signs the auth entry) |

The dApp-submits model only works for the example dApp's **classic G-address**
branch. A Nido **smart account (C-address)** cannot be a classic transaction
source and holds no XLM for fees — that is exactly why the relayer exists. So a
dApp cannot submit a gas-abstracted Nido transaction itself; only Nido (which
holds the relayer relationship: channel-account source + fee-bump) can. Vanilla
SEP-43 `signTransaction` → "dApp submits to RPC" is therefore wrong for smart
accounts. This design resolves it: **Nido submits via the relayer and returns
the resulting tx hash to the dApp** (with a submitted-marker so the dApp does not
re-broadcast).

### Passkey vs session key

- **Primary passkey** authorizes privileged / explicit moments: name claim,
  transfer, granting a session key (`add_context_rule`), revoking it. These are
  the moments the signing surface owns.
- **Session key** (a separate WebAuthn credential the dApp mints on its own
  origin, registered on the smart account via a scoped `add_context_rule`)
  authorizes in-scope dApp calls in-page with no Nido UI. Out-of-scope or
  over-limit calls are rejected on-chain / by the relayer.

### Existing reusable pieces this design extends

- `lib/transfer/txSummary.ts` — `describeTransaction(xdr)`, `describeOperation`,
  `describeInvokeContract` (recognizes `transfer`, `register`, generic invoke).
- `lib/transfer/review.ts` — `renderTransferReview`, `renderNameRegister`,
  `renderGenericOp` (already shared between `/sign/` and `/transfer/`).
- `lib/primaryPasskeySigner.ts` — `signAndSubmit` with the relayer/classic
  branch.
- `lib/progressSteps.ts` — the step ticker controller.
- `lib/walletSign.ts` / `injectPasskeySignature` — building the
  `SorobanAuthorizationEntry` from a passkey assertion.

## Architecture

Three new abstractions plus one canonical page. Existing surfaces become thin
callers.

### 1. `SignRequest` — the typed intent

A serializable request a caller hands to the signing surface.

```
SignRequest {
  kind: 'name-claim' | 'transfer' | 'session-grant' | 'session-revoke'
      | 'dapp-tx' | 'generic'
  account: string            // the Nido C-address that authorizes
  operation: OperationDescriptor | { frozenXdr: string }
  title: string              // e.g. "Claim alice"
  subtitle?: string          // e.g. "An app is asking you to sign…"
  submitMode: 'relayer' | 'return-to-dapp'
  editable?: EditableSchema  // optional inline controls (e.g. grant cap/period/expiry)
  returnTarget:              // where to go on success/cancel
      { type: 'route', url: string }
    | { type: 'dapp', origin: string, callbackUrl?: string }
  dappOrigin?: string        // for kind: 'dapp-tx'
}
```

`OperationDescriptor` is a **high-level** op the surface can *build and
re-build* into a transaction:

- `{ type: 'register', name }`
- `{ type: 'transfer', token, to, amount }`
- `{ type: 'add_context_rule', target, signer, validUntil, policies }`
- `{ type: 'remove_context_rule', ruleId }`

For `kind: 'dapp-tx'` the operation is the already-built **frozen XDR** (Nido did
not author it; it can only describe, sign, and submit it).

Building a high-level operation rather than a frozen XDR is what lets the surface
host **editable controls** (the grant's spending cap) — it rebuilds and
re-simulates the transaction after the user edits, which a frozen XDR cannot
support.

### 2. The canonical `/sign/` route — the surface

A single Astro page that owns the full lifecycle. On load:

1. **Resolve** the `SignRequest`: read it from same-origin `sessionStorage` by a
   short id (`/sign/?req=<id>`), or **normalize** a legacy entry (`?sign=`,
   `?xdr=`, `?claim=`) into a `SignRequest` for back-compat and bookmarked URLs.
2. **rpId guard**: ensure we are on the account's **contract-id subdomain** (the
   passkey's rpId). If not, redirect there, carrying the request via the existing
   cross-subdomain **query handoff** (the claim flow already crosses subdomains
   this way; `sessionStorage` is per-origin and must not be relied on across the
   hop).
3. **Build + simulate**: a per-kind builder turns `operation` into an assembled
   transaction; simulate to discover the smart account's auth entry, footprint,
   and fee. (Frozen dApp XDR skips the build and is only simulated/described.) A
   skeleton is shown while this runs.
4. **Review render**: `describeTransaction` → op summaries → per-kind renderer →
   the primary human-readable card, plus the single shared **"Show technical
   details"** expander (decoded ops, raw XDR, auth hash, fee, contract/registry
   ids).
5. **Editable controls** (only if `editable` is present): render inline controls;
   on change, rebuild + re-simulate + repaint the review.
6. **Ceremony**: "Confirm it's you" → passkey assertion over the auth digest →
   `injectPasskeySignature`.
7. **Submit** per `submitMode`:
   - `relayer`: `submitSorobanTransaction({ func, auth })` → `waitForConfirmation`,
     with the four-step `progressSteps` ticker now owned by the surface; classic
     fallback when the relayer is disabled.
   - `return-to-dapp`: Nido submits via the relayer, then returns the resulting
     **tx hash** to the dApp (postMessage / callback) with a **submitted-marker**
     so the dApp does not re-broadcast.
8. **Result + return**: success and error states render inline (generalizing the
   current `#claim-progress-error` + retry). On success, redirect to
   `returnTarget` (own action) or postMessage the dApp.

### 3. Review layer (extend existing modules)

- Add `renderSessionGrant(op, scope)` to `lib/transfer/review.ts` for
  `add_context_rule` (app origin, spending cap, expiry window, target contract).
- Recognize `add_context_rule` / `remove_context_rule` in
  `describeInvokeContract`.
- Extract the **single** technical-details expander component, replacing the two
  current toggles (the `/sign/` "Show raw transaction" and the account
  signing-mode "Show technical details").

### 4. Lifecycle engine (generalize `signAndSubmit`)

Promote `primaryPasskeySigner.signAndSubmit` into a `runSign(request, hooks)`
that performs build → simulate → sign → submit → confirm with progress callbacks,
reusing the existing relayer/classic branch. The `/sign/` page is a thin shell
over `runSign`.

## Consumers become thin callers

This design does a **full migration** in one effort: every consumer moves to the
surface and the old surfaces are deleted.

- **Name claim** — `runNameClaim` drops its inline ceremony, submission, and
  ticker; it builds a `SignRequest{ kind: 'name-claim', operation:
  {register, name}, submitMode: 'relayer', returnTarget: <name subdomain> }` and
  navigates to `/sign/`. After confirmation the surface redirects to the claimed
  name's subdomain, where the existing (separate, out-of-scope) new-passkey
  registration step runs unchanged.
- **Transfer** — `/transfer/` becomes form-only; it builds the transfer operation
  and hands it to `/sign/` with `submitMode: 'relayer'`.
- **Session grant** — `/security/delegate/` becomes a thin caller building
  `SignRequest{ kind: 'session-grant', operation: add_context_rule, editable:
  <scope schema> }`. Its scope-editing controls move into the surface's editable
  slot, so the grant renders as a standard transaction with the spending
  cap/period/expiry as the editable primary view and the raw `add_context_rule`
  op in the expander.
- **Session revoke** — a thin caller for `remove_context_rule`.
- **dApp explicit approval** — the wallet-kit `/sign/` entry normalizes into
  `SignRequest{ kind: 'dapp-tx', operation: {frozenXdr}, submitMode:
  'return-to-dapp', dappOrigin }`.

## Surfaces deleted / replaced

- `account/index.astro` `#signing-mode` container and its bespoke
  `describeSignRequest` / `renderStoredNameClaimDetails` / `renderClaimTxDetails`.
- The `#claim-progress` blob as the *claim UI* (the ticker component is reused
  inside the surface).
- `/security/delegate/`'s bespoke shell (logic moves to a caller + the editable
  slot).
- The two separate "show details" / "show raw" toggles collapse into one.

## Error handling

Each failure is a distinct inline state on the surface, with retry / return:

- build or simulate failure,
- passkey cancellation,
- relayer rejection (over spending limit, out of scope),
- confirmation timeout.

These generalize the existing claim error/retry behavior.

## Testing

- **Unit**: `SignRequest` build/normalize (including legacy `?sign=`/`?xdr=`/
  `?claim=` normalization), per-kind builders, review renderers (including the
  new `renderSessionGrant`), the `submitMode` branch.
- **Integration**: name claim end-to-end through the surface with a synthetic
  passkey; the grant flow rebuilding the tx after an editable-cap change; the
  dApp `return-to-dapp` path returning a hash with the submitted-marker; the
  relayer vs classic submission branch.
- Retarget existing `claimFlow` tests onto the new path.

## Risks & open questions

- **Cross-subdomain handoff.** `sessionStorage` is per-origin, so the single
  origin-crossing hop (name subdomain → account subdomain) must carry the request
  via query params or a parent-domain (`.nido.fyi`) cookie, reusing the
  mechanism the claim flow already uses. Most own-action callers already run on
  the account's own subdomain, so the same-origin `sessionStorage` handoff covers
  them.
- **Pre-simulation latency.** Building and simulating before the review renders
  adds latency; show a skeleton and only enable "Confirm it's you" once the
  review is populated.
- **dApp submitted-marker contract.** Define exactly what Nido returns for
  `return-to-dapp` so dApps know the transaction is already submitted and do not
  call `signAndSend`. Document this for the example dApp and the wallet-kit
  module.
