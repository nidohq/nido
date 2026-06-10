# Session-Key Scope UI (Deliverable 4, PR 2 — #72)

**Issue:** [#72](https://github.com/theahaco/g2c/issues/72), second half. PR 1 (relayer gas abstraction, #73) is this branch's base.
**Deliverable text:** "Session key UI: users can grant dApps scoped signing permissions (contract restrictions, spending limits, time windows) via context rules." Proof: "Session key can be created with scope restrictions and used by a dApp to execute a scoped transaction."

## Goal

Users approving a dApp delegation can attach a **spending limit** (amount + rolling period) alongside the existing **contract restriction** and **time window**; the Security page shows each app's full scope and offers a working **revoke**. Proof on testnet: the status-message dApp tips an author via a session key scoped to the XLM SAC with a daily limit — in-limit tips land gaslessly through the relayer, an over-limit tip is rejected on-chain, an out-of-scope call is rejected (already covered by `scoped_session_key.rs`).

## Current state (recon 2026-06-10, all verified in-repo)

- Delegate flow (`/security/delegate/`): params `origin`/`target`/`pubkey`/`duration`/`return`; durations 24h/7d/30d/none → `valid_until = latest.sequence + {17280, 120960, 518400, ∞}` (correction discovered in final review: the page's `?? 17280` coerces `none` to 24h — pre-existing bug, untouched by this PR, candidate for a follow-up issue); installs via `add_context_rule` with `CallContract(target)`, one `External(verifier, pubkey)` signer, and an **empty policies Map**.
- Security page: `SessionKeyCard` shows label + expiry; **revoke is a placeholder alert** ("Task 22"); no `remove_context_rule` call site exists in the frontend.
- OZ pinned rev `637c53a` ships `policies::spending_limit`: `SpendingLimitAccountParams { spending_limit: i128 /*stroops*/, period_ledgers: u32 }`, rolling window (entries older than `current - period` evicted), **meters only SAC `transfer` calls** (fn symbol `transfer`, amount = args[2]), `CallContract` contexts only, max 1000 window entries, plus `set_spending_limit`/`uninstall`. It is a library: a thin policy **contract** wrapper must be deployed (exact precedent: `contracts/multisig-policy` wrapping `simple_threshold`, deployed + registered as `unverified/multisig-policy`, resolved via stellar-registry).
- The policy is deny-by-default: `enforce` panics `NotAllowed` for any non-transfer context, so a limit on a non-SAC scope (e.g. the status-message contract) is prohibitive — it blocks every call the rule would otherwise allow — not vacuous; hence the tip feature targets the SAC, where transfers are the point: the dApp calls `SAC.transfer(from=smartAccount, to=author, amount)` **directly**, so the auth context is `CallContract(SAC)` and both the scope match and the limit metering apply.

## Decisions (settled with Willem, 2026-06-10)

1. Spending-limit proof = **status-message dApp "tip the author"** (session key scoped to the XLM SAC, e.g. 5 XLM/day).
2. Security page v1 = **scope display + revoke only** (no in-place `set_spending_limit` editing; changing a limit means revoke + re-delegate).
3. Limit UI: amount in XLM + period preset (per day / per week / per 30 days → 17280 / 120960 / 518400 ledgers), "No limit" when unset. dApps may *suggest* via new optional URL params `limit` (XLM decimal) and `limit_period` (`day|week|30d`, default `day`); the user can edit before approving.
4. Policy contract address resolved at runtime via the registry name `spending-limit-policy` (same pattern the frontend already uses for `name-registry`).

## Components

### 1. `contracts/spending-limit-policy` (new, mirrors `contracts/multisig-policy`)

`#![no_std]` contract implementing OZ's `Policy` trait with `AccountParams = SpendingLimitAccountParams`, delegating `enforce`/`install`/`uninstall` to `stellar_accounts::policies::spending_limit`. Expose `set_spending_limit` pass-through for forward-compat (unused by UI v1). Build via `just build-contracts`; deploy to testnet; register `unverified/spending-limit-policy`; add to `DEPLOYED.md`.

### 2. Delegate approval screen

- Parse optional `limit` + `limit_period`; render an editable limit row (amount input, period select, "No limit" state). Copy notes limits meter **token transfers** in the scoped contract.
- On approve with a limit: resolve the policy address via registry, build `policies = Map{ policyAddr → SpendingLimitAccountParams{ stroops(amount), periodLedgers } }` and pass it to the existing `add_context_rule` call. Without a limit: unchanged empty Map.
- Submission continues through `signAndSubmit` (gasless when the relayer flag is on — inherited from PR 1).

### 3. Security page ("Apps you've let in")

- `SessionKeyCard` upgrade: show target contract (short + explorer link), expiry (raw ledger number, as before), and — when the rule carries the spending-limit policy — "Limit: X XLM per <period>" (read from rule policies/policy state; spent-so-far not shown in v1 (the wrapper getter returns params only)).
- **Real revoke**: `remove_context_rule(ruleId)` through the bindings client + `signAndSubmit`, with confirm dialog (existing), success toast, row refresh, and local session-material cleanup for that target. This closes the "Task 22" placeholder (and only the session-key card; the recovery card's placeholder is out of scope).

### 4. status-message dApp tip feature

- "Enable tipping" → existing `startDelegation` with `targetContract = XLM SAC id`, `duration` (reuse selector), plus `limit=5`, `limit_period=day` suggestion.
- "Tip 1 XLM" button per message author: in-page session signing (generalize `nidoSign`'s flow) of a **direct `SAC.transfer(smartAccount → author, amount)`** call; submit via the relayer (`{func, auth}` to `POST /relay`) so tipping is gasless; surface the explorer link.
- Over-limit attempt surfaces the on-chain rejection (relayer returns the enforce failure) in the dApp UI.
- Relayer client reuse: lift the pure fetch client from `packages/frontend/src/lib/relayerClient.ts` into `@g2c/passkey-sdk` (it is env-free — every function takes `baseUrl`); `relayerClient.ts` becomes the env-defaulting shim; `network.ts` holds only RELAYER_URL. Frontend tests move with it.

### 5. Proofs

- **Rust integration test** (new, in `crates/integration-tests`): register the wrapper policy contract; install a session-key rule with the policy; within-limit SAC transfer auth succeeds; cumulative over-limit attempt panics; window roll (advance ledgers past the period) allows spending again.
- **Testnet proof for the PR**: scripted or preview-driven tip run — in-limit tip hash (fee-bump via relayer, session-key credential) + over-limit rejection evidence; recorded in the PR description like PR 1.

## Error handling

- Delegate approve with limit but registry resolution fails → blocking error before signing ("spending-limit policy unavailable"), never silently install without the limit the user saw.
- Revoke failure surfaces the signAndSubmit error in the card; row stays until confirmed on-chain.
- dApp tip: relayer rejection (limit/scope/expiry) mapped to a readable message; the session material is kept (rule may still be valid for smaller amounts).

## Out of scope

- In-place limit editing (`set_spending_limit` UI), multi-asset limit UI (one SAC scope = one asset; XLM only in the demo), recovery-card revoke wiring, per-function allowlists beyond `CallContract`, relayer-side per-key quotas.

## Stacking note

This branch is stacked on `feat/72-relayer-gas-abstraction` (PR #73). **Retarget this PR's base to `main` before PR 1 merges** (project memory: merging a stacked base and deleting its branch closes the child PR).
